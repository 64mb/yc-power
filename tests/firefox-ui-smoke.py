#!/usr/bin/env python3
"""exercise the real content bundle in an isolated headless Firefox profile"""
import argparse
import base64
import contextlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import socket
import struct
import subprocess
import tempfile
import threading
import time
import zlib

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *_args):
        pass


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


class Marionette:
    def __init__(self, connection):
        self.connection = connection
        self.sequence = 0
        self.receive()

    def receive(self):
        prefix = b''
        while not prefix.endswith(b':'):
            chunk = self.connection.recv(1)
            if not chunk:
                raise RuntimeError('Firefox closed the test connection')
            prefix += chunk
        remaining = int(prefix[:-1])
        data = b''
        while len(data) < remaining:
            data += self.connection.recv(remaining - len(data))
        return json.loads(data)

    def command(self, name, arguments=None):
        self.sequence += 1
        data = json.dumps([0, self.sequence, name, arguments or {}]).encode()
        self.connection.sendall(str(len(data)).encode() + b':' + data)
        response = self.receive()
        if response[2]:
            raise RuntimeError(name + ': ' + response[2]['message'])
        result = response[3]
        return result.get('value') if isinstance(result, dict) and 'value' in result else result

    def evaluate(self, script):
        return self.command('WebDriver:ExecuteScript', {'script': script, 'args': []})

    def wait(self, script, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            result = self.evaluate(script)
            if result:
                return result
            time.sleep(.1)
        raise AssertionError('Timed out: ' + script[:160])

    def click(self, expression):
        point = self.evaluate('const e=' + expression + '; if(!e) throw Error("Missing test control");const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};')
        self.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'duration': 30, 'origin': 'viewport', **point},
            {'type': 'pointerDown', 'button': 0}, {'type': 'pointerUp', 'button': 0},
        ]}]})


def pixel(image, x, y):
    data = base64.b64decode(image)
    index = 8
    compressed = b''
    while index < len(data):
        length = struct.unpack('>I', data[index:index + 4])[0]
        kind = data[index + 4:index + 8]
        chunk = data[index + 8:index + 8 + length]
        index += length + 12
        if kind == b'IHDR':
            width, height, depth, color, _, _, _ = struct.unpack('>IIBBBBB', chunk)
        elif kind == b'IDAT':
            compressed += chunk
    assert depth == 8 and color in (2, 6), (depth, color)
    channels = 4 if color == 6 else 3
    stride = width * channels
    raw = zlib.decompress(compressed)
    previous = [0] * stride
    for row_index in range(y + 1):
        filter_type = raw[row_index * (stride + 1)]
        row = list(raw[row_index * (stride + 1) + 1:(row_index + 1) * (stride + 1)])
        for column in range(stride):
            left = row[column - channels] if column >= channels else 0
            above = previous[column]
            corner = previous[column - channels] if column >= channels else 0
            predictors = [0, left, above, (left + above) // 2]
            estimate = left + above - corner
            distances = [abs(estimate - left), abs(estimate - above), abs(estimate - corner)]
            predictors.append([left, above, corner][distances.index(min(distances))])
            row[column] = (row[column] + predictors[filter_type]) & 255
        previous = row
    return tuple(previous[x * channels:x * channels + 3]), width, height


def exercise(driver, origin, scenario):
    driver.command('WebDriver:Navigate', {'url': origin + '/tests/fixtures/native-tree.html?scenario=' + scenario})
    ready = driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r && r.querySelector(".ycp-toggle") && !r.textContent.includes("Loading cloud list") && !r.textContent.includes("Reading the console tree") && {count:r.querySelector(".ycp-toggle .g-text")?.textContent};')
    expected = '30' if scenario == 'virtual' else '3' if scenario == 'small' else ''
    if expected:
        assert ready['count'] == expected, (scenario, ready, driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.textContent.slice(-500);'))
    text = driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent;')
    assert 'Could not read' not in text, text
    assert not driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-search");')
    if scenario == 'virtual':
        return {'scenario': scenario, 'clouds': ready['count']}
    driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-toggle button")')
    selected = 'cloud-beta' if scenario == 'multi' else 'cloud-alpha'
    driver.click('document.querySelector("[data-list-item=\\"cloud.' + selected + '\\"] .ycp-add-native")')
    driver.wait('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud").length===1;')
    text = driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent;')
    assert ('Beta organization' if scenario == 'multi' else 'Alpha organization') in text, text
    assert ('Beta' if scenario == 'multi' else 'Alpha') in text, text
    driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-toggle button")')
    tree_style = driver.evaluate('const s=getComputedStyle(document.querySelector(".cloud-tree-list-container"));return {visibility:s.visibility,opacity:s.opacity};')
    assert tree_style == {'visibility': 'visible', 'opacity': '1'}, tree_style
    icon = driver.evaluate('const r=document.querySelector(".header-icon").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:innerWidth,h:innerHeight};')
    screenshot = driver.command('WebDriver:TakeScreenshot', {'full': False, 'scroll': False})
    value, _, _ = pixel(screenshot, icon['x'], icon['y'])
    assert all(abs(a - b) < 6 for a, b in zip(value, (52, 143, 255))), ('Shared SVG disappeared', value)
    driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector("button[title=\\"Original sidebar\\"]")')
    driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");')
    alignment = driver.evaluate('const a=document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button").getBoundingClientRect();const b=document.querySelector("#native-toggle").getBoundingClientRect();return Math.abs((a.y+a.height/2)-(b.y+b.height/2));')
    assert alignment < 2, alignment
    driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")')
    driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-header");')
    driver.evaluate('window.scrollTo(0,200);return true;')
    driver.wait('return Math.abs(document.querySelector("[data-ycp-aside]").getBoundingClientRect().top)<1;')
    return {'scenario': scenario, 'plus': 'visible selection', 'sharedSvg': 'visible', 'returnIcon': 'aligned', 'sticky': 'preserved'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--firefox', default=shutil.which('firefox') or '/Applications/Firefox.app/Contents/MacOS/firefox')
    args = parser.parse_args()
    if not (ROOT / 'content.js').exists():
        raise SystemExit('Run npm run build first')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix='yc-power-firefox-test-') as directory:
        port = free_port()
        Path(directory, 'user.js').write_text('user_pref("marionette.port", %d);\nuser_pref("browser.aboutwelcome.enabled", false);\nuser_pref("browser.shell.checkDefaultBrowser", false);\n' % port)
        process = subprocess.Popen([args.firefox, '-headless', '-no-remote', '-profile', directory, '-marionette'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    connection = socket.create_connection(('127.0.0.1', port), timeout=1)
                    break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError('Firefox did not start its isolated test session')
            connection.settimeout(30)
            driver = Marionette(connection)
            driver.command('WebDriver:NewSession', {'capabilities': {'acceptInsecureCerts': True}})
            driver.command('Marionette:SetContext', {'value': 'content'})
            driver.command('WebDriver:SetWindowRect', {'width': 1200, 'height': 800})
            origin = 'http://127.0.0.1:' + str(server.server_port)
            for scenario in ['small', 'multi', 'virtual']:
                print(json.dumps(exercise(driver, origin, scenario)), flush=True)
            driver.command('WebDriver:DeleteSession')
        finally:
            process.terminate()
            with contextlib.suppress(subprocess.TimeoutExpired):
                process.wait(timeout=10)
            if process.poll() is None:
                process.kill()
                process.wait()
            server.shutdown()


if __name__ == '__main__':
    main()

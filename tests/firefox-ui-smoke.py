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
    if scenario == 'delayed-controls':
        driver.wait('return fixture.expansionClicks===1;', timeout=25)
        driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-all-row button")')
        visibility = driver.evaluate('const t=document.querySelector(".cloud-tree-list-container"),r=document.querySelector("[data-ycp-host]").shadowRoot;return {expanded:r.querySelector(".ycp-all-row button").getAttribute("aria-expanded"),inert:t.hasAttribute("inert"),covered:t.hasAttribute("data-ycp-covered")};')
        assert visibility == {'expanded': 'true', 'inert': False, 'covered': False}, visibility
        expected = driver.evaluate('const list=document.querySelector(".cloud-tree-list");list.scrollTop=250;fixture.pauseAt=performance.now();return list.scrollTop;')
        assert expected > 0
        driver.wait('return performance.now()-fixture.pauseAt>1000;')
        assert driver.evaluate('return document.querySelector(".cloud-tree-list").scrollTop;') == expected
        driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-all-row button")')
        driver.wait('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status")?.textContent.includes("Loading");')
        driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.title==="Default sidebar")')
        driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");')
        assert not driver.evaluate('return document.querySelector(".cloud-tree-list-container").hasAttribute("inert");')
        expected = driver.evaluate('const list=document.querySelector(".cloud-tree-list");list.scrollTop=400;fixture.pauseAt=performance.now();return list.scrollTop;')
        driver.wait('return performance.now()-fixture.pauseAt>1000;')
        assert driver.evaluate('return document.querySelector(".cloud-tree-list").scrollTop;') == expected
        driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")')
        driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder");', timeout=25)
        return {'scenario': scenario, 'allClouds': 'opens immediately during load', 'defaultSidebar': 'interactive during load', 'scroll': 'not changed by cancelled scans', 'resume': 'folders load after return'}
    if scenario == 'cloud-order-scroll':
        driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelectorAll(".ycp-folder").length>=26&&!r.querySelector(".ycp-status");', timeout=25)
        points = driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const source=r.querySelector("[data-cloud-id=cloud-alpha] .ycp-link").getBoundingClientRect();const list=r.querySelector(".ycp-mine").getBoundingClientRect();return {source:{x:Math.round(source.x+source.width/2),y:Math.round(source.y+source.height/2)},target:{x:Math.round(list.x+80),y:Math.round(list.bottom-5)}};')
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'duration': 30, 'origin': 'viewport', **points['source']}, {'type': 'pointerDown', 'button': 0},
            {'type': 'pointerMove', 'duration': 600, 'origin': 'viewport', **points['target']}, {'type': 'pause', 'duration': 1500}, {'type': 'pointerUp', 'button': 0},
        ]}]})
        driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.mine.join(",")==="cloud-beta,cloud-alpha";')
        assert driver.evaluate('return location.pathname;') == '/clouds'
        driver.evaluate('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-mine").scrollTop=0;return true;')
        driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-cloud-id=cloud-beta] .ycp-link")')
        driver.wait('return location.pathname==="/clouds/cloud-beta";')
        return {'scenario': scenario, 'edgeScroll': 'reveals next cloud even over source folders', 'navigation': 'normal click preserved, suppressed during drag'}
    if scenario == 'cloud-order':
        driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===3;')
        points = driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const source=r.querySelector("[data-cloud-id=cloud-beta] .ycp-link").getBoundingClientRect();const target=r.querySelector("[data-cloud-id=cloud-alpha] .ycp-cloud").getBoundingClientRect();return {source:{x:Math.round(source.x+source.width/2),y:Math.round(source.y+source.height/2)},target:{x:Math.round(target.x+48),y:Math.round(target.y+5)}};')
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [
            {'type': 'pointerMove', 'duration': 30, 'origin': 'viewport', **points['source']}, {'type': 'pointerDown', 'button': 0},
            {'type': 'pointerMove', 'duration': 200, 'origin': 'viewport', 'x': points['source']['x']+10, 'y': points['source']['y']-5},
            {'type': 'pointerMove', 'duration': 600, 'origin': 'viewport', **points['target']}, {'type': 'pause', 'duration': 200}, {'type': 'pointerUp', 'button': 0},
        ]}]})
        try:
            driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.mine.join(",")==="cloud-beta,cloud-alpha,cloud-analytics";')
        except AssertionError:
            raise AssertionError(driver.evaluate('return {dropMarkers:document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("[data-ycp-drop]").length,mine:fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.mine};'))
        actual = driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;return {order:Array.from(r.querySelectorAll(".ycp-group")).map(e=>e.dataset.cloudId),folder:r.querySelector("[data-cloud-id=cloud-beta] .ycp-folder a")?.getAttribute("href")};')
        assert actual['order'] == ['cloud-beta', 'cloud-alpha', 'cloud-analytics'], actual
        assert 'cloud-beta/folder-beta' in actual['folder'], actual
        driver.command('WebDriver:Navigate', {'url': origin + '/tests/fixtures/native-tree.html?scenario=cloud-order'})
        driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===3;')
        assert driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-group").dataset.cloudId;') == 'cloud-beta'
        driver.evaluate('document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-cloud-id=cloud-beta] .ycp-cloud").focus();return true;')
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [{'type': 'keyDown', 'value': '\ue00a'}, {'type': 'keyDown', 'value': '\ue015'}, {'type': 'keyUp', 'value': '\ue015'}, {'type': 'keyUp', 'value': '\ue00a'}]}]})
        driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",")==="cloud-alpha,cloud-beta,cloud-analytics";')
        assert driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.activeElement?.closest("[data-cloud-id]")?.dataset.cloudId;') == 'cloud-beta'
        for arrow, expected in [('\ue013', 'cloud-beta,cloud-alpha,cloud-analytics'), ('\ue015', 'cloud-alpha,cloud-beta,cloud-analytics')]:
            driver.command('WebDriver:PerformActions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [{'type': 'keyDown', 'value': '\ue00a'}, {'type': 'keyDown', 'value': arrow}, {'type': 'keyUp', 'value': arrow}, {'type': 'keyUp', 'value': '\ue00a'}]}]})
            driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",")===' + json.dumps(expected) + ';')

        driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");', timeout=25)
        points = driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const s=r.querySelector("[data-cloud-id=cloud-beta] .ycp-link").getBoundingClientRect(),t=r.querySelector("[data-cloud-id=cloud-alpha] .ycp-cloud").getBoundingClientRect();return {source:{x:Math.round(s.x+s.width/2),y:Math.round(s.y+s.height/2)},target:{x:Math.round(t.x+48),y:Math.round(t.y+5)}};')
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerMove', 'duration': 30, 'origin': 'viewport', **points['source']}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerMove', 'duration': 500, 'origin': 'viewport', **points['target']}]}]})
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [{'type': 'keyDown', 'value': '\ue00c'}, {'type': 'keyUp', 'value': '\ue00c'}]}]})
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerUp', 'button': 0}]}]})
        assert driver.evaluate('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",");') == 'cloud-alpha,cloud-beta,cloud-analytics'
        assert driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("[data-ycp-drop],[data-ycp-dragging],[data-reordering]").length;') == 0
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerMove', 'duration': 30, 'origin': 'viewport', **points['source']}, {'type': 'pointerDown', 'button': 0}, {'type': 'pointerMove', 'duration': 500, 'origin': 'viewport', **points['target']}]}]})
        driver.evaluate('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.title==="Default sidebar").focus();return true;')
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'key', 'id': 'keyboard', 'actions': [{'type': 'keyDown', 'value': ' '}, {'type': 'keyUp', 'value': ' '}]}]})
        driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");')
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerUp', 'button': 0}]}]})
        driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")')
        driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-mine");')
        assert driver.evaluate('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"].mine.join(",");') == 'cloud-alpha,cloud-beta,cloud-analytics'
        assert driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("[data-ycp-drop],[data-ycp-dragging],[data-reordering]").length;') == 0
        driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.title==="Show all organization clouds in this panel")')
        assert not driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-cloud[data-reorderable]");')
        return {'scenario': scenario, 'mouseDrag': 'moves cloud with folders', 'reload': 'order restored', 'keyboard': 'Alt+Down works', 'allClouds': 'native order retained'}
    if scenario == 'folder-icons':
        driver.wait('return !!document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder");')
        initial = driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-item-icon .g-icon").innerHTML;')
        driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-row-action")')
        grid = driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;return Array.from(r.querySelectorAll(".ycp-icons [role=row]")).map(e=>e.querySelectorAll("button").length);')
        assert grid == [8, 8, 8], grid
        preset = driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-icons button[value=database] .g-icon").innerHTML;')
        driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-icons button[value=database]")')
        driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-edit button[type=submit]")')
        driver.wait('return fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"]?.custom["folder:folder-alpha"]?.icon==="database";')
        actual = driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-item-icon .g-icon").innerHTML;')
        assert actual == preset and actual != initial
        driver.command('WebDriver:Navigate', {'url': origin + '/tests/fixtures/native-tree.html?scenario=folder-icons'})
        driver.wait('return !!document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder");')
        assert driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-folder .ycp-item-icon .g-icon").innerHTML;') == preset
        driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud button")).find(b=>b.title==="Label and color")')
        driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-edit");')
        assert not driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-icons");')
        return {'scenario': scenario, 'presets': '24 in 8x3 grid', 'folderIcon': 'saved and restored', 'cloudIcon': 'fixed'}
    if scenario == 'expand-state':
        driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===2;')
        disclosure = 'Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud")).find(e=>e.querySelector("a").getAttribute("href").endsWith("cloud-beta")).querySelector("button")'
        assert not driver.evaluate('return (' + disclosure + ').disabled;')
        driver.click(disclosure)
        driver.command('WebDriver:PerformActions', {'actions': [{'type': 'pointer', 'id': 'mouse', 'parameters': {'pointerType': 'mouse'}, 'actions': [{'type': 'pointerMove', 'duration': 30, 'origin': 'viewport', 'x': 900, 'y': 500}]}]})
        driver.wait('const p=fixture.memory["yc-power:"+location.origin+":organization:id:org-alpha"];return Array.isArray(p.expandedClouds)&&!p.expandedClouds.includes("cloud-beta");')
        assert driver.evaluate('return getComputedStyle((' + disclosure + ').parentElement.querySelector(".ycp-row-action")).opacity;') == '0'
        driver.command('WebDriver:Navigate', {'url': origin + '/tests/fixtures/native-tree.html?scenario=expand-state'})
        driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelectorAll(".ycp-cloud").length===2;')
        assert driver.evaluate('return (' + disclosure + ').getAttribute("aria-expanded");') == 'false'
        driver.evaluate('history.pushState(null,"","/folders/folder-beta/dashboard");return true;')
        driver.wait('return (' + disclosure + ').getAttribute("aria-expanded")==="true";')
        driver.click(disclosure)
        driver.evaluate('browser.storage.local.set({compactDensity:true});return true;')
        assert driver.evaluate('return (' + disclosure + ').getAttribute("aria-expanded");') == 'false'
        return {'scenario': scenario, 'collapse': 'preserved on reload', 'navigation': 'reveals target once', 'mouseFocus': 'does not retain actions', 'busyDisclosure': 'enabled'}
    if scenario == 'empty-cache':
        driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelector(".ycp-header")&&!r.querySelector(".ycp-cloud")&&Array.isArray(fixture.memory["yc-power:"+location.origin+":catalog"])&&fixture.memory["yc-power:"+location.origin+":catalog"].length===0;')
        return {'scenario': scenario, 'cache': 'cleared after confirmed empty native list'}
    if scenario == 'failed':
        driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelector(".ycp-header")&&r.textContent.includes("Could not read");')
        return {'scenario': scenario, 'defaultView': 'my clouds retained after scan failure'}
    if scenario == 'multi-saved':
        driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r?.querySelector(".ycp-cloud")&&r.textContent.includes("Beta organization");')
        widths = driver.evaluate('return [...new Set(fixture.widths)];')
        assert widths and all(abs(width - 320) < 1 for width in widths), widths
        return {'scenario': scenario, 'savedOrganization': 'restored', 'initialWidth': 'stable'}
    if scenario.startswith('delayed'):
        if scenario == 'delayed-cache':
            driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder a")?.getAttribute("href").includes("folder-old");')
            driver.wait('const r=document.querySelector("[data-ycp-host]").shadowRoot;return Array.from(r.querySelectorAll(".ycp-folder a")).some(e=>e.getAttribute("href").includes("folder-alpha"))&&!Array.from(r.querySelectorAll(".ycp-folder a")).some(e=>e.getAttribute("href").includes("folder-old"));', timeout=25)
            assert driver.evaluate('return fixture.expansionClicks;') == 1
            driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");')
            driver.evaluate('window.fixture.folderDisappeared=false;const r=document.querySelector("[data-ycp-host]").shadowRoot;new MutationObserver(()=>{if(!r.querySelector(".ycp-folder"))fixture.folderDisappeared=true}).observe(r,{childList:true,subtree:true});return true;')
            driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("button")).find(b=>b.title==="Refresh clouds")')
            driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");')
            driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-status");', timeout=25)
            assert not driver.evaluate('return fixture.folderDisappeared;')
            assert driver.evaluate('return fixture.expansionClicks;') == 1
            return {'scenario': scenario, 'cache': 'rendered first', 'backgroundRefresh': 'fresh folders retained throughout repeated refresh'}
        if scenario == 'delayed-cancel':
            driver.wait('return fixture.expansionClicks===1;')
            modern = driver.evaluate('return Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).some(b=>b.title==="Show all organization clouds in this panel"&&!b.disabled);')
            assert modern
            driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.title==="Show all organization clouds in this panel")')
            driver.wait('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud").length===3;')
            driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-header button")).find(b=>b.title==="Show my clouds")')
            driver.click('Array.from(document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll("button")).find(b=>b.title==="Default sidebar")')
            driver.wait('return !!document.querySelector(".ycp-native-return-slot")?.shadowRoot?.querySelector("button");')
            driver.click('document.querySelector(".ycp-native-return-slot").shadowRoot.querySelector("button")')

        try:
            driver.wait('return document.querySelector("[data-ycp-host]")?.shadowRoot.querySelector(".ycp-folder");', timeout=25)
        except AssertionError:
            raise AssertionError(driver.evaluate('return {scenario:fixture.scenario,clicks:fixture.expansionClicks,panel:document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent,rows:document.querySelector(".cloud-tree-list").textContent};'))
        assert driver.evaluate('return fixture.expansionClicks;') == 1
        widths = driver.evaluate('return [...new Set(fixture.widths)];')
        assert widths and all(abs(width - 320) < 1 for width in widths), widths
        return {'scenario': scenario, 'savedCloudFolders': 'loaded automatically', 'nativeExpansion': 'once'}
    ready = driver.wait('const r=document.querySelector("[data-ycp-host]")?.shadowRoot;return r && r.querySelector(".ycp-toggle") && !r.textContent.includes("Loading cloud list") && !r.textContent.includes("Reading the console tree") && {count:r.querySelector(".ycp-toggle .g-text")?.textContent};')
    expected = '30' if scenario == 'virtual' else '3' if scenario == 'small' else ''
    if expected:
        assert ready['count'] == expected, (scenario, ready, driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.textContent.slice(-500);'))
    text = driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent;')
    assert 'Could not read' not in text, text
    assert not driver.evaluate('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-search");')
    if scenario == 'small':
        assert driver.evaluate('return getComputedStyle(document.querySelector("[data-ycp-host]")).backgroundColor;') == 'rgb(243, 245, 247)'
        for theme, background, foreground in [('dark-hc', 'rgb(31, 37, 43)', 'rgb(230, 235, 240)'), ('light-hc', 'rgb(255, 255, 255)', 'rgb(20, 25, 30)')]:
            driver.evaluate('document.querySelector(".cloud-tree-list-container").style.backgroundColor=' + json.dumps(background) + ';document.body.style.setProperty("--g-color-text-primary",' + json.dumps(foreground) + ');document.body.className=' + json.dumps('g-root g-root_theme_' + theme) + ';return true;')
            driver.wait('const h=document.querySelector("[data-ycp-host]");return getComputedStyle(h).backgroundColor===' + json.dumps(background) + ';')
            colors = driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;return {root:getComputedStyle(r.querySelector(".ycp-root")).backgroundColor,text:getComputedStyle(r.querySelector(".ycp-layout")).color};')
            assert colors == {'root': 'rgba(0, 0, 0, 0)', 'text': foreground}, colors
    if scenario == 'virtual':
        return {'scenario': scenario, 'clouds': ready['count']}
    driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-toggle button")')
    selected = 'cloud-beta' if scenario == 'multi' else 'cloud-alpha'
    driver.click('document.querySelector("[data-list-item=\\"cloud.' + selected + '\\"] .ycp-add-native")')
    driver.wait('return document.querySelector("[data-ycp-host]").shadowRoot.querySelectorAll(".ycp-cloud").length===1;')
    text = driver.evaluate('return document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-root").textContent;')
    assert ('Beta organization' if scenario == 'multi' else 'Alpha organization') in text, text
    assert ('Beta' if scenario == 'multi' else 'Alpha') in text, text
    if scenario == 'small':
        driver.evaluate('browser.storage.local.set({compactDensity:true});return true;')
        driver.wait('return !!document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-compact]");')
        compact = driver.evaluate('const row=document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-cloud");return {height:row.getBoundingClientRect().height,children:Array.from(row.children).map(e=>({height:e.getBoundingClientRect().height,font:getComputedStyle(e).lineHeight}))};')
        assert compact['height'] == 28, compact
        driver.evaluate('browser.storage.local.set({compactDensity:false});return true;')
        driver.wait('return !document.querySelector("[data-ycp-host]").shadowRoot.querySelector("[data-compact]");')
    geometry = driver.evaluate('const r=document.querySelector("[data-ycp-host]").shadowRoot;const row=r.querySelector(".ycp-cloud");const centers=Array.from(row.children).map(e=>{const b=e.getBoundingClientRect();return b.y+b.height/2});return {delta:Math.max(...centers)-Math.min(...centers),refresh:Array.from(row.querySelectorAll("button")).some(b=>b.title==="Refresh folders"),footer:!!r.querySelector(".ycp-footer")};')
    assert geometry['delta'] < 1 and not geometry['refresh'] and not geometry['footer'], geometry
    driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector(".ycp-toggle button")')
    tree_style = driver.evaluate('const s=getComputedStyle(document.querySelector(".cloud-tree-list-container"));return {visibility:s.visibility,opacity:s.opacity};')
    assert tree_style == {'visibility': 'visible', 'opacity': '1'}, tree_style
    icon = driver.evaluate('const r=document.querySelector(".header-icon").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:innerWidth,h:innerHeight};')
    screenshot = driver.command('WebDriver:TakeScreenshot', {'full': False, 'scroll': False})
    value, _, _ = pixel(screenshot, icon['x'], icon['y'])
    assert all(abs(a - b) < 6 for a, b in zip(value, (52, 143, 255))), ('Shared SVG disappeared', value)
    driver.click('document.querySelector("[data-ycp-host]").shadowRoot.querySelector("button[title=\\"Default sidebar\\"]")')
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
    parser.add_argument('--scenario', action='append')
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
            for scenario in args.scenario or ['small', 'multi', 'virtual', 'delayed', 'delayed-cancel', 'delayed-controls', 'delayed-cache', 'multi-saved', 'empty-cache', 'expand-state', 'folder-icons', 'cloud-order', 'cloud-order-scroll', 'failed']:
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

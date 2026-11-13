import {test, expect, firefox} from '@playwright/test';
import {access, mkdtemp, readFile, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createServer, createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'https://console.yandex.cloud';

async function freeDebuggerPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function installTemporaryAddon(port, addonPath) {
  let socket;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    socket = createConnection({host: '127.0.0.1', port});
    try {
      await new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
        socket.setTimeout(1000, () => socket.destroy(new Error('Firefox debugger connection timed out')));
      });
      break;
    } catch (error) {
      socket.destroy();
      if (Date.now() >= deadline) throw new Error('Firefox temporary add-on debugger did not start', {cause: error});
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  if (socket.readyState !== 'open') throw new Error('Firefox temporary add-on debugger did not start within 10 seconds');
  let buffer = Buffer.alloc(0), pending, failure;
  const messages = [];
  const fail = error => {
    failure = error;
    if (pending) { pending.reject(error); pending = undefined; }
  };
  socket.setTimeout(10000, () => socket.destroy(new Error('Firefox debugger packet timed out')));
  socket.on('error', fail);
  socket.on('close', () => fail(new Error('Firefox temporary add-on debugger disconnected')));
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const colon = buffer.indexOf(58);
      if (colon < 0) break;
      const length = Number(buffer.subarray(0, colon).toString());
      if (!Number.isSafeInteger(length) || length < 0) { socket.destroy(new Error('Invalid Firefox debugger packet')); return; }
      if (buffer.length < colon + 1 + length) break;
      let message;
      try { message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length)); }
      catch (error) { socket.destroy(error); return; }
      buffer = buffer.subarray(colon + 1 + length);
      if (pending) { const waiting = pending; pending = undefined; waiting.resolve(message); }
      else messages.push(message);
    }
  });
  const receive = () => {
    if (messages.length) return Promise.resolve(messages.shift());
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => { pending = {resolve, reject}; });
  };
  const request = async packet => {
    const data = Buffer.from(JSON.stringify(packet));
    socket.write(Buffer.concat([Buffer.from(data.length + ':'), data]));
    while (true) {
      const response = await receive();
      if (response.from !== packet.to || (response.type && response.type !== packet.type)) continue;
      if (response.error) throw new Error('Firefox add-on installation: ' + response.error + ': ' + response.message);
      return response;
    }
  };
  try {
    await receive();
    const root = await request({to: 'root', type: 'getRoot'});
    if (!root.addonsActor) throw new Error('Firefox debugger does not expose the temporary add-on actor');
    return await request({to: root.addonsActor, type: 'installTemporaryAddon', addonPath, openDevTools: false});
  } finally {
    socket.destroy();
  }
}

test('installed Firefox add-on selects initially unselected regional and local clouds', async ({}, testInfo) => {
  if (process.env.YC_POWER_DOCKER !== '1') throw new Error('Firefox extension checks must run in the isolated Docker test container');
  await access('/.dockerenv');
  test.setTimeout(120000);
  const directory = await mkdtemp(path.join(tmpdir(), 'yc-power-firefox-extension-'));
  const uuid = randomUUID();
  const profile = path.join(directory, 'profile');
  const archive = path.join(root, 'build/yc-power-firefox.xpi');
  await access(archive);
  const debuggerPort = await freeDebuggerPort();
  let context, page;
  const consoleMessages = [];
  try {
    context = await firefox.launchPersistentContext(profile, {
      headless: true,
      args: ['--start-debugger-server', String(debuggerPort)],
      viewport: {width: 1200, height: 800},
      firefoxUserPrefs: {
        'xpinstall.signatures.required': false,
        'devtools.debugger.remote-enabled': true,
        'devtools.debugger.prompt-connection': false,
        'devtools.debugger.force-local': true,
        'devtools.chrome.enabled': true,
        'extensions.webextensions.uuids': JSON.stringify({'yc-power@local': uuid}),
        'extensions.langpacks.signatures.required': false,
      },
    });
    context.on('console', message => consoleMessages.push({type: message.type(), text: message.text()}));
    const installed = await installTemporaryAddon(debuggerPort, archive);
    await testInfo.attach('firefox-temporary-addon-install', {body: JSON.stringify(installed, null, 2), contentType: 'application/json'});
    expect(installed.addon?.id ?? installed.id).toBe('yc-power@local');

    let html = await readFile(path.join(root, 'tests/fixtures/native-tree.html'), 'utf8');
    html = html.replace(/^window\.browser=.*$/m, '').replace('<script src="/content.js"></script>', '');
    html = html.replace('targetRegionId=region-beta', 'targetRegionId=kz');
    html = html.replace('item.append(a);li.append(item);return li;', `
      const title=document.createElement('div');title.className='cloud-tree-list-item__main';title.textContent=a.textContent;a.replaceChildren();
      const expansion=item.querySelector('.cloud-tree-list-item__expand-button');if(expansion)a.append(expansion);
      if(row.id==='cloud-beta'){
        const icon=document.createElement('div');icon.className='cloud-tree-list-item__icon';
        const regionIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');regionIcon.setAttribute('width','16');regionIcon.setAttribute('height','16');
        regionIcon.innerHTML='<circle cx="8" cy="8" r="6" fill="blue"/>';icon.append(regionIcon);a.append(icon);
      }
      a.style.display='flex';a.style.alignItems='center';a.style.minWidth='0';a.style.flex='1';a.append(title);item.append(a);const actions=document.createElement('div');actions.className='cloud-tree-list-item__actions';item.append(actions);li.append(item);return li;`);
    await context.route(origin + '/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (['/options.css', '/content.css'].includes(pathname)) {
        await route.fulfill({contentType: 'text/css', body: await readFile(path.join(root, pathname.slice(1)), 'utf8')});
      } else await route.fulfill({contentType: 'text/html', body: html});
    });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/tests/fixtures/native-tree.html?scenario=multi-regional');
    expect(await page.evaluate(() => typeof window.browser)).toBe('undefined');
    await expect(page.locator('[data-ycp-host] .ycp-toggle button')).toBeVisible({timeout: 20000});
    await expect(page.locator('[data-ycp-host] .ycp-cloud')).toHaveCount(0);

    for (const cloudId of ['cloud-beta', 'cloud-alpha']) {
      await page.locator('[data-ycp-host] .ycp-toggle button').click();
      const row = page.locator('[data-list-item="cloud.' + cloudId + '"]');
      const plus = row.locator('.ycp-add-native');
      await row.hover();
      await expect(plus).toHaveAttribute('aria-label', 'Add to my clouds');
      if (cloudId === 'cloud-beta') {
        await expect(row.locator('a')).toHaveAttribute('href', '/auth/move?targetRegionId=kz&targetService=console&targetPath=%2Fcloud%2Fcloud-beta');
        await expect(row.locator('.cloud-tree-list-item__expand-button')).toHaveCount(1);
        await expect(row.locator('a .cloud-tree-list-item__icon svg')).toHaveCount(1);
      }
      await plus.click();
      await expect(page.locator('[data-ycp-host] [data-cloud-id="' + cloudId + '"] .ycp-cloud')).toBeVisible();
      await row.hover();
      await expect(row.locator('.ycp-add-native')).toHaveAttribute('aria-label', 'Remove from my clouds');
      await page.locator('[data-ycp-host] .ycp-toggle button').click();
    }
    await expect(page.locator('[data-ycp-host] .ycp-cloud')).toHaveCount(2);
    await page.goto(origin + '/tests/fixtures/native-tree.html?scenario=multi-regional');
    await expect(page.locator('[data-ycp-host] .ycp-cloud')).toHaveCount(2, {timeout: 20000});
    await expect(page.locator('[data-ycp-host] a[href*="targetRegionId=kz"]')).toBeVisible();
    expect(errors).toEqual([]);
    await testInfo.attach('installed-firefox-extension', {body: await page.screenshot({fullPage: true}), contentType: 'image/png'});
  } catch (error) {
    const diagnostics = {consoleMessages};
    if (page && !page.isClosed()) {
      diagnostics.url = page.url();
      diagnostics.page = await page.locator('body').innerText({timeout: 3000}).catch(() => 'Unavailable');
      diagnostics.extensionHosts = await page.locator('[data-ycp-host]').count().catch(() => 0);
    }
    await testInfo.attach('firefox-extension-diagnostics', {body: JSON.stringify(diagnostics, null, 2), contentType: 'application/json'});
    throw error;
  } finally {
    if (page && !page.isClosed()) {
      await page.screenshot({fullPage: true}).then(body => testInfo.attach('firefox-extension-final-state', {body, contentType: 'image/png'})).catch(() => {});
    }
    await context?.close();
    await rm(directory, {recursive: true, force: true});
  }
});

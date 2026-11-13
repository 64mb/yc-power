import assert from 'node:assert/strict';
import {access, cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, test} from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
test('installed MV3 extension saves settings, transfers preferences and injects regional panel', async ({}, testInfo) => {
    if (process.env.YC_POWER_DOCKER !== '1') throw new Error('Browser smoke tests must run in the isolated Docker test container');
    await access('/.dockerenv');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'yc-power-chromium-'));
    let context;
    let page;
    try {
        const extension = path.join(directory, 'extension');
        await cp(path.join(root, 'build/chromium'), extension, {recursive: true});
        const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
        // grant only synthetic fixture hosts at install time to avoid a native permission prompt
        manifest.host_permissions.push('https://alpha.example/*', 'https://beta.example/*');
        await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
        context = await chromium.launchPersistentContext(path.join(directory, 'profile'), {
            channel: 'chromium', headless: false,
            args: ['--no-sandbox', '--password-store=basic', '--use-mock-keychain', '--disable-background-networking', '--load-extension=' + extension, '--disable-extensions-except=' + extension],
        });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const extensionOrigin = worker.url().slice(0, worker.url().lastIndexOf('/'));
        assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().manifest_version), 3);
        page = await context.newPage();
        await page.goto(extensionOrigin + '/options.html');
        await page.locator('.domain-row input').waitFor();
        await page.waitForFunction(() => !document.querySelector('.domain-row input').disabled);
        await page.waitForFunction(() => document.querySelector('.settings-logo').naturalWidth > 0);
        for (const host of ['https://alpha.example', 'https://beta.example']) {
            await page.getByRole('button', {name: 'Add address', exact: true}).click();
            await page.locator('.domain-row input').last().fill(host);
        }
        await page.locator('.domain-folder-toggle').nth(1).click();
        await page.locator('button[type=submit]').click();
        const expected = ['https://console.yandex.cloud', 'https://alpha.example', 'https://beta.example'];
        await page.waitForFunction(async () => (await chrome.storage.local.get('domainHosts')).domainHosts?.length === 3);
        assert.deepEqual(await worker.evaluate(async () => (await chrome.storage.local.get('domainHosts')).domainHosts), expected);
        await page.reload();
        await page.waitForFunction(() => document.querySelectorAll('.domain-row input').length === 3 && !document.querySelector('.domain-row input').disabled);
        assert.deepEqual(await page.locator('.domain-row input').evaluateAll((inputs) => inputs.map((input) => input.value)), expected);
        assert.equal(await page.locator('.domain-folder-toggle').nth(1).evaluate((button) => button.classList.contains('g-button_view_outlined-info')), true);

        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', {name: 'Export settings', exact: true}).click();
        const download = await downloadPromise;
        const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
        assert.equal(exported.format, 'yc-power-settings');
        assert.deepEqual(exported.settings.domainHosts, expected);
        exported.settings.compactDensity = true;
        exported.settings['yc-power:https://beta.example:organization:id:org-alpha'] = {mine: ['cloud-alpha'], initialized: true, expandedClouds: ['cloud-alpha'], width: 320, custom: {'cloud:cloud-alpha': {label: 'Imported alpha'}}};
        await page.locator('input[type=file]').setInputFiles({name: 'synthetic-settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))});
        await page.waitForFunction(() => document.querySelector('input[type=checkbox]').checked);
        assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('compactDensity')).compactDensity), false);
        await page.locator('button[type=submit]').click();
        await page.waitForFunction(async () => (await chrome.storage.local.get('compactDensity')).compactDensity === true);
        assert.equal(await worker.evaluate(async () => (await chrome.storage.local.get('yc-power:https://beta.example:organization:id:org-alpha'))['yc-power:https://beta.example:organization:id:org-alpha'].custom['cloud:cloud-alpha'].label), 'Imported alpha');
        await page.reload();
        await page.waitForFunction(() => document.querySelector('input[type=checkbox]')?.checked);
        await page.waitForFunction(() => !document.querySelector('.domain-row input').disabled);
        assert.equal(await page.getByRole('button', {name: 'Export settings', exact: true}).isEnabled(), true);
        assert.equal(await page.getByRole('button', {name: 'Import settings', exact: true}).isEnabled(), true);
        await page.waitForFunction(async () => (await chrome.scripting.getRegisteredContentScripts()).some((script) => script.matches.includes('https://beta.example/*')));
        for (const colorScheme of ['light', 'dark']) {
            await page.emulateMedia({colorScheme});
            await page.waitForFunction((theme) => document.querySelector('.g-root')?.classList.contains('g-root_theme_' + theme), colorScheme);
            const screenshot = testInfo.outputPath('options-' + colorScheme + '.png');
            await page.screenshot({path: screenshot, fullPage: true});
            await testInfo.attach('Options ' + colorScheme, {path: screenshot, contentType: 'image/png'});
        }
        await page.emulateMedia({colorScheme: 'light'});

        let html = await readFile(path.join(root, 'tests/fixtures/native-tree.html'), 'utf8');
        html = html.replace(/^window\.browser=.*$/m, '').replace('<script src="/content.js"></script>', '');
        await context.route('https://beta.example/**', async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            if (['/options.css', '/content.css'].includes(pathname)) {
                await route.fulfill({contentType: 'text/css', body: await readFile(path.join(root, pathname.slice(1)), 'utf8')});
            } else await route.fulfill({contentType: 'text/html', body: html});
        });
        const prefix = 'yc-power:https://beta.example';
        await worker.evaluate(async ({prefix}) => chrome.storage.local.set({
            [prefix + ':organization:id:org-beta']: {mine: ['cloud-beta'], initialized: true, expandedClouds: ['cloud-beta'], width: 320, custom: {}},
            [prefix + ':layout']: {scopeKey: prefix + ':organization:id:org-alpha', width: 320, collapsedOrganizations: []},
        }), {prefix});
        await page.goto('https://beta.example/tests/fixtures/native-tree.html?scenario=multi-regional');
        await page.locator('[data-ycp-host] .ycp-cloud').first().waitFor();
        await page.locator('[data-ycp-host] a[href*="targetRegionId=region-beta"]').first().waitFor();
        assert.equal(await page.evaluate(() => typeof window.browser), 'undefined');
        assert.equal(await page.locator('[data-ycp-host]').count(), 1);
        console.log(JSON.stringify({browser: 'Chromium', manifestVersion: 3, options: 'two origins and cloud-only persisted across reload', transfer: 'real export download and import persisted on Save', logo: 'loaded', background: 'dynamic registration verified', content: 'real isolated injection and regional link verified', permissions: 'synthetic hosts granted at test installation, native permission prompt not tested'}));
    } finally {
        if (page && !page.isClosed()) {
            const screenshot = testInfo.outputPath('chromium-extension.png');
            await page.screenshot({path: screenshot, fullPage: true}).then(() => testInfo.attach('Chromium extension', {path: screenshot, contentType: 'image/png'})).catch(() => {});
        }
        await context?.close();
        await rm(directory, {recursive: true, force: true});
    }
});

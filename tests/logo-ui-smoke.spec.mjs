import {test, expect} from '@playwright/test';

function insertBrand(stale = false) {
  const nav = document.createElement('nav');
  const anchor = document.createElement('a'); anchor.href = '/clouds'; anchor.id = 'fixture-brand';
  Object.assign(anchor.style, {display: 'inline-flex', width: '40px', height: '40px', alignItems: 'center'});
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('width', '32'); svg.setAttribute('height', '32');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M23.858 27.411c-2.813 1.925-6.204 1.825-13.01 1.866l-5.403-.01 2.734-7.362 4.05-.008c3.295.008 5.26-.242 6.86-1.387 1.555-1.114 2.503-2.828 3.642-5.919l1.415-3.795L32 10.793l-1.885 5.048c-2.39 6.389-3.475 9.603-6.257 11.57M8.142 4.589c2.813-1.925 6.204-1.825 13.01-1.866l5.403.01-2.734 7.362-4.05.008c-3.294-.008-5.26.242-6.86 1.387-1.555 1.114-2.503 2.828-3.642 5.919l-1.415 3.795L0 21.207l1.885-5.048C4.275 9.77 5.36 6.556 8.142 4.59'); path.setAttribute('fill', '#2A9FFF');
  svg.append(path); anchor.append(svg); nav.append(anchor); document.body.prepend(nav);
  history.pushState(null, '', '/clouds/cloud-alpha/folder-alpha');
  if (stale) {
    const anchor = document.querySelector('#fixture-brand');
    const path = anchor.querySelector('path');
    path.style.setProperty('fill', '#123456', 'important');
    path.dataset.ycpLogoOriginalFill = JSON.stringify({value: '', priority: ''});
    anchor.style.position = 'relative';
    anchor.dataset.ycpLogoOriginalPosition = JSON.stringify({value: '', priority: ''});
    const badge = document.createElement('span'); badge.dataset.ycpFolderBadge = ''; anchor.append(badge);
  }
}

test('native console logo follows cloud and current folder settings', async ({page}, testInfo) => {
  await page.goto('/tests/fixtures/native-tree.html?scenario=folder-icons');
  await expect(page.locator('.ycp-folder').first()).toBeVisible();
  await page.evaluate(insertBrand);
  const path = page.locator('#fixture-brand > svg > path');
  const badge = page.locator('[data-ycp-folder-badge]');
  await expect(path).toHaveCSS('fill', 'rgb(42, 159, 255)');
  await expect(badge).toHaveCount(0);
  await page.evaluate(async () => {
    const key = `yc-power:${location.origin}:organization:id:org-alpha`;
    await browser.storage.local.set({[key]: {...fixture.memory[key], custom: {'cloud:cloud-alpha': {color: '#123456'}, 'folder:folder-alpha': {color: '#ab1234', icon: 'terminal'}, 'folder:folder-analytics': {color: '#789abc', icon: 'server'}}}, colorConsoleLogo: true, showFolderBadge: true});
  });
  await expect(path).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await expect(badge).toHaveCSS('color', 'rgb(171, 18, 52)');
  await expect(badge.locator('svg.g-icon')).toBeVisible();
  await expect(badge).toHaveCSS('pointer-events', 'none');
  const logoBounds = await page.locator('#fixture-brand > svg').boundingBox();
  const badgeBounds = await badge.boundingBox();
  expect(badgeBounds.x).toBeGreaterThan(logoBounds.x + logoBounds.width / 2);
  expect(badgeBounds.x).toBeCloseTo(logoBounds.x + logoBounds.width - 5, 1);
  expect(badgeBounds.y).toBeCloseTo(logoBounds.y - 4, 1);
  expect(badgeBounds.y).toBeLessThan(logoBounds.y + logoBounds.height / 2);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.body.className = `g-root g-root_theme_${theme}`; }, theme);
    const screenshot = testInfo.outputPath(`console-logo-${theme}.png`);
    await page.screenshot({path: screenshot});
    await testInfo.attach(`console-logo-${theme}`, {path: screenshot, contentType: 'image/png'});
  }
  await page.evaluate(() => browser.storage.local.set({showFolderBadge: false}));
  await expect(badge).toHaveCount(0);
  await expect(path).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await page.evaluate(() => browser.storage.local.set({showFolderBadge: true, colorConsoleLogo: false}));
  await expect(badge).toHaveCSS('color', 'rgb(171, 18, 52)');
  await expect(path).toHaveCSS('fill', 'rgb(42, 159, 255)');
  await page.evaluate(() => browser.storage.local.set({colorConsoleLogo: true}));
  const firstIcon = await badge.locator('svg.g-icon').innerHTML();
  await page.evaluate(() => history.pushState(null, '', '/folders/folder-analytics'));
  await expect(badge).toHaveCSS('color', 'rgb(120, 154, 188)');
  await expect.poll(() => badge.locator('svg.g-icon').innerHTML()).not.toBe(firstIcon);
  await page.evaluate(() => history.pushState(null, '', '/clouds/cloud-alpha'));
  await expect(badge).toHaveCount(0);
  await page.evaluate(() => browser.storage.local.set({colorConsoleLogo: false}));
  await expect(path).toHaveCSS('fill', 'rgb(42, 159, 255)');
  await page.evaluate(() => browser.storage.local.set({colorConsoleLogo: true}));
  await expect(path).toHaveCSS('fill', 'rgb(18, 52, 86)');
  const externalPaint = [];
  page.on('request', request => { if (request.url().startsWith('https://untrusted.example/')) externalPaint.push(request.url()); });
  await page.evaluate(() => {
    const key = `yc-power:${location.origin}:organization:id:org-alpha`;
    return browser.storage.local.set({[key]: {...fixture.memory[key], custom: {...fixture.memory[key].custom, 'cloud:cloud-alpha': {color: 'url(https://untrusted.example/pattern.svg#paint)'}}}});
  });
  await expect(path).not.toHaveCSS('fill', 'rgb(18, 52, 86)');
  await expect.poll(() => path.evaluate(node => node.style.fill)).not.toContain('url(');
  expect(externalPaint).toEqual([]);
  await page.evaluate(() => {
    const key = `yc-power:${location.origin}:organization:id:org-alpha`;
    return browser.storage.local.set({[key]: {...fixture.memory[key], custom: {...fixture.memory[key].custom, 'cloud:cloud-alpha': {color: '#123456'}}}});
  });
  await expect(path).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await page.evaluate(() => {
    const anchor = document.querySelector('#fixture-brand'); const replacement = anchor.cloneNode(true); replacement.querySelector('path').style.removeProperty('fill'); anchor.replaceWith(replacement);
  });
  await expect(path).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await page.evaluate(() => browser.storage.local.set({_ycPowerReset: Date.now()}));
  await expect(path).toHaveCSS('fill', 'rgb(42, 159, 255)');
  await expect(badge).toHaveCount(0);
});

for (const enabled of [false, true]) {
  test(`fresh content context restores stale logo decorations with settings ${enabled ? 'enabled' : 'disabled'}`, async ({page}) => {
    await page.route('**/tests/fixtures/native-tree.html?scenario=folder-icons', async route => {
      const response = await route.fetch();
      const html = await response.text();
      const setup = `<script>(${insertBrand.toString()})(true);
` +
        `const settingsKey = 'yc-power:' + location.origin + ':organization:id:org-alpha';
` +
        `browser.storage.local.set({colorConsoleLogo:${enabled},showFolderBadge:${enabled},[settingsKey]:{...fixture.memory[settingsKey],custom:{'cloud:cloud-alpha':{color:'#654321'},'folder:folder-alpha':{color:'#ab1234',icon:'terminal'}}}});<\/script>`;
      await route.fulfill({response, body: html.replace('<script src="/content.js"></script>', setup + '<script src="/content.js"></script>')});
    });
    await page.goto('/tests/fixtures/native-tree.html?scenario=folder-icons');
    await expect(page.locator('.ycp-folder').first()).toBeVisible();
    const anchor = page.locator('#fixture-brand');
    const path = anchor.locator(':scope > svg > path');
    const badge = anchor.locator(':scope > [data-ycp-folder-badge]');
    if (enabled) {
      await expect(path).toHaveCSS('fill', 'rgb(101, 67, 33)');
      await expect(badge).toHaveCount(1);
      await expect(badge.locator('svg.g-icon')).toBeVisible();
      await expect(badge).toHaveCSS('color', 'rgb(171, 18, 52)');
      await page.evaluate(() => browser.storage.local.set({colorConsoleLogo: false, showFolderBadge: false}));
    }
    await expect(path).toHaveCSS('fill', 'rgb(42, 159, 255)');
    await expect(path).not.toHaveAttribute('data-ycp-logo-original-fill');
    await expect(badge).toHaveCount(0);
    await expect(anchor).toHaveCSS('position', 'static');
    await expect(anchor).not.toHaveAttribute('data-ycp-logo-original-position');
  });
}

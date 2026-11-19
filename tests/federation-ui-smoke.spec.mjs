import {test, expect} from '@playwright/test';

const fixtureOrigin = 'https://federation.example';

test.beforeEach(async ({page, baseURL}) => {
  await page.route(fixtureOrigin + '/**', async route => {
    const url = new URL(route.request().url());
    const response = await page.request.get(baseURL + url.pathname + url.search);
    await route.fulfill({response});
  });
});

const cached = page => page.locator('[data-cached-federation="federation-beta"]');
const active = page => page.locator('[data-cloud-id="cloud-alpha"]');

async function openFederations(page) {
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=federations');
  await expect(active(page).getByRole('link', {name: 'Active custom cloud', exact: true})).toBeVisible();
  await expect(cached(page).getByRole('link', {name: 'Cached custom folder', exact: true})).toBeVisible();
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-alpha:catalog`]?.[0]?.name)).toBe('Alpha core');
}

test('cached federation keeps its settings and folders without native loading', async ({page}, testInfo) => {
  await openFederations(page);
  const beta = cached(page);
  await expect(beta).toContainText('Beta cached federation');
  await expect(beta.getByRole('link', {name: 'Cached custom cloud', exact: true})).toHaveAttribute('href', /\/federations\/federation-beta$/);
  await expect(active(page).locator('.ycp-cloud .ycp-item-icon')).toHaveCSS('color', 'rgb(17, 34, 51)');
  await expect(beta.locator('.ycp-cloud .ycp-item-icon')).toHaveCSS('color', 'rgb(68, 85, 102)');
  const snapshot = await page.evaluate(() => ({clicks: fixture.expansionClicks, catalog: structuredClone(fixture.memory[`yc-power:${location.origin}:federation:id:federation-beta:catalog`])}));
  const disclosure = beta.locator('.ycp-cloud button[aria-expanded]').first();
  await disclosure.click();
  await expect(beta.getByRole('link', {name: 'Cached custom folder', exact: true})).toHaveCount(0);
  await disclosure.click();
  await expect(beta.getByRole('link', {name: 'Cached custom folder', exact: true})).toBeVisible();
  await page.evaluate(() => {fixture.records.find(row => row.id === 'cloud-alpha').name = 'Updated active cloud'; fixture.renderRows();});
  await page.getByRole('button', {name: 'Refresh clouds', exact: true}).click();
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-alpha:catalog`]?.[0]?.name)).toBe('Updated active cloud');
  expect(await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-beta:catalog`])).toEqual(snapshot.catalog);
  expect(await page.evaluate(() => fixture.expansionClicks)).toBe(snapshot.clicks);
  await expect(beta.getByRole('link', {name: 'Cached custom cloud', exact: true})).toBeVisible();
  for (const theme of ['light', 'dark']) {
    const background = theme === 'dark' ? 'rgb(31, 37, 43)' : 'rgb(255, 255, 255)';
    const foreground = theme === 'dark' ? 'rgb(230, 235, 240)' : 'rgb(20, 25, 30)';
    await page.evaluate(({theme, background, foreground}) => {
      document.querySelector('.cloud-tree-list-container').style.backgroundColor = background;
      document.body.style.setProperty('--g-color-text-primary', foreground);
      document.body.className = `g-root g-root_theme_${theme}`;
    }, {theme, background, foreground});
    await expect(page.locator('[data-ycp-host]')).toHaveCSS('background-color', background);
    await expect(page.locator('.ycp-layout')).toHaveCSS('color', foreground);
    await expect(page.locator('.ycp-root')).toHaveClass(new RegExp(`g-root_theme_${theme}(?:\\s|$)`));
    await expect(page.locator('.ycp-federation-row button').first()).toHaveCSS('color', theme === 'dark' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)');
    await expect(beta.getByRole('link', {name: 'Cached custom folder', exact: true})).toBeVisible();
    const screenshot = testInfo.outputPath(`federations-${theme}.png`);
    await page.screenshot({path: screenshot});
    await testInfo.attach(`federations-${theme}`, {path: screenshot, contentType: 'image/png'});
  }
  await beta.locator('[data-federation-id="federation-beta"] button').first().click();
  await expect(beta.locator('[data-cached-cloud-id]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:layout`]?.collapsedOrganizations)).toContain('federation:federation-beta');
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=federations');
  await expect(cached(page).locator('[data-federation-id="federation-beta"] button').first()).toHaveAttribute('aria-expanded', 'false');
  await expect(cached(page).locator('[data-cached-cloud-id]')).toHaveCount(0);
});

test('identity changes isolate identical organization and cloud identifiers', async ({page}) => {
  await openFederations(page);
  const alphaSettings = await page.evaluate(() => structuredClone(fixture.memory[`yc-power:${location.origin}:federation:id:federation-alpha:organization:id:org-alpha`]));
  await page.evaluate(() => {
    document.getElementById('fixture-identity').textContent = 'window.__DATA__ = '+JSON.stringify({user:{isFederated:true,federationId:'federation-beta',federationName:'Beta cached federation'}})+';';
    fixture.renderRows();
  });
  await expect(active(page).getByRole('link', {name: 'Cached custom cloud', exact: true})).toBeVisible();
  await expect(active(page).locator('.ycp-cloud .ycp-item-icon')).toHaveCSS('color', 'rgb(68, 85, 102)');
  await expect(page.locator('[data-cached-federation="federation-alpha"]').getByRole('link', {name: 'Active custom cloud', exact: true})).toBeVisible();
  await active(page).locator('.ycp-cloud').hover();
  await active(page).getByRole('button', {name: 'Remove from my clouds', exact: true}).click();
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-beta:organization:id:org-alpha`]?.mine)).toEqual([]);
  expect(await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-alpha:organization:id:org-alpha`])).toEqual(alphaSettings);
});

test('active single organization collapse hides and restores its cloud', async ({page}) => {
  await openFederations(page);
  const group = page.locator('.ycp-organization-group').filter({has: active(page)});
  const disclosure = group.getByRole('button', {name: 'Clouds in Alpha organization', exact: true});
  await disclosure.click();
  await expect(active(page)).toHaveCount(0);
  await expect(cached(page).getByRole('link', {name: 'Cached custom cloud', exact: true})).toBeVisible();
  await page.locator('.ycp-mine').getByRole('button', {name: 'Clouds in Alpha organization', exact: true}).first().click();
  await expect(active(page).getByRole('link', {name: 'Active custom cloud', exact: true})).toBeVisible();
});

test('legacy settings are copied explicitly and retained unchanged', async ({page}) => {
  await openFederations(page);
  const legacy = {mine: ['cloud-analytics'], initialized: true, custom: {'cloud:cloud-analytics': {label: 'Imported analytics', color: '#789abc'}}, expandedClouds: ['cloud-analytics']};
  await page.evaluate(value => browser.storage.local.set({[`yc-power:${location.origin}:organization:id:org-alpha`]: value}), legacy);
  const copy = page.getByRole('button', {name: 'Transfer settings', exact: true});
  await expect(copy).toBeVisible();
  await expect(copy.locator('.g-icon')).toHaveCount(1);
  await expect(page.getByRole('link', {name: 'Imported analytics', exact: true})).toHaveCount(0);
  await copy.click();
  await expect(page.getByRole('link', {name: 'Imported analytics', exact: true})).toBeVisible();
  await expect(copy).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-alpha:organization:id:org-alpha`]?.legacyImported)).toBe(true);
  const settings = await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-alpha:organization:id:org-alpha`]);
  expect(settings.mine).toEqual(['cloud-analytics', 'cloud-alpha']);
  expect(settings.custom['cloud:cloud-alpha'].label).toBe('Active custom cloud');
  expect(settings.custom['cloud:cloud-analytics']).toEqual(legacy.custom['cloud:cloud-analytics']);
  expect(await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:organization:id:org-alpha`])).toEqual(legacy);
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=federations');
  await expect(page.getByRole('link', {name: 'Imported analytics', exact: true})).toBeVisible();
  await expect(copy).toHaveCount(0);
});

async function editGroup(page, heading, label, color) {
  await heading.hover();
  await heading.locator('.ycp-group-action').click();
  await expect(page.locator('.ycp-edit')).toBeVisible();
  await expect(page.locator('.ycp-icons')).toHaveCount(0);
  await page.getByRole('textbox', {name: 'Label', exact: true}).fill(label);
  await page.locator(`.ycp-palette button[value="${color}"]`).click();
  await page.locator('.ycp-edit button[type="submit"]').click();
}

test('organization and federation appearance stays scoped and survives native refresh', async ({page}, testInfo) => {
  await openFederations(page);
  const federation = page.locator('[data-federation-id="federation-alpha"]');
  const organization = page.locator('.ycp-mine > .ycp-organization-group > .ycp-organization-row');
  const cachedOrganization = cached(page).locator('.ycp-organization-group > .ycp-organization-row');
  const federationIcon = await federation.locator('.ycp-group-icon .g-icon').innerHTML();
  const originalColor = await federation.locator('.ycp-group-icon').evaluate(icon => getComputedStyle(icon).color);
  await federation.hover();
  await federation.locator('.ycp-group-action').click();
  await page.getByRole('textbox', {name: 'Label', exact: true}).fill('Label only');
  await page.locator('.ycp-edit button[type="submit"]').click();
  await expect(federation).toContainText('Label only');
  await expect(federation.locator('.ycp-group-icon')).toHaveCSS('color', originalColor);
  await editGroup(page, federation, 'Work accounts', '#b49aff');
  await editGroup(page, organization, 'Production organization', '#00a8a1');
  await editGroup(page, cachedOrganization, 'Sandbox organization', '#ef7070');
  await expect(federation).toContainText('Work accounts');
  await expect(federation.locator('.ycp-group-icon')).toHaveCSS('color', 'rgb(180, 154, 255)');
  await expect(organization).toContainText('Production organization');
  await expect(organization.locator('.ycp-group-icon')).toHaveCSS('color', 'rgb(0, 168, 161)');
  await expect(cachedOrganization).toContainText('Sandbox organization');
  await expect(cachedOrganization.locator('.ycp-group-icon')).toHaveCSS('color', 'rgb(239, 112, 112)');
  await expect(cached(page).locator('.ycp-federation-row')).toContainText('Beta cached federation');
  await expect(federation.locator('.ycp-group-icon .g-icon')).toHaveJSProperty('innerHTML', federationIcon);
  const positions = await Promise.all([federation.locator('.ycp-group-icon'), organization.locator('.ycp-group-icon'), active(page).locator('.ycp-cloud .ycp-item-icon')].map(icon => icon.boundingBox()));
  const centers = positions.map(box => box.x + box.width / 2);
  expect(centers[1] - centers[0]).toBeCloseTo(6, 1);
  expect(centers[2] - centers[1]).toBeCloseTo(6, 1);
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=federations');
  await expect(organization).toContainText('Production organization');
  await expect(cachedOrganization).toContainText('Sandbox organization');
  await page.evaluate(() => {
    document.getElementById('fixture-identity').textContent = 'window.__DATA__ = ' + JSON.stringify({user: {isFederated: true, federationId: 'federation-alpha', federationName: 'Updated native federation'}}) + ';';
  });
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:federation:id:federation-alpha:profile`]?.name)).toBe('Updated native federation');
  await expect(federation).toContainText('Work accounts');
  await page.getByRole('button', {name: 'Refresh clouds', exact: true}).click();
  await expect(organization).toContainText('Production organization');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      document.querySelector('.cloud-tree-list-container').style.backgroundColor = theme === 'dark' ? 'rgb(31, 37, 43)' : 'white';
      document.body.className = `g-root g-root_theme_${theme}`;
    }, theme);
    await expect(federation.locator('button').first()).toHaveCSS('color', theme === 'dark' ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)');
    const screenshot = testInfo.outputPath(`group-appearance-${theme}.png`);
    await page.screenshot({path: screenshot});
    await testInfo.attach(`groups-${theme}`, {path: screenshot, contentType: 'image/png'});
  }
  await federation.hover();
  await federation.locator('.ycp-group-action').click();
  await page.getByRole('button', {name: 'Auto', exact: true}).click();
  await expect(federation).toContainText('Updated native federation');
  await expect(federation).not.toContainText('Work accounts');
  await expect(organization).toContainText('Production organization');
  await expect(cachedOrganization).toContainText('Sandbox organization');
});

test('single organization header supports appearance without federation detection', async ({page}) => {
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=folder-icons');
  const heading = page.locator('.ycp-heading-organization');
  await expect(heading).toContainText('Alpha organization');
  await editGroup(page, heading, 'My organization', '#b49aff');
  await expect(heading).toContainText('My organization');
  await expect(heading.locator('.ycp-group-icon')).toHaveCSS('color', 'rgb(180, 154, 255)');
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=folder-icons');
  await expect(heading).toContainText('My organization');
  await heading.hover();
  await heading.locator('.ycp-group-action').click();
  await page.getByRole('button', {name: 'Auto', exact: true}).click();
  await expect(heading).toContainText('Alpha organization');
});

for (const state of ['matching', 'expired', 'mismatched']) {
  test(`pending destination is handled for ${state} identity`, async ({page}) => {
    await openFederations(page);
    const pending = await page.evaluate(value => {
      const destination = {federationId: value === 'mismatched' ? 'federation-beta' : 'federation-alpha', href: location.origin + '/clouds/cloud-beta', expires: Date.now() + (value === 'expired' ? -1000 : 300000)};
      sessionStorage.setItem('yc-power:destination', JSON.stringify(destination));
      return JSON.stringify(destination);
    }, state);
    if (state === 'matching') await page.route('**/clouds/cloud-beta', route => route.fulfill({contentType: 'text/html', body: '<title>Resumed destination</title>'}));
    await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=federations');
    if (state === 'matching') {
      await expect(page).toHaveTitle('Resumed destination');
      await expect(page).toHaveURL(/\/clouds\/cloud-beta$/);
    } else {
      await expect(active(page)).toBeVisible();
      await expect(page).toHaveURL(/\/clouds\/cloud-alpha$/);
    }
    expect(await page.evaluate(() => sessionStorage.getItem('yc-power:destination'))).toBe(state === 'mismatched' ? pending : null);
  });
}

for (const identity of ['missing', 'malformed']) {
  test(`${identity} identity preserves legacy catalog and blocks native refresh`, async ({page}) => {
    await openFederations(page);
    const legacyCatalog = [{type: 'cloud', id: 'legacy-cloud', name: 'Legacy preserved', href: '/clouds/legacy-cloud', folders: []}];
    await page.evaluate(async ({value, identity}) => {
      await browser.storage.local.set({[`yc-power:${location.origin}:catalog`]: value});
      const script = document.getElementById('fixture-identity');
      if (identity === 'missing') script.remove(); else script.textContent = 'window.__DATA__ = {broken';
    }, {value: legacyCatalog, identity});
    await expect(active(page)).toHaveCount(0);
    const clicks = await page.evaluate(() => fixture.expansionClicks);
    await page.getByRole('button', {name: 'Refresh clouds', exact: true}).click();
    await expect(page.getByRole('status').filter({hasText: 'Could not determine the active federation'})).toBeVisible();
    expect(await page.evaluate(() => fixture.expansionClicks)).toBe(clicks);
    expect(await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:catalog`])).toEqual(legacyCatalog);
    await expect(cached(page).getByRole('link', {name: 'Cached custom cloud', exact: true})).toBeVisible();
  });
}

test('external inactive catalog and preferences changes update cached groups', async ({page}) => {
  await openFederations(page);
  await page.evaluate(async () => {
    const prefix = `yc-power:${location.origin}:federation:id:federation-beta`;
    const settings = structuredClone(fixture.memory[prefix + ':organization:id:org-alpha']);
    settings.custom['cloud:cloud-alpha'] = {label: 'Externally renamed', color: '#abcdef'};
    settings.custom['folder:folder-alpha'] = {label: 'External folder label'};
    const catalog = structuredClone(fixture.memory[prefix + ':catalog']);
    catalog[0].folders.push({type: 'folder', id: 'folder-external', name: 'External new folder', href: '/clouds/cloud-alpha/folder-external', cloudId: 'cloud-alpha'});
    await browser.storage.local.set({[prefix + ':catalog']: catalog, [prefix + ':organization:id:org-alpha']: settings});
  });
  await expect(cached(page).getByRole('link', {name: 'Externally renamed', exact: true})).toBeVisible();
  await expect(cached(page).getByRole('link', {name: 'External folder label', exact: true})).toBeVisible();
  await expect(cached(page).getByRole('link', {name: 'External · new', exact: true})).toBeVisible();
  await expect(cached(page).locator('.ycp-cloud .ycp-item-icon')).toHaveCSS('color', 'rgb(171, 205, 239)');
  await expect(active(page).getByRole('link', {name: 'Active custom cloud', exact: true})).toBeVisible();
});

test('verified personal identity resumes native scanning after unknown identity', async ({page}) => {
  await openFederations(page);
  await page.evaluate(() => document.getElementById('fixture-identity').remove());
  await expect(active(page)).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText: 'Could not determine the active federation'})).toBeVisible();
  await page.evaluate(() => {
    fixture.records.find(row => row.id === 'cloud-alpha').name = 'Verified personal cloud';
    fixture.renderRows();
    const script = document.createElement('script');
    script.id = 'fixture-identity';
    script.textContent = 'window.__DATA__ = {"user":{"isFederated":false}};';
    document.head.append(script);
  });
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:catalog`]?.[0]?.name)).toBe('Verified personal cloud');
  await expect(active(page).getByRole('link', {name: /Verified.*personal/})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText: 'Could not determine the active federation'})).toHaveCount(0);
  await expect(page.locator('[data-cached-federation]')).toHaveCount(0);
});

test('cached folder opens federation sign-in and resumes only after matching identity', async ({page}) => {
  await openFederations(page);
  await page.route('**/federations/federation-beta', route => route.fulfill({contentType: 'text/html', body: '<title>Federation sign-in</title>'}));
  await cached(page).getByRole('link', {name: 'Cached custom folder', exact: true}).click();
  await expect(page).toHaveTitle('Federation sign-in');
  const destination = await page.evaluate(() => JSON.parse(sessionStorage.getItem('yc-power:destination')));
  expect(destination.federationId).toBe('federation-beta');
  expect(new URL(destination.href, fixtureOrigin).href).toBe(fixtureOrigin + '/clouds/cloud-alpha/folder-alpha');
  await page.route('**/clouds/cloud-alpha/folder-alpha', route => route.fulfill({contentType: 'text/html', body: '<title>Selected cached folder</title>'}));
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=federations');
  await expect(active(page)).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('yc-power:destination')).federationId)).toBe('federation-beta');
  await page.evaluate(() => {
    document.getElementById('fixture-identity').textContent = 'window.__DATA__ = ' + JSON.stringify({user: {isFederated: true, federationId: 'federation-beta', federationName: 'Beta cached federation'}}) + ';';
  });
  await expect(page).toHaveTitle('Selected cached folder');
  expect(await page.evaluate(() => sessionStorage.getItem('yc-power:destination'))).toBeNull();
});

test('single organization hiding bypasses its collapse without losing saved state', async ({page}) => {
  await openFederations(page);
  const organization = page.locator('.ycp-mine > .ycp-organization-group > .ycp-organization-row');
  await organization.locator('button').first().click();
  await expect(active(page)).toHaveCount(0);
  await page.evaluate(() => browser.storage.local.set({hideSingleOrganization: true}));
  await expect(organization).toHaveCount(0);
  await expect(active(page)).toBeVisible();
  await expect(cached(page).locator('.ycp-organization-row:not(.ycp-federation-row)')).toHaveCount(0);
  await expect(cached(page).getByRole('link', {name: 'Cached custom cloud', exact: true})).toBeVisible();
  const federation = page.locator('[data-federation-id="federation-alpha"]');
  await expect(federation.locator('.ycp-group-count')).toHaveText('1');
  await expect(cached(page).locator('.ycp-federation-row .ycp-group-count')).toHaveText('1');
  await federation.locator('button').first().click();
  await expect(active(page)).toHaveCount(0);
  await federation.locator('button').first().click();
  await expect(active(page)).toBeVisible();
  await page.evaluate(() => browser.storage.local.set({hideSingleOrganization: false}));
  await expect(federation.locator('.ycp-group-count')).toHaveCount(0);
  await expect(organization).toBeVisible();
  await expect(organization.locator('button').first()).toHaveAttribute('aria-expanded', 'false');
  await expect(active(page)).toHaveCount(0);
});

test('multiple organizations keep their level even when only one has selected clouds', async ({page}) => {
  await openFederations(page);
  await page.evaluate(async () => {
    const prefix = `yc-power:${location.origin}:federation:id:federation-beta`;
    const catalog = structuredClone(fixture.memory[prefix + ':catalog']);
    catalog.push({type: 'cloud', id: 'unselected', name: 'Unselected cloud', href: '/clouds/unselected', organizationId: 'another-organization', organizationName: 'Another organization', folders: []});
    await browser.storage.local.set({[prefix + ':catalog']: catalog, hideSingleOrganization: true});
  });
  await expect(page.locator('.ycp-mine > .ycp-organization-group > .ycp-organization-row')).toHaveCount(0);
  await expect(cached(page).locator('.ycp-organization-row:not(.ycp-federation-row)')).toHaveCount(1);
});

test('personal organizations share the federation level only when enabled', async ({page}, testInfo) => {
  await openFederations(page);
  await page.evaluate(async () => {
    const personal = [{type: 'cloud', id: 'personal-cloud', name: 'Personal cloud', href: '/clouds/personal-cloud', organizationId: 'personal-org', organizationName: 'Personal organization', folders: []}];
    await browser.storage.local.set({
      [`yc-power:${location.origin}:passport-catalog`]: personal,
      [`yc-power:${location.origin}:passport-profile`]: {name: 'Personal test account'},
      [`yc-power:${location.origin}:catalog`]: personal,
      [`yc-power:${location.origin}:organization:id:personal-org`]: {mine: ['personal-cloud'], initialized: true, custom: {'cloud:personal-cloud': {label: 'Passport selected'}}},
    });
  });
  await expect(page.locator('[data-cached-passport]')).toHaveCount(0);
  await page.evaluate(() => browser.storage.local.set({showPersonalOrganizations: true, hideSingleOrganization: true}));
  const personal = page.locator('[data-cached-passport]');
  await expect(personal).toContainText('Personal organization');
  await expect(personal.getByRole('button', {name: 'Passport selected', exact: true})).toBeVisible();
  const federationIcon = await page.locator('[data-federation-id="federation-alpha"] .ycp-group-icon').boundingBox();
  const account = page.locator('[data-passport-account]');
  await expect(account).toContainText('Personal test account');
  const personalIcon = await account.locator('[data-passport-heading] .ycp-group-icon').boundingBox();
  expect(personalIcon.x).toBeCloseTo(federationIcon.x, 1);
  await page.evaluate(() => {
    const button = document.createElement('button'); button.setAttribute('aria-label', 'Account');
    fixture.accountClicks = 0; button.onclick = () => {fixture.accountClicks++;}; document.body.append(button);
  });
  await personal.getByRole('button', {name: 'Passport selected', exact: true}).click();
  await expect.poll(() => page.evaluate(() => fixture.accountClicks)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('yc-power:destination')).federationId)).toBeNull();
  await page.evaluate(() => {
    sessionStorage.removeItem('yc-power:destination');
    fixture.records.splice(0, fixture.records.length, {type: 'organization', id: 'personal-org', name: 'Personal organization'}, {type: 'cloud', id: 'personal-cloud', name: 'Personal cloud'});
    fixture.renderRows();
    history.replaceState(null, '', '/clouds/personal-cloud');
    document.getElementById('fixture-identity').textContent = 'window.__DATA__ = {"user":{"isFederated":false,"displayName":"Personal test account"}};';
  });
  await expect(page.locator('[data-cloud-id="personal-cloud"]')).toBeVisible();
  await expect(page.locator('[data-cached-federation]')).toHaveCount(2);
  await expect(page.locator('.ycp-mine > .ycp-passport-account > .ycp-passport-organization')).toContainText('Personal organization');
  await page.mouse.move(900, 700);
  const screenshot = testInfo.outputPath('personal-organizations.png');
  await page.screenshot({path: screenshot});
  await testInfo.attach('personal-organizations', {path: screenshot, contentType: 'image/png'});
  await page.evaluate(() => browser.storage.local.set({showPersonalOrganizations: false}));
  await expect(page.locator('[data-cached-federation]')).toHaveCount(0);
  await expect(page.locator('[data-cloud-id="personal-cloud"]')).toBeVisible();
  await expect(page.locator('[data-federation-id]')).toHaveCount(0);
  await expect(page.locator('[data-passport-account]')).toHaveCount(0);
});

test('hierarchy options persist and participate in portable settings', async ({page}, testInfo) => {
  await page.goto('/tests/fixtures/options.html?scenario=hierarchy');
  const hide = page.getByRole('checkbox', {name: 'Hide single organizations in federations', exact: true});
  const personal = page.getByRole('checkbox', {name: 'Show personal organizations alongside federations', exact: true});
  await expect(hide).not.toBeChecked();
  await expect(personal).not.toBeChecked();
  await hide.check(); await personal.check();
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect.poll(() => page.evaluate(() => fixture.memory.hideSingleOrganization && fixture.memory.showPersonalOrganizations)).toBe(true);
  await page.reload();
  await expect(hide).toBeChecked(); await expect(personal).toBeChecked();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export settings', exact: true}).click();
  const file = await downloaded;
  const {readFile} = await import('node:fs/promises');
  const settings = JSON.parse(await readFile(await file.path(), 'utf8'));
  expect(settings.settings.hideSingleOrganization).toBe(true);
  expect(settings.settings.showPersonalOrganizations).toBe(true);
  await page.setViewportSize({width: 500, height: 900});
  const screenshot = testInfo.outputPath('hierarchy-options.png');
  await page.screenshot({path: screenshot, fullPage: true});
  await testInfo.attach('hierarchy-options', {path: screenshot, contentType: 'image/png'});
});

test('passport uid without federation flags never renders the stale federated catalog', async ({page}, testInfo) => {
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=passport-real');
  await expect(page.getByRole('link', {name: 'Personal selected', exact: true})).toBeVisible();
  await expect(page.getByRole('link', {name: 'Another personal selected', exact: true})).toBeVisible();
  const personalGroup = page.locator('.ycp-passport-organization').first();
  const organizationIcon = await personalGroup.locator('.ycp-organization-row .ycp-group-icon').boundingBox();
  const cloudIcon = await personalGroup.locator('.ycp-cloud .ycp-item-icon').boundingBox();
  expect(cloudIcon.x - organizationIcon.x).toBeCloseTo(12, 1);
  await expect(page.locator('[data-cloud-id="stale-cloud"]')).toHaveCount(0);
  await expect(page.locator('[data-cached-federation]')).toHaveCount(0);
  expect(await page.evaluate(() => fixture.seenStaleCloud)).toBe(false);
  await expect.poll(() => page.evaluate(() => fixture.memory[`yc-power:${location.origin}:passport-catalog`]?.length)).toBe(3);
  expect(await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:passport-catalog`].some(cloud => cloud.id === 'stale-cloud'))).toBe(false);
  expect(await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:organization:id:stale-org`].mine)).toEqual(['stale-cloud']);
  await page.evaluate(() => browser.storage.local.set({showPersonalOrganizations: true}));
  await expect(page.locator('[data-passport-heading]')).toContainText('Synthetic personal account');
  await expect(page.locator('[data-cached-federation="synthetic-fed"]')).toBeVisible();
  const screenshot = testInfo.outputPath('passport-correct-catalog.png');
  await page.mouse.move(900, 700);
  await page.screenshot({path: screenshot});
  await testInfo.attach('passport-catalog', {path: screenshot, contentType: 'image/png'});
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=passport-real');
  await expect(page.getByRole('link', {name: 'Personal selected', exact: true})).toBeVisible();
  expect(await page.evaluate(() => fixture.seenStaleCloud)).toBe(false);
});

test('reset confirms before removing all settings and clears staged imports', async ({page}, testInfo) => {
  const url = '/tests/fixtures/options.html?scenario=reset';
  await page.goto(url);
  await expect(page.getByRole('button', {name: 'Reset all settings', exact: true})).toBeEnabled();
  await page.evaluate(() => browser.storage.local.set({
    domainHosts: ['https://console.yandex.cloud', 'https://custom.example'], compactDensity: true,
    cloudOnlyHosts: ['https://custom.example'], hideSingleOrganization: true, showPersonalOrganizations: true,
    'yc-power:https://custom.example:catalog': [{type: 'cloud', id: 'example', name: 'Example', href: '/clouds/example', folders: []}],
    'yc-power:https://custom.example:organization:id:example-org': {mine: ['example'], custom: {}},
    'yc-power:https://custom.example:federation:id:example-fed:profile': {name: 'Example federation'},
  }));
  await page.reload();
  const before = await page.evaluate(() => structuredClone(fixture.memory));
  await page.getByRole('button', {name: 'Reset all settings', exact: true}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', {name: 'Cancel', exact: true})).toBeFocused();
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
  expect(await page.evaluate(() => fixture.memory)).toEqual(before);
  expect(await page.evaluate(() => fixture.revocations)).toEqual([]);
  await page.locator('input[type=file]').setInputFiles({name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({format: 'yc-power-settings', version: 1, settings: before}))});
  await expect(page.getByRole('status')).toHaveText('Settings loaded from JSON. Save to apply them');
  await page.getByRole('button', {name: 'Reset all settings', exact: true}).click();
  await dialog.getByRole('button', {name: 'Cancel', exact: true}).hover();
  const screenshot = testInfo.outputPath('reset-confirmation.png');
  await page.screenshot({path: screenshot});
  await testInfo.attach('reset-confirmation', {path: screenshot, contentType: 'image/png'});
  await dialog.getByRole('button', {name: 'Reset all settings', exact: true}).click();
  await expect(page.getByRole('status')).toHaveText('All settings have been reset. Reload the console pages');
  const reset = await page.evaluate(() => fixture.memory);
  expect(typeof reset._ycPowerReset).toBe('string');
  expect(Object.keys(reset).sort()).toEqual(['_ycPowerReset', 'cloudOnlyHosts', 'compactDensity', 'domainHosts', 'hideSingleOrganization', 'showPersonalOrganizations'].sort());
  expect(reset.domainHosts).toEqual(['https://console.yandex.cloud']);
  expect(reset.cloudOnlyHosts).toEqual([]);
  expect(reset.compactDensity || reset.hideSingleOrganization || reset.showPersonalOrganizations).toBe(false);
  expect(await page.evaluate(() => fixture.revocations)).toEqual([{origins: ['https://custom.example/*']}]);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  expect(await page.evaluate(() => Object.keys(fixture.memory).some(key => key.startsWith('yc-power:')))).toBe(false);
});

test('reset cancels pending panel saves and prevents reinjection until reload', async ({page}) => {
  await openFederations(page);
  await page.evaluate(async () => {
    document.querySelector('[data-ycp-host]').shadowRoot.querySelector('[data-cloud-id="cloud-alpha"] .ycp-row-action').click();
    await browser.storage.local.set({_ycPowerReset: 'synthetic-reset', domainHosts: ['https://console.yandex.cloud']});
    await browser.storage.local.remove(Object.keys(fixture.memory).filter(key => key.startsWith('yc-power:')));
  });
  await expect(page.locator('[data-ycp-host]')).toHaveCount(0);
  await page.addScriptTag({url: fixtureOrigin + '/content.js'});
  // wait beyond the former save debounce to detect resurrected preferences
  await page.waitForTimeout(300);
  await expect(page.locator('[data-ycp-host], .ycp-add-native')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(fixture.memory).filter(key => key.startsWith('yc-power:')))).toEqual([]);
  expect(await page.evaluate(() => globalThis.__ycPowerReset)).toBe(true);
});

test('group labels toggle disclosure while customization buttons remain independent', async ({page}) => {
  await openFederations(page);
  const federation = page.locator('[data-federation-id="federation-alpha"]');
  await expect(federation).toHaveCSS('cursor', 'pointer');
  await federation.getByText('Alpha federation', {exact: true}).click();
  await expect(active(page)).toHaveCount(0);
  await federation.getByText('Alpha federation', {exact: true}).click();
  await expect(active(page)).toBeVisible();
  const organization = page.locator('.ycp-mine > .ycp-organization-group > .ycp-organization-row');
  await organization.getByText('Alpha organization', {exact: true}).click();
  await expect(active(page)).toHaveCount(0);
  await organization.getByText('Alpha organization', {exact: true}).click();
  await organization.hover();
  await organization.locator('.ycp-group-action').click();
  await expect(organization.locator('button').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(active(page)).toBeVisible();
  await expect(page.locator('.ycp-edit')).toBeVisible();
  await organization.locator('.ycp-group-action').click();
  await expect(page.locator('.ycp-edit')).toHaveCount(0);
  await expect(organization.locator('button').first()).toHaveAttribute('aria-expanded', 'true');
});

test('reset cancels navigation waiting for a pending preferences write', async ({page}) => {
  await openFederations(page);
  await page.route('**/federations/federation-beta', route => route.fulfill({contentType: 'text/html', body: '<title>Unexpected navigation</title>'}));
  await page.evaluate(async () => {
    const originalSet = browser.storage.local.set;
    browser.storage.local.set = values => {
      const stored = originalSet(values);
      return Object.keys(values).some(key => key.includes(':organization:')) ? new Promise(resolve => {fixture.completeSave = () => stored.then(resolve);}) : stored;
    };
    const shadow = document.querySelector('[data-ycp-host]').shadowRoot;
    shadow.querySelector('[data-cloud-id="cloud-alpha"] .ycp-row-action').click();
    shadow.querySelector('[data-cached-federation="federation-beta"] .ycp-link').click();
    await Promise.resolve(); await Promise.resolve();
    await originalSet({_ycPowerReset: 'cancel-navigation', domainHosts: ['https://console.yandex.cloud']});
    fixture.completeSave();
  });
  await expect(page.locator('[data-ycp-host]')).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/clouds\/cloud-alpha$/);
  expect(await page.evaluate(() => sessionStorage.getItem('yc-power:destination'))).toBeNull();
});

async function seedOrderedGroups(page) {
  await page.evaluate(async () => {
    const origin = `yc-power:${location.origin}`;
    const cloud = (id, organizationId, name) => ({type: 'cloud', id, name, href: `/clouds/${id}`, organizationId, organizationName: `${name} organization`, folders: []});
    await browser.storage.local.set({
      showPersonalOrganizations: true,
      [`${origin}:passport-catalog`]: [cloud('personal-one', 'personal-org', 'Personal one'), cloud('personal-two', 'personal-org', 'Personal two'), cloud('personal-unselected', 'personal-org', 'Personal unselected')],
      [`${origin}:passport-profile`]: {name: 'Personal test account'},
      [`${origin}:organization:id:personal-org`]: {mine: ['personal-one', 'personal-two'], initialized: true, custom: {}},
      [`${origin}:federation:id:federation-gamma:catalog`]: [cloud('cloud-gamma', 'org-gamma', 'Gamma cloud')],
      [`${origin}:federation:id:federation-gamma:profile`]: {name: 'Gamma federation'},
      [`${origin}:federation:id:federation-gamma:organization:id:org-gamma`]: {mine: ['cloud-gamma'], initialized: true, custom: {}},
      [`${origin}:layout`]: {...fixture.memory[`${origin}:layout`], groupOrder: ['federation:federation-alpha', 'federation:unavailable', 'federation:federation-beta', 'account:passport', 'federation:federation-gamma']},
    });
  });
  await expect(page.locator('[data-group-order-key]')).toHaveCount(3);
}

const groupOrder = page => page.locator('.ycp-mine > [data-group-order-key]').evaluateAll(nodes => nodes.map(node => node.dataset.groupOrderKey));

test('inactive groups drag together and preserve order while the active federation stays first', async ({page}) => {
  await openFederations(page);
  await seedOrderedGroups(page);
  const gamma = page.locator('[data-cached-federation="federation-gamma"]');
  const source = await gamma.locator('.ycp-federation-row > .g-text').first().boundingBox();
  const target = await cached(page).locator('.ycp-federation-row').boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 4, {steps: 12});
  await page.mouse.up();
  await expect.poll(() => groupOrder(page)).toEqual(['federation:federation-gamma', 'federation:federation-beta', 'account:passport']);
  await expect(gamma.locator('.ycp-federation-row button').first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.ycp-mine > .ycp-federation-row').first()).toHaveAttribute('data-federation-id', 'federation-alpha');
  const savedOrder = await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:layout`].groupOrder);
  expect(savedOrder).toEqual(['federation:federation-alpha', 'federation:unavailable', 'federation:federation-gamma', 'federation:federation-beta', 'account:passport']);
  await page.goto(fixtureOrigin + '/tests/fixtures/native-tree.html?scenario=federations');
  await expect.poll(() => groupOrder(page)).toEqual(['federation:federation-gamma', 'federation:federation-beta', 'account:passport']);
  await page.evaluate(() => {
    document.getElementById('fixture-identity').textContent = 'window.__DATA__ = ' + JSON.stringify({user: {isFederated: true, federationId: 'federation-gamma', federationName: 'Gamma federation'}}) + ';';
    fixture.renderRows();
  });
  await expect(page.locator('.ycp-mine > .ycp-federation-row').first()).toHaveAttribute('data-federation-id', 'federation-gamma');
  await expect.poll(() => groupOrder(page)).toEqual(['federation:federation-alpha', 'federation:federation-beta', 'account:passport']);
  expect(await page.evaluate(() => fixture.memory[`yc-power:${location.origin}:layout`].groupOrder)).toEqual(savedOrder);
});

test('personal account counts selected clouds with organization headings visible and hidden', async ({page}) => {
  await openFederations(page);
  await seedOrderedGroups(page);
  const heading = page.locator('[data-passport-heading]');
  await expect(heading.locator('.ycp-group-count')).toHaveText('2');
  await expect(page.locator('[data-passport-account] .ycp-organization-row:not(.ycp-federation-row)')).toBeVisible();
  await page.evaluate(() => browser.storage.local.set({hideSingleOrganization: true}));
  await expect(heading.locator('.ycp-group-count')).toHaveText('2');
  await page.evaluate(() => {
    fixture.records.splice(0, fixture.records.length,
      {type: 'organization', id: 'personal-org', name: 'Personal organization'},
      {type: 'cloud', id: 'personal-one', name: 'Personal one'},
      {type: 'cloud', id: 'personal-two', name: 'Personal two'},
      {type: 'cloud', id: 'personal-unselected', name: 'Personal unselected'});
    fixture.renderRows();
    history.replaceState(null, '', '/clouds/personal-one');
    document.getElementById('fixture-identity').textContent = 'window.__DATA__ = {"user":{"isFederated":false,"displayName":"Personal test account"}};';
  });
  await expect(page.locator('[data-cloud-id="personal-one"]')).toBeVisible();
  await expect(heading.locator('.ycp-group-count')).toHaveText('2');
  await expect(page.locator('.ycp-mine > .ycp-passport-account').first()).toHaveAttribute('data-passport-account', 'true');
  await page.evaluate(() => browser.storage.local.set({hideSingleOrganization: false}));
  await expect(heading.locator('.ycp-group-count')).toHaveText('2');
  await expect(page.locator('[data-cloud-id="personal-unselected"]')).toHaveCount(0);
});

test('current context dots identify only active federation organization and cloud including folder routes', async ({page}, testInfo) => {
  await openFederations(page);
  const federation = page.locator('.ycp-mine > [data-federation-id="federation-alpha"]');
  const organization = page.locator('.ycp-mine > .ycp-organization-group > .ycp-organization-row');
  const currentCloud = active(page).locator('.ycp-cloud');
  for (const heading of [federation, organization, currentCloud]) {
    await expect(heading.locator('.ycp-active-dot')).toHaveCount(1);
    await expect(heading.getByRole('img', {name: 'Current context', exact: true})).toHaveClass(/ycp-active-dot/);
    const dot = await heading.locator('.ycp-active-dot').boundingBox();
    const icon = await heading.locator('.ycp-active-dot').locator('..').boundingBox();
    expect(dot.x).toBeLessThan(icon.x);
    expect(dot.y).toBeLessThan(icon.y);
  }
  await expect(cached(page).locator('.ycp-active-dot')).toHaveCount(0);
  await expect(page.locator('.ycp-active-dot')).toHaveCount(3);
  await page.evaluate(() => history.pushState(null, '', '/clouds/cloud-alpha/folder-alpha'));
  await expect(currentCloud.getByRole('img', {name: 'Current context', exact: true})).toBeVisible();
  await expect(active(page).locator('.ycp-folder .ycp-active-dot')).toHaveCount(0);
  await expect(page.locator('.ycp-active-dot')).toHaveCount(3);
  for (const theme of ['light', 'dark']) {
    const background = theme === 'dark' ? 'rgb(31, 37, 43)' : 'rgb(255, 255, 255)';
    await page.evaluate(({theme, background}) => {
      document.querySelector('.cloud-tree-list-container').style.backgroundColor = background;
      document.body.style.setProperty('--g-color-text-primary', theme === 'dark' ? 'rgb(230, 235, 240)' : 'rgb(20, 25, 30)');
      document.body.className = `g-root g-root_theme_${theme}`;
    }, {theme, background});
    await expect(page.locator('.ycp-root')).toHaveClass(new RegExp(`g-root_theme_${theme}(?:\\s|$)`));
    await expect(page.locator('[data-ycp-host]')).toHaveCSS('background-color', background);
    await page.screenshot({path: testInfo.outputPath(`active-context-${theme}.png`)});
  }
});

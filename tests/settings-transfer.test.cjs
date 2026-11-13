const {test} = require('node:test');
const assert = require('node:assert/strict');
const {exportSettings, parseSettings, MAX_BYTES} = require('../settings-transfer.js');
const Core = require('../core.js');
const publicOrigin = 'https://console.yandex.cloud';
const customOrigin = 'https://console.example.test';
const envelope = settings => JSON.stringify({format: 'yc-power-settings', version: 1, settings});

test('round trips global settings, two hosts, organization scopes, customization and catalog', () => {
  const first = Core.scopeKey(publicOrigin, 'example-org');
  const second = Core.scopeKey(customOrigin, null);
  const stored = {
    domainHosts: [publicOrigin, customOrigin], cloudOnlyHosts: [customOrigin], compactDensity: true,
    [first]: {mine: ['example-cloud'], initialized: true, width: 400, expandedClouds: ['example-cloud'], showAllModern: false,
      custom: {'cloud:example-cloud': {label: 'Example cloud', icon: 'rocket', color: '#123456'}, 'folder:example-folder': {label: 'Example folder', icon: 'code'}}},
    [second]: {mine: [], custom: {}, initialized: false, width: 360, showAllModern: true},
    [`yc-power:${publicOrigin}:layout`]: {scopeKey: first, width: 400, collapsedOrganizations: ['example-org']},
    [`yc-power:${publicOrigin}:catalog`]: [{type: 'cloud', id: 'example-cloud', name: 'Example cloud', href: '/clouds/example-cloud', organizationId: 'example-org', organizationName: 'Example organization', folders: [{type: 'folder', id: 'example-folder', cloudId: 'example-cloud', name: 'Example folder', href: '/folders/example-folder'}]}],
  };
  const output = exportSettings(stored);
  assert.equal(output, JSON.stringify(JSON.parse(output), null, 2) + '\n');
  assert.deepEqual(parseSettings(output), stored);
});

test('exports only extension settings and supplies the public default', () => {
  const output = exportSettings({token: 'secret', unrelated: {password: 'secret'}});
  assert.equal(output.includes('secret'), false);
  assert.deepEqual(parseSettings(output), {domainHosts: [publicOrigin], cloudOnlyHosts: [], compactDensity: false});
});

test('rejects unknown or malformed settings and unsupported formats', () => {
  for (const settings of [null, [], {token: 'secret'}, {compactDensity: 'true'}, {domainHosts: publicOrigin},
    {[Core.scopeKey(publicOrigin, null)]: {mine: 'example-cloud'}},
    {[Core.scopeKey(publicOrigin, null)]: {token: 'secret'}},
    {[Core.scopeKey(publicOrigin, null)]: {custom: {'cloud:example-cloud': {icon: 7}}}},
    {[`yc-power:${publicOrigin}:catalog`]: [{id: 'bad'}]},
    {[`yc-power:${publicOrigin}:layout`]: {scopeKey: Core.scopeKey(customOrigin, null)}},
  ]) assert.throws(() => parseSettings(envelope(settings)), /Invalid settings file/);
  for (const input of ['', 'null', '{}', '{', JSON.stringify({format: 'yc-power-settings', version: 2, settings: {}})]) {
    assert.throws(() => parseSettings(input), /Invalid settings file/);
  }
});

test('rejects hostile console origins in host lists and scoped keys', () => {
  for (const host of ['http://console.example.test', 'https://user:pass@console.example.test', 'https://*.example.test', 'https://console.example.test/path', 'https://console.example.test?query', 'https://console.example.test#fragment', 'https://console.example.test:8443', 'javascript:alert(1)']) {
    assert.throws(() => parseSettings(envelope({domainHosts: [host]})), /Invalid settings file/);
    assert.throws(() => parseSettings(envelope({[`yc-power:${host}:organization:unscoped`]: {}})), /Invalid settings file/);
  }
});

test('rejects prototype keys, oversized files and excessively nested input', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const input = `{"format":"yc-power-settings","version":1,"settings":{"${Core.scopeKey(publicOrigin, null)}":{"custom":{"cloud:example":{"${key}":{}}}}}}`;
    assert.throws(() => parseSettings(input), /Invalid settings file/);
  }
  assert.throws(() => parseSettings(' '.repeat(MAX_BYTES + 1)), /Invalid settings file/);
  let nested = {};
  for (let index = 0; index < 25; index++) nested = {nested};
  assert.throws(() => parseSettings(envelope(nested)), /Invalid settings file/);
});

test('exports real scanned catalogs while dropping incidental row metadata', () => {
  const catalog = Core.catalog(Core.annotateOrganizations([
    {type: 'organization', id: 'example-org', name: 'Example organization', offset: 0, pinned: false},
    {type: 'cloud', id: 'example-cloud', name: 'Example cloud', href: '/clouds/example-cloud', offset: 10, pinned: false},
    {type: 'folder', id: 'example-folder', name: 'Example folder', href: '/folders/example-folder', offset: 20, pinned: false},
  ]));
  const key = `yc-power:${publicOrigin}:catalog`;
  const exported = exportSettings({[key]: catalog});
  assert.deepEqual(parseSettings(exported)[key], Core.catalogCache(catalog, publicOrigin));
  assert.equal(exported.includes('offset'), false);
  assert.equal(exported.includes('pinned'), false);
  assert.equal(parseSettings(exported)[key][0].folders.length, 1);
});

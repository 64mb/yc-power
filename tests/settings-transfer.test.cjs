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

test('round trips separate federation catalogs and preferences sharing organization IDs', () => {
  const stored = {domainHosts: [publicOrigin], cloudOnlyHosts: [], compactDensity: false};
  for (const [index, federationId] of ['example-fed-a', 'example-fed-b'].entries()) {
    const prefix = `yc-power:${publicOrigin}:federation:id:${federationId}`;
    const appearance = {label: `Example group ${index}`, color: index ? '#abcdef' : '#123456'};
    stored[`${prefix}:organization:id:example-org`] = {mine: [`example-cloud-${index}`], initialized: true, width: 360 + index, appearance};
    stored[`${prefix}:profile`] = {name: `Example federation ${index}`, appearance: {...appearance, label: `Example federation label ${index}`}};
    stored[`${prefix}:catalog`] = [{type: 'cloud', id: `example-cloud-${index}`, name: `Example cloud ${index}`, href: `/clouds/example-cloud-${index}`, organizationId: 'example-org', organizationName: 'Example organization', folders: []}];
  }
  stored[`yc-power:${publicOrigin}:layout`] = {scopeKey: `yc-power:${publicOrigin}:federation:id:example-fed-b:organization:id:example-org`};
  assert.deepEqual(parseSettings(exportSettings(stored)), stored);
  assert.equal(JSON.parse(exportSettings(stored)).version, 1);
});

test('accepts federated unscoped preferences and legacy layout selections', () => {
  const scopeKey = `yc-power:${publicOrigin}:federation:id:example-fed:organization:unscoped`;
  const stored = {[scopeKey]: {mine: [], initialized: false}, [`yc-power:${publicOrigin}:layout`]: {scopeKey}};
  assert.equal(parseSettings(exportSettings(stored))[`yc-power:${publicOrigin}:layout`].scopeKey, scopeKey);
  const legacy = Core.scopeKey(publicOrigin, 'example:org');
  assert.deepEqual(parseSettings(exportSettings({[legacy]: {mine: []}}))[legacy], {mine: []});
});

test('rejects malformed federation scopes and invalid layout selections', () => {
  const prefix = `yc-power:${publicOrigin}:federation`;
  for (const key of [
    `${prefix}:id::catalog`, `${prefix}:id:example%20fed:catalog`, `${prefix}:id:example%2Ffed:catalog`,
    `${prefix}:id:example%3Afed:catalog`, `${prefix}:id:%ZZ:catalog`, `${prefix}:id:${'a'.repeat(129)}:catalog`,
    `${prefix}:id:example.fed:catalog`, `${prefix}:id:example-fed:organization:id:`,
    `${prefix}:id:example-fed:organization:id:%ZZ`, `${prefix}:id:example-fed:catalog:extra`,
    `${prefix}:example-fed:catalog`,
  ]) {
    assert.throws(() => parseSettings(envelope({[key]: {}})), /Invalid settings file/);
    assert.throws(() => exportSettings({[key]: {}}), /Invalid settings file/);
  }
  for (const scopeKey of [
    `yc-power:${customOrigin}:federation:id:example-fed:organization:id:example-org`,
    `${prefix}:id:example-fed:catalog`,
    `yc-power:${publicOrigin}:layout`,
  ]) assert.throws(() => parseSettings(envelope({[`yc-power:${publicOrigin}:layout`]: {scopeKey}})), /Invalid settings file/);
});

test('keeps strict catalog field validation for federated imports', () => {
  const key = `yc-power:${publicOrigin}:federation:id:example-fed:catalog`;
  const cloud = {type: 'cloud', id: 'example-cloud', name: 'Example cloud', href: '/clouds/example-cloud', folders: []};
  assert.throws(() => parseSettings(envelope({[key]: [{...cloud, token: 'unexpected'}]})), /Invalid settings file/);
  assert.throws(() => parseSettings(envelope({[key]: [{...cloud, folders: [{type: 'folder', id: 'example-folder', name: 'Example folder', href: '/folders/example-folder', token: 'unexpected'}]}]})), /Invalid settings file/);
});

test('round trips federation profile names and rejects invalid profile fields', () => {
  const key = `yc-power:${publicOrigin}:federation:id:example-fed:profile`;
  const profile = {name: 'Example federation'};
  assert.deepEqual(parseSettings(exportSettings({[key]: profile}))[key], profile);
  for (const value of [{}, {name: 7}, {name: 'a'.repeat(2049)}, {name: 'Example', token: 'unexpected'}, [], null]) {
    assert.throws(() => parseSettings(envelope({[key]: value})), /Invalid settings file/);
    assert.throws(() => exportSettings({[key]: value}), /Invalid settings file/);
  }
});

test('retains explicit legacy association without accepting nonboolean flags', () => {
  const key = `yc-power:${publicOrigin}:federation:id:example-fed:organization:id:example-org`;
  assert.equal(parseSettings(exportSettings({[key]: {legacyImported: true}}))[key].legacyImported, true);
  assert.throws(() => parseSettings(envelope({[key]: {legacyImported: 'yes'}})), /Invalid settings file/);
});

test('round trips partial appearance and validates organization and federation appearance fields', () => {
  const organizationKey = Core.scopeKey(publicOrigin, 'example-org');
  const profileKey = `yc-power:${publicOrigin}:federation:id:example-fed:profile`;
  for (const key of [organizationKey, profileKey]) {
    const base = key === profileKey ? {name: 'Example federation'} : {};
    for (const appearance of [{}, {label: ''}, {color: '#123456'}, {label: 'a'.repeat(2048), color: 'b'.repeat(2048)}]) {
      const value = {...base, appearance};
      assert.deepEqual(parseSettings(exportSettings({[key]: value}))[key], value);
    }
    for (const appearance of [null, [], 'invalid', {label: null}, {color: 7}, {label: {}}, {color: false}, {label: 'a'.repeat(2049)}, {color: 'a'.repeat(2049)}, {icon: 'rocket'}, {label: 'Example', unknown: {}}]) {
      const value = {...base, appearance};
      assert.throws(() => parseSettings(envelope({[key]: value})), /Invalid settings file/);
      assert.throws(() => exportSettings({[key]: value}), /Invalid settings file/);
    }
  }
});

test('imports version one preferences and profiles without appearance unchanged', () => {
  const organizationKey = Core.scopeKey(publicOrigin, 'example-org');
  const profileKey = `yc-power:${publicOrigin}:federation:id:example-fed:profile`;
  const stored = {
    [organizationKey]: {mine: ['example-cloud'], custom: {}, initialized: true},
    [profileKey]: {name: 'Example federation'},
  };
  const imported = parseSettings(envelope(stored));
  assert.deepEqual(imported[organizationKey], stored[organizationKey]);
  assert.deepEqual(imported[profileKey], stored[profileKey]);
});

test('round trips optional global flags without adding missing flags', () => {
  const defaults = {domainHosts: [publicOrigin], cloudOnlyHosts: [], compactDensity: false};
  assert.deepEqual(parseSettings(envelope({})), defaults);
  assert.deepEqual(JSON.parse(exportSettings({})).settings, defaults);
  for (const key of ['hideSingleOrganization', 'showPersonalOrganizations', 'colorConsoleLogo', 'showFolderBadge']) {
    for (const value of [true, false]) {
      assert.deepEqual(parseSettings(exportSettings({[key]: value})), {...defaults, [key]: value});
    }
    for (const value of [null, 0, 1, 'true', 'false', [], {}]) {
      assert.throws(() => parseSettings(envelope({[key]: value})), /Invalid settings file/);
      assert.throws(() => exportSettings({[key]: value}), /Invalid settings file/);
    }
  }
});

test('round trips personal catalogs with the same validation and metadata filtering as catalogs', () => {
  const key = `yc-power:${publicOrigin}:passport-catalog`;
  const folder = {type: 'folder', id: 'example-folder', name: 'Example folder', href: '/folders/example-folder', cloudId: 'example-cloud'};
  const cloud = {type: 'cloud', id: 'example-cloud', name: 'Example cloud', href: '/clouds/example-cloud', organizationId: 'example-org', organizationName: 'Example organization', folders: [folder]};
  const expected = Core.catalogCache([cloud], publicOrigin);
  assert.deepEqual(parseSettings(envelope({[key]: [cloud]}))[key], expected);
  const output = exportSettings({[key]: [{...cloud, offset: 10, pinned: false, folders: [{...folder, offset: 20}]}]});
  assert.deepEqual(parseSettings(output)[key], expected);
  assert.equal(output.includes('offset'), false);
  assert.equal(output.includes('pinned'), false);
  for (const value of [null, {}, [{id: 'bad'}], [{...cloud, folders: {}}]]) {
    assert.throws(() => parseSettings(envelope({[key]: value})), /Invalid settings file/);
    assert.throws(() => exportSettings({[key]: value}), /Invalid settings file/);
  }
  for (const value of [[{...cloud, token: 'unexpected'}], [{...cloud, folders: [{...folder, token: 'unexpected'}]}]]) {
    assert.throws(() => parseSettings(envelope({[key]: value})), /Invalid settings file/);
    assert.equal(exportSettings({[key]: value}).includes('unexpected'), false);
  }
});

test('round trips personal account profiles and rejects invalid fields and federated profile keys', () => {
  const key = `yc-power:${publicOrigin}:passport-profile`;
  for (const profile of [
    {name: 'Example person'},
    {name: 'Example person', appearance: {}},
    {name: 'Example person', appearance: {label: 'Personal account', color: '#123456'}},
  ]) {
    assert.deepEqual(parseSettings(envelope({[key]: profile}))[key], profile);
    assert.deepEqual(parseSettings(exportSettings({[key]: profile}))[key], profile);
  }
  for (const profile of [
    null, [], {}, {name: 7}, {name: 'a'.repeat(2049)},
    {name: 'Example person', token: 'unexpected'},
    {name: 'Example person', appearance: null},
    {name: 'Example person', appearance: {label: {}}},
    {name: 'Example person', appearance: {color: false}},
    {name: 'Example person', appearance: {label: 'a'.repeat(2049)}},
    {name: 'Example person', appearance: {icon: 'person'}},
  ]) {
    assert.throws(() => parseSettings(envelope({[key]: profile})), /Invalid settings file/);
    assert.throws(() => exportSettings({[key]: profile}), /Invalid settings file/);
  }
  const nestedKey = `yc-power:${publicOrigin}:federation:id:example-fed:passport-profile`;
  assert.throws(() => parseSettings(envelope({[nestedKey]: {name: 'Example person'}})), /Invalid settings file/);
  assert.throws(() => exportSettings({[nestedKey]: {name: 'Example person'}}), /Invalid settings file/);
});

test('round trips layout group order while preserving unknown groups and legacy layouts', () => {
  const key = `yc-power:${publicOrigin}:layout`;
  for (const layout of [
    {},
    {width: 360, collapsedOrganizations: ['example-org']},
    {groupOrder: []},
    {groupOrder: ['federation:example-fed-b', 'account:passport', 'federation:removed-fed', 'federation:example-fed-a']},
    {groupOrder: ['a'.repeat(2048)]},
  ]) {
    assert.deepEqual(parseSettings(envelope({[key]: layout}))[key], layout);
    assert.deepEqual(parseSettings(exportSettings({[key]: layout}))[key], layout);
  }
  for (const groupOrder of [null, {}, 'account:passport', false, [null], [7], [{}], ['a'.repeat(2049)]]) {
    assert.throws(() => parseSettings(envelope({[key]: {groupOrder}})), /Invalid settings file/);
    assert.throws(() => exportSettings({[key]: {groupOrder}}), /Invalid settings file/);
  }
});

test('personal profile subjects round trip without allowing subjects in federation profiles', () => {
  const key = `yc-power:${publicOrigin}:passport-profile`;
  const profile = {name: 'Synthetic person', subjectId: 'synthetic-subject', appearance: {label: 'Personal'}};
  assert.deepEqual(parseSettings(exportSettings({[key]: profile}))[key], profile);
  for (const subjectId of [null, '', '../bad', 'bad.subject', 'a'.repeat(257), 7, {}]) {
    assert.throws(() => parseSettings(envelope({[key]: {...profile, subjectId}})), /Invalid settings file/);
    assert.throws(() => exportSettings({[key]: {...profile, subjectId}}), /Invalid settings file/);
  }
  const federationKey = `yc-power:${publicOrigin}:federation:id:example-fed:profile`;
  assert.throws(() => parseSettings(envelope({[federationKey]: profile})), /Invalid settings file/);
  assert.throws(() => exportSettings({[federationKey]: profile}), /Invalid settings file/);
});

test('container preference exports without browser-local container associations', () => {
  const result = parseSettings(exportSettings({useSessionContainers: true, _sessionContainers: {'synthetic-key': 'firefox-container-1'}}));
  assert.equal(result.useSessionContainers, true);
  assert.equal('_sessionContainers' in result, false);
  assert.throws(() => parseSettings(envelope({useSessionContainers: 'true'})), /Invalid settings file/);
});

test('isolated personal scopes preserve independent account settings', () => {
  const Federation = require('../federation.js');
  const stored = {useSessionContainers: true};
  for (const subject of ['subject-alpha', 'subject-beta']) {
    stored[Federation.passportProfileKey(publicOrigin, subject)] = {name: subject, subjectId: subject};
    stored[Federation.passportCatalogKey(publicOrigin, subject)] = [];
    stored[Federation.scopeKey(publicOrigin, 'example-org', null, subject)] = {mine: ['example-cloud'], initialized: true, width: 360, custom: {}};
  }
  const parsed = parseSettings(exportSettings(stored));
  for (const [key, value] of Object.entries(stored)) assert.deepEqual(parsed[key], value);
});

test('personal scoped profiles reject an account different from their storage key', () => {
  const Federation = require('../federation.js');
  const key = Federation.passportProfileKey(publicOrigin, 'subject-alpha');
  assert.throws(() => parseSettings(envelope({[key]: {name: 'Synthetic', subjectId: 'subject-beta'}})), /Invalid settings file/);
  assert.equal(parseSettings(envelope({[key]: {name: 'Synthetic'}}))[key].name, 'Synthetic');
});

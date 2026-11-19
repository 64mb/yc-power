const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../federation.js');
const origin = 'https://console.yandex.cloud';

test('federation routes require an exact safe same-origin path', () => {
  for (const href of ['/federations/example-1_A', `${origin}/federations/example-1_A`]) assert.equal(F.federationId(href, origin), 'example-1_A');
  for (const href of ['/federations/', '/federations/a/', '/federations/a?x', '/federations/a?', '/federations/a#', '/federations/%61', '/federations/a/b', '/federations/a\n', '//other.example/federations/a', 'https://other.example/federations/a', '/federations/../federations/a', `/federations/${'a'.repeat(129)}`]) assert.equal(F.federationId(href, origin), null, href);
});

test('keys preserve legacy scopes and isolate federation and organization identities', () => {
  assert.equal(F.catalogKey(origin), `yc-power:${origin}:catalog`);
  assert.equal(F.scopeKey(origin, 'a:b'), `yc-power:${origin}:organization:id:a%3Ab`);
  const keys = [F.scopeKey(origin, 'a', 'b'), F.scopeKey(origin, 'b', 'a'), F.scopeKey(origin, 'a'), F.scopeKey(origin, null, 'a'), F.catalogKey(origin, 'a'), F.catalogKey(origin)];
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(F.parseKey(F.scopeKey(origin, 'org:/%', 'example')), {origin, federationId: 'example', kind: 'organization', organizationId: 'org:/%'});
  assert.deepEqual(F.parseKey(`yc-power:${origin}:layout`), {origin, federationId: null, kind: 'layout', organizationId: null});
  assert.notEqual(F.identityKey('a:b', 'c'), F.identityKey('a', 'b:c'));
  assert.notEqual(F.identityKey(null, 'a'), F.identityKey('null', 'a'));
});

test('parser rejects malformed and noncanonical keys', () => {
  const suffixes = ['organization:id:', 'organization:id:%', 'organization:id:%61', 'organization:id:a:b', 'federation:id:a%3Ab:catalog', 'federation:id:%61:catalog', 'federation:id::catalog', 'federation:id:a:layout', 'federation:id:a:organization:id:%FF', 'catalog:extra', 'catalog\n'];
  for (const suffix of suffixes) assert.equal(F.parseKey(`yc-power:${origin}:${suffix}`), null, suffix);
  for (const host of ['http://example.test', 'https://EXAMPLE.test', 'https://example.test:443', 'https://example.test:8443', 'https://user@example.test', 'https://example.test/path', 'https://example.test/', 'https://*.example.test']) assert.equal(F.parseKey(`yc-power:${host}:catalog`), null, host);
});

test('catalog grouping uses only stored catalogs for the exact origin', () => {
  const stored = {
    [F.catalogKey(origin)]: [{id: 'same'}],
    [F.catalogKey(origin, 'one')]: [{id: 'same'}],
    [F.catalogKey(origin, 'two')]: [{id: 'same'}],
    [F.catalogKey('https://example.test', 'one')]: [],
    [F.scopeKey(origin, 'org', 'one')]: [],
    [F.catalogKey(origin, 'bad')]: {},
  };
  const groups = F.catalogGroups(stored, origin, (items, host) => items.map(item => ({...item, host})));
  assert.deepEqual(groups.map(group => group.federationId), [null, 'one', 'two']);
  assert.equal(groups[1].catalog[0].host, origin);
  assert.equal(new Set(groups.map(group => F.identityKey(group.federationId, group.catalog[0].id))).size, 3);
  delete stored[F.catalogKey(origin)];
  assert.deepEqual(F.catalogGroups(stored, origin, value => value).map(group => group.federationId), ['one', 'two']);
});

test('login URLs validate origin and identifier', () => {
  assert.equal(F.loginHref(origin, 'example_1'), `${origin}/federations/example_1`);
  for (const id of [null, '', '../x', 'a:b', 'a?b', 'a\n', 'a'.repeat(129)]) assert.equal(F.loginHref(origin, id), null);
  assert.equal(F.loginHref(`${origin}/`, 'a'), null);
  assert.equal(F.loginHref('https://user@example.test', 'a'), null);
});

test('inline identity uses JSON assignments and the last assignment is authoritative', () => {
  const assignment = user => `window.__DATA__ = ${JSON.stringify({user})};`;
  const federated = assignment({isFederated: true, federationId: 'example', federationName: 'Example team', privateField: 'ignored'});
  assert.deepEqual(F.identityFromScripts(['window.__DATA__ = {};', federated]), {id: 'example', name: 'Example team'});
  assert.deepEqual(F.identityFromScripts([federated, assignment({isFederated: false})]), {id: null, name: null});
  assert.deepEqual(F.identityFromScripts([assignment({isFederated: false}), federated]), {id: 'example', name: 'Example team'});
  assert.deepEqual(F.identityFromScripts([assignment({isFederated: true, federationId: 'example'})]), {id: 'example', name: 'example'});
  for (const invalid of ['window.__DATA__ = {broken};', 'window.__DATA__ = {};', assignment({}), assignment({isFederated: true, federationId: '../bad'}), assignment({isFederated: 'true', federationId: 'example'}), 'window.__DATA__ = ' + ' '.repeat(2 * 1024 * 1024)]) {
    assert.equal(F.identityFromScripts([federated, invalid]), null);
  }
  assert.equal(F.identityFromScripts(['const data = {"user":{"isFederated":false}};']), null);
  assert.equal(F.identityFromScripts(['window.__DATA__ = (() => { throw Error("never execute"); })();']), null);
});

test('profile keys belong exclusively to federation scopes', () => {
  assert.deepEqual(F.parseKey(F.profileKey(origin, 'example')), {origin, federationId: 'example', kind: 'profile', organizationId: null});
  assert.equal(F.parseKey(`yc-power:${origin}:profile`), null);
});

test('dotted federation identifiers round trip without accepting dot segments', () => {
  const id = 'example.team-1_A';
  assert.equal(F.federationId(`/federations/${id}`, origin), id);
  assert.equal(F.loginHref(origin, id), `${origin}/federations/${id}`);
  assert.equal(F.parseKey(F.catalogKey(origin, id)).federationId, id);
  assert.equal(F.parseKey(F.scopeKey(origin, 'org', id)).federationId, id);
  assert.equal(F.parseKey(F.profileKey(origin, id)).federationId, id);
  assert.deepEqual(F.identityFromScripts([`window.__DATA__ = ${JSON.stringify({user: {isFederated: true, federationId: id}})};`]), {id, name: id});
  for (const invalid of ['.', '..', '.example', '-example', '_example']) {
    assert.equal(F.federationId(`/federations/${invalid}`, origin), null);
    assert.equal(F.loginHref(origin, invalid), null);
    assert.equal(F.parseKey(F.catalogKey(origin, invalid)), null);
  }
});

test('passport snapshots remain distinct from legacy and federation catalogs', () => {
  const passport = F.passportCatalogKey(origin);
  assert.deepEqual(F.parseKey(passport), {origin, federationId: null, kind: 'passport-catalog', organizationId: null});
  assert.notEqual(passport, F.catalogKey(origin));
  assert.equal(F.parseKey(`yc-power:${origin}:federation:id:example:passport-catalog`), null);
  const groups = F.catalogGroups({[passport]: [{id: 'personal'}], [F.catalogKey(origin)]: [{id: 'legacy'}]}, origin, value => value);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find(group => group.key === passport).catalog, [{id: 'personal'}]);
  assert.equal(F.identityFromScripts(['window.__DATA__ = {"user":{"isFederated":false,"isLocalFederated":true}};']), null);
});

test('real passport bootstrap omits federation flags and uses a numeric uid', () => {
  const passport = user => F.identityFromScripts(['window.__DATA__ = ' + JSON.stringify({user}) + ';']);
  assert.deepEqual(passport({id: 'synthetic-user', uid: '1234567890'}), {id: null, name: null, subjectId: 'synthetic-user'});
  for (const uid of ['', '0', 'invalid', '123\n', '9'.repeat(33)]) assert.equal(passport({id: 'synthetic-user', uid}), null);
  assert.equal(passport({uid: '1234567890'}), null);
  assert.equal(passport({id: 'synthetic-user', yandexuid: '1234567890'}), null);
  assert.equal(passport({id: 'synthetic-user', uid: '1234567890', federationId: 'example-fed'}), null);
  assert.equal(passport({id: 'synthetic-user', uid: '1234567890', isLocalFederated: true}), null);
  assert.deepEqual(passport({id: 'synthetic-user', uid: '1234567890', isFederated: true, federationId: 'example-fed'}), {id: 'example-fed', name: 'example-fed'});
});

test('passport heading uses the account display name without exposing its uid', () => {
  const identity = F.identityFromScripts(['window.__DATA__ = {"user":{"id":"synthetic-user","uid":"1234567890","displayName":"Synthetic account","login":"synthetic-login"}};']);
  assert.deepEqual(identity, {id: null, name: 'Synthetic account', subjectId: 'synthetic-user'});
  assert.equal(JSON.stringify(identity).includes('1234567890'), false);
  assert.deepEqual(F.identityFromScripts(['window.__DATA__ = {"user":{"id":"synthetic-user","uid":"1234567890","login":"synthetic-login"}};']), {id: null, name: 'synthetic-login', subjectId: 'synthetic-user'});
});

test('personal login links select a safe subject and preserve the relative destination', () => {
  const path = '/folders/example-folder?tab=overview#details';
  assert.equal(F.passportLoginHref(origin, 'synthetic-subject', path), `${origin}/auth/switch?sub=synthetic-subject&redirectUrl=${encodeURIComponent(path)}`);
  for (const subject of [null, undefined]) assert.equal(F.passportLoginHref(origin, subject, path), `${origin}/auth/switch?redirectUrl=${encodeURIComponent(path)}`);
  for (const subject of ['', '../bad', 'bad.subject', 'bad\n', 'a'.repeat(257), 7]) assert.equal(F.passportLoginHref(origin, subject, path), null);
  for (const path of ['//other.example/path', 'https://other.example/path', '/\\other.example/path', '/folders/example\n', 'relative', null]) assert.equal(F.passportLoginHref(origin, 'synthetic-subject', path), null);
  assert.equal(F.passportLoginHref(`${origin}/`, 'synthetic-subject', path), null);
  const identity = id => F.identityFromScripts([`window.__DATA__ = ${JSON.stringify({user: {isFederated: false, id}})};`]);
  assert.equal(identity('synthetic-subject').subjectId, 'synthetic-subject');
  for (const id of ['', '../bad', 'bad.subject', 'a'.repeat(257), 7]) assert.deepEqual(identity(id), {id: null, name: null});
  assert.equal(F.validSubjectId('a'.repeat(256)), true);
});

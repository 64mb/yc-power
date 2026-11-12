const {test} = require('node:test');
const assert = require('node:assert/strict');
const {annotateOrganizations, catalog, currentOrganization, scopeKey} = require('../core.js');
const origin = 'https://console.yandex.cloud';

test('DOM organization headers scope two virtual groups despite sticky offsets', () => {
  const rows = annotateOrganizations([
    {type:'organization',id:'org-a',name:'First',offset:450},
    {type:'cloud',id:'a',offset:0},
    {type:'folder',id:'fa',offset:36},
    {type:'organization',id:'org-b',name:'Second',offset:45},
    {type:'cloud',id:'b',offset:500},
    {type:'folder',id:'fb',offset:536},
  ]);
  const clouds = catalog(rows);
  assert.equal(clouds.find(c=>c.id==='a').organizationId, 'org-a');
  assert.equal(clouds.find(c=>c.id==='b').organizationName, 'Second');
  assert.deepEqual(clouds.find(c=>c.id==='a').folders.map(f=>f.id), ['fa']);
  assert.deepEqual(clouds.find(c=>c.id==='b').folders.map(f=>f.id), ['fb']);
  assert.deepEqual(currentOrganization(clouds, '/folders/fb', origin), {id:'org-b',name:'Second'});
  assert.deepEqual(currentOrganization(clouds, '/clouds/a/fa', origin), {id:'org-a',name:'First'});
  assert.deepEqual(currentOrganization(clouds, '/organizations/org-b', origin), {id:'org-b',name:'Second'});
});

test('later virtual snapshots without headers preserve known cloud organization', () => {
  const previous = [{type:'cloud',id:'a',organizationId:'org-a',organizationName:'First',folders:[]}];
  const clouds = catalog([{type:'cloud',id:'a',offset:0},{type:'folder',id:'f',offset:36}], previous);
  assert.equal(clouds[0].organizationId, 'org-a');
  assert.equal(clouds[0].folders[0].id, 'f');
});

test('orphan folders with another organization never attach to a nearby cloud', () => {
  const clouds = catalog([{type:'cloud',id:'a',organizationId:'org-a',offset:0},
    {type:'folder',id:'orphan',organizationId:'org-b',offset:36}]);
  assert.deepEqual(clouds[0].folders, []);
  assert.deepEqual(currentOrganization(clouds, '/folders/orphan', origin), {id:'org-a',name:'org-a'});
});

test('settings keys isolate origin, organization, and unidentified organizations', () => {
  const keys = [scopeKey(origin, 'a'), scopeKey(origin, 'b'), scopeKey(origin), scopeKey(origin, 'unscoped'), scopeKey('https://other.example', 'a')];
  assert.equal(new Set(keys).size, keys.length);
  const preferences = {[keys[0]]:{mine:['cloud-a'],custom:{'cloud:a':{label:'A'}},width:420,showAllModern:true},
    [keys[1]]:{mine:['cloud-b'],custom:{},width:300,showAllModern:false},[keys[2]]:{mine:['unknown']}};
  const first = structuredClone(preferences[keys[0]]);
  first.mine.push('changed');
  assert.deepEqual(preferences[keys[1]].mine, ['cloud-b']);
  assert.deepEqual(preferences[keys[0]].mine, ['cloud-a']);
  assert.equal(preferences[keys[1]].showAllModern, false);
  assert.deepEqual(preferences[keys[2]].mine, ['unknown']);
});

test('root routes infer the single visible organization without requiring an active cloud', () => {
  const clouds = [{id:'a',organizationId:'org-a',organizationName:'First',folders:[]}, {id:'b',organizationId:'org-a',organizationName:'First',folders:[]}];
  assert.deepEqual(currentOrganization(clouds, '/', origin), {id:'org-a',name:'First'});
  assert.deepEqual(currentOrganization(clouds, '/services', origin), {id:'org-a',name:'First'});
});

test('an explicit first-plus selection resolves an ambiguous organization without mixing scopes', () => {
  const clouds = [{id:'a',organizationId:'org-a',organizationName:'First',folders:[]}, {id:'b',organizationId:'org-b',organizationName:'Second',folders:[]}];
  assert.equal(currentOrganization(clouds, '/', origin), null);
  assert.deepEqual(currentOrganization(clouds, '/', origin, 'org-b'), {id:'org-b',name:'Second'});
  assert.deepEqual(currentOrganization(clouds, '/clouds/a', origin, 'org-b'), {id:'org-a',name:'First'});
  assert.notEqual(scopeKey(origin, currentOrganization(clouds, '/', origin, 'org-b').id), scopeKey(origin, 'org-a'));
});

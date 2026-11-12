const {test} = require('node:test');
const assert = require('node:assert/strict');
const {label, color, route, catalog} = require('../core.js');
const origin = 'https://console.yandex.cloud';
test('accepts active cloud singular route and dotted folder identifiers', () => {
  assert.deepEqual(route('/cloud/yc.example.cloud', origin), {type:'cloud',id:'yc.example.cloud',href:'/cloud/yc.example.cloud'});
  assert.equal(route('/clouds/yc.example.cloud/yc.example.folder', origin).cloudId, 'yc.example.cloud');
  assert.equal(route('/folders/yc.example.folder', origin).id, 'yc.example.folder');
  for (const href of ['javascript:alert(1)', 'https://other.example/folders/a', '/services/a']) assert.equal(route(href, origin), null);
});
test('shortens shared prefixes without losing the distinguishing suffix', () => {
  assert.equal(label('example-app-enterprise-folder', 'yc-example-app-prod'), 'enterprise');
  assert.equal(label('folder'), 'folder');
  assert.equal(label('yc-production-cloud'), 'production');
});
test('colors remain stable for an object ID', () => {
  assert.equal(color('abc'), color('abc'));
  assert.notEqual(color('abc'), color('def'));
});
test('virtual rows keep folders under correct clouds, never under a pinned neighbor', () => {
  const rows = [
    {type:'cloud',id:'a',offset:200,name:'first',href:'/clouds/a'},
    {type:'cloud',id:'b',offset:300,name:'second',href:'/cloud/b'},
    {type:'folder',id:'f',offset:336,name:'folder',href:'/folders/f'},
    {type:'folder',id:'p',cloudId:'a',offset:10,pinned:true,name:'pinned',href:'/clouds/a/p'},
  ];
  const previous = [{type:'cloud',id:'a',folders:[{type:'folder',id:'f'}]}, {type:'cloud',id:'gone',folders:[]}];
  const clouds = catalog(rows.reverse(), previous);
  assert.equal(clouds.find(c=>c.id==='b').folders[0].id, 'f');
  assert.deepEqual(clouds.find(c=>c.id==='a').folders.map(f=>f.id), ['p']);
  assert.equal(clouds.some(c=>c.id==='gone'), false);
});
test('organization boundaries prevent orphan folder attachment', () => {
  const clouds = catalog([{type:'cloud',id:'a',offset:0},{type:'organization',id:'org',offset:10},{type:'folder',id:'orphan',offset:20}]);
  assert.deepEqual(clouds[0].folders, []);
});
test('completed folder refresh drops removed folders only for the target cloud', () => {
  const previous = [{type:'cloud',id:'a',folders:[{type:'folder',id:'removed'}]}, {type:'cloud',id:'b',folders:[{type:'folder',id:'keep'}]}];
  const clouds = catalog([{type:'cloud',id:'a',offset:0},{type:'folder',id:'new',offset:36},{type:'cloud',id:'b',offset:72}], previous, 'a');
  assert.deepEqual(clouds.find(c=>c.id==='a').folders.map(f=>f.id), ['new']);
  assert.deepEqual(clouds.find(c=>c.id==='b').folders.map(f=>f.id), ['keep']);
});
test('keeps a meaningful YC suffix when shortening folder names', () => {
  assert.equal(label('example-runners-yc-folder', 'yc-example-build-prod'), 'runners · yc');
  assert.equal(label('example-runners-yt-folder', 'yc-example-build-prod'), 'runners · yt');
});

test('catalog cache keeps validated routes and strips unrelated fields', () => {
  const {catalogCache} = require('../core.js');
  const result = catalogCache([null, {id: 'bad', name: 'Bad', href: 'https://example.net/clouds/bad'}, {
    id: 'cloud-alpha', name: 'Alpha', href: '/clouds/cloud-alpha', organizationId: 'org-alpha', organizationName: 'Alpha organization', offset: 42, dom: 'discard',
    folders: [{id: 'folder-alpha', name: 'Folder', href: '/clouds/cloud-alpha/folder-alpha', extra: true}, {id: 'folder-beta', name: 'Wrong parent', href: '/clouds/cloud-beta/folder-beta'}],
  }], 'https://console.example.com');
  assert.equal(result.length, 1);
  assert.equal(result[0].offset, undefined);
  assert.equal(result[0].dom, undefined);
  assert.equal(result[0].folders.length, 1);
  assert.equal(result[0].folders[0].extra, undefined);
  assert.equal(result[0].folders[0].cloudId, 'cloud-alpha');
});

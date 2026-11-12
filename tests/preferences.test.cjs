const {test} = require('node:test');
const assert = require('node:assert/strict');
const {preferenceSync, scopeKey} = require('../core.js');
const a = scopeKey('https://console.yandex.cloud', 'a');
const b = scopeKey('https://console.yandex.cloud', 'b');

test('read-only scope navigation never overwrites another tab settings', async () => {
  const writes = [];
  const cache = {[a]:{mine:['old'],custom:{},width:300}};
  const sync = preferenceSync(cache, (...args)=>writes.push(args));
  assert.equal(sync.receive(a, {mine:['new'],custom:{label:'changed'},width:480}), true);
  await sync.flush(a);
  await sync.flush(b);
  assert.deepEqual(writes, []);
  assert.deepEqual(cache[a].mine, ['new']);
  assert.equal(cache[a].width, 480);
});

test('pending local edits remain isolated by key and flush only their captured snapshot', async () => {
  const writes = [];
  const cache = {};
  const sync = preferenceSync(cache, (key, snapshot)=>writes.push([key, snapshot]));
  const settings = {mine:['local'],custom:{label:'local'},showAllModern:true};
  sync.stage(a, settings);
  settings.mine.push('later mutation');
  assert.equal(sync.receive(a, {mine:['external']}), false);
  assert.equal(sync.receive(b, {mine:['other org']}), true);
  await sync.flush(b);
  assert.deepEqual(writes, []);
  await sync.flush(a);
  assert.deepEqual(writes, [[a,{mine:['local'],custom:{label:'local'},showAllModern:true}]]);
  assert.deepEqual(cache[b].mine, ['other org']);
  assert.equal(sync.receive(a, {mine:['external after save']}), true);
});

test('self storage events do not trigger writebacks or active-state reconciliation', async () => {
  const cache = {};
  let writes = 0;
  const sync = preferenceSync(cache, ()=>{writes++;});
  const settings = {mine:['a'],width:400};
  sync.stage(a, settings);
  assert.equal(sync.receive(a, settings), false);
  await sync.flush(a);
  assert.equal(sync.receive(a, settings), false);
  await sync.flush(a);
  assert.equal(writes, 1);
});

test('a completed older save cannot clear a newer pending edit', async () => {
  const cache = {};
  const releases = [];
  const writes = [];
  const sync = preferenceSync(cache, (key, snapshot)=>new Promise(resolve=>{ writes.push(snapshot); releases.push(resolve); }));
  sync.stage(a, {mine:['first']});
  const first = sync.flush(a);
  await Promise.resolve();
  sync.stage(a, {mine:['second']});
  releases.shift()();
  await first;
  assert.equal(sync.receive(a, {mine:['stale external']}), false);
  const second = sync.flush(a);
  await Promise.resolve();
  releases.shift()();
  await second;
  assert.deepEqual(writes, [{mine:['first']},{mine:['second']}]);
});

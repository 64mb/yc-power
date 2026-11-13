const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function background(hosts, granted) {
    const calls = [];
    const listeners = {};
    const event = name => ({addListener: fn => { listeners[name] = fn; }});
    const browser = {
        storage: {local: {get: async () => ({domainHosts: hosts})}, onChanged: event('storage')},
        permissions: {
            contains: async ({origins}) => origins.every(origin => granted.includes(origin)),
            onAdded: event('added'), onRemoved: event('removed'),
        },
        contentScripts: {register: async value => {
            calls.push(['register', JSON.parse(JSON.stringify(value))]);
            return {unregister: async () => { calls.push(['unregister']); }};
        }},
        tabs: {
            query: async value => { calls.push(['query', JSON.parse(JSON.stringify(value))]); return [{id: 42}]; },
            insertCSS: async (...args) => { calls.push(['insertCSS', ...args]); },
            executeScript: async (...args) => { calls.push(['executeScript', ...args]); },
        },
    };
    vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), {browser, URL, console});
    await new Promise(resolve => setImmediate(resolve));
    return {calls, listeners};
}

test('Firefox registers both granted addresses and injects into existing tabs', async () => {
    const hosts = ['https://alpha.example', 'https://beta.example'];
    const {calls} = await background(hosts, hosts.map(host => host + '/*'));
    assert.deepEqual(calls.find(([name]) => name === 'register')[1], {
        matches: hosts.map(host => host + '/*'), js: [{file: 'content.js'}],
        css: [{file: 'content.css'}], runAt: 'document_idle',
    });
    assert.ok(calls.some(([name]) => name === 'executeScript'));
});

test('Firefox unregisters disabled addresses when settings change', async () => {
    const hosts = ['https://alpha.example'];
    const {calls, listeners} = await background(hosts, ['https://alpha.example/*']);
    hosts.length = 0;
    listeners.storage({domainHosts: {newValue: []}}, 'local');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(([name]) => name === 'unregister').length, 1);
    assert.equal(calls.filter(([name]) => name === 'register').length, 1);
});

test('Firefox excludes ungranted and invalid origins', async () => {
    const {calls} = await background(['https://alpha.example', 'https://beta.example', 'http://invalid.example'], ['https://alpha.example/*']);
    assert.deepEqual(calls.find(([name]) => name === 'register')[1].matches, ['https://alpha.example/*']);
});

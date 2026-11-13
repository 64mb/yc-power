const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function worker({hosts, granted = ['https://console.yandex.cloud/*'], registered = []} = {}) {
    const calls = [];
    const listeners = {};
    const event = (name) => ({addListener: (listener) => { listeners[name] = listener; }});
    const chrome = {
        storage: {local: {get: async () => ({domainHosts: hosts})}, onChanged: event('storage')},
        permissions: {
            contains: async ({origins}) => origins.every((origin) => granted.includes(origin)),
            onAdded: event('added'), onRemoved: event('removed'),
        },
        runtime: {onInstalled: event('installed'), onStartup: event('startup')},
        scripting: Object.fromEntries(['getRegisteredContentScripts', 'registerContentScripts', 'updateContentScripts', 'unregisterContentScripts', 'insertCSS', 'executeScript'].map((name) => [name, async (args) => {
            calls.push([name, JSON.parse(JSON.stringify(args))]);
            return name === 'getRegisteredContentScripts' ? registered : undefined;
        }])),
        tabs: {query: async (query) => { calls.push(['query', JSON.parse(JSON.stringify(query))]); return [{id: 42}]; }},
    };
    vm.runInNewContext(fs.readFileSync('chromium-background.js', 'utf8'), {chrome, URL, console});
    await new Promise((resolve) => setImmediate(resolve));
    return {calls, listeners};
}

test('Chromium registers only granted configured HTTPS origins and injects into existing tabs', async () => {
    const {calls} = await worker({hosts: ['https://console.yandex.cloud', 'https://other.example', 'http://invalid.example', 'https://user:pass@invalid.example']});
    const script = calls.find(([name]) => name === 'registerContentScripts')[1][0];
    assert.deepEqual(script.matches, ['https://console.yandex.cloud/*']);
    assert.deepEqual(script.js, ['browser-alias.js', 'content.js']);
    assert.equal(script.persistAcrossSessions, true);
    assert.deepEqual(calls.find(([name]) => name === 'executeScript')[1], {target: {tabId: 42}, files: ['browser-alias.js', 'content.js']});
});

test('Chromium removes persistent registration when all origins are disabled', async () => {
    const {calls} = await worker({hosts: [], registered: [{id: 'yc-power'}]});
    assert.ok(calls.some(([name]) => name === 'unregisterContentScripts'));
    assert.ok(!calls.some(([name]) => name === 'executeScript'));
});

test('Chromium reconciles existing persistent registration on worker startup', async () => {
    const {calls, listeners} = await worker({registered: [{id: 'yc-power'}]});
    assert.ok(calls.some(([name]) => name === 'updateContentScripts'));
    assert.deepEqual(Object.keys(listeners).sort(), ['added', 'installed', 'removed', 'startup', 'storage']);
});

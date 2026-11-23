const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const origin = 'https://alpha.example';
const extensionId = 'yc-power@local';
const copy = value => JSON.parse(JSON.stringify(value));

async function background(hosts, granted, {enabled = false, permissions = [], mappings = {}, containers = [], profiles = {}, supportedColors} = {}) {
    const calls = [];
    const listeners = {};
    const event = name => ({addListener: fn => { listeners[name] = fn; }});
    const stored = {domainHosts: hosts, useSessionContainers: enabled, _sessionContainers: mappings, ...profiles};
    const cookieStores = new Map(containers.map(cookieStoreId => [cookieStoreId, {cookieStoreId, color: 'blue'}]));
    let nextTabId = 100;
    const browser = {
        storage: {local: {
            get: async () => copy(stored),
            set: async value => {
                calls.push(['storage.set', copy(value)]);
                Object.assign(stored, copy(value));
            },
        }, onChanged: event('storage')},
        permissions: {
            contains: async ({origins = [], permissions: requested = []}) =>
                origins.every(origin => granted.includes(origin)) && requested.every(permission => permissions.includes(permission)),
            onAdded: event('added'), onRemoved: event('removed'),
        },
        runtime: {id: extensionId, onMessage: event('message')},
        contextualIdentities: {
            ...(supportedColors ? {getSupportedColors: async () => copy(supportedColors)} : {}),
            update: async (cookieStoreId, values) => {
                calls.push(['containers.update', cookieStoreId, copy(values)]);
                const container = {...cookieStores.get(cookieStoreId), ...values};
                cookieStores.set(cookieStoreId, container);
                return container;
            },
            get: async cookieStoreId => {
                calls.push(['containers.get', cookieStoreId]);
                if (!cookieStores.has(cookieStoreId)) throw new Error('Container does not exist');
                return cookieStores.get(cookieStoreId);
            },
            create: async value => {
                const cookieStoreId = 'firefox-container-' + (cookieStores.size + 1);
                calls.push(['containers.create', copy(value)]);
                const container = {cookieStoreId, color: value.color};
                cookieStores.set(cookieStoreId, container);
                return container;
            },
        },
        contentScripts: {register: async value => {
            calls.push(['register', JSON.parse(JSON.stringify(value))]);
            return {unregister: async () => { calls.push(['unregister']); }};
        }},
        tabs: {
            onRemoved: event('tabRemoved'),
            create: async value => {
                const id = nextTabId++;
                calls.push(['tabs.create', copy(value), id]);
                return {id};
            },
            update: async (id, value) => { calls.push(['tabs.update', id, copy(value)]); },
            query: async value => { calls.push(['query', JSON.parse(JSON.stringify(value))]); return [{id: 42}]; },
            insertCSS: async (...args) => { calls.push(['insertCSS', ...args]); },
            executeScript: async (...args) => { calls.push(['executeScript', ...args]); },
        },
    };
    const context = vm.createContext({browser, URL, console});
    for (const script of ['core.js', 'federation.js', 'background.js']) {
        vm.runInContext(fs.readFileSync(script, 'utf8'), context, {filename: script});
    }
    await new Promise(resolve => setImmediate(resolve));
    return {calls, listeners, stored};
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

function containerBackground(options) {
    return background([origin], [origin + '/*'], {
        enabled: true, permissions: ['contextualIdentities', 'cookies'], ...options,
    });
}

function sender({id = 42, url = origin + '/', cookieStoreId = 'firefox-default', extension = extensionId} = {}) {
    return {id: extension, url, tab: {id, cookieStoreId}};
}

function openContainer(listeners, message, from = sender()) {
    return listeners.message({
        type: 'yc-power:open-container',
        href: '/clouds/demo',
        federationId: 'demo-federation',
        ...message,
    }, from);
}

test('Firefox rejects container requests when disabled or when permissions are missing', async () => {
    for (const options of [{enabled: false}, {permissions: ['contextualIdentities']}, {permissions: ['cookies']}]) {
        const {calls, listeners} = await containerBackground(options);
        await assert.rejects(openContainer(listeners), /Containers are unavailable/);
        assert.ok(!calls.some(([name]) => name === 'containers.create' || name === 'tabs.create'));
    }
});

test('Firefox reuses a stored federation container and keeps navigation in the current container', async () => {
    const cookieStoreId = 'firefox-container-existing';
    const key = JSON.stringify([origin, 'demo-federation', null]);
    const {calls, listeners} = await containerBackground({mappings: {[key]: cookieStoreId}, containers: [cookieStoreId]});
    assert.equal((await openContainer(listeners)).opened, true);
    assert.deepEqual(calls.find(([name]) => name === 'tabs.create'), ['tabs.create', {url: 'about:blank', cookieStoreId, active: true}, 100]);
    assert.deepEqual(calls.find(([name]) => name === 'tabs.update'), ['tabs.update', 100, {url: origin + '/federations/demo-federation'}]);
    assert.equal((await openContainer(listeners, {activeAccount: true}, sender({cookieStoreId}))).opened, false);
    assert.equal(calls.filter(([name]) => name === 'tabs.create').length, 1);
    assert.ok(!calls.some(([name]) => name === 'containers.create' || name === 'storage.set'));
});

test('Firefox creates a single federation container for concurrent requests', async () => {
    const {calls, listeners} = await containerBackground();
    const results = await Promise.all([openContainer(listeners), openContainer(listeners)]);
    assert.deepEqual(results.map(result => result.opened), [true, true]);
    assert.equal(calls.filter(([name]) => name === 'containers.create').length, 1);
    assert.equal(calls.filter(([name]) => name === 'storage.set').length, 1);
    assert.deepEqual(calls.filter(([name]) => name === 'tabs.create').map(([, tab]) => tab.cookieStoreId), [
        'firefox-container-1', 'firefox-container-1',
    ]);
});

test('Firefox rejects invalid container destinations before opening tabs', async () => {
    const {calls, listeners} = await containerBackground();
    for (const message of [
        {href: 'https://external.example/clouds/demo'},
        {href: '/settings'},
        {federationId: '../settings'},
        {federationId: null, subjectId: 'invalid/subject'},
    ]) {
        await assert.rejects(openContainer(listeners, message), /Invalid container destination/);
    }
    assert.ok(!calls.some(([name]) => name === 'containers.create' || name === 'tabs.create'));
});

test('Firefox keeps Passport subjects in separate containers', async () => {
    const {calls, listeners} = await containerBackground();
    for (const subjectId of ['subject-a', 'subject-b', 'subject-a']) {
        assert.equal((await openContainer(listeners, {federationId: null, subjectId})).opened, true);
    }
    const stores = calls.filter(([name]) => name === 'tabs.create').map(([, tab]) => tab.cookieStoreId);
    assert.notEqual(stores[0], stores[1]);
    assert.equal(stores[0], stores[2]);
    const logins = calls.filter(([name]) => name === 'tabs.update').map(([, , {url}]) => new URL(url));
    assert.deepEqual(logins.map(url => [url.pathname, url.searchParams.get('sub'), url.searchParams.get('redirectUrl')]), [
        ['/auth/switch', 'subject-a', '/clouds/demo'],
        ['/auth/switch', 'subject-b', '/clouds/demo'],
        ['/auth/switch', 'subject-a', '/clouds/demo'],
    ]);
});

test('Firefox returns a pending destination once to the originating console in the new tab', async () => {
    const {calls, listeners} = await containerBackground();
    await openContainer(listeners);
    const [, {cookieStoreId}, tabId] = calls.find(([name]) => name === 'tabs.create');
    const destination = from => listeners.message({type: 'yc-power:container-destination'}, from);
    assert.equal(await destination(sender()), null);
    assert.equal(await destination(sender({id: tabId, cookieStoreId, url: 'https://beta.example/'})), null);
    assert.equal(await destination(sender({id: tabId, cookieStoreId, extension: 'other@example'})), undefined);
    const result = await destination(sender({id: tabId, cookieStoreId}));
    assert.equal(result.href, '/clouds/demo');
    assert.equal(result.federationId, 'demo-federation');
    assert.equal(await destination(sender({id: tabId, cookieStoreId})), null);
});

test('Firefox declares container API access and keeps cookie access optional', () => {
    const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
    assert.ok(manifest.permissions.includes('contextualIdentities'));
    assert.ok(!manifest.permissions.includes('cookies'));
    assert.ok(manifest.optional_permissions.includes('cookies'));
    assert.ok(!manifest.optional_permissions.includes('contextualIdentities'));
    assert.deepEqual(manifest.background.scripts, ['core.js', 'federation.js', 'background.js']);
});

test('Firefox binds an unbound personal container after observing its account', async () => {
    const {calls, listeners} = await containerBackground();
    await openContainer(listeners, {federationId: null});
    const [, {cookieStoreId}, id] = calls.find(([name]) => name === 'tabs.create');
    assert.equal(await listeners.message({type: 'yc-power:managed-container', observedSubjectId: 'subject-alpha'}, sender({id, cookieStoreId})), true);
    await openContainer(listeners, {federationId: null, subjectId: 'subject-alpha', activeAccount: true}, sender({id, cookieStoreId}));
    assert.equal(calls.filter(([name]) => name === 'containers.create').length, 1);
    await openContainer(listeners, {federationId: null, subjectId: 'subject-alpha', activeAccount: true, newTab: true, background: true}, sender({id, cookieStoreId}));
    assert.deepEqual(calls.filter(([name]) => name === 'tabs.create').at(-1)[1], {url: origin + '/clouds/demo', cookieStoreId, active: false});
});

test('Firefox container colors follow federation preferences and update existing sessions', async () => {
    const profile = `yc-power:${origin}:federation:id:demo-federation:profile`;
    const {calls, listeners, stored} = await containerBackground({profiles: {[profile]: {name: 'Demo', appearance: {color: '#ff0000'}}}});
    await openContainer(listeners);
    assert.equal(calls.find(([name]) => name === 'containers.create')[1].color, 'red');
    stored[profile] = {name: 'Demo', appearance: {color: '#00c79a'}};
    listeners.storage({[profile]: {newValue: stored[profile]}}, 'local');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(([name]) => name === 'containers.update').at(-1)[2].color, 'turquoise');
    stored[profile] = {name: 'Demo'};
    listeners.storage({[profile]: {newValue: stored[profile]}}, 'local');
    await openContainer(listeners);
    assert.equal(calls.filter(([name]) => name === 'containers.update').at(-1)[2].color, 'blue');
    assert.equal(calls.filter(([name]) => name === 'containers.create').length, 1);
});

test('Firefox uses the browser palette when newer container colors are available', async () => {
    const profile = `yc-power:${origin}:federation:id:demo-federation:profile`;
    const {calls, listeners} = await containerBackground({profiles: {[profile]: {appearance: {color: '#00ffff'}}}, supportedColors: [
        {color: 'blue', colorCode: '#0000ff'}, {color: 'cyan', colorCode: '#00ffff'},
    ]});
    await openContainer(listeners);
    assert.equal(calls.find(([name]) => name === 'containers.create')[1].color, 'cyan');
});

test('Firefox matches imported shorthand and RGB federation colors', async () => {
    const profile = `yc-power:${origin}:federation:id:demo-federation:profile`;
    for (const color of ['#f00', 'rgb(255, 0, 0)']) {
        const {calls, listeners} = await containerBackground({profiles: {[profile]: {appearance: {color}}}});
        await openContainer(listeners);
        assert.equal(calls.find(([name]) => name === 'containers.create')[1].color, 'red');
    }
});

test('Firefox recolors a personal container when its known account mapping appears', async () => {
    const profile = `yc-power:${origin}:passport:id:subject-alpha:passport-profile`;
    const {calls, listeners, stored} = await containerBackground({profiles: {[profile]: {name: 'Synthetic', subjectId: 'subject-alpha', appearance: {color: '#ff0000'}}}});
    await openContainer(listeners, {federationId: null});
    const [, {cookieStoreId}, id] = calls.find(([name]) => name === 'tabs.create');
    await listeners.message({type: 'yc-power:managed-container', observedSubjectId: 'subject-alpha'}, sender({id, cookieStoreId}));
    listeners.storage({_sessionContainers: {newValue: stored._sessionContainers}}, 'local');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.filter(([name]) => name === 'containers.update').at(-1)[2].color, 'red');
});

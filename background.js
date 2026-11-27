'use strict';

const DEFAULT_HOSTS = ['https://console.yandex.cloud'];
let registration;
let updates = Promise.resolve();

function normalizeHost(value) {
    try {
        if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return null;
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) return null;
        return url.origin;
    } catch { return null; }
}

async function updateRegistration() {
    const stored = await browser.storage.local.get('domainHosts');
    const configured = Array.isArray(stored.domainHosts) ? stored.domainHosts : DEFAULT_HOSTS;
    const hosts = [...new Set(configured.map(normalizeHost).filter(Boolean))];
    const allowed = [];
    for (const host of hosts) {
        if (await browser.permissions.contains({origins: [host + '/*']})) allowed.push(host + '/*');
    }
    if (registration) {
        await registration.unregister();
        registration = undefined;
    }
    if (!allowed.length) return;
    registration = await browser.contentScripts.register({
        matches: allowed,
        js: [{file: 'content.js'}],
        css: [{file: 'content.css'}],
        runAt: 'document_idle',
    });
    const tabs = await browser.tabs.query({url: allowed});
    await Promise.all(tabs.map(async (tab) => {
        try {
            await browser.tabs.insertCSS(tab.id, {file: 'content.css'});
            await browser.tabs.executeScript(tab.id, {file: 'content.js'});
        } catch {
            // tabs may navigate or close before injection finishes
        }
    }));
}

function scheduleUpdate() {
    updates = updates.then(updateRegistration).catch((error) => console.error('YC Power registration failed', error));
}

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.domainHosts) scheduleUpdate();
    scheduleContainerColors(changes, area);
});
browser.permissions.onAdded.addListener(scheduleUpdate);
browser.permissions.onRemoved.addListener(scheduleUpdate);
scheduleUpdate();

// container identifiers stay local and are never part of exported preferences
const containerRequests = new Map();
let containerQueue = Promise.resolve();
const legacyContainerColors = {blue: '#37adff', turquoise: '#00c79a', green: '#51cd00', yellow: '#ffcb00', orange: '#ff9f00', red: '#ff613d', pink: '#ff4bda', purple: '#af51f5', toolbar: '#7c7c7d'};
function rgbColor(value) {
    if (typeof value !== 'string') return null;
    if (/^#[0-9a-f]{3}$/i.test(value)) value = '#' + [...value.slice(1)].map(channel => channel + channel).join('');
    if (/^#[0-9a-f]{6}$/i.test(value)) return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16));
    const rgb = /^rgb\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*\)$/i.exec(value);
    if (rgb && rgb.slice(1).every(channel => Number(channel) <= 255)) return rgb.slice(1).map(Number);
    if (!globalThis.document) return null;
    const probe = document.createElement('span');
    probe.style.color = value;
    if (!probe.style.color || /var\(|inherit|currentcolor/i.test(value)) return null;
    document.documentElement.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved !== value ? rgbColor(resolved) : null;
}
async function containerColor(profile) {
    const target = rgbColor(profile?.appearance?.color);
    if (!target) return 'blue';
    const colors = browser.contextualIdentities.getSupportedColors
        ? await browser.contextualIdentities.getSupportedColors()
        : Object.entries(legacyContainerColors).map(([color, colorCode]) => ({color, colorCode}));
    let nearest = 'blue', distance = Infinity;
    for (const {color, colorCode} of colors) {
        const rgb = rgbColor(colorCode);
        if (!rgb) continue;
        const difference = rgb.reduce((sum, channel, index) => sum + (channel - target[index]) ** 2, 0);
        if (difference < distance) { nearest = color; distance = difference; }
    }
    return nearest;
}
function containerProfileKey(origin, id, subject) {
    return id === null ? YCPowerFederation.passportProfileKey(origin, subject) : YCPowerFederation.profileKey(origin, id);
}
async function synchronizeContainerColors(changes) {
    const stored = await browser.storage.local.get(null);
    if (!stored.useSessionContainers) return;
    for (const [key, cookieStoreId] of Object.entries(stored._sessionContainers || {})) {
        try {
            const [origin, id, subject] = JSON.parse(key);
            const profileKey = containerProfileKey(origin, id, subject);
            if (changes && !changes[profileKey]) continue;
            const container = await browser.contextualIdentities.get(cookieStoreId);
            const color = await containerColor(stored[profileKey]);
            if (container.color !== color) await browser.contextualIdentities.update(cookieStoreId, {color});
        } catch { /* deleted containers can be recreated on the next navigation */ }
    }
}
function scheduleContainerColors(changes, area) {
    if (area !== 'local' || !Object.keys(changes).some(key => ['profile', 'passport-profile'].includes(YCPowerFederation.parseKey(key)?.kind) || key === 'useSessionContainers' || key === '_sessionContainers')) return;
    const colors = changes.useSessionContainers || changes._sessionContainers ? undefined : changes;
    containerQueue = containerQueue.then(() => synchronizeContainerColors(colors)).catch(() => {});
}
containerQueue = containerQueue.then(() => synchronizeContainerColors()).catch(() => {});
async function openContainer(message, sender) {
    const origin = new URL(sender.url).origin;
    const stored = await browser.storage.local.get(null);
    const hosts = stored.domainHosts || DEFAULT_HOSTS;
    if (!stored.useSessionContainers || !hosts.includes(origin) || !await browser.permissions.contains({permissions: ['contextualIdentities', 'cookies'], origins: [origin + '/*']})) throw new Error('Containers are unavailable');
    if (sender.tab.incognito) return {opened: false};
    const route = YCPowerCore.route(message.href, origin);
    const id = message.federationId;
    const login = id === null ? YCPowerFederation.passportLoginHref(origin, message.subjectId, route?.href) : YCPowerFederation.loginHref(origin, id);
    if (!route || !login || (id === null && message.subjectId != null && !YCPowerFederation.validSubjectId(message.subjectId))) throw new Error('Invalid container destination');
    const key = JSON.stringify([origin, id, id === null ? message.subjectId : null]);
    const mapping = stored._sessionContainers || {};
    let container;
    if (typeof mapping[key] === 'string') {
        try { container = await browser.contextualIdentities.get(mapping[key]); } catch { /* recreate deleted containers */ }
    }
    const color = await containerColor(stored[containerProfileKey(origin, id, message.subjectId)]).catch(() => 'blue');
    if (container && container.color !== color) {
        await browser.contextualIdentities.update(container.cookieStoreId, {color}).catch(() => {});
    }
    if (!container) {
        container = await browser.contextualIdentities.create({name: id === null ? 'YC Power · personal' : 'YC Power · ' + id, color, icon: 'briefcase'});
        await browser.storage.local.set({_sessionContainers: {...mapping, [key]: container.cookieStoreId}});
    }
    if (sender.tab.cookieStoreId === container.cookieStoreId && message.activeAccount === true) {
        if (!message.newTab) return {opened: false};
        await browser.tabs.create({url: new URL(route.href, origin).href, cookieStoreId: container.cookieStoreId, active: message.background !== true, ...(Number.isInteger(sender.tab.windowId) ? {windowId: sender.tab.windowId} : {})});
        return {opened: true};
    }
    const tab = await browser.tabs.create({url: 'about:blank', cookieStoreId: container.cookieStoreId, active: message.background !== true});
    containerRequests.set(tab.id, {origin, federationId: id, ...(id === null ? {subjectId: message.subjectId} : {}), href: route.href, expires: Date.now() + 300000});
    try { await browser.tabs.update(tab.id, {url: login}); }
    catch (error) { containerRequests.delete(tab.id); throw error; }
    return {opened: true};
}
browser.runtime?.onMessage?.addListener((message, sender) => {
    if (!sender.tab || !sender.url || sender.id !== browser.runtime.id) return;
    if (message?.type === 'yc-power:managed-container') {
        const check = containerQueue.then(async () => {
            const stored = await browser.storage.local.get('_sessionContainers');
            const mapping = stored._sessionContainers || {};
            const origin = new URL(sender.url).origin;
            const managed = Object.entries(mapping).some(([key, store]) => {
                try {
                    const [host, federation] = JSON.parse(key);
                    return host === origin && federation === null && store === sender.tab.cookieStoreId;
                } catch { return false; }
            });
            if (managed && YCPowerFederation.validSubjectId(message.observedSubjectId)) {
                const unknown = JSON.stringify([origin, null, null]);
                const known = JSON.stringify([origin, null, message.observedSubjectId]);
                if (mapping[unknown] === sender.tab.cookieStoreId && !mapping[known]) {
                    const next = {...mapping, [known]: sender.tab.cookieStoreId};
                    delete next[unknown];
                    await browser.storage.local.set({_sessionContainers: next});
                }
            }
            return managed;
        });
        containerQueue = check.catch(() => {});
        return check;
    }
    if (message?.type === 'yc-power:open-container') {
        const request = containerQueue.then(() => openContainer(message, sender));
        containerQueue = request.catch(() => {});
        return request;
    }
    if (message?.type === 'yc-power:container-destination') {
        const pending = containerRequests.get(sender.tab.id);
        if (!pending || pending.expires < Date.now()) { containerRequests.delete(sender.tab.id); return Promise.resolve(null); }
        if (new URL(sender.url).origin !== pending.origin) return Promise.resolve(null);
        containerRequests.delete(sender.tab.id);
        const {origin, ...destination} = pending;
        return Promise.resolve(destination);
    }
});
browser.tabs.onRemoved?.addListener(id => containerRequests.delete(id));

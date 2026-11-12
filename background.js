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
});
browser.permissions.onAdded.addListener(scheduleUpdate);
browser.permissions.onRemoved.addListener(scheduleUpdate);
scheduleUpdate();

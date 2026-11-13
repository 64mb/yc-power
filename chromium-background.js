'use strict';

const DEFAULT_HOSTS = ['https://console.yandex.cloud'];
const REGISTRATION_ID = 'yc-power';
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
    const stored = await chrome.storage.local.get('domainHosts');
    const configured = Array.isArray(stored.domainHosts) ? stored.domainHosts : DEFAULT_HOSTS;
    const allowed = [];
    for (const host of [...new Set(configured.map(normalizeHost).filter(Boolean))]) {
        if (await chrome.permissions.contains({origins: [host + '/*']})) allowed.push(host + '/*');
    }
    const registered = await chrome.scripting.getRegisteredContentScripts({ids: [REGISTRATION_ID]});
    if (!allowed.length) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ids: [REGISTRATION_ID]});
        return;
    }
    const script = {
        id: REGISTRATION_ID,
        matches: allowed,
        js: ['browser-alias.js', 'content.js'],
        css: ['content.css'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
    };
    if (registered.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
    const tabs = await chrome.tabs.query({url: allowed});
    await Promise.all(tabs.map(async (tab) => {
        try {
            await chrome.scripting.insertCSS({target: {tabId: tab.id}, files: ['content.css']});
            await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['browser-alias.js', 'content.js']});
        } catch {
            // tabs may navigate or close before injection finishes
        }
    }));
}

function scheduleUpdate() {
    updates = updates.then(updateRegistration).catch((error) => console.error('YC Power registration failed', error));
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.domainHosts) scheduleUpdate();
});
chrome.permissions.onAdded.addListener(scheduleUpdate);
chrome.permissions.onRemoved.addListener(scheduleUpdate);
chrome.runtime.onInstalled.addListener(scheduleUpdate);
chrome.runtime.onStartup.addListener(scheduleUpdate);
scheduleUpdate();

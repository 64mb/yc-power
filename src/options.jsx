import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button, Card, Icon, Checkbox, Text, TextInput, ThemeProvider} from '@gravity-ui/uikit';
import {Plus, TrashBin, FloppyDisk, FolderTree, Clouds, ArrowDownToLine, ArrowUpFromLine} from '@gravity-ui/icons';
import '@gravity-ui/uikit/styles/styles.css';
import './options.css';
import {TooltipLayer} from './TooltipLayer.jsx';
import {getLanguage, messages} from './options-i18n.js';
import Transfer from '../settings-transfer.js';

const language = getLanguage();
const t = messages[language];
document.documentElement.lang = language;
class HostError extends Error {}

const DEFAULT_HOSTS = ['https://console.yandex.cloud'];

function normalizeHost(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) throw new HostError(t.https);
    let url;
    try { url = new URL(value); } catch { throw new HostError(t.invalid); }
    if (url.protocol !== 'https:' || url.hostname.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) {
        throw new HostError(t.invalid);
    }
    return url.origin;
}

function Settings() {
    const [hosts, setHosts] = useState(DEFAULT_HOSTS.map((host) => ({host, cloudOnly: false})));
    const [compactDensity, setCompactDensity] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);
    const [imported, setImported] = useState(null);
    const importInput = useRef(null);
    useEffect(() => {
        browser.storage.local.get(['domainHosts', 'compactDensity', 'cloudOnlyHosts']).then((stored) => {
            const disabledHosts = new Set((Array.isArray(stored.cloudOnlyHosts) ? stored.cloudOnlyHosts : []).flatMap((host) => {
                try { return [normalizeHost(host)]; } catch { return []; }
            }));
            setHosts((Array.isArray(stored.domainHosts) ? stored.domainHosts : DEFAULT_HOSTS).map((host) => {
                let cloudOnly = false;
                try { cloudOnly = disabledHosts.has(normalizeHost(host)); } catch { /* keep invalid addresses editable */ }
                return {host, cloudOnly};
            }));
            setCompactDensity(stored.compactDensity === true);
            setLoading(false);
        }).catch(() => {
            setStatus({theme: 'danger', message: t.loadFailed});
        });
    }, []);
    async function exportSettings() {
        try {
            const data = Transfer.exportSettings(await browser.storage.local.get(null));
            const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
            const link = document.createElement('a');
            link.href = url; link.download = 'yc-power-settings.json'; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch { setStatus({theme: 'danger', message: t.exportFailed}); }
    }
    async function importSettings(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            if (file.size > Transfer.MAX_BYTES) throw new Error('File too large');
            const settings = Transfer.parseSettings(await file.text());
            setImported(settings);
            setHosts(settings.domainHosts.map(host => ({host, cloudOnly: settings.cloudOnlyHosts.includes(host)})));
            setCompactDensity(settings.compactDensity);
            setStatus({theme: 'success', message: t.importReady});
        } catch { setStatus({theme: 'danger', message: t.importFailed}); }
    }
    async function save(event) {
        event.preventDefault();
        try {
            const rows = new Map();
            for (const row of hosts) {
                if (!row.host.trim()) continue;
                const host = normalizeHost(row.host.trim());
                if (!rows.has(host)) rows.set(host, {host, cloudOnly: row.cloudOnly});
            }
            const next = [...rows.keys()];
            const cloudOnlyHosts = [...rows.values()].filter((row) => row.cloudOnly).map((row) => row.host);
            // request permissions directly from the save gesture
            const request = next.length ? browser.permissions.request({origins: next.map((host) => host + '/*')}) : Promise.resolve(true);
            setSaving(true);
            if (!await request) {
                setStatus({theme: 'warning', message: t.denied});
                return;
            }
            const stored = await browser.storage.local.get('domainHosts');
            const previous = Array.isArray(stored.domainHosts) ? stored.domainHosts : DEFAULT_HOSTS;
            await browser.storage.local.set({...imported, domainHosts: next, compactDensity, cloudOnlyHosts});
            setImported(null);
            const removed = previous.flatMap((host) => {
                try { return [normalizeHost(host)]; } catch { return []; }
            }).filter((host) => !next.includes(host) && !DEFAULT_HOSTS.includes(host));
            if (removed.length) await browser.permissions.remove({origins: removed.map((host) => host + '/*')});
            setHosts([...rows.values()]);
            setStatus({theme: 'success', message: next.length ? t.saved : t.disabled});
        } catch (error) {
            setStatus({theme: 'danger', message: error instanceof HostError ? error.message : t.saveFailed});
        } finally { setSaving(false); }
    }
    return <main className="settings">
        <header className="settings-heading">
            <img className="settings-logo" src="icons/icon.svg" width="44" height="44" alt=""/>
            <div><Text as="h1" variant="header-1">YC Power</Text><Text color="secondary">{t.settings}</Text></div>
        </header>
        <Card className="settings-card" view="outlined">
            <Text as="h2" variant="subheader-1">{t.domains}</Text>
            <Text as="p" color="secondary">{t.intro}</Text>
            <form onSubmit={save}>
                <div className="domain-list">
                    {hosts.map((row, index) => <div className="domain-row" key={index}>
                        <TextInput size="l" value={row.host} disabled={loading || saving} placeholder={t.placeholder}
                            controlProps={{'aria-label': `${t.address} ${index + 1}`, spellCheck: false, autoComplete: 'off'}}
                            onUpdate={(value) => setHosts((current) => current.map((item, i) => i === index ? {...item, host: value} : item))}/>
                        <Button size="l" view={row.cloudOnly ? 'outlined-info' : 'flat-secondary'} className="domain-folder-toggle"
                            disabled={loading || saving} data-ycp-tooltip={row.cloudOnly ? t.cloudsOnly : t.foldersEnabled}
                            aria-label={`${row.cloudOnly ? t.cloudsOnly : t.foldersEnabled} ${index + 1}`} selected={row.cloudOnly}
                            onClick={() => setHosts((current) => current.map((item, i) => i === index ? {...item, cloudOnly: !item.cloudOnly} : item))}>
                            <Icon data={row.cloudOnly ? Clouds : FolderTree} size={16}/>
                        </Button>
                        <Button size="l" view="flat-secondary" disabled={loading || saving} data-ycp-tooltip={t.remove} aria-label={`${t.remove} ${index + 1}`}
                            onClick={() => setHosts((current) => current.filter((_, i) => i !== index))}><Icon data={TrashBin} size={16}/></Button>
                    </div>)}
                </div>
                {!hosts.length && <Text as="p" color="secondary">{t.empty}</Text>}
                <Button view="flat" disabled={loading || saving} onClick={() => setHosts((current) => [...current, {host: '', cloudOnly: false}])}><Icon data={Plus} size={16}/>{t.add}</Button>
                <Text className="settings-hint" as="p" variant="body-1" color="secondary">{t.hint}</Text>
                <section className="settings-appearance" aria-labelledby="appearance-heading">
                    <Text as="h2" variant="subheader-1" id="appearance-heading">{t.appearance}</Text>
                    <Checkbox size="m" checked={compactDensity} onUpdate={setCompactDensity} disabled={loading || saving}
                        controlProps={{'aria-describedby': 'compact-density-hint'}}>{t.compactDensity}</Checkbox>
                    <Text as="p" variant="body-1" color="secondary" id="compact-density-hint">{t.compactDensityHint}</Text>
                </section>
                <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={importSettings}/>
                <div className="settings-transfer">
                    <Button view="outlined" disabled={loading || saving} onClick={exportSettings}><Icon data={ArrowDownToLine} size={16}/>{t.exportSettings}</Button>
                    <Button view="outlined" disabled={loading || saving} onClick={() => importInput.current.click()}><Icon data={ArrowUpFromLine} size={16}/>{t.importSettings}</Button>
                </div>
                <div className="settings-actions">{status && <Text className="settings-status" variant="caption-1" color={status.theme === 'success' ? 'positive' : status.theme} role="status" aria-live="polite">{status.message}</Text>}<Button type="submit" view="action" size="l" loading={saving} disabled={loading}><Icon data={FloppyDisk} size={16}/>{t.save}</Button></div>
            </form>
        </Card>
        <Text as="p" variant="body-1" color="secondary">{t.privacy}</Text>
    </main>;
}

createRoot(document.getElementById('root')).render(<ThemeProvider theme="system" lang={language}><Settings/><TooltipLayer/></ThemeProvider>);

import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button, Card, Dialog, Icon, Checkbox, Text, TextInput, ThemeProvider} from '@gravity-ui/uikit';
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
    const supportsSessionContainers = Boolean(browser.runtime.getManifest?.()?.browser_specific_settings?.gecko);
    const [hosts, setHosts] = useState(DEFAULT_HOSTS.map((host) => ({host, cloudOnly: false})));
    const [compactDensity, setCompactDensity] = useState(false);
    const [hideSingleOrganization, setHideSingleOrganization] = useState(false);
    const [showPersonalOrganizations, setShowPersonalOrganizations] = useState(false);
    const [colorConsoleLogo, setColorConsoleLogo] = useState(false);
    const [showFolderBadge, setShowFolderBadge] = useState(false);
    const [useSessionContainers, setUseSessionContainers] = useState(undefined);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState(null);
    const [imported, setImported] = useState(null);
    const [resetOpen, setResetOpen] = useState(false);
    const importInput = useRef(null);
    const busy = useRef(false);
    useEffect(() => {
        browser.storage.local.get(['domainHosts', 'compactDensity', 'cloudOnlyHosts', 'hideSingleOrganization', 'showPersonalOrganizations', 'colorConsoleLogo', 'showFolderBadge', 'useSessionContainers']).then((stored) => {
            const disabledHosts = new Set((Array.isArray(stored.cloudOnlyHosts) ? stored.cloudOnlyHosts : []).flatMap((host) => {
                try { return [normalizeHost(host)]; } catch { return []; }
            }));
            setHosts((Array.isArray(stored.domainHosts) ? stored.domainHosts : DEFAULT_HOSTS).map((host) => {
                let cloudOnly = false;
                try { cloudOnly = disabledHosts.has(normalizeHost(host)); } catch { /* keep invalid addresses editable */ }
                return {host, cloudOnly};
            }));
            setCompactDensity(stored.compactDensity === true);
            setHideSingleOrganization(stored.hideSingleOrganization === true);
            setShowPersonalOrganizations(stored.showPersonalOrganizations === true);
            setColorConsoleLogo(stored.colorConsoleLogo === true);
            setShowFolderBadge(stored.showFolderBadge === true);
            setUseSessionContainers(typeof stored.useSessionContainers === 'boolean' ? stored.useSessionContainers : undefined);
            if (new URLSearchParams(location.search).has('import')) setStatus({theme: 'info', message: t.importChoose});
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
    function chooseImport() {
        if (browser.extension?.getViews?.({type: 'popup'}).includes(window)) {
            browser.tabs.create({url: browser.runtime.getURL('options.html?import=1')}).catch(() => {
                setStatus({theme: 'danger', message: t.importFailed});
            });
            return;
        }
        importInput.current.click();
    }
    async function persistSettings(settings) {
        const stored = await browser.storage.local.get('domainHosts');
        const previous = Array.isArray(stored.domainHosts) ? stored.domainHosts : DEFAULT_HOSTS;
        const applied = {...settings,
            hideSingleOrganization: settings.hideSingleOrganization === true,
            showPersonalOrganizations: settings.showPersonalOrganizations === true,
            colorConsoleLogo: settings.colorConsoleLogo === true,
            showFolderBadge: settings.showFolderBadge === true,
        };
        await browser.storage.local.set(applied);
        if (supportsSessionContainers && !applied.useSessionContainers) await browser.permissions.remove({permissions: ['cookies']});
        const manifest = browser.runtime?.getManifest?.() || {};
        const requiredOrigins = [...(manifest.host_permissions || []), ...(manifest.permissions || [])];
        const removed = previous.flatMap(host => {
            try { return [normalizeHost(host)]; } catch { return []; }
        }).filter(host => !applied.domainHosts.includes(host) && !DEFAULT_HOSTS.includes(host) && !requiredOrigins.includes(host + '/*'));
        if (removed.length) await browser.permissions.remove({origins: removed.map(host => host + '/*')});
        setHosts(applied.domainHosts.map(host => ({host, cloudOnly: applied.cloudOnlyHosts.includes(host)})));
        setCompactDensity(applied.compactDensity);
        setHideSingleOrganization(applied.hideSingleOrganization);
        setShowPersonalOrganizations(applied.showPersonalOrganizations);
        setColorConsoleLogo(applied.colorConsoleLogo);
        setShowFolderBadge(applied.showFolderBadge);
        setImported(null);
        setStatus({theme: 'success', message: applied.domainHosts.length ? t.saved : t.disabled});
    }
    async function importSettings(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || busy.current) return;
        busy.current = true;
        setSaving(true);
        setStatus(null);
        try {
            if (file.size > Transfer.MAX_BYTES) throw new Error('File too large');
            const settings = Transfer.parseSettings(await file.text());
            setImported(settings);
            setHosts(settings.domainHosts.map(host => ({host, cloudOnly: settings.cloudOnlyHosts.includes(host)})));
            setCompactDensity(settings.compactDensity);
            setHideSingleOrganization(settings.hideSingleOrganization === true);
            setShowPersonalOrganizations(settings.showPersonalOrganizations === true);
            setColorConsoleLogo(settings.colorConsoleLogo === true);
            setShowFolderBadge(settings.showFolderBadge === true);
            if (supportsSessionContainers || 'useSessionContainers' in settings) setUseSessionContainers(settings.useSessionContainers === true);
            setStatus({theme: 'success', message: t.importReady});
        } catch { setStatus({theme: 'danger', message: t.importFailed}); }
        finally {
            busy.current = false;
            setSaving(false);
        }
    }
    async function resetSettings() {
        if (busy.current) return;
        busy.current = true;
        setSaving(true);
        setStatus(null);
        try {
            const stored = await browser.storage.local.get(null);
            const previous = Array.isArray(stored.domainHosts) ? stored.domainHosts : [];
            const defaults = {
                _ycPowerReset: crypto.randomUUID(),
                domainHosts: DEFAULT_HOSTS,
                cloudOnlyHosts: [],
                compactDensity: false,
                hideSingleOrganization: false,
                showPersonalOrganizations: false,
                colorConsoleLogo: false,
                showFolderBadge: false,
                useSessionContainers: false,
            };
            // publish the reset marker before removing data so content scripts discard pending writes
            await browser.storage.local.set(defaults);
            const current = await browser.storage.local.get(null);
            const removedKeys = [...new Set([...Object.keys(stored), ...Object.keys(current)])]
                .filter((key) => !Object.hasOwn(defaults, key));
            if (removedKeys.length) await browser.storage.local.remove(removedKeys);
            setHosts(DEFAULT_HOSTS.map((host) => ({host, cloudOnly: false})));
            setCompactDensity(false);
            setHideSingleOrganization(false);
            setShowPersonalOrganizations(false);
            setColorConsoleLogo(false);
            setShowFolderBadge(false);
            setUseSessionContainers(false);
            if (supportsSessionContainers) await browser.permissions.remove({permissions: ['cookies']});
            setImported(null);
            if (importInput.current) importInput.current.value = '';
            const manifest = browser.runtime?.getManifest?.() || {};
            const requiredOrigins = [...(manifest.host_permissions || []), ...(manifest.permissions || [])];
            const removedHosts = [...new Set(previous.flatMap((host) => {
                try { return [normalizeHost(host)]; } catch { return []; }
            }))].filter((host) => !DEFAULT_HOSTS.includes(host) && !requiredOrigins.includes(host + '/*'));
            if (removedHosts.length) await browser.permissions.remove({origins: removedHosts.map((host) => host + '/*')});
            setStatus({theme: 'success', message: t.resetDone});
        } catch {
            setStatus({theme: 'danger', message: t.resetFailed});
        } finally {
            setResetOpen(false);
            busy.current = false;
            setSaving(false);
        }
    }
    async function save(event) {
        event.preventDefault();
        if (busy.current) return;
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
            const permissions = {};
            if (next.length) permissions.origins = next.map((host) => host + '/*');
            if (supportsSessionContainers && useSessionContainers) permissions.permissions = ['cookies'];
            const request = Object.keys(permissions).length ? browser.permissions.request(permissions) : Promise.resolve(true);
            busy.current = true;
            setSaving(true);
            if (!await request) {
                setStatus({theme: 'warning', message: t.denied});
                return;
            }
            const settings = {...imported, domainHosts: next, compactDensity, cloudOnlyHosts, hideSingleOrganization, showPersonalOrganizations, colorConsoleLogo, showFolderBadge};
            if (supportsSessionContainers || useSessionContainers !== undefined) settings.useSessionContainers = useSessionContainers === true;
            await persistSettings(settings);
        } catch (error) {
            setStatus({theme: 'danger', message: error instanceof HostError ? error.message : t.saveFailed});
        } finally { busy.current = false; setSaving(false); }
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
                    <Checkbox size="m" checked={hideSingleOrganization} onUpdate={setHideSingleOrganization} disabled={loading || saving}
                        controlProps={{'aria-describedby': 'hide-single-organization-hint'}}>{t.hideSingleOrganization}</Checkbox>
                    <Text as="p" variant="body-1" color="secondary" id="hide-single-organization-hint">{t.hideSingleOrganizationHint}</Text>
                    <Checkbox size="m" checked={showPersonalOrganizations} onUpdate={setShowPersonalOrganizations} disabled={loading || saving}
                        controlProps={{'aria-describedby': 'show-personal-organizations-hint'}}>{t.showPersonalOrganizations}</Checkbox>
                    <Text as="p" variant="body-1" color="secondary" id="show-personal-organizations-hint">{t.showPersonalOrganizationsHint}</Text>
                    <Checkbox size="m" checked={colorConsoleLogo} onUpdate={setColorConsoleLogo} disabled={loading || saving}
                        controlProps={{'aria-describedby': 'color-console-logo-hint'}}>{t.colorConsoleLogo}</Checkbox>
                    <Text as="p" variant="body-1" color="secondary" id="color-console-logo-hint">{t.colorConsoleLogoHint}</Text>
                    <Checkbox size="m" checked={showFolderBadge} onUpdate={setShowFolderBadge} disabled={loading || saving}
                        controlProps={{'aria-describedby': 'show-folder-badge-hint'}}>{t.showFolderBadge}</Checkbox>
                    <Text as="p" variant="body-1" color="secondary" id="show-folder-badge-hint">{t.showFolderBadgeHint}</Text>
                </section>
                {supportsSessionContainers && <section className="settings-appearance" aria-labelledby="sessions-heading">
                    <Text as="h2" variant="subheader-1" id="sessions-heading">{t.sessions}</Text>
                    <Checkbox size="m" checked={useSessionContainers === true} onUpdate={setUseSessionContainers} disabled={loading || saving}
                        controlProps={{'aria-describedby': 'session-containers-hint'}}>{t.useSessionContainers}</Checkbox>
                    <Text as="p" variant="body-1" color="secondary" id="session-containers-hint">{t.useSessionContainersHint}</Text>
                </section>}
                <input ref={importInput} type="file" accept="application/json,.json" hidden onChange={importSettings}/>
                <div className="settings-transfer">
                    <Button view="outlined" disabled={loading || saving} onClick={exportSettings}><Icon data={ArrowDownToLine} size={16}/>{t.exportSettings}</Button>
                    <Button view="outlined" disabled={loading || saving} onClick={chooseImport}><Icon data={ArrowUpFromLine} size={16}/>{t.importSettings}</Button>
                    <Button view="outlined-danger" disabled={loading || saving} onClick={() => setResetOpen(true)}><Icon data={TrashBin} size={16}/>{t.resetSettings}</Button>
                </div>
                <div className="settings-actions">{status && <Text className="settings-status" variant="body-2" color={status.theme === 'success' ? 'positive' : status.theme} role="status" aria-live="polite">{status.message}</Text>}<Button type="submit" view="action" size="l" loading={saving} disabled={loading}><Icon data={FloppyDisk} size={16}/>{t.save}</Button></div>
            </form>
        </Card>
        <Dialog open={resetOpen} onClose={() => { if (!saving) setResetOpen(false); }} initialFocus="cancel"
            aria-labelledby="reset-settings-title" aria-describedby="reset-settings-description"
            disableEscapeKeyDown={saving} disableOutsideClick={saving} hasCloseButton={!saving}>
            <Dialog.Header caption={t.resetSettings} id="reset-settings-title"/>
            <Dialog.Body><Text as="p" id="reset-settings-description">{t.resetConfirm}</Text></Dialog.Body>
            <Dialog.Footer preset="danger" textButtonCancel={t.cancel} textButtonApply={t.resetSettings}
                onClickButtonCancel={() => setResetOpen(false)} onClickButtonApply={resetSettings}
                loading={saving} propsButtonCancel={{disabled: saving}} propsButtonApply={{disabled: saving}}/>
        </Dialog>
        <Text as="p" variant="body-1" color="secondary">{t.privacy}</Text>
    </main>;
}

createRoot(document.getElementById('root')).render(<ThemeProvider theme="system" lang={language}><Settings/><TooltipLayer/></ThemeProvider>);

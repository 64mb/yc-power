import React from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Button, Icon, Label, Palette, TextInput, Text, ThemeProvider} from '@gravity-ui/uikit';
import {ArrowRotateRight, Bars, ChevronDown, ChevronRight, Ellipsis, CircleMinus, CirclePlus, Folder, Cloud, FloppyDisk, ArrowRotateLeft, Xmark, Clouds, ArrowLeft, Terminal, Server, Database, Briefcase, PersonsLock, Person, NodesDown, Cube, CodeFork, Cpu, ShieldCheck, Globe, Key, Rocket, Gear, HardDrive, Archive, ChartLine, Bell, Flask, Bug, PlugConnection, Layers, Clock, Code, Bucket, AbbrApi, Display, FileText, ListCheck, TrafficLight, Thunderbolt, Puzzle, Wrench, Magnifier, Tag, Flag, Persons, Envelope, Route, Fingerprint} from '@gravity-ui/icons';
import '@gravity-ui/uikit/styles/styles.css';
import './panel.css';
import Core from '../core.js';
import Federation from '../federation.js';
import I18n from '../panel-i18n.js';
import {TooltipLayer} from './TooltipLayer.jsx';

const gravityCSS = __YCP_GRAVITY_CSS__;
const folderIcons = {folder: Folder, terminal: Terminal, server: Server, database: Database, briefcase: Briefcase, network: NodesDown, container: Cube, git: CodeFork, cpu: Cpu, security: ShieldCheck, globe: Globe, key: Key, rocket: Rocket, settings: Gear, disk: HardDrive, archive: Archive, monitoring: ChartLine, alerts: Bell, testing: Flask, bug: Bug, connection: PlugConnection, layers: Layers, clock: Clock, code: Code, bucket: Bucket, api: AbbrApi, desktop: Display, logs: FileText, tasks: ListCheck, traffic: TrafficLight, automation: Thunderbolt, plugins: Puzzle, tools: Wrench, search: Magnifier, tag: Tag, flag: Flag, team: Persons, mail: Envelope, routing: Route, identity: Fingerprint};
const cloudIcons = {cloud: Cloud, ...Object.fromEntries(Object.entries(folderIcons).filter(([name]) => name !== 'folder'))};

(function () {
  'use strict';
  if (globalThis.__ycPower || globalThis.__ycPowerReset) return;
  globalThis.__ycPower = true;
  const storage = globalThis.browser?.storage.local;
  const defaults = () => ({mine: [], initialized: false, width: 360, custom: {}, showAllModern: false});
  const readIdentity = () => Federation.identityFromScripts([...document.scripts].filter(script => !script.src).map(script => script.textContent));
  let identity = readIdentity();
  let federationId = identity?.id || null;
  const scopeKey = (organizationId, id = federationId) => Federation.scopeKey(location.origin, organizationId, id);
  const cloudFederation = cloud => Object.hasOwn(cloud, 'federationId') ? cloud.federationId : federationId;
  const activeCloud = cloud => cloudFederation(cloud) === federationId;
  const organizationGroupKey = (id, federation = federationId) => federation ? Federation.identityKey(federation, id || '') : id || '';
  const canScanIdentity = () => {
    const current = readIdentity();
    if ((current?.id || null) !== federationId || Boolean(current) !== Boolean(identity)) return false;
    return Boolean(identity) || !Object.keys(preferences).some(savedKey => {
      const scope = Federation.parseKey(savedKey);
      return scope?.origin === location.origin && ((scope.federationId !== null && scope.kind === 'catalog') || scope.kind === 'passport-catalog');
    });
  };
  let organization = null, key = scopeKey(null), preferences = {};
  const collapsedOrganizations = new Set();
  let groupOrder = [];
  const layoutKey = `yc-power:${location.origin}:layout`;
  function rememberLayout() {
    if (stopped) return;
    storage?.set({[layoutKey]: {scopeKey: key, width: state.width, collapsedOrganizations: [...collapsedOrganizations], groupOrder}}).catch(() => {});
  }
  const preferenceSync = Core.preferenceSync(preferences, (savedKey, snapshot) => stopped ? undefined : storage?.set({[savedKey]: snapshot}));
  let state = {...defaults(), clouds: []};
  let scanReady = false, selectedOrganizationId = null;
  let nativeReturnSlot, nativeReturnTarget;
  let tree, aside, host, root, shadow, observer, themeObserver, lifecycleObserver, timer, saveTimer;
  let mountPoll = null, mountQueued = false;
  let busy = false, native = false, allOpen = false, edit = null, stopped = false;
  let statusKey = 'reading', statusArgs = {}, lastUrl = location.href, rescan = false;
  let themeOverrides = {}, panelWidth = 360, minimumWidth = 1, compactDensity = false, foldersEnabled = true;
  let hideSingleOrganization = false, showPersonalOrganizations = false;
  const personalMode = () => identity !== null && federationId === null;
  function activeCatalog() {
    if (!identity && !canScanIdentity()) return [];
    return Core.catalogCache(preferences[personalMode() ? Federation.passportCatalogKey(location.origin) : catalogKey], location.origin);
  }
  const expanded = new Set();
  let revealedRoute = null, observedRouteTransition = null, lastActiveCloudId = null;
  let cloudDrag = null, pointerDrag = null, reorderFocus = null, reorderAnnouncement = '';
  function clearCloudDrag() {
    cloudDrag = null;
    if (pointerDrag) {
      const session = pointerDrag; pointerDrag = null;
      cancelAnimationFrame(session.frame);
      window.removeEventListener('pointermove', session.move, true);
      window.removeEventListener('pointerup', session.up, true);
      window.removeEventListener('pointercancel', session.cancel, true);
      window.removeEventListener('keydown', session.escape, true);
      window.removeEventListener('blur', session.cancel);
      if (session.node.hasPointerCapture(session.pointerId)) session.node.releasePointerCapture(session.pointerId);
    }
    shadow?.querySelector('.ycp-mine')?.removeAttribute('data-reordering');
    shadow?.querySelectorAll('[data-ycp-drop], [data-ycp-dragging]').forEach(el => { el.removeAttribute('data-ycp-drop'); el.removeAttribute('data-ycp-dragging'); });
  }
  function beginCloudDrag(event, cloud) {
    if (event.button !== 0 || !event.isPrimary || !['mouse', 'pen'].includes(event.pointerType) || event.target.closest('button, input')) return;
    clearCloudDrag();
    const session = {id: cloud.id, key, node: event.currentTarget, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false, cancelled: false, target: null, after: false, frame: 0};
    pointerDrag = session;
    const updateTarget = () => {
      shadow.querySelectorAll('[data-ycp-drop]').forEach(el => el.removeAttribute('data-ycp-drop'));
      session.target = null;
      const group = shadow.elementFromPoint(session.x, session.y)?.closest('.ycp-group');
      if (!group || !acceptsCloudDrop(group.dataset.cloudId)) return;
      const bounds = group.querySelector('.ycp-cloud').getBoundingClientRect();
      session.target = group.dataset.cloudId; session.after = session.y >= bounds.top + bounds.height / 2;
      group.dataset.ycpDrop = session.after ? 'after' : 'before';
    };
    const scroll = () => {
      if (pointerDrag !== session || session.cancelled) return;
      if (!orderingAvailable() || !session.node.isConnected || session.key !== key || !movableClouds().some(cloud => cloud.id === session.id)) { clearCloudDrag(); return; }
      const list = shadow.querySelector('.ycp-mine');
      if (!list) { clearCloudDrag(); return; }
      const area = list.getBoundingClientRect();
      if (session.x >= area.left && session.x <= area.right && session.y >= area.top - 32 && session.y <= area.bottom + 32) {
        if (session.y < area.top + 28) list.scrollTop -= 8;
        else if (session.y > area.bottom - 28) list.scrollTop += 8;
      }
      updateTarget();
      session.frame = requestAnimationFrame(scroll);
    };
    session.move = pointer => {
      if (pointer.pointerId !== session.pointerId || session.cancelled) return;
      if (!(pointer.buttons & 1) || !orderingAvailable() || session.key !== key || !movableClouds().some(cloud => cloud.id === session.id)) { clearCloudDrag(); return; }
      session.x = pointer.clientX; session.y = pointer.clientY;
      if (!session.active && Math.hypot(session.x - session.startX, session.y - session.startY) < 6) return;
      pointer.preventDefault();
      if (!session.active) {
        session.active = true; cloudDrag = {id: session.id, key: session.key};
        session.node.setPointerCapture(session.pointerId);
        session.node.closest('.ycp-group').setAttribute('data-ycp-dragging', '');
        shadow.querySelector('.ycp-mine').setAttribute('data-reordering', '');
        session.frame = requestAnimationFrame(scroll);
      }
      updateTarget();
    };
    session.up = pointer => {
      if (pointer.pointerId !== session.pointerId) return;
      if (session.active) {
        pointer.preventDefault();
        const suppressClick = click => { click.preventDefault(); click.stopPropagation(); };
        session.node.addEventListener('click', suppressClick, {capture: true, once: true});
        setTimeout(() => session.node.removeEventListener('click', suppressClick, true), 250);
      }
      if (session.active && !session.cancelled && session.key === key && session.target && acceptsCloudDrop(session.target)) moveCloud(session.id, session.target, session.after);
      else clearCloudDrag();
    };
    session.cancel = () => clearCloudDrag();
    session.escape = keyboard => {
      if (keyboard.key !== 'Escape') return;
      keyboard.preventDefault(); session.cancelled = true; cloudDrag = null;
      cancelAnimationFrame(session.frame);
      shadow.querySelectorAll('[data-ycp-drop], [data-ycp-dragging]').forEach(el => { el.removeAttribute('data-ycp-drop'); el.removeAttribute('data-ycp-dragging'); });
      shadow.querySelector('.ycp-mine')?.removeAttribute('data-reordering');
    };
    window.addEventListener('pointermove', session.move, {capture: true, passive: false});
    window.addEventListener('pointerup', session.up, true);
    window.addEventListener('pointercancel', session.cancel, true);
    window.addEventListener('keydown', session.escape, true);
    window.addEventListener('blur', session.cancel);
  }
  function orderedInactiveGroups() {
    const ids = [...new Set(cachedGroups().map(group => federationGroupKey(group.federationId)))];
    return [...groupOrder.filter(id => ids.includes(id)), ...ids.filter(id => !groupOrder.includes(id))];
  }
  function moveGroup(source, target, after = false) {
    const visible = orderedInactiveGroups();
    if (!visible.includes(source) || !visible.includes(target)) { clearCloudDrag(); return; }
    const complete = [...groupOrder, ...visible.filter(id => !groupOrder.includes(id))];
    groupOrder = Core.reorderMine(complete, source, target, after);
    clearCloudDrag(); rememberLayout(); render();
  }
  function beginGroupDrag(event, id) {
    if (event.button !== 0 || !event.isPrimary || !['mouse', 'pen'].includes(event.pointerType) || event.target.closest('button, input, a, select, textarea')) return;
    clearCloudDrag();
    const session = {id, key, node: event.currentTarget, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false, cancelled: false, target: null, after: false, frame: 0};
    pointerDrag = session;
    const updateTarget = () => {
      shadow.querySelectorAll('[data-ycp-drop]').forEach(node => node.removeAttribute('data-ycp-drop'));
      session.target = null;
      const wrapper = shadow.elementFromPoint(session.x, session.y)?.closest('[data-group-order-key]');
      if (!wrapper || wrapper.dataset.groupOrderKey === id || !orderedInactiveGroups().includes(wrapper.dataset.groupOrderKey)) return;
      const bounds = wrapper.getBoundingClientRect();
      session.target = wrapper.dataset.groupOrderKey;
      session.after = session.y >= bounds.top + bounds.height / 2;
      wrapper.dataset.ycpDrop = session.after ? 'after' : 'before';
    };
    const scroll = () => {
      if (pointerDrag !== session) return;
      if (!session.node.isConnected || session.key !== key || !orderedInactiveGroups().includes(id)) { clearCloudDrag(); return; }
      const list = shadow.querySelector('.ycp-mine'), area = list.getBoundingClientRect();
      if (session.x >= area.left && session.x <= area.right && session.y >= area.top - 32 && session.y <= area.bottom + 32) {
        if (session.y < area.top + 28) list.scrollTop -= 8;
        else if (session.y > area.bottom - 28) list.scrollTop += 8;
      }
      updateTarget(); session.frame = requestAnimationFrame(scroll);
    };
    session.move = pointer => {
      if (pointer.pointerId !== session.pointerId || session.cancelled) return;
      if (!(pointer.buttons & 1) || session.key !== key) { clearCloudDrag(); return; }
      session.x = pointer.clientX; session.y = pointer.clientY;
      if (!session.active && Math.hypot(session.x - session.startX, session.y - session.startY) < 6) return;
      pointer.preventDefault();
      if (!session.active) {
        session.active = true; session.node.setPointerCapture(session.pointerId);
        session.node.closest('[data-group-order-key]').setAttribute('data-ycp-dragging', '');
        shadow.querySelector('.ycp-mine').setAttribute('data-reordering', '');
        session.frame = requestAnimationFrame(scroll);
      }
      updateTarget();
    };
    session.up = pointer => {
      if (pointer.pointerId !== session.pointerId) return;
      if (session.active) {
        pointer.preventDefault();
        const suppressClick = click => { click.preventDefault(); click.stopPropagation(); };
        session.node.addEventListener('click', suppressClick, {capture: true, once: true});
        setTimeout(() => session.node.removeEventListener('click', suppressClick, true), 250);
      }
      if (session.active && !session.cancelled && session.key === key && session.target) moveGroup(id, session.target, session.after);
      else clearCloudDrag();
    };
    session.cancel = () => clearCloudDrag();
    session.escape = keyboard => {
      if (keyboard.key !== 'Escape') return;
      keyboard.preventDefault(); session.cancelled = true; cancelAnimationFrame(session.frame);
      shadow.querySelectorAll('[data-ycp-drop], [data-ycp-dragging]').forEach(node => { node.removeAttribute('data-ycp-drop'); node.removeAttribute('data-ycp-dragging'); });
      shadow.querySelector('.ycp-mine')?.removeAttribute('data-reordering');
    };
    window.addEventListener('pointermove', session.move, {capture: true, passive: false});
    window.addEventListener('pointerup', session.up, true);
    window.addEventListener('pointercancel', session.cancel, true);
    window.addEventListener('keydown', session.escape, true);
    window.addEventListener('blur', session.cancel);
  }
  function movableClouds() {
    const clouds = new Map(state.clouds.map(cloud => [cloud.id, cloud]));
    if (!groupedOrganizations()) return state.mine.map(id => clouds.get(id)).filter(cloud => cloud && (cloud.organizationId || null) === (organization?.id || null));
    return organizationGroups().flatMap(group => group.clouds);
  }
  function groupedOrganizations() {
    return new Set(state.clouds.map(cloud => cloud.organizationId || '')).size > 1;
  }
  function organizationGroups() {
    const groups = new Map();
    for (const cloud of state.clouds) {
      const id = organizationGroupKey(cloud.organizationId);
      if (!groups.has(id)) groups.set(id, {id, name: cloud.organizationName || t('unknownOrganization'), clouds: []});
      groups.get(id).clouds.push(cloud);
    }
    return [...groups.values()].map(group => {
      const settings = cloudSettings(group.clouds[0]);
      const clouds = new Map(group.clouds.map(cloud => [cloud.id, cloud]));
      return {...group, clouds: settings.mine.map(id => clouds.get(id)).filter(Boolean)};
    }).filter(group => group.clouds.length);
  }
  function cachedGroups() {
    return Federation.catalogGroups(preferences, location.origin, Core.catalogCache)
      .filter(group => group.federationId !== federationId && (group.federationId === null
        ? showPersonalOrganizations && group.key === Federation.passportCatalogKey(location.origin)
        : !personalMode() || showPersonalOrganizations))
      .flatMap(group => {
        const organizations = new Map();
        for (const item of group.catalog) {
          const cloud = {...item, federationId: group.federationId, folders: item.folders.map(folder => ({...folder, federationId: group.federationId}))};
          if (!cloudSettings(cloud).mine.includes(cloud.id)) continue;
          const id = organizationGroupKey(cloud.organizationId, group.federationId);
          if (!organizations.has(id)) organizations.set(id, {id, federationId: group.federationId, name: cloud.organizationName || t('unknownOrganization'), clouds: []});
          organizations.get(id).clouds.push(cloud);
        }
        return [...organizations.values()].map(organization => ({...organization, clouds: cloudSettings(organization.clouds[0]).mine.map(id => organization.clouds.find(cloud => cloud.id === id)).filter(Boolean)}));
      });
  }
  function hideOrganizationLevel(id) {
    if (!hideSingleOrganization || !id) return false;
    const catalog = id === federationId ? state.clouds : Core.catalogCache(preferences[Federation.catalogKey(location.origin, id)], location.origin);
    return new Set(catalog.map(cloud => cloud.organizationId || '')).size === 1;
  }
  function federationName(id) {
    const profile = preferences[id === null ? Federation.passportProfileKey(location.origin) : Federation.profileKey(location.origin, id)];
    return profile?.appearance?.label || profile?.name || (id === null ? t('passportAccount') : id);
  }
  const groupColor = appearance => appearance?.color || 'var(--g-color-text-secondary)';
  function organizationSettings(group) {
    return group.clouds[0] ? cloudSettings(group.clouds[0]) : state;
  }
  function GroupAction({type, id, name, cloud}) {
    const targetKey = type === 'passport' ? Federation.passportProfileKey(location.origin) : type === 'federation' ? Federation.profileKey(location.origin, id) : cloud ? scopeKey(cloud.organizationId, cloudFederation(cloud)) : key;
    return <Button className="ycp-group-action" view="flat-secondary" size="s" aria-label={t(type === 'passport' ? 'customizePassport' : type === 'federation' ? 'customizeFederation' : 'customizeOrganization', {name})} aria-expanded={edit?.groupKey === targetKey} data-ycp-tooltip={t('customizeTitle')} onClick={event => { event.stopPropagation(); customizeGroup(type, targetKey, name); }}><Icon data={Ellipsis} size={16}/></Button>;
  }
  function toggleGroup(id) {
    if (collapsedOrganizations.has(id)) collapsedOrganizations.delete(id); else collapsedOrganizations.add(id);
    rememberLayout(); render();
  }
  function ActiveDot({active}) {
    return active ? <span className="ycp-active-dot" role="img" aria-label={t('activeContext')} data-ycp-tooltip={t('activeContext')}/> : null;
  }
  function OrganizationHeading({group}) {
    const appearance = organizationSettings(group).appearance;
    const name = appearance?.label || group.name;
    return <div className="ycp-organization-row" onClick={() => toggleGroup(group.id)}>
      <Button view="flat-secondary" size="m" aria-label={t('organizationClouds', {name})} aria-expanded={!collapsedOrganizations.has(group.id)} onClick={event => {
        event.stopPropagation();
        if (event.detail > 0) event.currentTarget.blur();
        toggleGroup(group.id);
      }}><Icon data={collapsedOrganizations.has(group.id) ? ChevronRight : ChevronDown} size={16}/></Button>
      <span className="ycp-group-icon" style={{color: groupColor(appearance)}}><Icon data={Briefcase} size={16}/><ActiveDot active={group.clouds.some(cloud => activeCloud(cloud) && cloud.organizationId === (currentCloud()?.organizationId || organization?.id))}/></span>
      <Text variant="body-1" data-ycp-tooltip={group.name}>{name}</Text>
      <Text variant="caption-2" color="secondary">{group.clouds.length}</Text>
      <GroupAction type="organization" name={group.name} cloud={group.clouds[0]}/>
    </div>;
  }
  function federationGroupKey(id) { return id === null ? 'account:passport' : `federation:${id}`; }
  function FederationHeading({id, cached = false, cloudCount = 0}) {
    const groupKey = federationGroupKey(id), name = federationName(id);
    const profile = preferences[id === null ? Federation.passportProfileKey(location.origin) : Federation.profileKey(location.origin, id)];
    const originalName = profile?.name || (id === null ? t('passportAccount') : id);
    return <div className="ycp-organization-row ycp-federation-row" data-federation-id={id ?? undefined} data-passport-heading={id === null || undefined} data-group-reorderable={cached || undefined} tabIndex={cached ? 0 : undefined} role={cached ? 'group' : undefined} aria-label={cached ? name : undefined} onPointerDown={cached ? event => beginGroupDrag(event, groupKey) : undefined} onKeyDown={cached ? event => {
      if (event.target !== event.currentTarget || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const ids = orderedInactiveGroups(), index = ids.indexOf(groupKey), down = event.key === 'ArrowDown';
      const target = ids[index + (down ? 1 : -1)];
      if (target) { moveGroup(groupKey, target, down); requestAnimationFrame(() => shadow.querySelector(`[data-group-order-key="${CSS.escape(groupKey)}"] .ycp-federation-row`)?.focus()); }
    } : undefined} onClick={() => toggleGroup(groupKey)}>
      <Button view="flat-secondary" size="m" aria-label={t(id === null ? 'passportClouds' : 'federationClouds', {name})} aria-expanded={!collapsedOrganizations.has(groupKey)} onClick={event => {
        event.stopPropagation();
        if (event.detail > 0) event.currentTarget.blur();
        toggleGroup(groupKey);
      }}><Icon data={collapsedOrganizations.has(groupKey) ? ChevronRight : ChevronDown} size={16}/></Button>
      <span className="ycp-group-icon" style={{color: groupColor(profile?.appearance)}}><Icon data={id === null ? Person : PersonsLock} size={16}/><ActiveDot active={!cached && identity !== null}/></span>
      <Text variant="body-1" data-ycp-tooltip={cached ? `${originalName}\n${t(id === null ? 'switchPassport' : 'cachedFederation')}` : originalName}>{name}</Text>
      {(id === null || hideOrganizationLevel(id)) ? <Text className="ycp-group-count" variant="caption-2" color="secondary">{cloudCount}</Text> : <span/>}
      <GroupAction type={id === null ? "passport" : "federation"} id={id} name={originalName}/>
    </div>;
  }
  function CachedOrganization({group, hidden = false, passport = false}) {
    const collator = new Intl.Collator(consoleLanguage(), {sensitivity: 'base', numeric: true});
    return <div className={`ycp-organization-group${passport ? ' ycp-passport-organization' : ''}`} data-organization-id={group.id} data-cached-passport={passport || undefined} data-organization-hidden={hidden || undefined}>
      {!hidden && <OrganizationHeading group={group}/>}
      {(hidden || !collapsedOrganizations.has(group.id)) && group.clouds.map(cloud => <section className="ycp-group" key={cloud.id} data-cached-cloud-id={cloud.id}>
        <Item item={cloud}/>
        {cloudFoldersEnabled(cloud) && itemExpanded(cloud) && [...cloud.folders].sort((a, b) => collator.compare(display(a, cloud), display(b, cloud)) || a.id.localeCompare(b.id)).map(folder => <Item key={folder.id} item={folder} parent={cloud}/>)}
      </section>)}
    </div>;
  }
  function PassportLevel({enabled = true, cached = false, cloudCount = 0, children}) {
    if (!enabled) return children;
    const id = federationGroupKey(null);
    return <div className="ycp-federation ycp-passport-account" data-passport-account data-group-order-key={cached ? id : undefined}>
      <FederationHeading id={null} cached={cached} cloudCount={cloudCount}/>
      {!collapsedOrganizations.has(id) && children}
    </div>;
  }
  function CachedFederations({groups}) {
    return orderedInactiveGroups().map(groupKey => {
      const selected = groups.filter(group => federationGroupKey(group.federationId) === groupKey);
      const id = selected[0]?.federationId;
      const cloudCount = selected.reduce((sum, group) => sum + group.clouds.length, 0);
      if (id === null) return <PassportLevel key={groupKey} cached cloudCount={cloudCount}>{selected.map(group => <CachedOrganization key={group.id} group={group} passport/>)}</PassportLevel>;
      return <div key={groupKey} className="ycp-federation" data-cached-federation={id} data-group-order-key={groupKey}>
        <FederationHeading id={id} cached cloudCount={cloudCount}/>
        {!collapsedOrganizations.has(groupKey) && selected.map(group => <CachedOrganization key={group.id} group={group} hidden={hideOrganizationLevel(id)}/>)}
      </div>;
    });
  }
  function itemExpanded(cloud) {
    if (activeCloud(cloud)) return expanded.has(cloud.id);
    const settings = cloudSettings(cloud);
    return (settings.expandedClouds || settings.mine).includes(cloud.id);
  }
  function toggleCachedExpanded(cloud) {
    updateCloudSettings(cloud, settings => {
      const ids = settings.expandedClouds || settings.mine;
      settings.expandedClouds = ids.includes(cloud.id) ? ids.filter(id => id !== cloud.id) : [...ids, cloud.id];
    });
    render();
  }
  function updateCloudSettings(cloud, update) {
    const cloudKey = scopeKey(cloud.organizationId, cloudFederation(cloud));
    if (cloudKey === key) { update(state); save(true); return; }
    const settings = structuredClone(cloudSettings(cloud));
    update(settings);
    preferenceSync.stage(cloudKey, settings);
    preferenceSync.flush(cloudKey).catch(() => { statusKey = 'saveFailed'; render(); });
  }
  function itemSettings(item, parent) {
    const cloud = item.type === 'cloud' ? item : parent || state.clouds.find(cloud => cloud.id === item.cloudId || cloud.folders.some(folder => folder.id === item.id));
    return cloud ? cloudSettings(cloud) : state;
  }
  function legacyPreferences() {
    if (!federationId || !organization || state.legacyImported) return null;
    const saved = preferences[Core.scopeKey(location.origin, organization.id)];
    return Array.isArray(saved?.mine) && saved.mine.length ? saved : null;
  }
  function importLegacyPreferences() {
    const saved = legacyPreferences();
    if (!saved) return;
    state.mine = [...new Set([...saved.mine, ...state.mine])];
    state.custom = {...saved.custom, ...state.custom};
    if (saved.appearance) state.appearance = {...saved.appearance, ...state.appearance};
    state.expandedClouds = [...new Set([...(saved.expandedClouds || saved.mine), ...(state.expandedClouds || [])])];
    state.initialized = true; state.legacyImported = true;
    save(true); restoreExpanded(); queueExpandedFolders(); render();
  }
  function moveCloud(source, target, after, focus = false) {
    const sourceCloud = state.clouds.find(cloud => cloud.id === source);
    const targetCloud = state.clouds.find(cloud => cloud.id === target);
    if (!sourceCloud || !targetCloud || (sourceCloud.organizationId || null) !== (targetCloud.organizationId || null)) return;
    const settings = cloudSettings(sourceCloud);
    const ordered = Core.reorderMine(settings.mine, source, target, after);
    clearCloudDrag();
    if (ordered === settings.mine) return;
    updateCloudSettings(sourceCloud, settings => { settings.mine = ordered; });
    if (focus) reorderFocus = {id: source, key};
    const visible = movableClouds();
    const cloud = visible.find(cloud => cloud.id === source);
    reorderAnnouncement = t('cloudMoved', {name: cloud ? display(cloud) : source, position: visible.findIndex(cloud => cloud.id === source) + 1, count: visible.length});
    save(); render();
  }
  function orderingAvailable() {
    const count = scopedClouds().length;
    return !native && (groupedOrganizations() || !(state.showAllModern && organization && scanReady && count > 0 && count < 10));
  }
  function acceptsCloudDrop(target) {
    const visible = movableClouds();
    const source = visible.find(cloud => cloud.id === cloudDrag?.id);
    const destination = visible.find(cloud => cloud.id === target);
    return orderingAvailable() && cloudDrag?.key === key && cloudDrag.id !== target && source && destination && (source.organizationId || null) === (destination.organizationId || null);
  }
  function hasNoFolders(id) {
    const cloud = state.clouds.find(cloud => cloud.id === id);
    return Boolean(cloud && !cloud.folders.length && loadedFolders.has(folderKey(id)));
  }
  function restoreExpanded() {
    expanded.clear();
    const scopes = groupedOrganizations() ? [...new Map(state.clouds.map(cloud => [cloud.organizationId || '', cloudSettings(cloud)])).values()] : [state];
    for (const settings of scopes) {
      const saved = Array.isArray(settings.expandedClouds) ? settings.expandedClouds : settings.mine;
      saved.forEach(id => { if (typeof id === 'string' && !hasNoFolders(id)) expanded.add(id); });
    }
  }
  function rememberExpanded(cloudId) {
    const cloud = state.clouds.find(cloud => cloud.id === cloudId);
    const keep = settings => [...expanded].filter(id => settings.mine.includes(id) || state.clouds.some(item => item.id === id && (item.organizationId || null) === (cloud?.organizationId || organization?.id || null)));
    if (!cloud || scopeKey(cloud.organizationId, cloudFederation(cloud)) === key) { state.expandedClouds = keep(state); return; }
    updateCloudSettings(cloud, settings => { settings.expandedClouds = keep(settings); });
  }
  function currentCloud() {
    const selected = tree?.querySelector('[data-list-item^="cloud."][aria-selected="true"], [data-list-item^="cloud."].cloud-tree-list-item__item_selected');
    const selectedRoute = Core.route(selected?.querySelector('a[href]')?.getAttribute('href'), location.origin);
    const header = document.querySelector('.console-dashboard-header__cloud-icon')?.closest('.console-dashboard-header__entity-info');
    const identifiers = new Set([...header?.querySelectorAll('.g-text') || []].map(node => node.textContent.trim()));
    const headerCloud = state.clouds.find(cloud => identifiers.has(cloud.id));
    return Core.currentCloud(state.clouds, location.href, location.origin, selectedRoute?.type === 'cloud' ? selectedRoute.id : headerCloud?.id);
  }
  function revealCurrentRoute() {
    const cloud = currentCloud();
    const transition = `${key}:${location.href}:${cloud?.id || ''}`;
    if (observedRouteTransition !== transition) { observedRouteTransition = transition; revealedRoute = null; }
    if (revealedRoute === transition) return;
    const active = Core.route(location.href, location.origin);
    if (!active) { revealedRoute = transition; return; }
    if (!cloud) return;
    revealedRoute = transition;
    if (personalMode() && showPersonalOrganizations && collapsedOrganizations.delete(federationGroupKey(null))) rememberLayout();
    if (federationId && collapsedOrganizations.delete(federationGroupKey(federationId))) rememberLayout();
    if (collapsedOrganizations.delete(organizationGroupKey(cloud.organizationId))) rememberLayout();
    if (!cloudFoldersEnabled(cloud) || hasNoFolders(cloud.id)) return;
    if (!expanded.has(cloud.id)) { expanded.add(cloud.id); rememberExpanded(cloud.id); save(); }
  }
  let catalogKey = Federation.catalogKey(location.origin, federationId);
  function saveCatalog() {
    if (stopped || !canScanIdentity()) return;
    const snapshot = Core.catalogCache(state.clouds, location.origin);
    const savedCatalogKey = catalogKey;
    preferences[savedCatalogKey] = snapshot;
    const saved = {[savedCatalogKey]: snapshot};
    if (personalMode()) {
      const passportKey = Federation.passportCatalogKey(location.origin);
      preferences[passportKey] = snapshot;
      saved[passportKey] = snapshot;
    }
    storage?.set(saved).catch(() => {});
  }
  function saveFederationProfile() {
    if (stopped || !identity) return;
    const profileKey = identity.id === null ? Federation.passportProfileKey(location.origin) : Federation.profileKey(location.origin, identity.id);
    const profile = {...preferences[profileKey], name: identity.name || (identity.id === null ? t('passportAccount') : identity.id)};
    if (preferences[profileKey]?.name === profile.name) return;
    preferences[profileKey] = profile;
    storage?.set({[profileKey]: profile}).catch(() => {});
  }
  function resumeDestination() {
    if (!identity || location.pathname.startsWith('/federations/')) return;
    try {
      const saved = sessionStorage.getItem('yc-power:destination');
      if (!saved) return;
      const destination = JSON.parse(saved);
      if (!Number.isFinite(destination.expires) || destination.expires < Date.now()) { sessionStorage.removeItem('yc-power:destination'); return; }
      if (destination.federationId !== identity.id) return;
      const route = Core.route(destination.href, location.origin);
      sessionStorage.removeItem('yc-power:destination');
      if (route && route.href !== location.href) location.replace(route.href);
    } catch {
      try { sessionStorage.removeItem('yc-power:destination'); } catch { /* session storage can be unavailable */ }
    }
  }
  function syncIdentity() {
    const next = readIdentity();
    if ((next?.id || null) === federationId && Boolean(next) === Boolean(identity)) {
      const renamed = next?.name !== identity?.name;
      identity = next; saveFederationProfile(); if (renamed) render(); return;
    }
    clearTimeout(saveTimer);
    preferenceSync.flush(key).catch(() => {});
    invalidateScans(); clearCloudDrag();
    identity = next; federationId = next?.id || null;
    key = scopeKey(null); catalogKey = Federation.catalogKey(location.origin, federationId);
    selectedOrganizationId = null; organization = null; scanReady = false; edit = null;
    state = {...defaults(), ...structuredClone(preferences[key] || {}), width: state.width, clouds: activeCatalog()};
    saveFederationProfile(); syncOrganization(); restoreExpanded();
    rescan = true; scheduleScans(); render(); decorateNative(); resumeDestination();
  }
  const loadedFolders = new Set(), attemptedFolders = new Set(), pendingFolders = new Map();
  let scanGeneration = 0, queueScheduled = false, activeScan = null;
  let startupWaiting = false, startupWaitTree = null, startupPoll = null, startupDeadlineTimer = null;
  function cancelStartupWait() {
    clearTimeout(startupPoll); clearTimeout(startupDeadlineTimer);
    startupPoll = null; startupDeadlineTimer = null;
    startupWaiting = false; startupWaitTree = null;
  }
  function confirmedEmpty(list) {
    return list && !tree.querySelector('[role="progressbar"], .g-spin, [aria-busy="true"], [role="alert"]') && /no clouds|нет облаков|облака не найдены|не найдено облаков|no results|ничего не найдено/i.test(list.textContent);
  }
  function treeReady() {
    const list = tree?.isConnected && tree.querySelector('.cloud-tree-list');
    return Boolean(list && ([...list.querySelectorAll('[data-list-item^="cloud."]')].some(row => !row.dataset.listItem.endsWith('.pinned')) || confirmedEmpty(list)));
  }
  function checkStartupReadiness() {
    if (!startupWaiting || stopped || startupWaitTree !== tree || !treeReady()) return;
    cancelStartupWait();
    statusKey = native || allOpen ? 'scanPaused' : 'cloudCount';
    rescan = true;
    scheduleScans();
  }
  function beginStartupWait() {
    cancelStartupWait();
    startupWaiting = true; startupWaitTree = tree;
    statusKey = state.clouds.length ? 'cloudCount' : 'reading';
    const waitingTree = tree;
    const valid = () => !stopped && startupWaiting && tree === waitingTree && tree?.isConnected;
    const poll = () => {
      startupPoll = null;
      if (!valid()) return;
      checkStartupReadiness();
      if (startupWaiting) startupPoll = setTimeout(poll, 50);
    };
    startupDeadlineTimer = setTimeout(() => {
      startupDeadlineTimer = null;
      if (!valid()) return;
      clearTimeout(startupPoll); startupPoll = null;
      statusKey = 'scanFailed';
      render();
    }, 5000);
    checkStartupReadiness();
    if (startupWaiting) startupPoll = setTimeout(poll, 50);
  }
  function scanFailed(target) {
    statusKey = 'scanFailed';
    if (!state.mine.length) allOpen = true;
  }
  const folderKey = id => `${key}:${id}`;
  function invalidateScans() {
    clearCloudDrag();
    scanGeneration++; pendingFolders.clear(); loadedFolders.clear(); attemptedFolders.clear();
    if (busy) rescan = true;
  }
  function cloudFoldersEnabled(cloud) {
    return foldersEnabled && !cloud?.regionId;
  }
  function queueFolderScan(id, force = false) {
    if (!cloudFoldersEnabled(state.clouds.find(cloud => cloud.id === id))) return;
    const requestKey = folderKey(id);
    if (!force && attemptedFolders.has(requestKey)) return;
    pendingFolders.set(requestKey, {id, key, generation: scanGeneration});
    scheduleScans();
  }
  function scheduleScans() {
    if (queueScheduled || stopped) return;
    queueScheduled = true;
    queueMicrotask(() => {
      queueScheduled = false;
      if (busy || stopped || native || allOpen || startupWaiting || !tree?.isConnected) return;
      if (rescan) { rescan = false; void scan(); return; }
      for (const [requestKey, request] of pendingFolders) {
        pendingFolders.delete(requestKey);
        if (request.key !== key || request.generation !== scanGeneration) continue;
        attemptedFolders.add(requestKey);
        void scan(request.id);
        return;
      }
    });
  }
  function queueExpandedFolders() {
    if (!foldersEnabled) return;
    const clouds = groupedOrganizations() ? state.clouds : scopedClouds();
    const allModern = !groupedOrganizations() && state.showAllModern && organization && scanReady && clouds.length > 0 && clouds.length < 10;
    for (const cloud of clouds) {
      if ((allModern || cloudSettings(cloud).mine.includes(cloud.id)) && expanded.has(cloud.id) && !cloud.folders.length && !loadedFolders.has(folderKey(cloud.id))) queueFolderScan(cloud.id);
    }
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function consoleLanguage() {
    return I18n.language(document.documentElement.lang, tree?.querySelector('input')?.placeholder, navigator.language);
  }
  const t = (key, params) => I18n.translate(consoleLanguage(), key, params);
  function save(immediate = false) {
    clearTimeout(saveTimer);
    const savedKey = key;
    const {clouds, ...settings} = state;
    preferenceSync.stage(savedKey, settings);
    const flush = () => {
      preferenceSync.flush(savedKey).catch(() => { statusKey = 'saveFailed'; render(); });
    };
    if (immediate) flush(); else saveTimer = setTimeout(flush, 150);
  }
  function flushPendingPreferences() {
    clearTimeout(saveTimer);
    return Promise.all(Object.keys(preferences).map(savedKey => preferenceSync.flush(savedKey)));
  }
  const onPageHide = () => { void flushPendingPreferences().catch(() => {}); };
  function syncOrganization(adopted, initialize = true) {
    if (adopted?.id) selectedOrganizationId = adopted.id;
    const next = adopted || Core.currentOrganization(state.clouds, location.href, location.origin, selectedOrganizationId, currentCloud()?.id);
    const nextKey = scopeKey(next?.id);
    organization = next;
    if (nextKey === key) return;
    clearTimeout(saveTimer);
    const {clouds, width} = state;
    preferenceSync.flush(key).catch(() => { statusKey = 'saveFailed'; render(); });
    clearCloudDrag();
    invalidateScans();
    key = nextKey;
    state = {...defaults(), ...structuredClone(preferences[key] || {}), clouds};
    if (groupedOrganizations()) state.width = width;
    state.width = Math.min(440, Math.max(1, Number(state.width) || 360));
    edit = null; restoreExpanded();
    if (initialize) initializeMine();
    applyWidth(); rememberLayout();
  }
  function scopedClouds() {
    return state.clouds.filter(cloud => (cloud.organizationId || null) === (organization?.id || null));
  }
  function initializeMine() {
    if (!canScanIdentity()) return;
    if (state.initialized) return;
    const active = currentCloud();
    const current = scopedClouds().find(cloud => cloud.id === active?.id);
    if (current) { state.mine = [current.id]; state.initialized = true; if (!hasNoFolders(current.id)) expanded.add(current.id); rememberExpanded(current.id); save(); }
  }
  function display(item, parent) {
    return itemSettings(item, parent).custom[`${item.type}:${item.id}`]?.label || Core.label(item.name, parent?.name);
  }
  function itemColor(item, parent) {
    return itemSettings(item, parent).custom[`${item.type}:${item.id}`]?.color || Core.color(item.id);
  }
  function setNativeVisibility() {
    if (nativeReturnSlot) nativeReturnSlot.style.display = native ? 'inline-flex' : 'none';
    const covered = !native && !allOpen;
    tree?.toggleAttribute('data-ycp-covered', covered);
    host?.toggleAttribute('data-ycp-covered', covered);
    if (tree) {
      tree.toggleAttribute('inert', covered);
      if (covered) tree.setAttribute('aria-hidden', 'true');
      else tree.removeAttribute('aria-hidden');
    }
  }
  function pauseTreeScan() {
    scanGeneration++;
    for (const request of pendingFolders.values()) if (request.key === key) request.generation = scanGeneration;
    if (activeScan) {
      const scan = activeScan;
      if (!scan.restored && scan.list.isConnected) { scan.list.scrollTop = scan.originalScroll; scan.restored = true; }
      if (scan.key === key) {
        if (scan.target) queueFolderScan(scan.target, true);
        else rescan = true;
      }
    }
    if (busy || pendingFolders.size || rescan) statusKey = 'scanPaused';
  }
  function restoreNativeTree() {
    tree?.removeAttribute('data-ycp-covered'); tree?.removeAttribute('inert'); tree?.removeAttribute('aria-hidden');
    nativeReturnSlot?.remove(); nativeReturnSlot = null; nativeReturnTarget = null;
  }
  function ensureNativeReturn() {
    const search = tree?.querySelector('.cloud-tree-list-container__search');
    if (!search) {
      if (nativeReturnSlot) { nativeReturnSlot.remove(); nativeReturnSlot = null; nativeReturnTarget = null; render(); }
      return;
    }
    if (nativeReturnSlot?.parentElement === search) {
      nativeReturnSlot.style.display = native ? 'inline-flex' : 'none';
      return;
    }
    nativeReturnSlot?.remove();
    nativeReturnSlot = document.createElement('span'); nativeReturnSlot.className = 'ycp-native-return-slot';
    nativeReturnSlot.style.display = native ? 'inline-flex' : 'none';
    const slotShadow = nativeReturnSlot.attachShadow({mode: 'open'});
    const style = document.createElement('style'); style.textContent = gravityCSS;
    nativeReturnTarget = document.createElement('span'); slotShadow.append(style, nativeReturnTarget);
    search.append(nativeReturnSlot); render();
  }
  function readRows(list) {
    const viewport = list || tree;
    return Core.annotateOrganizations([...tree.querySelectorAll('[data-list-item]')].flatMap(el => {
      const raw = el.dataset.listItem;
      const li = el.closest('li');
      const bounds = li || el;
      const offset = Math.round(bounds.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop);
      if (raw.startsWith('organization.')) return [{type: 'organization', id: raw.slice(13), name: el.querySelector('a')?.title || raw.slice(13), offset}];
      const a = el.querySelector('a[href]');
      const item = a && Core.route(a.getAttribute('href'), location.origin);
      if (!item || !a.title) return [];
      return [{...item, regionId: item.regionId, name: a.title, offset, pinned: raw.endsWith('.pinned')}];
    }));
  }
  function collectRow(rows, row) {
    const id = `${row.type}:${row.id}:${row.pinned || false}`;
    rows.set(id, {...rows.get(id), ...row});
  }
  function cloudSettings(cloud) {
    const cloudKey = scopeKey(cloud.organizationId, cloudFederation(cloud));
    return cloudKey === key ? state : {...defaults(), ...preferences[cloudKey]};
  }
  function decorateNative() {
    if (stopped || !tree?.isConnected) return;
    ensureNativeReturn();
    const enabled = canScanIdentity();
    for (const row of tree.querySelectorAll('[data-list-item^="cloud."]')) {
      const id = row.dataset.listItem.slice(6).replace(/\.pinned$/, '');
      const cloud = state.clouds.find(item => item.id === id);
      const mine = cloud ? cloudSettings(cloud).mine.includes(id) : false;
      let add = row.querySelector('.ycp-add-native');
      if (!add) {
        add = document.createElement('button');
        add.type = 'button';
        add.className = 'g-button g-button_view_flat-secondary g-button_size_m g-button_pin_round-round ycp-add-native';
        add.addEventListener('click', event => {
          event.preventDefault(); event.stopPropagation();
          if (!canScanIdentity()) return;
          const item = Core.route(row.querySelector('a[href]')?.getAttribute('href'), location.origin);
          if (!item) return;
          let cloud = state.clouds.find(c => c.id === item.id);
          const annotated = readRows(tree.querySelector('.cloud-tree-list')).find(candidate => candidate.type === 'cloud' && candidate.id === item.id);
          if (!cloud) {
            cloud = {...item, ...annotated, name: row.querySelector('a').title, folders: []};
            state.clouds.push(cloud);
          } else if (annotated) Object.assign(cloud, annotated);
          if (!groupedOrganizations() && cloud.organizationId && (!organization || !Core.currentOrganization(state.clouds, location.href, location.origin))) {
            syncOrganization({id: cloud.organizationId, name: cloud.organizationName || cloud.organizationId}, false);
          }
          native = false; allOpen = true; setNativeVisibility();
          toggleMine(cloud); render();
        });
        row.append(add);
      }
      add.disabled = !enabled;
      const title = t(mine ? 'remove' : 'add');
      if (add.dataset.ycpTooltip !== title) {
        add.dataset.ycpTooltip = title; add.setAttribute('aria-label', title);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16'); svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', (mine ? CircleMinus : CirclePlus)({}).props.children.props.d); path.setAttribute('fill', 'currentColor'); path.setAttribute('fill-rule', 'evenodd'); path.setAttribute('clip-rule', 'evenodd');
        svg.classList.add('g-icon'); svg.append(path);
        const wrapper = document.createElement('span'); wrapper.className = 'g-button__icon';
        const inner = document.createElement('span'); inner.className = 'g-button__icon-inner'; inner.append(svg); wrapper.append(inner); add.replaceChildren(wrapper);
      }
    }
  }
  async function waitForRows(list, scanTree, valid) {
    for (let attempt = 0; attempt < 100; attempt++) {
      await pause(40);
      if (!valid()) return false;
      const positions = [...list.querySelectorAll('[data-list-item]')].filter(el => !el.dataset.listItem.startsWith('organization.') && getComputedStyle(el.closest('li') || el).position !== 'sticky').map(el => ({
        top: el.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop,
        height: el.getBoundingClientRect().height,
      }));
      if (!positions.length) {
        if (attempt >= 10 && !tree.querySelector('[role="progressbar"], .g-spin, [aria-busy="true"]')) return true;
        continue;
      }
      if (list.scrollHeight <= list.clientHeight + 2) return true;
      const first = Math.min(...positions.map(p => p.top));
      const last = Math.max(...positions.map(p => p.top + p.height));
      // wait for virtual rows to cover the requested viewport, even in background tabs
      if (first <= list.scrollTop + 320 && last >= Math.min(list.scrollHeight - 8, list.scrollTop + list.clientHeight - 40)) return true;
    }
    throw new Error('Virtual rows did not catch up with scrolling');
  }
  function refreshClouds() {
    if (busy || native || allOpen) { void scan(); return; }
    if (!treeReady()) { beginStartupWait(); render(); return; }
    cancelStartupWait();
    rescan = false;
    void scan();
  }
  async function scan(target) {
    if (!canScanIdentity()) { statusKey = 'identityUnknown'; render(); return; }
    if (target && !cloudFoldersEnabled(state.clouds.find(cloud => cloud.id === target))) return;
    if (startupWaiting) {
      if (target) queueFolderScan(target, true);
      return;
    }
    if (busy) {
      if (target) queueFolderScan(target, true); else rescan = true;
      return;
    }
    if (stopped || !tree?.isConnected) return;
    if (native || allOpen) { rescan = true; statusKey = 'scanPaused'; render(); return; }
    const scanTree = tree, generation = scanGeneration, scanKey = key, verifiedIdentity = Boolean(identity);
    const valid = () => {
      const current = readIdentity();
      return !stopped && tree === scanTree && tree.isConnected && !native && !allOpen && generation === scanGeneration && scanKey === key && (current?.id || null) === federationId && Boolean(current) === verifiedIdentity;
    };
    const list = tree.querySelector('.cloud-tree-list');
    if (!list) { scanFailed(target); setNativeVisibility(); render(); return; }
    if (tree.querySelector('input')?.value) {
      statusKey = 'clearSearch'; allOpen = true; setNativeVisibility(); render(); return;
    }
    const scanContext = {list, originalScroll: list.scrollTop, key: scanKey, target, restored: false};
    activeScan = scanContext;
    busy = true; setNativeVisibility();
    statusKey = target ? 'loadingFolders' : 'scanning'; render();
    const originalScroll = scanContext.originalScroll;
    const rows = new Map();
    let found = !target;
    try {
      for (let top = 0, steps = 0; steps < 600; steps++) {
        if (!valid()) return;
        list.scrollTop = top;
        if (!await waitForRows(list, scanTree, valid)) return;
        if (!valid()) return;
        for (const row of readRows(list)) collectRow(rows, row);
        if (target && !found) {
          const row = [...tree.querySelectorAll('[data-list-item]')].find(el => el.dataset.listItem === `cloud.${target}`);
          if (row) {
            found = true;
            const expand = row.querySelector('.cloud-tree-list-item__expand-button');
            const opened = row.matches('[aria-expanded="true"], [aria-busy="true"]') || row.querySelector('.cloud-tree-list-item__expand-icon_expanded, [aria-expanded="true"], [aria-busy="true"], [role="progressbar"], .g-spin');
            if (expand && !opened) { tree.removeAttribute('inert'); expand.click(); setNativeVisibility(); }
            let stable = 0, previousSignature = '';
            for (let attempt = 0; attempt < 60; attempt++) {
              await pause(100);
              if (!valid()) return;
              const after = readRows(list).filter(item => !item.pinned && item.type !== 'organization').sort((a, b) => a.offset - b.offset);
              const index = after.findIndex(item => item.type === 'cloud' && item.id === target);
              const children = [];
              for (const child of after.slice(index + 1)) {
                if (child.type !== 'folder') break;
                children.push(child);
              }
              const loading = tree.querySelector('[role="progressbar"], .g-spin, [aria-busy="true"]');
              const signature = children.map(child => child.id).join('|');
              stable = !loading && signature === previousSignature ? stable + 1 : 0;
              previousSignature = signature;
              if (attempt >= 14 && stable >= 5) break;
              if (attempt === 59) throw new Error('Folder loading did not settle');
            }
            for (const [rowKey, item] of rows) {
              if (item.type === 'folder' && item.cloudId === target) rows.delete(rowKey);
            }
            for (const item of readRows(list)) collectRow(rows, item);
          }
        }
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 2) break;
        top = list.scrollTop + Math.max(36, list.clientHeight - 108);
      }
      if (!valid()) return;
      const freshRows = [...rows.values()];
      const empty = !target && confirmedEmpty(list);
      if (!target && !freshRows.some(row => row.type === 'cloud') && !empty) throw new Error('Cloud list is not ready');
      if (freshRows.some(row => row.type === 'cloud')) state.clouds = Core.catalog(freshRows, state.clouds, found ? target : undefined);
      else if (empty) state.clouds = [];
      saveCatalog();
      if (target && found) loadedFolders.add(folderKey(target));
      scanReady = true;
      syncOrganization(); initializeMine();
      if (!target) restoreExpanded();
      if (target && found && hasNoFolders(target) && expanded.delete(target)) { rememberExpanded(target); save(); }
      statusKey = 'cloudCount'; statusArgs = {count: scopedClouds().length};
      if (target && !found) statusKey = 'notFound';
      if (!target) {
        for (const cloud of groupedOrganizations() ? state.clouds : scopedClouds()) {
          if (cloudSettings(cloud).mine.includes(cloud.id)) queueFolderScan(cloud.id, true);
        }
      }
    } catch (error) {
      if (!valid()) return;
      console.warn('YC Power: tree scan failed', error);
      scanFailed(target);
    } finally {
      if (target && !valid()) attemptedFolders.delete(`${scanKey}:${target}`);
      if (!scanContext.restored && list.isConnected) list.scrollTop = originalScroll;
      if (activeScan === scanContext) activeScan = null;
      busy = false; setNativeVisibility(); render(); decorateNative();
      scheduleScans();
    }
  }
  function toggleMine(cloud) {
    if (activeCloud(cloud) && !canScanIdentity()) return;
    const mine = cloudSettings(cloud).mine.includes(cloud.id);
    updateCloudSettings(cloud, settings => {
      settings.mine = mine ? settings.mine.filter(id => id !== cloud.id) : [...settings.mine, cloud.id];
      settings.initialized = true;
    });
    if (!activeCloud(cloud)) { render(); return; }
    if (!mine && !hasNoFolders(cloud.id)) expanded.add(cloud.id);
    if (!mine && collapsedOrganizations.delete(organizationGroupKey(cloud.organizationId))) rememberLayout();
    rememberExpanded(cloud.id);
    save(true); render(); decorateNative();
    if (!mine && !cloud.folders.length) queueFolderScan(cloud.id);
  }
  function itemIconName(item, parent) {
    const icons = item.type === 'cloud' ? cloudIcons : folderIcons;
    const icon = itemSettings(item, parent).custom[`${item.type}:${item.id}`]?.icon;
    return Object.hasOwn(icons, icon) ? icon : item.type === 'cloud' ? 'cloud' : 'folder';
  }
  function customize(item, parent) {
    const cloud = item.type === 'cloud' ? item : parent;
    if (edit?.key === `${item.type}:${item.id}` && edit?.federationId === cloudFederation(cloud)) { edit = null; render(); return; }
    const probe = document.createElement('span'); probe.style.color = itemColor(item, parent); shadow.append(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g); probe.remove();
    edit = {cloud, federationId: cloudFederation(cloud), cloudId: cloud?.id, key: `${item.type}:${item.id}`, type: item.type, iconsEnabled: item.type === 'folder' || !cloudFoldersEnabled(item), icon: itemIconName(item, parent), name: item.name, label: display(item, parent), color: rgb ? `#${rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : '#246bfd'};
    render();
  }
  function customizeGroup(type, groupKey, name) {
    if (edit?.groupKey === groupKey) { edit = null; render(); return; }
    const settings = ['federation', 'passport'].includes(type) ? preferences[groupKey] : groupKey === key ? state : preferences[groupKey];
    const appearance = settings?.appearance;
    const probe = document.createElement('span'); probe.style.color = groupColor(appearance); shadow.append(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g); probe.remove();
    const color = rgb ? `#${rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : '#246bfd';
    edit = {groupKey, key: `${type}:${groupKey}`, type, name, label: appearance?.label || name, color, initialColor: color, hasCustomColor: Boolean(appearance?.color), iconsEnabled: false};
    render();
  }
  function saveCustomization(value) {
    if (edit.groupKey) {
      const appearance = value ? {
        ...(value.label && value.label !== edit.name ? {label: value.label} : {}),
        ...(edit.hasCustomColor || value.color !== edit.initialColor ? {color: value.color} : {}),
      } : undefined;
      if (edit.type === 'organization' && edit.groupKey === key) {
        if (appearance) state.appearance = appearance; else delete state.appearance;
        save(true);
      } else {
        const settings = structuredClone(preferences[edit.groupKey] || {});
        if (['federation', 'passport'].includes(edit.type) && !settings.name) settings.name = edit.name;
        if (appearance) settings.appearance = appearance; else delete settings.appearance;
        preferenceSync.stage(edit.groupKey, settings);
        preferenceSync.flush(edit.groupKey).catch(() => { statusKey = 'saveFailed'; render(); });
      }
      edit = null; render(); return;
    }
    const cloud = edit.cloud;
    if (!cloud) { edit = null; render(); return; }
    updateCloudSettings(cloud, settings => {
      if (value) settings.custom[edit.key] = {...settings.custom[edit.key], ...value};
      else delete settings.custom[edit.key];
    });
    edit = null; render();
  }
  function safeHref(item) {
    const route = Core.route(item.href, location.origin);
    if (route?.id !== item.id || route.type !== item.type) return undefined;
    return activeCloud(item) ? route.href : cloudFederation(item) === null ? undefined : Federation.loginHref(location.origin, cloudFederation(item));
  }
  async function navigateCached(event, item) {
    if (stopped) return;
    if (activeCloud(item)) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const href = safeHref(item), route = Core.route(item.href, location.origin);
    const passport = cloudFederation(item) === null;
    if ((!href && !passport) || !route || route.id !== item.id || route.type !== item.type) return;
    try {
      sessionStorage.setItem('yc-power:destination', JSON.stringify({federationId: cloudFederation(item), href: route.href, expires: Date.now() + 300000}));
      await flushPendingPreferences();
      if (stopped) return;
      if (passport) {
        statusKey = 'switchPassport';
        document.querySelector('[aria-label="Учетная запись"], [aria-label="Account"], [aria-label="User account"], [aria-label="Аккаунт"]')?.click();
        render();
      } else location.assign(href);
    } catch { statusKey = 'saveFailed'; render(); }
  }
  function Item({item, parent, draggable = false}) {
    const empty = item.type === 'cloud' && (activeCloud(item) ? hasNoFolders(item.id) : !item.folders.length);
    const current = activeCloud(item) && (item.type === 'folder' ? location.pathname.split('/').includes(item.id) : !cloudFoldersEnabled(item) && currentCloud()?.id === item.id);
    return <div className={`ycp-row ycp-${item.type}`} data-current={current || undefined} draggable={false} data-reorderable={draggable || undefined} tabIndex={draggable ? 0 : undefined} role={draggable ? 'group' : undefined} aria-label={draggable ? t('reorderCloud', {name: display(item)}) : undefined} aria-keyshortcuts={draggable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined} onKeyDown={event => {
      if (!draggable || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const clouds = movableClouds().filter(cloud => (cloud.organizationId || null) === (item.organizationId || null));
      const index = clouds.findIndex(cloud => cloud.id === item.id);
      const next = clouds[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (next) moveCloud(item.id, next.id, event.key === 'ArrowDown', true);
    }} onPointerDown={event => { if (draggable) beginCloudDrag(event, item); }} onDragStart={draggable ? event => event.preventDefault() : undefined}>
      {item.type === 'cloud' && (cloudFoldersEnabled(item) ? <Button view="flat-secondary" size="m" aria-label={t('folders', {name: item.name})} aria-expanded={!empty && itemExpanded(item)} disabled={empty} onClick={event => {
        if (!activeCloud(item)) { toggleCachedExpanded(item); if (event.detail > 0) event.currentTarget.blur(); return; }
        if (expanded.has(item.id)) expanded.delete(item.id);
        else { expanded.add(item.id); if (!item.folders.length) queueFolderScan(item.id); }
        if (event.detail > 0) event.currentTarget.blur();
        rememberExpanded(item.id); save(true); render();
      }}><Icon data={!empty && itemExpanded(item) ? ChevronDown : ChevronRight} size={16}/></Button> : <span className="ycp-disclosure-space"/>)}
      {item.type === 'folder' && <span className="ycp-indent"/>}
      <span className="ycp-item-icon" data-ycp-tooltip={draggable ? t('dragCloud') : undefined} style={{color: itemColor(item, parent)}}><Icon data={item.type === 'cloud' ? (cloudFoldersEnabled(item) ? Cloud : cloudIcons[itemIconName(item)]) : folderIcons[itemIconName(item, parent)]} size={16}/><ActiveDot active={item.type === 'cloud' && activeCloud(item) && currentCloud()?.id === item.id}/></span>
      <a className="ycp-link" draggable={draggable ? false : undefined} href={safeHref(item)} role={!activeCloud(item) && cloudFederation(item) === null ? 'button' : undefined} tabIndex={!activeCloud(item) && cloudFederation(item) === null ? 0 : undefined} onKeyDown={event => {
        if (!activeCloud(item) && cloudFederation(item) === null && ['Enter', ' '].includes(event.key)) { event.preventDefault(); void navigateCached({button: 0, preventDefault() {}}, item); }
      }} onClick={event => navigateCached(event, item)} data-ycp-tooltip={`${item.name}\n${item.id}${activeCloud(item) ? '' : `\n${t(cloudFederation(item) === null ? 'switchPassport' : 'cachedFederation')}`}`} aria-current={current ? 'page' : undefined}>
        <Text variant="body-1">{display(item, parent)}</Text>
      </a>
      {item.type === 'cloud' && <Button className="ycp-row-action" view="flat-secondary" size="m" aria-label={t(cloudSettings(item).mine.includes(item.id) ? 'remove' : 'add')} data-ycp-tooltip={t(cloudSettings(item).mine.includes(item.id) ? 'remove' : 'add')} onClick={() => toggleMine(item)}><Icon data={cloudSettings(item).mine.includes(item.id) ? CircleMinus : CirclePlus} size={16}/></Button>}
      {item.type === 'folder' && <span/>}
      <Button className="ycp-row-action" view="flat-secondary" size="m" aria-label={t('customize', {name: item.name})} aria-expanded={edit?.key === `${item.type}:${item.id}` && edit?.federationId === cloudFederation(item)} data-ycp-tooltip={t(item.type === 'folder' ? 'customizeFolderTitle' : 'customizeTitle')} onClick={() => customize(item, parent)}><Icon data={Ellipsis} size={16}/></Button>
    </div>;
  }
  function EditActions({measurement = false}) {
    return <div className="ycp-actions">
      <Button size="s" view="action" type={measurement ? 'button' : 'submit'} tabIndex={measurement ? -1 : undefined}><Icon data={FloppyDisk} size={16}/>{t('save')}</Button>
      <Button size="s" view="outlined-utility" tabIndex={measurement ? -1 : undefined} onClick={measurement ? undefined : () => { saveCustomization(null); }}><Icon data={ArrowRotateLeft} size={16}/>{t('auto')}</Button>
      <Button size="s" view="flat-secondary" tabIndex={measurement ? -1 : undefined} onClick={measurement ? undefined : () => { edit = null; render(); }}><Icon data={Xmark} size={16}/>{t('cancel')}</Button>
    </div>;
  }
  function Panel() {
    React.useLayoutEffect(() => {
      const request = reorderFocus;
      if (!request) return;
      reorderFocus = null;
      if (request.key !== key || !orderingAvailable()) return;
      [...shadow.querySelectorAll('.ycp-group')].find(group => group.dataset.cloudId === request.id)?.querySelector('.ycp-cloud')?.focus();
    });
    const measureRef = React.useRef(null);
    React.useLayoutEffect(() => {
      const row = measureRef.current;
      if (!row) return;
      const measure = () => {
        const borders = aside ? getComputedStyle(aside) : null;
        const next = Math.min(440, Math.ceil(row.getBoundingClientRect().width + 24 +
          (parseFloat(borders?.borderLeftWidth) || 0) + (parseFloat(borders?.borderRightWidth) || 0)));
        if (next > 0 && next !== minimumWidth) { minimumWidth = next; applyWidth(); render(); }
      };
      measure();
      const resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(row);
      return () => resizeObserver.disconnect();
    }, []);
    const theme = document.body.className.match(/g-root_theme_(light-hc|dark-hc|light|dark)(?:\s|$)/)?.[1] || 'light';
    const currentClouds = scopedClouds();
    const allModern = !groupedOrganizations() && state.showAllModern && organization && scanReady && currentClouds.length > 0 && currentClouds.length < 10;
    const mine = allModern ? currentClouds : movableClouds();
    const grouped = groupedOrganizations();
    const editIcons = edit?.type === 'cloud' ? cloudIcons : folderIcons;
    const groups = grouped ? organizationGroups() : [{id: organizationGroupKey(organization?.id), name: organization?.name, clouds: mine}];
    const cached = cachedGroups();
    const passportGroups = personalMode();
    const hideActiveOrganization = hideOrganizationLevel(federationId);
    const folderNames = new Intl.Collator(consoleLanguage(), {sensitivity: 'base', numeric: true});
    return <ThemeProvider theme={theme} scoped lang={consoleLanguage()} rootClassName="ycp-root"><div className="ycp-layout" style={themeOverrides} data-all-open={allOpen || undefined} data-edit-open={Boolean(edit) || undefined} data-compact={compactDensity || undefined}>
      {native ? (() => {
        const button = <ThemeProvider theme={theme} scoped lang={consoleLanguage()}><span style={themeOverrides}><Button view="flat-secondary" size="m" data-ycp-tooltip={t('back')} aria-label={t('back')} onClick={() => { native = false; setNativeVisibility(); render(); }}><Icon data={ArrowLeft} size={16}/></Button></span></ThemeProvider>;
        return nativeReturnTarget ? createPortal(button, nativeReturnTarget) : <div className="ycp-native-fallback">{button}</div>;
      })() : <>
        <div className="ycp-header"><div className="ycp-heading"><Text variant="subheader-1">{t(allModern ? 'all' : 'mine')}</Text>{!grouped && !federationId && !passportGroups && organization && <div className="ycp-heading-organization">
          <span className="ycp-group-icon" style={{color: groupColor(state.appearance)}}><Icon data={Briefcase} size={12}/><ActiveDot active/></span>
          <Text className="ycp-organization" variant="caption-2" color="secondary" data-ycp-tooltip={organization.name}>{state.appearance?.label || organization.name}</Text>
          <GroupAction type="organization" name={organization.name}/>
        </div>}</div>
          {!grouped && organization && scanReady && currentClouds.length > 0 && currentClouds.length < 10 && <Button view="flat-secondary" size="m" selected={Boolean(allModern)} aria-pressed={Boolean(allModern)} data-ycp-tooltip={t(allModern ? 'showMyClouds' : 'showAllModern')} aria-label={t(allModern ? 'showMyClouds' : 'showAllModern')} onClick={() => { clearCloudDrag(); state.showAllModern = !allModern; save(); render(); }}><Icon data={allModern ? Clouds : Cloud} size={16}/></Button>}
          <span className="ycp-refresh" data-ycp-tooltip={(busy || statusKey !== 'cloudCount') ? `${t('refresh')}\n${t(statusKey, statusArgs)}` : t('refresh')}>
            <Button view="flat-secondary" size="m" aria-label={t('refresh')} loading={busy} onClick={refreshClouds}><Icon data={ArrowRotateRight} size={16}/></Button>
          </span>
          <Button view="flat-secondary" size="m" data-ycp-tooltip={t('native')} aria-label={t('native')} onClick={() => { clearCloudDrag(); pauseTreeScan(); native = true; setNativeVisibility(); render(); }}><Icon data={Bars} size={16}/></Button>
        </div>

        {(busy || statusKey !== 'cloudCount') && <div className="ycp-status" role="status"><Text variant="caption-2" color="secondary">{t(statusKey, statusArgs)}</Text></div>}

        <div className="ycp-reorder-status" role="status" aria-live="polite">{reorderAnnouncement}</div>
        <div className="ycp-mine" data-federated={Boolean(federationId) || undefined}>
          {legacyPreferences() && <div className="ycp-note"><Button view="outlined" size="s" onClick={importLegacyPreferences}><Icon data={PersonsLock} size={16}/>{t('importLegacy')}</Button></div>}
          {!mine.length && !cached.length && <div className="ycp-note">{t('empty')}</div>}
          {federationId && <FederationHeading id={federationId} cloudCount={mine.length}/>}
          <PassportLevel enabled={personalMode() && showPersonalOrganizations} cloudCount={mine.length}>
          {(!federationId || !collapsedOrganizations.has(federationGroupKey(federationId))) && groups.map(group => <div key={group.id} className={passportGroups ? 'ycp-organization-group ycp-passport-organization' : grouped || federationId ? 'ycp-organization-group' : undefined} data-organization-id={grouped || passportGroups ? group.id : undefined} data-organization-hidden={hideActiveOrganization || undefined}>
            {!hideActiveOrganization && (grouped || passportGroups || (federationId && group.name)) && <OrganizationHeading group={group}/>}
            {(hideActiveOrganization || !(grouped || federationId || passportGroups) || !collapsedOrganizations.has(group.id)) && group.clouds.map(cloud => {
            const folders = [...cloud.folders].sort((a, b) => folderNames.compare(display(a, cloud), display(b, cloud)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
            return <section className="ycp-group" key={cloud.id} data-cloud-id={cloud.id}>
              <Item item={cloud} draggable={!allModern}/>
              {cloudFoldersEnabled(cloud) && expanded.has(cloud.id) && !hasNoFolders(cloud.id) && <>
                {folders.map(folder => <Item key={folder.id} item={folder} parent={cloud}/>)}
              </>}
            </section>;
          })}</div>)}
          </PassportLevel>
          <CachedFederations groups={cached}/>
        </div>
        {edit && <form className="ycp-edit" onSubmit={event => { event.preventDefault(); if (!/^#[0-9a-f]{6}$/i.test(edit.color)) return; saveCustomization({label: edit.label.trim(), color: edit.color, ...(edit.iconsEnabled && Object.hasOwn(editIcons, edit.icon) ? {icon: edit.icon} : {})}); }}>
          <Text variant="caption-2">{edit.name}</Text>
          <TextInput value={edit.label} maxLength={120} controlProps={{'aria-label': t('label')}} onUpdate={value => { edit.label = value; render(); }}/>
          {Object.entries(Core.palettes).map(([name, colors]) => <div className="ycp-palette-group" key={name}>
            <div className="ycp-palette-heading"><Label theme={name === 'power' ? 'utility' : 'info'} size="xs">{t(name)}</Label></div>
            <Palette className="ycp-palette" rowClassName="ycp-palette-row" optionClassName="ycp-palette-option" multiple={false} size="m" columns={8} value={[edit.color]} aria-label={`${t('palette')}: ${t(name)}`} options={colors.map(color => ({value: color, content: <span data-ycp-tooltip={color} className="ycp-swatch" style={{backgroundColor: color}}/>}))} onUpdate={values => { if (values[0]) { edit.color = values[0]; render(); } }}/>
          </div>)}
          {edit.iconsEnabled && <div className="ycp-palette-group ycp-icons-group">
            <div className="ycp-palette-heading"><Label theme="info" size="xs">{t('icons')}</Label></div>
            <Palette className="ycp-palette ycp-icons" rowClassName="ycp-palette-row" optionClassName="ycp-palette-option" multiple={false} size="m" columns={8} value={[edit.icon]} aria-label={t('icons')} options={Object.entries(editIcons).map(([value, data]) => ({value, content: <span data-ycp-tooltip={t(`icon_${value}`)} className="ycp-icon-option" style={{color: edit.color}}><Icon data={data} size={16}/></span>}))} onUpdate={values => { if (Object.hasOwn(editIcons, values[0])) { edit.icon = values[0]; render(); } }}/>
          </div>}
          <EditActions/>
        </form>}
        <div className="ycp-toggle"><div className="ycp-all-row" onClick={() => { if (!allOpen) pauseTreeScan(); allOpen = !allOpen; setNativeVisibility(); render(); }}><Button view="flat-secondary" size="m" aria-label={t('all')} aria-expanded={allOpen}><Icon data={allOpen ? ChevronDown : ChevronRight} size={16}/></Button><span className="ycp-all-label">{t('all')}</span><Text color="secondary">{(grouped ? state.clouds.length : currentClouds.length) || ''}</Text></div></div>

      </>}
      <div ref={measureRef} className="ycp-action-measure" aria-hidden="true"><EditActions measurement/></div>
      <div className="ycp-resize" role="separator" tabIndex={0} aria-label={t('width')} aria-orientation="vertical" aria-valuemin={minimumWidth} aria-valuemax={440} aria-valuenow={panelWidth} onKeyDown={event => {
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setWidth(panelWidth + (event.key === 'ArrowRight' ? 20 : -20)); }
      }} onPointerDown={event => {
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const move = e => setWidth(e.clientX - aside.getBoundingClientRect().left);
        const stop = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', stop); handle.removeEventListener('pointercancel', stop); };
        handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop); handle.addEventListener('pointercancel', stop);
      }}/>
    </div><TooltipLayer scope={aside} style={themeOverrides}/></ThemeProvider>;
  }
  function setWidth(width) {
    state.width = Math.round(Math.max(minimumWidth, Math.min(440, innerWidth - 120, width)));
    applyWidth(); save(); rememberLayout();
  }
  function applyWidth() {
    if (!aside) return;
    const layout = aside.parentElement;
    const main = layout.querySelector(':scope > .console-dashboard-layout__wrapper');
    const reserve = main ? parseFloat(getComputedStyle(main).minWidth) || 800 : 800;
    const available = Math.max(minimumWidth, Math.min(440, layout.clientWidth - reserve));
    panelWidth = Math.max(minimumWidth, Math.min(state.width, available, 440));
    aside.style.setProperty('--ycp-width', `${panelWidth}px`);
  }
  function onResize() { applyWidth(); render(); }
  function render() { if (root && !stopped) { revealCurrentRoute(); root.render(<Panel/>); queueExpandedFolders(); scheduleScans(); } }
  function refreshTheme() {
    if (!aside) return;
    const computed = getComputedStyle(aside);
    let surface = tree, background = computed.getPropertyValue('--g-color-base-background');
    while (surface) {
      const candidate = getComputedStyle(surface).backgroundColor;
      if (candidate && candidate !== 'transparent' && candidate !== 'rgba(0, 0, 0, 0)') { background = candidate; break; }
      surface = surface.parentElement;
    }
    host?.style.setProperty('--ycp-console-background', background || '#fff');
    themeOverrides = Object.fromEntries([...computed].filter(name => name.startsWith('--g-')).map(name => [name, computed.getPropertyValue(name)]));
    const reference = tree?.querySelector('.cloud-tree-list-item__title');
    if (reference) {
      const font = getComputedStyle(reference);
      themeOverrides['--g-font-family-sans'] = font.fontFamily;
      themeOverrides['--g-text-body-font-family'] = font.fontFamily;
      themeOverrides['--g-text-body-1-font-size'] = font.fontSize;
      themeOverrides['--g-text-body-1-line-height'] = font.lineHeight;
    }
  }
  function scheduleMount() {
    if (mountQueued || stopped) return;
    mountQueued = true;
    queueMicrotask(() => { mountQueued = false; if (!stopped) mount(); });
  }
  function watchTreeLifecycle() {
    const selector = '.console-dashboard-layout__aside, .cloud-tree-list-container';
    lifecycleObserver = new MutationObserver(records => {
      const detached = tree && !tree.isConnected || host && !host.isConnected;
      const changed = records.some(record => {
        if (record.type === 'attributes') return record.target === tree || record.target === aside || record.target.matches(selector);
        if (record.target === aside) return true;
        return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(selector) || node.querySelector(selector)));
      });
      if (detached || changed) scheduleMount();
    });
    lifecycleObserver.observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['class']});
    const deadline = performance.now() + 5000;
    const poll = () => {
      mountPoll = null;
      if (stopped) return;
      mount();
      if (!host?.isConnected && performance.now() < deadline) mountPoll = setTimeout(poll, 50);
    };
    poll();
  }
  function mount() {
    const nextTree = document.querySelector('.console-dashboard-layout__aside .cloud-tree-list-container');
    if (!nextTree) {
      if (tree || host || root) {
        observer?.disconnect(); root?.unmount(); host?.remove(); root = null;
        restoreNativeTree(); aside?.removeAttribute('data-ycp-aside'); aside?.style.removeProperty('--ycp-width');
        cancelStartupWait(); invalidateScans(); scanReady = false;
        tree = null; aside = null; host = null;
      }
      return;
    }
    if (nextTree === tree && host?.isConnected) { ensureNativeReturn(); checkStartupReadiness(); return; }
    cancelStartupWait();
    observer?.disconnect(); root?.unmount(); host?.remove();
    restoreNativeTree(); aside?.removeAttribute('data-ycp-aside'); aside?.style.removeProperty('--ycp-width');
    invalidateScans(); scanReady = false;
    tree = nextTree; aside = tree.parentElement;
    clearTimeout(mountPoll); mountPoll = null;
    aside.querySelectorAll(':scope > [data-ycp-host]').forEach(node => node.remove());
    tree.querySelectorAll('.ycp-add-native, .ycp-native-return-slot').forEach(node => node.remove());
    aside.dataset.ycpAside = ''; applyWidth();
    host = document.createElement('div'); host.dataset.ycpHost = '';
    shadow = host.attachShadow({mode: 'open'});
    const style = document.createElement('style'); style.textContent = gravityCSS;
    const app = document.createElement('div'); shadow.append(style, app); aside.prepend(host);
    refreshTheme();
    root = createRoot(app);
    observer = new MutationObserver(() => {
      decorateNative();
      checkStartupReadiness();
      if (!busy && !native && !startupWaiting && !rescan && scanReady && !state.clouds.length && tree.querySelector('[data-list-item^="cloud."]')) {
        if (treeReady()) void scan();
        else { beginStartupWait(); render(); }
      }
    });
    observer.observe(tree, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'aria-busy', 'role', 'data-list-item']});
    beginStartupWait();
    setNativeVisibility(); decorateNative(); render();
  }
  function cleanup(discard = false) {
    if (discard) stopped = true;
    cancelStartupWait();
    clearTimeout(mountPoll); lifecycleObserver?.disconnect();
    clearCloudDrag();
    preferenceSync.flush(key).catch(() => {});
    stopped = true; clearInterval(timer); clearTimeout(saveTimer); observer?.disconnect(); themeObserver?.disconnect(); window.removeEventListener('resize', onResize);
    root?.unmount(); host?.remove(); restoreNativeTree();
    aside?.removeAttribute('data-ycp-aside'); aside?.style.removeProperty('--ycp-width');
    tree?.querySelectorAll('.ycp-add-native').forEach(el => el.remove());
    globalThis.__ycPower = false;
    window.removeEventListener('pagehide', onPageHide);
  }
  globalThis.browser?.storage.onChanged.addListener((changes, area) => {
    if (stopped || area !== 'local') return;
    if (changes._ycPowerReset && changes._ycPowerReset.newValue !== changes._ycPowerReset.oldValue) {
      globalThis.__ycPowerReset = true;
      try { sessionStorage.removeItem('yc-power:destination'); } catch { /* session storage can be unavailable */ }
      cleanup(true); return;
    }
    if (changes.cloudOnlyHosts) {
      const enabled = !Array.isArray(changes.cloudOnlyHosts.newValue) || !changes.cloudOnlyHosts.newValue.includes(location.origin);
      if (enabled !== foldersEnabled) { foldersEnabled = enabled; if (enabled) revealedRoute = null; edit = null; invalidateScans(); rescan = true; render(); }
    }
    if (changes[layoutKey]) {
      const next = changes[layoutKey].newValue?.groupOrder;
      const order = Array.isArray(next) ? [...new Set(next.filter(id => typeof id === 'string'))] : [];
      if (JSON.stringify(order) !== JSON.stringify(groupOrder)) { clearCloudDrag(); groupOrder = order; render(); }
    }
    if (changes.compactDensity) { compactDensity = changes.compactDensity.newValue === true; render(); }
    if (changes.hideSingleOrganization || changes.showPersonalOrganizations) {
      if (changes.hideSingleOrganization) hideSingleOrganization = changes.hideSingleOrganization.newValue === true;
      if (changes.showPersonalOrganizations) showPersonalOrganizations = changes.showPersonalOrganizations.newValue === true;
      render();
    }
    if (changes.domainHosts && !changes.domainHosts.newValue?.includes(location.origin)) { cleanup(); return; }
    let activeChanged = false, anyChanged = false;
    for (const [changedKey, change] of Object.entries(changes)) {
      const scope = Federation.parseKey(changedKey);
      const legacyPreference = changedKey.startsWith(Core.scopeKey(location.origin, null).replace(/unscoped$/, ''));
      if (!legacyPreference && (!scope || scope.origin !== location.origin || scope.kind === 'layout')) continue;
      if (preferenceSync.receive(changedKey, change.newValue)) { anyChanged = true; if (changedKey === key) activeChanged = true; }
    }
    if (activeChanged) {
      clearCloudDrag();
      state = {...defaults(), ...structuredClone(preferences[key] || {}), clouds: state.clouds};
      state.width = Math.min(440, Math.max(1, Number(state.width) || 360));
      restoreExpanded();
      applyWidth(); render();
    }
    if (anyChanged && !activeChanged) { restoreExpanded(); render(); }
    decorateNative();
  });
  async function start() {
    try {
      const storedPreferences = storage ? await storage.get(null) : {};
      if (stopped) return;
      for (const [storedKey, settings] of Object.entries(storedPreferences)) {
        if (!Object.hasOwn(preferences, storedKey)) preferenceSync.receive(storedKey, settings);
      }
      compactDensity = storedPreferences.compactDensity === true;
      hideSingleOrganization = storedPreferences.hideSingleOrganization === true;
      showPersonalOrganizations = storedPreferences.showPersonalOrganizations === true;
      foldersEnabled = !Array.isArray(storedPreferences.cloudOnlyHosts) || !storedPreferences.cloudOnlyHosts.includes(location.origin);
      const layout = storedPreferences[layoutKey];
      if (Array.isArray(layout?.groupOrder)) groupOrder = [...new Set(layout.groupOrder.filter(id => typeof id === 'string'))];
      if (Array.isArray(layout?.collapsedOrganizations)) layout.collapsedOrganizations.filter(id => typeof id === 'string').forEach(id => collapsedOrganizations.add(id));
      const prefix = scopeKey(null).replace(/unscoped$/, '');
      const visibleOrganizations = [...new Set([...document.querySelectorAll('.console-dashboard-layout__aside [data-list-item^="organization."]')].map(row => row.dataset.listItem.slice(13)))];
      const visibleKey = visibleOrganizations.length === 1 ? scopeKey(visibleOrganizations[0]) : null;
      const savedScopes = Object.keys(preferences).filter(savedKey => savedKey.startsWith(prefix));
      if (visibleKey && preferences[visibleKey]) key = visibleKey;
      else if (typeof layout?.scopeKey === 'string' && layout.scopeKey.startsWith(prefix) && preferences[layout.scopeKey]) key = layout.scopeKey;
      else if (savedScopes.length === 1) key = savedScopes[0];
      if (key.startsWith(`${prefix}id:`)) {
        try { selectedOrganizationId = decodeURIComponent(key.slice(`${prefix}id:`.length)); } catch (_) { selectedOrganizationId = null; }
      }
      state.clouds = activeCatalog();
      const stored = preferences[key];
      if (stored && Array.isArray(stored.mine)) state = {...state, ...stored, clouds: state.clouds};
      state.width = Math.min(440, Math.max(1, Number(stored?.width ?? layout?.width) || 360));
      saveFederationProfile();
    } catch (_) { /* default settings remain usable if storage is unavailable */ }
    if (stopped) return;
    window.addEventListener('pagehide', onPageHide);
    resumeDestination();
    window.addEventListener('resize', onResize);
    restoreExpanded();
    if (state.clouds.length) syncOrganization();
    watchTreeLifecycle();
    themeObserver = new MutationObserver(() => { refreshTheme(); decorateNative(); render(); });
    themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class', 'style']});
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
    timer = setInterval(() => {
      syncIdentity();
      const activeId = currentCloud()?.id || null;
      if (location.href !== lastUrl || activeId !== lastActiveCloudId) { lastUrl = location.href; lastActiveCloudId = activeId; syncOrganization(); initializeMine(); render(); decorateNative(); }
    }, 1000);
  }
  void start();
})();

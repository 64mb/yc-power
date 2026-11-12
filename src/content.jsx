import React from 'react';
import {createRoot} from 'react-dom/client';
import {createPortal} from 'react-dom';
import {Button, Icon, Label, Palette, TextInput, Text, ThemeProvider} from '@gravity-ui/uikit';
import {ArrowRotateRight, Bars, ChevronDown, ChevronRight, Ellipsis, CircleMinus, CirclePlus, Folder, Cloud, FloppyDisk, ArrowRotateLeft, Xmark, Clouds, ArrowLeft, Terminal, Server, Database, Briefcase, NodesDown, Cube, CodeFork, Cpu, ShieldCheck, Globe, Key, Rocket, Gear, HardDrive, Archive, ChartLine, Bell, Flask, Bug, PlugConnection, Layers, Clock, Code} from '@gravity-ui/icons';
import '@gravity-ui/uikit/styles/styles.css';
import './panel.css';
import Core from '../core.js';
import I18n from '../panel-i18n.js';

const gravityCSS = __YCP_GRAVITY_CSS__;
const folderIcons = {folder: Folder, terminal: Terminal, server: Server, database: Database, briefcase: Briefcase, network: NodesDown, container: Cube, git: CodeFork, cpu: Cpu, security: ShieldCheck, globe: Globe, key: Key, rocket: Rocket, settings: Gear, disk: HardDrive, archive: Archive, monitoring: ChartLine, alerts: Bell, testing: Flask, bug: Bug, connection: PlugConnection, layers: Layers, clock: Clock, code: Code};

(function () {
  'use strict';
  if (globalThis.__ycPower) return;
  globalThis.__ycPower = true;
  const storage = globalThis.browser?.storage.local;
  const defaults = () => ({mine: [], initialized: false, width: 360, custom: {}, showAllModern: false});
  let organization = null, key = Core.scopeKey(location.origin, null), preferences = {};
  const layoutKey = `yc-power:${location.origin}:layout`;
  function rememberLayout() {
    storage?.set({[layoutKey]: {scopeKey: key, width: state.width}}).catch(() => {});
  }
  const preferenceSync = Core.preferenceSync(preferences, (savedKey, snapshot) => storage?.set({[savedKey]: snapshot}));
  let state = {...defaults(), clouds: []};
  let scanReady = false, selectedOrganizationId = null;
  let nativeReturnSlot, nativeReturnTarget;
  let tree, aside, host, root, shadow, observer, themeObserver, timer, saveTimer;
  let busy = false, native = false, allOpen = false, edit = null, stopped = false;
  let statusKey = 'reading', statusArgs = {}, lastUrl = location.href, rescan = false;
  let themeOverrides = {}, panelWidth = 360, minimumWidth = 1, compactDensity = false;
  const expanded = new Set();
  let revealedRoute = null, observedRouteTransition = null;
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
      if (!(pointer.buttons & 1) || !orderingAvailable() || session.key !== key || !state.mine.includes(session.id)) { clearCloudDrag(); return; }
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
  function movableClouds() {
    const clouds = new Map(scopedClouds().map(cloud => [cloud.id, cloud]));
    return state.mine.map(id => clouds.get(id)).filter(Boolean);
  }
  function moveCloud(source, target, after, focus = false) {
    const ordered = Core.reorderMine(state.mine, source, target, after);
    clearCloudDrag();
    if (ordered === state.mine) return;
    state.mine = ordered;
    if (focus) reorderFocus = {id: source, key};
    const visible = movableClouds();
    const cloud = visible.find(cloud => cloud.id === source);
    reorderAnnouncement = t('cloudMoved', {name: cloud ? display(cloud) : source, position: visible.findIndex(cloud => cloud.id === source) + 1, count: visible.length});
    save(); render();
  }
  function orderingAvailable() {
    const count = scopedClouds().length;
    return !native && !(state.showAllModern && organization && scanReady && count > 0 && count < 10);
  }
  function acceptsCloudDrop(target) {
    const visible = movableClouds();
    return orderingAvailable() && cloudDrag?.key === key && cloudDrag.id !== target && visible.some(c => c.id === cloudDrag.id) && visible.some(c => c.id === target);
  }
  function restoreExpanded() {
    expanded.clear();
    const saved = Array.isArray(state.expandedClouds) ? state.expandedClouds : state.mine;
    saved.forEach(id => { if (typeof id === 'string') expanded.add(id); });
  }
  function rememberExpanded() { state.expandedClouds = [...expanded]; }
  function revealCurrentRoute() {
    const transition = `${key}:${location.href}`;
    if (observedRouteTransition !== transition) { observedRouteTransition = transition; revealedRoute = null; }
    if (revealedRoute === transition) return;
    const active = Core.route(location.href, location.origin);
    if (!active) { revealedRoute = transition; return; }
    const cloud = scopedClouds().find(cloud => active.type === 'cloud' ? cloud.id === active.id : cloud.id === active.cloudId || cloud.folders.some(folder => folder.id === active.id));
    if (!cloud) return;
    revealedRoute = transition;
    if (!expanded.has(cloud.id)) { expanded.add(cloud.id); rememberExpanded(); save(); }
  }
  const catalogKey = `yc-power:${location.origin}:catalog`;
  let catalogSaveTimer;
  function saveCatalog() {
    clearTimeout(catalogSaveTimer);
    const snapshot = Core.catalogCache(state.clouds, location.origin);
    catalogSaveTimer = setTimeout(() => { storage?.set({[catalogKey]: snapshot}).catch(() => {}); }, 150);
  }
  const loadedFolders = new Set(), attemptedFolders = new Set(), pendingFolders = new Map();
  let scanGeneration = 0, queueScheduled = false, activeScan = null;
  const folderKey = id => `${key}:${id}`;
  function invalidateScans() {
    clearCloudDrag();
    scanGeneration++; pendingFolders.clear(); loadedFolders.clear(); attemptedFolders.clear();
    if (busy) rescan = true;
  }
  function queueFolderScan(id, force = false) {
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
      if (busy || stopped || native || allOpen || !tree?.isConnected) return;
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
    const clouds = scopedClouds();
    const allModern = state.showAllModern && organization && scanReady && clouds.length > 0 && clouds.length < 10;
    for (const cloud of clouds) {
      if ((allModern || state.mine.includes(cloud.id)) && expanded.has(cloud.id) && !cloud.folders.length && !loadedFolders.has(folderKey(cloud.id))) queueFolderScan(cloud.id);
    }
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  function consoleLanguage() {
    return I18n.language(document.documentElement.lang, tree?.querySelector('input')?.placeholder, navigator.language);
  }
  const t = (key, params) => I18n.translate(consoleLanguage(), key, params);
  function save() {
    clearTimeout(saveTimer);
    const savedKey = key;
    const {clouds, ...settings} = state;
    preferenceSync.stage(savedKey, settings);
    saveTimer = setTimeout(() => {
      preferenceSync.flush(savedKey).catch(() => { statusKey = 'saveFailed'; render(); });
    }, 150);
  }
  function syncOrganization(adopted, initialize = true) {
    if (adopted?.id) selectedOrganizationId = adopted.id;
    const next = adopted || Core.currentOrganization(state.clouds, location.href, location.origin, selectedOrganizationId);
    const nextKey = Core.scopeKey(location.origin, next?.id);
    organization = next;
    if (nextKey === key) return;
    clearTimeout(saveTimer);
    const {clouds} = state;
    preferenceSync.flush(key).catch(() => { statusKey = 'saveFailed'; render(); });
    clearCloudDrag();
    invalidateScans();
    key = nextKey;
    state = {...defaults(), ...structuredClone(preferences[key] || {}), clouds};
    state.width = Math.min(440, Math.max(1, Number(state.width) || 360));
    edit = null; restoreExpanded();
    if (initialize) initializeMine();
    applyWidth(); rememberLayout();
  }
  function scopedClouds() {
    return state.clouds.filter(cloud => (cloud.organizationId || null) === (organization?.id || null));
  }
  function initializeMine() {
    if (state.initialized) return;
    const active = Core.route(location.href, location.origin);
    const current = scopedClouds().find(c => active && (active.type === 'cloud' ? active.id === c.id : active.cloudId === c.id || c.folders.some(f => f.id === active.id)));
    if (current) { state.mine = [current.id]; state.initialized = true; expanded.add(current.id); rememberExpanded(); save(); }
  }
  function display(item, parent) {
    return state.custom[`${item.type}:${item.id}`]?.label || Core.label(item.name, parent?.name);
  }
  function itemColor(item) {
    return state.custom[`${item.type}:${item.id}`]?.color || Core.color(item.id);
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
      return [{...item, name: a.title, offset, pinned: raw.endsWith('.pinned')}];
    }));
  }
  function collectRow(rows, row) {
    const id = `${row.type}:${row.id}:${row.pinned || false}`;
    rows.set(id, {...rows.get(id), ...row});
  }
  function cloudSettings(cloud) {
    const cloudKey = Core.scopeKey(location.origin, cloud.organizationId);
    return cloudKey === key ? state : {...defaults(), ...preferences[cloudKey]};
  }
  function decorateNative() {
    if (!tree?.isConnected) return;
    ensureNativeReturn();
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
          const item = Core.route(row.querySelector('a[href]')?.getAttribute('href'), location.origin);
          if (!item) return;
          let cloud = state.clouds.find(c => c.id === item.id);
          const annotated = readRows(tree.querySelector('.cloud-tree-list')).find(candidate => candidate.type === 'cloud' && candidate.id === item.id);
          if (!cloud) {
            cloud = {...item, ...annotated, name: row.querySelector('a').title, folders: []};
            state.clouds.push(cloud);
          } else if (annotated) Object.assign(cloud, annotated);
          if (cloud.organizationId && (!organization || !Core.currentOrganization(state.clouds, location.href, location.origin))) {
            syncOrganization({id: cloud.organizationId, name: cloud.organizationName || cloud.organizationId}, false);
          }
          native = false; allOpen = true; setNativeVisibility();
          toggleMine(cloud); render();
        });
        row.append(add);
      }
      const title = t(mine ? 'remove' : 'add');
      if (add.title !== title) {
        add.title = title; add.setAttribute('aria-label', title);
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
  async function scan(target) {
    if (busy) {
      if (target) queueFolderScan(target, true); else rescan = true;
      return;
    }
    if (stopped || !tree?.isConnected) return;
    if (native || allOpen) { rescan = true; statusKey = 'scanPaused'; render(); return; }
    const scanTree = tree, generation = scanGeneration, scanKey = key;
    const valid = () => !stopped && tree === scanTree && tree.isConnected && !native && !allOpen && generation === scanGeneration && scanKey === key;
    const list = tree.querySelector('.cloud-tree-list');
    if (!list) { if (!state.mine.length) allOpen = true; statusKey = 'scanFailed'; setNativeVisibility(); render(); return; }
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
      const confirmedEmpty = !target && !tree.querySelector('[role="progressbar"], .g-spin, [aria-busy="true"], [role="alert"]') && /no clouds|нет облаков|облака не найдены|не найдено облаков|no results|ничего не найдено/i.test(list.textContent);
      if (freshRows.some(row => row.type === 'cloud')) state.clouds = Core.catalog(freshRows, state.clouds, found ? target : undefined);
      else if (confirmedEmpty) state.clouds = [];
      saveCatalog();
      if (target && found) loadedFolders.add(folderKey(target));
      scanReady = true;
      syncOrganization(); initializeMine();
      statusKey = 'cloudCount'; statusArgs = {count: scopedClouds().length};
      if (target && !found) statusKey = 'notFound';
      if (!target) {
        for (const cloud of scopedClouds()) {
          if (state.mine.includes(cloud.id)) queueFolderScan(cloud.id, true);
        }
      }
    } catch (error) {
      if (!valid()) return;
      console.warn('YC Power: tree scan failed', error);
      statusKey = 'scanFailed'; if (!state.mine.length) allOpen = true;
    } finally {
      if (target && !valid()) attemptedFolders.delete(`${scanKey}:${target}`);
      if (!scanContext.restored && list.isConnected) list.scrollTop = originalScroll;
      if (activeScan === scanContext) activeScan = null;
      busy = false; setNativeVisibility(); render(); decorateNative();
      scheduleScans();
    }
  }
  function toggleMine(cloud) {
    if ((cloud.organizationId || null) !== (organization?.id || null)) {
      const cloudKey = Core.scopeKey(location.origin, cloud.organizationId);
      const settings = structuredClone(cloudSettings(cloud));
      const mine = settings.mine.includes(cloud.id);
      const savedExpanded = Array.isArray(settings.expandedClouds) ? settings.expandedClouds : settings.mine;
      settings.expandedClouds = mine ? savedExpanded : [...new Set([...savedExpanded, cloud.id])];
      settings.mine = mine ? settings.mine.filter(id => id !== cloud.id) : [...settings.mine, cloud.id];
      settings.initialized = true;
      preferenceSync.stage(cloudKey, settings);
      preferenceSync.flush(cloudKey).catch(() => { statusKey = 'saveFailed'; render(); });
      decorateNative();
      return;
    }
    const mine = state.mine.includes(cloud.id);
    state.mine = mine ? state.mine.filter(id => id !== cloud.id) : [...state.mine, cloud.id];
    state.initialized = true;
    if (!mine) expanded.add(cloud.id);
    rememberExpanded();
    save(); render(); decorateNative();
    if (!mine && !cloud.folders.length) queueFolderScan(cloud.id);
  }
  function folderIconName(id) {
    const icon = state.custom[`folder:${id}`]?.icon;
    return Object.hasOwn(folderIcons, icon) ? icon : 'folder';
  }
  function customize(item, parent) {
    const probe = document.createElement('span'); probe.style.color = itemColor(item); shadow.append(probe);
    const rgb = getComputedStyle(probe).color.match(/\d+/g); probe.remove();
    edit = {key: `${item.type}:${item.id}`, type: item.type, icon: folderIconName(item.id), name: item.name, label: display(item, parent), color: rgb ? `#${rgb.slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : '#246bfd'};
    render();
  }
  function safeHref(item) {
    const route = Core.route(item.href, location.origin);
    return route?.id === item.id && route.type === item.type ? route.href : undefined;
  }
  function Item({item, parent, draggable = false}) {
    const current = item.type === 'folder' && location.pathname.split('/').includes(item.id);
    return <div className={`ycp-row ycp-${item.type}`} data-current={current || undefined} draggable={false} data-reorderable={draggable || undefined} tabIndex={draggable ? 0 : undefined} role={draggable ? 'group' : undefined} aria-label={draggable ? t('reorderCloud', {name: display(item)}) : undefined} aria-keyshortcuts={draggable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined} onKeyDown={event => {
      if (!draggable || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const clouds = movableClouds();
      const index = clouds.findIndex(cloud => cloud.id === item.id);
      const next = clouds[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (next) moveCloud(item.id, next.id, event.key === 'ArrowDown', true);
    }} onPointerDown={event => { if (draggable) beginCloudDrag(event, item); }} onDragStart={draggable ? event => event.preventDefault() : undefined}>
      {item.type === 'cloud' && <Button view="flat-secondary" size="m" aria-label={t('folders', {name: item.name})} aria-expanded={expanded.has(item.id)} onClick={event => {
        if (expanded.has(item.id)) expanded.delete(item.id);
        else { expanded.add(item.id); if (!item.folders.length) queueFolderScan(item.id); }
        if (event.detail > 0) event.currentTarget.blur();
        rememberExpanded(); save(); render();
      }}><Icon data={expanded.has(item.id) ? ChevronDown : ChevronRight} size={16}/></Button>}
      {item.type === 'folder' && <span className="ycp-indent"/>}
      <span className="ycp-item-icon" title={draggable ? t('dragCloud') : undefined} style={{color: itemColor(item)}}><Icon data={item.type === 'cloud' ? Cloud : folderIcons[folderIconName(item.id)]} size={16}/></span>
      <a className="ycp-link" draggable={draggable ? false : undefined} href={safeHref(item)} title={`${item.name}\n${item.id}`} aria-current={current ? 'page' : undefined}>
        <Text variant="body-1">{display(item, parent)}</Text>
      </a>
      {item.type === 'cloud' && <Button className="ycp-row-action" view="flat-secondary" size="m" aria-label={t(state.mine.includes(item.id) ? 'remove' : 'add')} title={t(state.mine.includes(item.id) ? 'remove' : 'add')} onClick={() => toggleMine(item)}><Icon data={state.mine.includes(item.id) ? CircleMinus : CirclePlus} size={16}/></Button>}
      {item.type === 'folder' && <span/>}
      <Button className="ycp-row-action" view="flat-secondary" size="m" aria-label={t('customize', {name: item.name})} title={t(item.type === 'folder' ? 'customizeFolderTitle' : 'customizeTitle')} onClick={() => customize(item, parent)}><Icon data={Ellipsis} size={16}/></Button>
    </div>;
  }
  function EditActions({measurement = false}) {
    return <div className="ycp-actions">
      <Button size="s" view="action" type={measurement ? 'button' : 'submit'} tabIndex={measurement ? -1 : undefined}><Icon data={FloppyDisk} size={16}/>{t('save')}</Button>
      <Button size="s" view="outlined-utility" tabIndex={measurement ? -1 : undefined} onClick={measurement ? undefined : () => { delete state.custom[edit.key]; edit = null; save(); render(); }}><Icon data={ArrowRotateLeft} size={16}/>{t('auto')}</Button>
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
    const allModern = state.showAllModern && organization && scanReady && currentClouds.length > 0 && currentClouds.length < 10;
    const mine = allModern ? currentClouds : movableClouds();
    return <ThemeProvider theme={theme} scoped lang={consoleLanguage()} rootClassName="ycp-root"><div className="ycp-layout" style={themeOverrides} data-all-open={allOpen || undefined} data-edit-open={Boolean(edit) || undefined} data-compact={compactDensity || undefined}>
      {native ? (() => {
        const button = <ThemeProvider theme={theme} scoped lang={consoleLanguage()}><span style={themeOverrides}><Button view="flat-secondary" size="m" title={t('back')} aria-label={t('back')} onClick={() => { native = false; setNativeVisibility(); render(); }}><Icon data={ArrowLeft} size={16}/></Button></span></ThemeProvider>;
        return nativeReturnTarget ? createPortal(button, nativeReturnTarget) : <div className="ycp-native-fallback">{button}</div>;
      })() : <>
        <div className="ycp-header"><div className="ycp-heading"><Text variant="subheader-1">{t(allModern ? 'all' : 'mine')}</Text>{organization && <Text className="ycp-organization" variant="caption-2" color="secondary" title={organization.name}>{organization.name}</Text>}</div>
          {organization && scanReady && currentClouds.length > 0 && currentClouds.length < 10 && <Button view="flat-secondary" size="m" selected={Boolean(allModern)} aria-pressed={Boolean(allModern)} title={t(allModern ? 'showMyClouds' : 'showAllModern')} aria-label={t(allModern ? 'showMyClouds' : 'showAllModern')} onClick={() => { clearCloudDrag(); state.showAllModern = !allModern; save(); render(); }}><Icon data={allModern ? Clouds : Cloud} size={16}/></Button>}
          <Button view="flat-secondary" size="m" title={t('refresh')} aria-label={t('refresh')} loading={busy} onClick={() => void scan()}><Icon data={ArrowRotateRight} size={16}/></Button>
          <Button view="flat-secondary" size="m" title={t('native')} aria-label={t('native')} onClick={() => { clearCloudDrag(); pauseTreeScan(); native = true; setNativeVisibility(); render(); }}><Icon data={Bars} size={16}/></Button>
        </div>

        {(busy || statusKey !== 'cloudCount') && <div className="ycp-status" role="status"><Text variant="caption-2" color="secondary">{t(statusKey, statusArgs)}</Text></div>}

        <div className="ycp-reorder-status" role="status" aria-live="polite">{reorderAnnouncement}</div>
        <div className="ycp-mine">
          {!mine.length && <div className="ycp-note">{t('empty')}</div>}
          {mine.map(cloud => {
            const folders = cloud.folders;
            return <section className="ycp-group" key={cloud.id} data-cloud-id={cloud.id}>
              <Item item={cloud} draggable={!allModern}/>
              {expanded.has(cloud.id) && <>
                {folders.map(folder => <Item key={folder.id} item={folder} parent={cloud}/>)}
                {!cloud.folders.length && loadedFolders.has(folderKey(cloud.id)) && <div className="ycp-note">{t('noFolders')}</div>}
              </>}
            </section>;
          })}
        </div>
        {edit && <form className="ycp-edit" onSubmit={event => { event.preventDefault(); if (!/^#[0-9a-f]{6}$/i.test(edit.color)) return; state.custom[edit.key] = {label: edit.label.trim(), color: edit.color, ...(edit.type === 'folder' && Object.hasOwn(folderIcons, edit.icon) ? {icon: edit.icon} : {})}; edit = null; save(); render(); }}>
          <Text variant="caption-2">{edit.name}</Text>
          <TextInput value={edit.label} maxLength={120} controlProps={{'aria-label': t('label')}} onUpdate={value => { edit.label = value; render(); }}/>
          <Text variant="caption-2">{t('color')}</Text>
          {Object.entries(Core.palettes).map(([name, colors]) => <div className="ycp-palette-group" key={name}>
            <div className="ycp-palette-heading"><Label theme={name === 'power' ? 'utility' : 'info'} size="xs">{t(name)}</Label></div>
            <Palette className="ycp-palette" rowClassName="ycp-palette-row" optionClassName="ycp-palette-option" multiple={false} size="m" columns={8} value={[edit.color]} aria-label={`${t('palette')}: ${t(name)}`} options={colors.map(color => ({value: color, title: color, content: <span className="ycp-swatch" style={{backgroundColor: color}}/>}))} onUpdate={values => { if (values[0]) { edit.color = values[0]; render(); } }}/>
          </div>)}
          {edit.type === 'folder' && <div className="ycp-palette-group ycp-icons-group">
            <div className="ycp-palette-heading"><Label theme="info" size="xs">{t('icons')}</Label></div>
            <Palette className="ycp-palette ycp-icons" rowClassName="ycp-palette-row" optionClassName="ycp-palette-option" multiple={false} size="m" columns={8} value={[edit.icon]} aria-label={t('icons')} options={Object.entries(folderIcons).map(([value, data]) => ({value, title: t(`icon_${value}`), content: <span className="ycp-icon-option" style={{color: edit.color}}><Icon data={data} size={16}/></span>}))} onUpdate={values => { if (Object.hasOwn(folderIcons, values[0])) { edit.icon = values[0]; render(); } }}/>
          </div>}
          <EditActions/>
        </form>}
        <div className="ycp-toggle"><div className="ycp-all-row" onClick={() => { if (!allOpen) pauseTreeScan(); allOpen = !allOpen; setNativeVisibility(); render(); }}><Button view="flat-secondary" size="m" aria-label={t('all')} aria-expanded={allOpen}><Icon data={allOpen ? ChevronDown : ChevronRight} size={16}/></Button><span className="ycp-all-label">{t('all')}</span><Text color="secondary">{currentClouds.length || ''}</Text></div></div>

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
    </div></ThemeProvider>;
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
  function mount() {
    const nextTree = document.querySelector('.console-dashboard-layout__aside .cloud-tree-list-container');
    if (!nextTree) {
      if (host?.isConnected) {
        observer?.disconnect(); root?.unmount(); host.remove(); root = null;
        restoreNativeTree(); aside?.removeAttribute('data-ycp-aside'); aside?.style.removeProperty('--ycp-width');
        invalidateScans(); scanReady = false;
        tree = null; aside = null; host = null;
      }
      return;
    }
    if (nextTree === tree && host?.isConnected) { ensureNativeReturn(); return; }
    observer?.disconnect(); root?.unmount(); host?.remove();
    restoreNativeTree(); aside?.removeAttribute('data-ycp-aside'); aside?.style.removeProperty('--ycp-width');
    invalidateScans(); scanReady = false;
    tree = nextTree; aside = tree.parentElement;
    aside.dataset.ycpAside = ''; applyWidth();
    host = document.createElement('div'); host.dataset.ycpHost = '';
    shadow = host.attachShadow({mode: 'open'});
    const style = document.createElement('style'); style.textContent = gravityCSS;
    const app = document.createElement('div'); shadow.append(style, app); aside.prepend(host);
    refreshTheme();
    root = createRoot(app);
    observer = new MutationObserver(() => {
      decorateNative();
      if (!busy && !native && scanReady && !state.clouds.length && tree.querySelector('[data-list-item^="cloud."]')) void scan();
    });
    observer.observe(tree, {childList: true, subtree: true});
    setNativeVisibility(); decorateNative(); render();
    if (busy) rescan = true; else void scan();
  }
  function cleanup() {
    clearCloudDrag();
    preferenceSync.flush(key).catch(() => {});
    stopped = true; clearInterval(timer); clearTimeout(saveTimer); observer?.disconnect(); themeObserver?.disconnect(); window.removeEventListener('resize', onResize);
    root?.unmount(); host?.remove(); restoreNativeTree();
    aside?.removeAttribute('data-ycp-aside'); aside?.style.removeProperty('--ycp-width');
    tree?.querySelectorAll('.ycp-add-native').forEach(el => el.remove());
    globalThis.__ycPower = false;
  }
  globalThis.browser?.storage.onChanged.addListener((changes, area) => {
    if (stopped || area !== 'local') return;
    if (changes.compactDensity) { compactDensity = changes.compactDensity.newValue === true; render(); }
    if (changes.domainHosts && !changes.domainHosts.newValue?.includes(location.origin)) { cleanup(); return; }
    const prefix = `yc-power:${location.origin}:organization:`;
    let activeChanged = false;
    for (const [changedKey, change] of Object.entries(changes)) {
      if (!changedKey.startsWith(prefix)) continue;
      if (preferenceSync.receive(changedKey, change.newValue) && changedKey === key) activeChanged = true;
    }
    if (activeChanged) {
      clearCloudDrag();
      state = {...defaults(), ...structuredClone(preferences[key] || {}), clouds: state.clouds};
      state.width = Math.min(440, Math.max(1, Number(state.width) || 360));
      restoreExpanded();
      applyWidth(); render();
    }
    decorateNative();
  });
  async function start() {
    try {
      const storedPreferences = storage ? await storage.get(null) : {};
      for (const [storedKey, settings] of Object.entries(storedPreferences)) {
        if (!Object.hasOwn(preferences, storedKey)) preferenceSync.receive(storedKey, settings);
      }
      compactDensity = storedPreferences.compactDensity === true;
      const layout = storedPreferences[layoutKey];
      const prefix = `yc-power:${location.origin}:organization:`;
      const visibleOrganizations = [...new Set([...document.querySelectorAll('.console-dashboard-layout__aside [data-list-item^="organization."]')].map(row => row.dataset.listItem.slice(13)))];
      const visibleKey = visibleOrganizations.length === 1 ? Core.scopeKey(location.origin, visibleOrganizations[0]) : null;
      const savedScopes = Object.keys(preferences).filter(savedKey => savedKey.startsWith(prefix));
      if (visibleKey && preferences[visibleKey]) key = visibleKey;
      else if (typeof layout?.scopeKey === 'string' && layout.scopeKey.startsWith(prefix) && preferences[layout.scopeKey]) key = layout.scopeKey;
      else if (savedScopes.length === 1) key = savedScopes[0];
      if (key.startsWith(`${prefix}id:`)) {
        try { selectedOrganizationId = decodeURIComponent(key.slice(`${prefix}id:`.length)); } catch (_) { selectedOrganizationId = null; }
      }
      state.clouds = Core.catalogCache(storedPreferences[catalogKey], location.origin);
      const stored = preferences[key];
      if (stored && Array.isArray(stored.mine)) state = {...state, ...stored, clouds: state.clouds};
      state.width = Math.min(440, Math.max(1, Number(stored?.width ?? layout?.width) || 360));
    } catch (_) { /* default settings remain usable if storage is unavailable */ }
    window.addEventListener('resize', onResize);
    restoreExpanded();
    if (state.clouds.length) syncOrganization();
    mount();
    themeObserver = new MutationObserver(() => { refreshTheme(); decorateNative(); render(); });
    themeObserver.observe(document.body, {attributes: true, attributeFilter: ['class', 'style']});
    themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
    timer = setInterval(() => {
      mount();
      if (location.href !== lastUrl) { lastUrl = location.href; syncOrganization(); initializeMine(); render(); decorateNative(); }
    }, 1000);
  }
  void start();
})();

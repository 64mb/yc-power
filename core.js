(function (root) {
  "use strict";
  const words = name => name.split(/[-_.\s]+/u).filter(Boolean);
  const palettes = {
    power: ['#b49aff', '#64c9ff', '#6adcb1', '#f2bd56', '#ef7070', '#e69ccf', '#9da7c2', '#78dce8'],
    material: ['#00a8a1', '#7160e8', '#0273ee', '#edca28', '#e62627', '#f44336', '#e91e64', '#9d27b0', '#673ab8', '#3f51b5', '#2196f3', '#05aaf4', '#07bcd4', '#009688', '#4caf51', '#8bc44a', '#cddc39', '#ffeb3b', '#ffc106', '#ff9800', '#ff5722', '#795548', '#9e9e9e', '#607d8c'],
  };
  function label(name, parentName = "") {
    let parts = words(name);
    const clean = input => {
      const result = [...input];
      if (/^yc$/i.test(result[0] || '')) result.shift();
      while (/^(cloud|folder)$/i.test(result.at(-1) || '')) result.pop();
      return result;
    };
    const parent = clean(words(parentName).filter(p => !/^(prod|preprod)$/i.test(p)));
    parts = clean(parts);
    while (parent.length && parts.length > 1 && parts[0]?.toLowerCase() === parent[0]?.toLowerCase()) {
      parts.shift();
      parent.shift();
    }
    return parts.length ? parts.join(" · ") : name;
  }
  function color(id) {
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `hsl(${(hash >>> 0) % 360} 64% 43%)`;
  }
  function route(href, origin) {
    try {
      const url = new URL(href, origin);
      if (url.origin !== origin) return null;
      if (url.pathname === '/auth/move') {
        const params = url.searchParams;
        const regionId = params.get('targetRegionId');
        const targetPath = params.get('targetPath');
        const allowed = ['targetRegionId', 'targetService', 'targetPath'];
        if ([...params.keys()].some(key => !allowed.includes(key)) || allowed.some(key => params.getAll(key).length !== 1)) return null;
        if (params.get('targetService') !== 'console' || !/^[a-z0-9-]{1,32}$/i.test(regionId || '') || !/^\/(?:clouds?|folders)\//.test(targetPath || '')) return null;
        const target = new URL(targetPath, origin);
        if (target.origin !== origin || target.search || target.hash) return null;
        const item = route(target.pathname, origin);
        return item ? {...item, href: url.pathname + url.search, regionId} : null;
      }
      const path = url.pathname.split("/").filter(Boolean);
      if (["clouds", "cloud"].includes(path[0]) && path[1]) {
        return path[2]
          ? {type: "folder", id: path[2], cloudId: path[1], href: url.pathname}
          : {type: "cloud", id: path[1], href: url.pathname};
      }
      if (path[0] === "folders" && path[1]) return {type: "folder", id: path[1], href: url.pathname};
    } catch (_) { /* invalid links are ignored */ }
    return null;
  }
  function catalog(rows, previous = [], refreshedCloudId) {
    const seen = new Set(rows.filter(r => r.type === "cloud").map(r => r.id));
    const clouds = new Map(previous.filter(c => seen.has(c.id)).map(c => [c.id, {...c, folders: c.id === refreshedCloudId ? [] : [...(c.folders || [])]}]));
    let current;
    for (const row of [...rows].filter(r => !r.pinned).sort((a, b) => a.offset - b.offset)) {
      if (row.type === "organization") {
        if (!rows.some(item => item.organizationId)) current = null;
        continue;
      }
      if (row.type === "cloud") {
        const old = clouds.get(row.id);
        current = {...old, ...row, folders: old?.folders || []};
        if (!row.regionId) delete current.regionId;
        clouds.set(row.id, current);
      } else if (row.type === "folder") {
        const cloud = row.cloudId ? clouds.get(row.cloudId) : current;
        if (cloud && (!row.organizationId || cloud.organizationId === row.organizationId)) {
          for (const other of clouds.values()) {
            if (other.id !== cloud.id) other.folders = other.folders.filter(f => f.id !== row.id);
          }
          cloud.folders = cloud.folders.filter(f => f.id !== row.id);
          cloud.folders.push({...row, cloudId: cloud.id});
        }
      }
    }
    for (const row of rows.filter(r => r.pinned && r.type === "folder" && r.cloudId !== refreshedCloudId)) {
      const cloud = clouds.get(row.cloudId);
      if (cloud && !cloud.folders.some(f => f.id === row.id)) cloud.folders.push(row);
    }
    return [...clouds.values()];
  }
  function annotateOrganizations(rows) {
    let organization, cloudId;
    return rows.map(row => {
      if (row.type === 'organization') { organization = row; cloudId = undefined; return row; }
      if (row.pinned) return row;
      if (row.type === 'cloud') cloudId = row.id;
      return {...row, ...(organization ? {organizationId: organization.id, organizationName: organization.name || organization.id} : {}),
        ...(row.type === 'folder' && !row.cloudId && cloudId ? {cloudId} : {})};
    });
  }
  function currentOrganization(clouds, href, origin, selectedId) {
    const url = new URL(href, origin);
    const organization = url.pathname.match(/^\/organizations\/([^/]+)/)?.[1];
    if (organization) return {id: organization, name: clouds.find(c => c.organizationId === organization)?.organizationName || organization};
    const active = route(href, origin);
    const cloud = clouds.find(c => active && (active.type === 'cloud' ? c.id === active.id : c.id === active.cloudId || c.folders.some(f => f.id === active.id)));
    if (cloud?.organizationId) return {id: cloud.organizationId, name: cloud.organizationName || cloud.organizationId};
    const organizations = new Map(clouds.filter(c => c.organizationId).map(c => [c.organizationId, c.organizationName || c.organizationId]));
    const id = organizations.has(selectedId) ? selectedId : organizations.size === 1 ? organizations.keys().next().value : null;
    return id ? {id, name: organizations.get(id)} : null;
  }
  function scopeKey(origin, organizationId) {
    return `yc-power:${origin}:organization:${organizationId ? `id:${encodeURIComponent(organizationId)}` : 'unscoped'}`;
  }
  function reorderMine(ids, sourceId, targetId, after = false) {
    const sourceIndex = ids.indexOf(sourceId);
    if (sourceId === targetId || sourceIndex < 0 || !ids.includes(targetId)) return ids;
    const result = [...ids];
    result.splice(sourceIndex, 1);
    result.splice(result.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
    return result;
  }
  function preferenceSync(cache, persist) {
    const pending = new Map();
    return {
      stage(key, settings) {
        const snapshot = structuredClone(settings);
        cache[key] = snapshot;
        pending.set(key, {snapshot, dispatched: false});
      },
      receive(key, settings) {
        if (pending.has(key)) return false;
        if (JSON.stringify(cache[key]) === JSON.stringify(settings)) return false;
        if (settings === undefined) delete cache[key];
        else cache[key] = structuredClone(settings);
        return true;
      },
      flush(key) {
        const entry = pending.get(key);
        if (!entry || entry.dispatched) return Promise.resolve();
        entry.dispatched = true;
        return Promise.resolve().then(() => persist(key, entry.snapshot)).then(() => {
          if (pending.get(key) === entry) pending.delete(key);
        }, error => {
          if (pending.get(key) === entry) entry.dispatched = false;
          throw error;
        });
      },
    };
  }
  function catalogCache(value, origin) {
    if (!Array.isArray(value)) return [];
    const text = value => typeof value === "string" && value.length <= 2048 ? value : undefined;
    const item = (value, type) => {
      if (!value || !text(value.id) || !text(value.name) || !text(value.href)) return null;
      const parsed = route(value.href, origin);
      if (!parsed || parsed.type !== type || parsed.id !== value.id) return null;
      return {...parsed, name: value.name};
    };
    return value.flatMap(value => {
      const cloud = item(value, "cloud");
      if (!cloud) return [];
      const organizationId = text(value.organizationId);
      return [{...cloud, ...(organizationId ? {organizationId, organizationName: text(value.organizationName) || organizationId} : {}),
        folders: (Array.isArray(value.folders) ? value.folders : []).flatMap(value => {
          const folder = item(value, "folder");
          return folder && (!folder.cloudId || folder.cloudId === cloud.id) ? [{...folder, cloudId: cloud.id}] : [];
        })}];
    });
  }
  const api = {label, color, route, catalog, annotateOrganizations, currentOrganization, scopeKey, reorderMine, preferenceSync, catalogCache, palettes};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.YCPowerCore = api;
})(globalThis);

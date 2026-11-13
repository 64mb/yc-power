(function (root) {
  'use strict';
  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.YCPowerCore;
  const MAX_BYTES = 5 * 1024 * 1024;
  const FORMAT = 'yc-power-settings';
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  const fail = () => { throw new Error('Invalid settings file'); };
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
  const text = value => typeof value === 'string' && value.length <= 2048;
  function plain(value, depth = 0) {
    if (depth > 20) fail();
    if (value === null || typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return;
    if (!Array.isArray(value) && !record(value)) fail();
    for (const key of Object.keys(value)) {
      if (forbidden.has(key)) fail();
      plain(value[key], depth + 1);
    }
  }
  function fields(value, names) {
    if (!record(value) || Object.keys(value).some(key => !names.includes(key))) fail();
  }
  function origin(value) {
    if (!text(value) || !/^https:\/\//i.test(value)) fail();
    let url;
    try { url = new URL(value); } catch { fail(); }
    if (url.protocol !== 'https:' || url.hostname.includes('*') || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) fail();
    return url.origin;
  }
  function strings(value) {
    if (!Array.isArray(value) || value.some(item => !text(item))) fail();
    return [...value];
  }
  function width(value) {
    if (!Number.isFinite(value) || value < 1 || value > 440) fail();
    return value;
  }
  function scopedKey(key) {
    if (typeof key !== 'string') fail();
    const match = /^yc-power:(https:\/\/[^/]+):(organization:(?:unscoped|id:[^:]+)|layout|catalog)$/.exec(key);
    if (!match || origin(match[1]) !== match[1]) fail();
    if (match[2].startsWith('organization:id:')) {
      try { if (!decodeURIComponent(match[2].slice(16))) fail(); } catch { fail(); }
    }
    return {origin: match[1], kind: match[2]};
  }
  function preferences(value) {
    fields(value, ['mine', 'initialized', 'width', 'custom', 'showAllModern', 'expandedClouds']);
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (['mine', 'expandedClouds'].includes(key)) result[key] = strings(item);
      else if (['initialized', 'showAllModern'].includes(key)) {
        if (typeof item !== 'boolean') fail();
        result[key] = item;
      } else if (key === 'width') result[key] = width(item);
      else {
        if (!record(item)) fail();
        result.custom = {};
        for (const [id, custom] of Object.entries(item)) {
          if (!/^(cloud|folder):.+/.test(id)) fail();
          fields(custom, ['label', 'color', 'icon']);
          if (Object.values(custom).some(value => !text(value))) fail();
          result.custom[id] = {...custom};
        }
      }
    }
    return result;
  }
  function normalize(stored, strict) {
    if (!record(stored)) fail();
    const result = {
      domainHosts: ['https://console.yandex.cloud'], cloudOnlyHosts: [], compactDensity: false,
    };
    for (const [key, value] of Object.entries(stored)) {
      if (key === 'domainHosts' || key === 'cloudOnlyHosts') {
        result[key] = [...new Set(strings(value).map(origin))];
      } else if (key === 'compactDensity') {
        if (typeof value !== 'boolean') fail();
        result[key] = value;
      } else if (key.startsWith('yc-power:')) {
        const scope = scopedKey(key);
        if (scope.kind !== 'catalog' || strict) plain(value);
        if (scope.kind === 'layout') {
          fields(value, ['scopeKey', 'width', 'collapsedOrganizations']);
          const layout = {};
          if ('scopeKey' in value) {
            const selected = scopedKey(value.scopeKey);
            if (selected.origin !== scope.origin || !selected.kind.startsWith('organization:')) fail();
            layout.scopeKey = value.scopeKey;
          }
          if ('width' in value) layout.width = width(value.width);
          if ('collapsedOrganizations' in value) layout.collapsedOrganizations = strings(value.collapsedOrganizations);
          result[key] = layout;
        } else if (scope.kind === 'catalog') {
          if (!Array.isArray(value)) fail();
          for (const cloud of value) {
            if (!record(cloud)) fail();
            if (strict) fields(cloud, ['type', 'id', 'href', 'name', 'organizationId', 'organizationName', 'regionId', 'folders']);
            if (cloud.folders !== undefined && !Array.isArray(cloud.folders)) fail();
            for (const folder of cloud.folders || []) {
              if (!record(folder)) fail();
              if (strict) fields(folder, ['type', 'id', 'href', 'name', 'cloudId', 'regionId']);
            }
          }
          const catalog = Core.catalogCache(value, scope.origin);
          if (catalog.length !== value.length || catalog.some((cloud, index) => cloud.folders.length !== (value[index].folders || []).length)) fail();
          result[key] = catalog;
        } else result[key] = preferences(value);
      } else if (strict) fail();
    }
    return result;
  }
  function parseSettings(input) {
    if (typeof input !== 'string' || new TextEncoder().encode(input).byteLength > MAX_BYTES) fail();
    let envelope;
    try { envelope = JSON.parse(input); } catch { fail(); }
    plain(envelope);
    fields(envelope, ['format', 'version', 'settings']);
    if (envelope.format !== FORMAT || envelope.version !== 1) fail();
    return normalize(envelope.settings, true);
  }
  function exportSettings(stored) {
    const output = JSON.stringify({format: FORMAT, version: 1, settings: normalize(stored, false)}, null, 2) + '\n';
    if (new TextEncoder().encode(output).byteLength > MAX_BYTES) fail();
    return output;
  }
  const api = {exportSettings, parseSettings, MAX_BYTES};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YCPowerSettingsTransfer = api;
})(globalThis);

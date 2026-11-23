(function (root) {
  'use strict';
  const safeId = value => typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[A-Za-z0-9]/.test(value) && !/[^A-Za-z0-9_.-]/.test(value);
  const validSubjectId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/.test(value);
  function validOrigin(origin) {
    if (typeof origin !== 'string') return false;
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hostname.includes('*') && url.origin === origin;
    } catch { return false; }
  }
  function federationId(href, origin) {
    if (!validOrigin(origin) || typeof href !== 'string') return null;
    const path = href.startsWith(`${origin}/`) ? href.slice(origin.length) : href;
    const match = /^\/federations\/([^/]+)$/.exec(path);
    return match && match[0] === path && safeId(match[1]) ? match[1] : null;
  }
  function identityFromScripts(texts) {
    if (!Array.isArray(texts)) return null;
    let identity = null;
    for (const text of texts) {
      if (typeof text !== 'string' || !/^\s*window\.__DATA__\s*=/.test(text)) continue;
      identity = null;
      if (text.length > 2 * 1024 * 1024) continue;
      const match = /^\s*window\.__DATA__\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(text);
      if (!match) continue;
      let data;
      try { data = JSON.parse(match[1]); } catch { continue; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
      if (Object.keys(data).length === 0) continue;
      const user = data.user;
      if (!user || typeof user !== 'object' || Array.isArray(user)) continue;
      const passport = typeof user.uid === 'string' && /^[1-9][0-9]{0,31}$/.test(user.uid) && typeof user.id === 'string' && user.id.length > 0;
      if (!user.federationId && user.isFederated !== true && user.isLocalFederated !== true && (user.isFederated === false || passport)) {
        const name = [user.displayName, user.login].find(value => typeof value === 'string' && value.trim() && value.length <= 2048) || null;
        identity = {id: null, name};
        if (validSubjectId(user.id)) identity.subjectId = user.id;
      }
      else if (user.isFederated === true && safeId(user.federationId)) {
        const name = typeof user.federationName === 'string' && user.federationName.trim() && user.federationName.length <= 2048 ? user.federationName : user.federationId;
        identity = {id: user.federationId, name};
      }
    }
    return identity;
  }
  const profileKey = (origin, id) => `yc-power:${origin}:federation:id:${encodeURIComponent(id)}:profile`;
  const passportCatalogKey = (origin, subject) => subject ? `yc-power:${origin}:passport:id:${subject}:passport-catalog` : `yc-power:${origin}:passport-catalog`;
  const passportProfileKey = (origin, subject) => subject ? `yc-power:${origin}:passport:id:${subject}:passport-profile` : `yc-power:${origin}:passport-profile`;
  function catalogKey(origin, id = null) {
    return `yc-power:${origin}:${id === null ? '' : `federation:id:${encodeURIComponent(id)}:`}catalog`;
  }
  function scopeKey(origin, organizationId, id = null, subject = null) {
    return `yc-power:${origin}:${id === null ? (subject ? `passport:id:${subject}:` : '') : `federation:id:${encodeURIComponent(id)}:`}organization:${organizationId ? `id:${encodeURIComponent(organizationId)}` : 'unscoped'}`;
  }
  function decode(value) {
    try {
      const decoded = decodeURIComponent(value);
      return decoded && encodeURIComponent(decoded) === value ? decoded : null;
    } catch { return null; }
  }
  function parseKey(key) {
    if (typeof key !== 'string') return null;
    const passport = /^yc-power:(https:\/\/[^/]+?):passport:id:([A-Za-z0-9][A-Za-z0-9_-]{0,255}):(passport-catalog|passport-profile|organization:(?:unscoped|id:([^:]+)))$/.exec(key);
    if (passport && passport[0] === key && validOrigin(passport[1])) {
      const organizationId = passport[4] === undefined ? null : decode(passport[4]);
      if (passport[4] !== undefined && organizationId === null) return null;
      return {origin: passport[1], federationId: null, subjectId: passport[2], kind: passport[3].startsWith('organization:') ? 'organization' : passport[3], organizationId};
    }
    const match = /^yc-power:(https:\/\/[^/]+?):((?:federation:id:([^:]+):)?)(catalog|passport-catalog|passport-profile|layout|profile|organization:(?:unscoped|id:([^:]+)))$/.exec(key);
    if (!match || match[0] !== key || !validOrigin(match[1])) return null;
    const id = match[3] === undefined ? null : decode(match[3]);
    if (match[3] !== undefined && !safeId(id)) return null;
    const kind = match[4].startsWith('organization:') ? 'organization' : match[4];
    if ((id !== null && ['layout', 'passport-catalog', 'passport-profile'].includes(kind)) || (id === null && kind === 'profile')) return null;
    const organizationId = match[5] === undefined ? null : decode(match[5]);
    if (match[5] !== undefined && organizationId === null) return null;
    return {origin: match[1], federationId: id, kind, organizationId};
  }
  function catalogGroups(stored, origin, normalizeCatalog) {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
    return Object.entries(stored).flatMap(([key, value]) => {
      const scope = parseKey(key);
      if (!scope || scope.origin !== origin || !['catalog', 'passport-catalog'].includes(scope.kind) || !Array.isArray(value)) return [];
      return [{federationId: scope.federationId, ...(scope.subjectId ? {subjectId: scope.subjectId} : {}), catalog: normalizeCatalog(value, origin), key}];
    });
  }
  const identityKey = (id, value) => JSON.stringify([id, value]);
  const loginHref = (origin, id) => validOrigin(origin) && safeId(id) ? `${origin}/federations/${id}` : null;
  function passportLoginHref(origin, subjectId, redirectPath) {
    if (!validOrigin(origin) || (subjectId !== null && subjectId !== undefined && !validSubjectId(subjectId)) || typeof redirectPath !== 'string' || !redirectPath.startsWith('/') || redirectPath.startsWith('//') || /[\\\x00-\x20\x7f]/.test(redirectPath)) return null;
    const destination = new URL(redirectPath, origin);
    if (destination.origin !== origin) return null;
    return `${origin}/auth/switch?${subjectId == null ? '' : `sub=${encodeURIComponent(subjectId)}&`}redirectUrl=${encodeURIComponent(redirectPath)}`;
  }
  const api = {identityFromScripts, profileKey, passportCatalogKey, passportProfileKey, federationId, catalogKey, scopeKey, parseKey, catalogGroups, identityKey, loginHref, validSubjectId, passportLoginHref};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.YCPowerFederation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

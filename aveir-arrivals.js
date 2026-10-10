window.AVEIR_ARRIVALS = window.AVEIR_ARRIVALS || (function () {
  const AVEIR_ARRIVALS_PROJECT = 'aveir-185b9';
  const AVEIR_ARRIVALS_CACHE_KEY = 'aveir_arrivals';
  const AVEIR_ARRIVALS_MAX = 24;
  const AVEIR_ARRIVALS_EVENT = 'aveir:arrivals';

  const DOC = 'https://firestore.googleapis.com/v1/projects/' + AVEIR_ARRIVALS_PROJECT + '/databases/(default)/documents/settings/arrivals';

  let setting = { mode: 'auto', picks: [] };
  let loaded = false;

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(AVEIR_ARRIVALS_CACHE_KEY) || 'null');
      if (c && (c.mode === 'auto' || c.mode === 'manual')) setting = { mode: c.mode, picks: Array.isArray(c.picks) ? c.picks : [] };
    } catch (e) {}
  }

  function writeCache() {
    try { localStorage.setItem(AVEIR_ARRIVALS_CACHE_KEY, JSON.stringify(setting)); } catch (e) {}
  }

  function fetchLive() {
    return fetch(DOC)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const f = d && d.fields ? d.fields : null;
        if (f) {
          const mode = f.mode && f.mode.stringValue === 'manual' ? 'manual' : 'auto';
          const picks = f.picks && f.picks.arrayValue && Array.isArray(f.picks.arrayValue.values)
            ? f.picks.arrayValue.values.map(v => String(v.stringValue || '')).filter(Boolean)
            : [];
          setting = { mode, picks };
          writeCache();
        }
        loaded = true;
        try { window.dispatchEvent(new CustomEvent(AVEIR_ARRIVALS_EVENT, { detail: setting })); } catch (e) {}
        return setting;
      })
      .catch(() => { loaded = true; return setting; });
  }

  function shown(p, extra) {
    if (!p || !p.slug) return false;
    return !!(p.cover || (extra && extra[p.slug]));
  }

  function list(extra, limit) {
    const all = (window.AVEIR_CATALOG || []).filter(p => shown(p, extra));
    const cap = Math.max(1, limit || AVEIR_ARRIVALS_MAX);
    if (setting.mode === 'manual' && setting.picks.length) {
      const by = {};
      all.forEach(p => { by[p.slug] = p; });
      const picked = setting.picks.map(s => by[s]).filter(Boolean);
      if (picked.length) return picked.slice(0, cap);
    }
    return all.slice().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0)).slice(0, cap);
  }

  readCache();
  const pending = fetchLive();

  return {
    ready: pending,
    isLoaded() { return loaded; },
    mode() { return setting.mode; },
    picks() { return setting.picks.slice(); },
    hasImage: shown,
    list,
    refresh: fetchLive
  };
})();

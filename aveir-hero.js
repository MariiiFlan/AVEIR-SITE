window.AVEIR_HERO = window.AVEIR_HERO || (function () {
  const AVEIR_HERO_PROJECT = 'aveir-185b9';
  const AVEIR_HERO_CACHE_KEY = 'aveir_hero';
  const AVEIR_HERO_MAX = 12;
  const AVEIR_HERO_EVENT = 'aveir:hero';
  const AVEIR_HERO_DEFAULT_INTERVAL = 6000;
  const AVEIR_HERO_MIN_INTERVAL = 2500;
  const AVEIR_HERO_MAX_INTERVAL = 20000;

  const DOC = 'https://firestore.googleapis.com/v1/projects/' + AVEIR_HERO_PROJECT + '/databases/(default)/documents/settings/hero';

  let setting = { mode: 'auto', picks: [], intervalMs: AVEIR_HERO_DEFAULT_INTERVAL };
  let loaded = false;
  let index = 0;
  let seq = 0;
  let timer = null;
  let full = {};
  let pending = {};

  function clampInterval(n) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return AVEIR_HERO_DEFAULT_INTERVAL;
    return Math.min(AVEIR_HERO_MAX_INTERVAL, Math.max(AVEIR_HERO_MIN_INTERVAL, Math.round(v)));
  }

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(AVEIR_HERO_CACHE_KEY) || 'null');
      if (c && (c.mode === 'auto' || c.mode === 'manual')) {
        setting = {
          mode: c.mode,
          picks: Array.isArray(c.picks) ? c.picks.slice(0, AVEIR_HERO_MAX) : [],
          intervalMs: clampInterval(c.intervalMs)
        };
      }
    } catch (e) {}
  }

  function writeCache() {
    try { localStorage.setItem(AVEIR_HERO_CACHE_KEY, JSON.stringify(setting)); } catch (e) {}
  }

  function emit() {
    try { window.dispatchEvent(new CustomEvent(AVEIR_HERO_EVENT, { detail: { index, seq, setting } })); } catch (e) {}
  }

  function fetchLive() {
    return fetch(DOC)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const f = d && d.fields ? d.fields : null;
        if (f) {
          const mode = f.mode && f.mode.stringValue === 'manual' ? 'manual' : 'auto';
          const picks = f.picks && f.picks.arrayValue && Array.isArray(f.picks.arrayValue.values)
            ? f.picks.arrayValue.values.map(v => String(v.stringValue || '')).filter(Boolean).slice(0, AVEIR_HERO_MAX)
            : [];
          const raw = f.intervalMs && (f.intervalMs.doubleValue ?? f.intervalMs.integerValue);
          setting = { mode, picks, intervalMs: clampInterval(raw) };
          writeCache();
        }
        loaded = true;
        if (index >= slides().length) index = 0;
        restart();
        emit();
        return setting;
      })
      .catch(() => { loaded = true; restart(); return setting; });
  }

  function shown(p) { return !!(p && p.slug && p.cover); }

  function slides() {
    const P = window.AVEIR_PRODUCTS;
    if (!P) return [];
    const all = P.all ? P.all() : [];
    if (setting.mode === 'manual' && setting.picks.length) {
      const by = {};
      all.forEach(p => { if (p.slug) by[p.slug] = p; });
      const out = [];
      setting.picks.forEach(s => { if (by[s] && shown(by[s])) out.push(by[s]); });
      if (out.length) return out;
    }
    return (P.newest ? P.newest(1) : []).filter(shown);
  }

  function hydrate(p) {
    if (!p || !p.slug || full[p.slug] !== undefined || pending[p.slug]) return;
    const P = window.AVEIR_PRODUCTS;
    if (!P || !P.images) return;
    pending[p.slug] = true;
    P.images(p.slug).then(m => {
      const order = (p.colors || []).concat(Object.keys(m || {}));
      let hit = '';
      for (let i = 0; i < order.length && !hit; i++) if (m && m[order[i]]) hit = m[order[i]];
      full[p.slug] = hit || '';
      delete pending[p.slug];
      if (hit) emit();
    }).catch(() => { full[p.slug] = ''; delete pending[p.slug]; });
  }

  function current() {
    const s = slides();
    if (!s.length) return null;
    const p = s[index % s.length];
    hydrate(p);
    hydrate(s[(index + 1) % s.length]);
    return { product: p, img: full[p.slug] || p.cover || '', index: index % s.length, seq, count: s.length };
  }

  function step() {
    const n = slides().length;
    if (n < 2) return;
    index = (index + 1) % n;
    seq++;
    emit();
  }

  function restart() {
    if (timer) { clearInterval(timer); timer = null; }
    if (slides().length < 2) return;
    timer = setInterval(() => { if (!document.hidden) step(); }, setting.intervalMs);
  }

  function go(i) {
    const n = slides().length;
    if (!n) return;
    index = ((i % n) + n) % n;
    seq++;
    emit();
    restart();
  }

  readCache();
  fetchLive();
  window.addEventListener('aveir:catalog', () => { restart(); emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) restart(); });

  return {
    get loaded() { return loaded; },
    get setting() { return setting; },
    get event() { return AVEIR_HERO_EVENT; },
    slides,
    current,
    next: step,
    go,
    refresh: fetchLive
  };
})();

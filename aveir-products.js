window.AVEIR_PRODUCTS = window.AVEIR_PRODUCTS || (function () {
  const AVEIR_PROJECT_ID = 'aveir-185b9';
  const AVEIR_PRODUCTS_LIMIT = 300;
  const AVEIR_CACHE_KEY = 'aveir_products';
  const AVEIR_KINDS = { tees: 'TEES', hats: 'HATS', pants: 'PANTS', shorts: 'SHORTS' };
  const AVEIR_DEFAULT_SIZES = { tees: ['S', 'M', 'L', 'XL', '2XL'], hats: ['ONE SIZE'], pants: ['28', '30', '32', '34', '36', '38'], shorts: ['28', '30', '32', '34', '36', '38'] };

  const REST = 'https://firestore.googleapis.com/v1/projects/' + AVEIR_PROJECT_ID + '/databases/(default)/documents';
  let cloudItems = [];
  let loaded = false;

  function fromValue(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return Date.parse(v.timestampValue) || 0;
    if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = fromValue(f[k]); return o; }
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
    return null;
  }

  function fields(doc) {
    const o = {};
    const f = doc.fields || {};
    for (const k in f) o[k] = fromValue(f[k]);
    return o;
  }

  function shape(raw) {
    const kind = AVEIR_KINDS[raw.kind] ? raw.kind : 'tees';
    const price = Number(raw.price) || 0;
    const was = Number(raw.was) || 0;
    return {
      slug: String(raw.slug || ''),
      name: String(raw.name || '').toUpperCase(),
      kind,
      cat: String(raw.cat || AVEIR_KINDS[kind]).toUpperCase(),
      price,
      was: was > price ? was : price,
      sizes: Array.isArray(raw.sizes) && raw.sizes.length ? raw.sizes.map(String) : AVEIR_DEFAULT_SIZES[kind],
      colors: Array.isArray(raw.colors) ? raw.colors.map(c => String(c).toLowerCase()) : [],
      cover: String(raw.cover || ''),
      desc: String(raw.desc || ''),
      createdAt: Number(raw.createdAt) || 0,
      href: 'item/?p=' + encodeURIComponent(String(raw.slug || '')),
      cloud: true
    };
  }

  function normalizeCode(p) {
    if (!p.kind) p.kind = 'tees';
    if (!p.href) p.href = p.kind + '/' + p.slug + '/';
    if (!p.sizes) p.sizes = AVEIR_DEFAULT_SIZES[p.kind] || AVEIR_DEFAULT_SIZES.tees;
    if (!p.createdAt) p.createdAt = 0;
    return p;
  }

  function merge() {
    const list = window.AVEIR_CATALOG || (window.AVEIR_CATALOG = []);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].cloud) list.splice(i, 1);
    list.forEach(normalizeCode);
    const taken = {};
    list.forEach(p => { taken[p.slug] = true; });
    cloudItems.forEach(p => { if (p.slug && !taken[p.slug]) { list.push(p); taken[p.slug] = true; } });
    if (window.AVEIR_STORE && window.AVEIR_STORE.catalog !== list) window.AVEIR_STORE.catalog = list;
    try { window.dispatchEvent(new CustomEvent('aveir:catalog', { detail: { count: cloudItems.length } })); } catch (e) {}
  }

  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(AVEIR_CACHE_KEY) || 'null');
      if (c && Array.isArray(c.items)) cloudItems = c.items.map(shape).filter(p => p.slug);
    } catch (e) {}
  }

  function writeCache(items) {
    try { localStorage.setItem(AVEIR_CACHE_KEY, JSON.stringify({ at: Date.now(), items })); } catch (e) {}
  }

  function fetchLive() {
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'products' }],
        where: { fieldFilter: { field: { fieldPath: 'live' }, op: 'EQUAL', value: { booleanValue: true } } },
        limit: AVEIR_PRODUCTS_LIMIT
      }
    };
    return fetch(REST + ':runQuery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json())
      .then(rows => {
        if (!Array.isArray(rows)) throw new Error('bad products response');
        const items = rows.filter(r => r.document).map(r => Object.assign(fields(r.document), { slug: r.document.name.split('/').pop() }));
        items.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
        cloudItems = items.map(shape).filter(p => p.slug);
        writeCache(items);
        loaded = true;
        merge();
        return cloudItems;
      })
      .catch(() => cloudItems);
  }

  const imagePending = {};
  const imageReady = {};

  function fetchImages(slug) {
    if (imagePending[slug]) return imagePending[slug];
    imagePending[slug] = fetch(REST + '/productImages/' + encodeURIComponent(slug))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const raw = d && d.fields && d.fields.images ? fromValue(d.fields.images) : {};
        const out = {};
        for (const k in raw) if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k];
        imageReady[slug] = out;
        return out;
      })
      .catch(() => { imageReady[slug] = {}; return {}; });
    return imagePending[slug];
  }

  readCache();
  merge();
  const pending = fetchLive();

  return {
    kinds: AVEIR_KINDS,
    defaultSizes: AVEIR_DEFAULT_SIZES,
    ready: pending,
    isLoaded() { return loaded; },
    all() { return window.AVEIR_CATALOG || []; },
    byKind(kind) { return (window.AVEIR_CATALOG || []).filter(p => (p.kind || 'tees') === kind); },
    find(slug) { return (window.AVEIR_CATALOG || []).find(p => p.slug === slug) || null; },
    newest(n) {
      const list = (window.AVEIR_CATALOG || []).slice();
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      return list.slice(0, n || 4);
    },
    href(p, base) { return (base || '') + (p.href || (p.kind || 'tees') + '/' + p.slug + '/'); },
    image(p, color) {
      if (!p) return '';
      const m = imageReady[p.slug];
      if (color && m && m[color]) return m[color];
      return p.cover || '';
    },
    images: fetchImages,
    loadedImages(slug) { return imageReady[slug] || null; },
    refresh: fetchLive
  };
})();

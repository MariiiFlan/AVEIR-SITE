const FEE_RATE = 0;
const DEFAULT_STORE_URL = 'https://aveir.us';
const ALLOWED_ORIGINS = ['https://aveir.us', 'https://www.aveir.us', 'https://mariiiflan.github.io'];
const SIZES = ['S', 'M', 'L', 'XL', '2XL'];
const MAX_QTY = 20;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEBHOOK_TOLERANCE_SECONDS = 300;
const STORE_TIMEZONE = 'America/Los_Angeles';
const PRODUCTS_CACHE_MS = 30000;
const PRODUCTS_LIMIT = 300;
let googleToken = null;
let productsCache = null;

function originOf(url) {
  try { return new URL(url).origin; } catch (e) { return ''; }
}

function cors(res, origin) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  res.headers.set('Vary', 'Origin');
  return res;
}

function json(body, status, origin) {
  return cors(Response.json(body, { status: status || 200 }), origin);
}

async function loadStore(env) {
  const base = env.STORE_URL || DEFAULT_STORE_URL;
  const r = await fetch(base + '/catalog.js', { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!r.ok) throw new Error('catalog unavailable');
  const text = await r.text();
  const m = text.match(/AVEIR_STORE\s*=\s*(\{[\s\S]*?\});/);
  if (!m) throw new Error('catalog unreadable');
  const store = JSON.parse(m[1]);
  const taken = {};
  (store.catalog || []).forEach(p => { p.kind = p.kind || 'tees'; taken[p.slug] = true; });
  (await loadProducts(env)).forEach(p => { if (!taken[p.slug]) store.catalog.push(p); });
  return store;
}

async function loadProducts(env) {
  if (productsCache && productsCache.at > Date.now() - PRODUCTS_CACHE_MS) return productsCache.items;
  const q = { structuredQuery: { from: [{ collectionId: 'products' }], where: { fieldFilter: { field: { fieldPath: 'live' }, op: 'EQUAL', value: { booleanValue: true } } }, limit: PRODUCTS_LIMIT } };
  const r = await firestore(env, 'POST', ':runQuery', q);
  if (!r.ok || !Array.isArray(r.body)) throw new Error('products unavailable');
  const items = r.body.filter(x => x.document).map(x => {
    const f = x.document.fields || {};
    const d = {};
    for (const k in f) d[k] = fromValue(f[k]);
    const price = Number(d.price) || 0;
    const was = Number(d.was) || 0;
    return {
      slug: x.document.name.split('/').pop(),
      name: String(d.name || '').toUpperCase(),
      kind: d.kind || 'tees',
      price,
      was: was > price ? was : price,
      sizes: Array.isArray(d.sizes) && d.sizes.length ? d.sizes.map(String) : SIZES,
      colors: Array.isArray(d.colors) ? d.colors.map(c => String(c).toLowerCase()) : [],
      cover: String(d.cover || ''),
      cloud: true
    };
  }).filter(p => p.slug && p.price > 0);
  productsCache = { at: Date.now(), items };
  return items;
}

async function stripe(env, method, path, params) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params ? params : undefined
  });
  return r.json();
}

function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function serviceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('firebase not configured');
  return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
}

async function accessToken(env) {
  if (googleToken && googleToken.exp > Date.now() + 60000) return googleToken.value;
  const sa = serviceAccount(env);
  const iat = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claim)));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + b64url(sig) })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('google auth failed');
  googleToken = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return googleToken.value;
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

function toFields(obj) {
  const out = {};
  for (const k in obj) out[k] = toValue(obj[k]);
  return out;
}

function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = fromValue(f[k]); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}

async function firestore(env, method, path, body) {
  const sa = serviceAccount(env);
  const base = 'https://firestore.googleapis.com/v1/projects/' + sa.project_id + '/databases/(default)/documents';
  const r = await fetch(base + (path.charAt(0) === ':' ? '' : '/') + path, {
    method,
    headers: { 'Authorization': 'Bearer ' + await accessToken(env), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

function stamp(d) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIMEZONE, year: 'numeric', month: 'numeric', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return MONTHS[Number(p.month) - 1] + ' ' + p.day + ', ' + p.year + ' - ' + p.hour + ':' + p.minute;
}

async function markPaid(env, sessionId, paymentId, amountTotal) {
  const got = await firestore(env, 'GET', 'orders/' + sessionId);
  if (!got.ok) return null;
  const fields = got.body.fields || {};
  const number = fields.number ? fromValue(fields.number) : '';
  if (fromValue(fields.status || { stringValue: '' }) !== 'PENDING') return number;
  const patch = { status: 'NEW', txn: paymentId || sessionId, total: amountTotal / 100, paidAt: new Date() };
  const done = await firestore(env, 'POST', ':commit', {
    writes: [{ update: { name: got.body.name, fields: toFields(patch) }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: got.body.updateTime } }]
  });
  if (!done.ok && done.status !== 400 && done.status !== 409) throw new Error('could not mark paid');
  return number;
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function handleWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('webhook not configured', { status: 500 });
  const raw = await request.text();
  const header = request.headers.get('Stripe-Signature') || '';
  const parts = {};
  header.split(',').forEach(p => { const i = p.indexOf('='); const k = p.slice(0, i); (parts[k] = parts[k] || []).push(p.slice(i + 1)); });
  const t = (parts.t || [])[0];
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > WEBHOOK_TOLERANCE_SECONDS) return new Response('bad timestamp', { status: 400 });
  const expected = await hmacHex(env.STRIPE_WEBHOOK_SECRET, t + '.' + raw);
  if (!(parts.v1 || []).some(v => safeEqual(v, expected))) return new Response('bad signature', { status: 400 });
  const event = JSON.parse(raw);
  const obj = event.data && event.data.object;
  if (obj && (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') && obj.payment_status === 'paid') {
    await markPaid(env, obj.id, obj.payment_intent, obj.amount_total || 0);
  }
  return new Response('ok');
}

function countryCode(v) {
  const c = String(v || '').trim().toUpperCase();
  if (!c || ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(c)) return 'US';
  if (/^[A-Z]{2}$/.test(c)) return c;
  return '';
}

async function createSession(request, env, origin) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400, origin); }
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return json({ error: 'no items' }, 400, origin);
  if (!ALLOWED_ORIGINS.includes(originOf(b.success_url)) || !ALLOWED_ORIGINS.includes(originOf(b.cancel_url))) return json({ error: 'bad return url' }, 400, origin);
  if (!env.STRIPE_SECRET_KEY || !env.CONNECTED_ACCOUNT_ID) return json({ error: 'payments not configured' }, 503, origin);

  let store;
  try { store = await loadStore(env); } catch (e) { return json({ error: 'store unavailable' }, 502, origin); }
  const bySlug = {};
  (store.catalog || []).forEach(p => { bySlug[p.slug] = p; });
  const promos = store.promos || {};
  const code = String(b.promo || '').trim().toUpperCase();
  const rate = promos[code] || 0;

  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('managed_payments[enabled]', 'false');
  p.set('success_url', b.success_url);
  p.set('cancel_url', b.cancel_url);
  if (b.email && String(b.email).indexOf('@') > 0) p.set('customer_email', String(b.email).slice(0, 200));

  let i = 0, subC = 0, afterC = 0;
  const summary = [];
  const lines = [];
  for (const it of b.items) {
    const prod = bySlug[it.slug];
    if (!prod) return json({ error: 'unknown item' }, 400, origin);
    const qty = Math.round(Number(it.qty));
    if (!(qty >= 1 && qty <= MAX_QTY)) return json({ error: 'bad quantity' }, 400, origin);
    const allowedSizes = (prod.sizes && prod.sizes.length ? prod.sizes : SIZES).map(z => String(z).toUpperCase());
    const size = allowedSizes.includes(String(it.size || '').toUpperCase()) ? String(it.size).toUpperCase() : '';
    if (!size) return json({ error: 'bad size' }, 400, origin);
    const color = String(it.color || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);
    if (prod.cloud && prod.colors.length && !prod.colors.includes(color)) return json({ error: 'bad color' }, 400, origin);
    const unit = Math.round(prod.price * 100);
    const unitAfter = Math.round(prod.price * 100 * (1 - rate));
    subC += unit * qty;
    afterC += unitAfter * qty;
    const label = prod.name + (size || color ? ' (' + [size, color.toUpperCase()].filter(Boolean).join(' / ') + ')' : '');
    summary.push(label + ' x' + qty);
    const img = prod.cloud ? (prod.cover || '') : (color ? '../tees/' + prod.slug + '/' + color + '.png' : '');
    lines.push({ name: prod.name, variant: [size ? 'SIZE ' + size : '', color.toUpperCase()].filter(Boolean).join(' / '), qty: 'x' + qty, img });
    p.set(`line_items[${i}][quantity]`, String(qty));
    p.set(`line_items[${i}][price_data][currency]`, 'usd');
    p.set(`line_items[${i}][price_data][unit_amount]`, String(unitAfter));
    p.set(`line_items[${i}][price_data][product_data][name]`, (label + (rate ? ' - ' + code : '')).slice(0, 120));
    i++;
  }

  const ships = store.shipping || [];
  const ship = ships.find(o => o.id === b.ship) || ships[0];
  if (!ship) return json({ error: 'no shipping' }, 400, origin);
  const freeOver = store.freeShippingOver ?? 100;
  const shipC = (ship.id === 'std' && subC >= freeOver * 100) ? 0 : Math.round(ship.price * 100);
  const addr = b.address || {};
  const st = String(addr.state || '').trim().toUpperCase();
  const taxes = store.tax || {};
  const taxRate = taxes[st] ?? taxes.default ?? 0;
  const taxC = Math.round(afterC * taxRate);

  for (const extra of [['SHIPPING - ' + ship.name, shipC], ['SALES TAX', taxC]]) {
    if (extra[1] > 0) {
      p.set(`line_items[${i}][quantity]`, '1');
      p.set(`line_items[${i}][price_data][currency]`, 'usd');
      p.set(`line_items[${i}][price_data][unit_amount]`, String(extra[1]));
      p.set(`line_items[${i}][price_data][product_data][name]`, extra[0]);
      i++;
    }
  }

  const total = afterC + shipC + taxC;
  const feeC = Math.round(total * FEE_RATE);
  if (feeC > 0) p.set('payment_intent_data[application_fee_amount]', String(feeC));
  p.set('payment_intent_data[transfer_data][destination]', env.CONNECTED_ACCOUNT_ID);

  const name = String(b.name || '').slice(0, 100);
  const cc = countryCode(addr.country);
  if (name && addr.line1 && cc) {
    p.set('payment_intent_data[shipping][name]', name);
    if (b.phone) p.set('payment_intent_data[shipping][phone]', String(b.phone).slice(0, 30));
    p.set('payment_intent_data[shipping][address][line1]', String(addr.line1).slice(0, 200));
    if (addr.line2) p.set('payment_intent_data[shipping][address][line2]', String(addr.line2).slice(0, 200));
    p.set('payment_intent_data[shipping][address][city]', String(addr.city || '').slice(0, 100));
    p.set('payment_intent_data[shipping][address][state]', st.slice(0, 50));
    p.set('payment_intent_data[shipping][address][postal_code]', String(addr.postal_code || '').slice(0, 20));
    p.set('payment_intent_data[shipping][address][country]', cc);
  }
  const meta = { items: summary.join(' | ').slice(0, 500), shipping: ship.name, promo: code && rate ? code : '', state: st };
  for (const k in meta) {
    p.set(`metadata[${k}]`, meta[k]);
    p.set(`payment_intent_data[metadata][${k}]`, meta[k]);
  }

  const j = await stripe(env, 'POST', 'checkout/sessions', p);
  if (j.error) return json({ error: j.error.message }, 400, origin);

  const when = new Date();
  const order = {
    number: '#AVR-' + when.getTime().toString(36).toUpperCase().slice(-6),
    createdAt: when,
    placed: stamp(when),
    status: 'PENDING',
    name: name.toUpperCase(),
    line1: (String(addr.line1 || '') + (addr.line2 ? ', ' + addr.line2 : '')).toUpperCase().slice(0, 200),
    line2: (String(addr.city || '') + ', ' + st + ' ' + String(addr.postal_code || '')).toUpperCase().slice(0, 200),
    country: String(addr.country || '').toUpperCase().slice(0, 60),
    email: String(b.email || '').toLowerCase().slice(0, 200),
    phone: String(b.phone || '-').slice(0, 30),
    shipId: ship.id,
    shipMethod: ship.name + ' - ' + (shipC === 0 ? 'FREE' : '$' + (shipC / 100).toFixed(2)),
    tracking: 'NO TRACKING YET',
    payMethod: 'STRIPE',
    txn: '',
    items: lines,
    total: total / 100,
    tax: taxC / 100,
    promo: code && rate ? code : ''
  };
  try {
    const saved = await firestore(env, 'POST', 'orders?documentId=' + encodeURIComponent(j.id), { fields: toFields(order) });
    if (!saved.ok) return json({ error: 'could not save order' }, 502, origin);
  } catch (e) {
    return json({ error: 'could not save order' }, 502, origin);
  }
  return json({ url: j.url }, 200, origin);
}

async function verifySession(url, env, origin) {
  const id = url.searchParams.get('session_id') || '';
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ paid: false }, 400, origin);
  const j = await stripe(env, 'GET', 'checkout/sessions/' + id);
  if (j.error) return json({ paid: false }, 404, origin);
  const paid = j.payment_status === 'paid';
  let number = '';
  if (paid) {
    try { number = await markPaid(env, id, j.payment_intent, j.amount_total || 0) || ''; } catch (e) {}
  }
  return json({ paid, total: (j.amount_total || 0) / 100, number }, 200, origin);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/webhook') return handleWebhook(request, env);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
    if (request.method === 'GET') return verifySession(url, env, origin);
    if (request.method === 'POST') return createSession(request, env, origin);
    return json({ error: 'method not allowed' }, 405, origin);
  }
};

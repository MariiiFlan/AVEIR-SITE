import { firestore, getDoc, fromDoc, toFields } from './db.js';
import { lookupPromo, consumePromo, cleanCode, isOwnerCode } from './promos.js';
import { sendReceipt, renderReceipt, imgUrlFor, receiptUrlFor, randomKey } from './receipts.js';
import { handleJoin } from './welcome.js';
import { verifyStaff } from './staff.js';

const FEE_RATE = 0.05;
const STRIPE_PCT = 0.029;
const STRIPE_FLAT = 30;
const STRIPE_INTL_PCT = 0.015;
const STRIPE_FX_PCT = 0.01;
const TAX_FLAT = 100;
const STRIPE_MIN_TOTAL = 50;
const DEFAULT_STORE_URL = 'https://aveir.us';
const ALLOWED_ORIGINS = ['https://aveir.us', 'https://www.aveir.us', 'https://mariiiflan.github.io'];
const SIZES = ['S', 'M', 'L', 'XL', '2XL'];
const MAX_QTY = 20;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEBHOOK_TOLERANCE_SECONDS = 300;
const STORE_TIMEZONE = 'America/Los_Angeles';
const PRODUCTS_CACHE_MS = 30000;
const PRODUCTS_LIMIT = 300;
const STRIPE_RETRIES = 2;
const IMG_CACHE_SECONDS = 86400;
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
  const cloud = await loadProducts(env);
  const live = {};
  cloud.forEach(p => { if (p.slug) live[p.slug] = true; });
  store.catalog = (store.catalog || []).filter(p => !live[p.slug]);
  store.catalog.forEach(p => { p.kind = p.kind || 'tees'; });
  cloud.forEach(p => store.catalog.push(p));
  return store;
}

async function loadProducts(env) {
  if (productsCache && productsCache.at > Date.now() - PRODUCTS_CACHE_MS) return productsCache.items;
  const q = { structuredQuery: { from: [{ collectionId: 'products' }], where: { fieldFilter: { field: { fieldPath: 'live' }, op: 'EQUAL', value: { booleanValue: true } } }, limit: PRODUCTS_LIMIT } };
  const r = await firestore(env, 'POST', ':runQuery', q);
  if (!r.ok || !Array.isArray(r.body)) throw new Error('products unavailable');
  const items = r.body.filter(x => x.document).map(x => {
    const d = fromDoc(x.document);
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
      soldOut: d.soldOut === true,
      soldSizes: Array.isArray(d.soldSizes) ? d.soldSizes.map(z => String(z).toUpperCase()) : [],
      cloud: true
    };
  }).filter(p => p.slug && p.price > 0);
  productsCache = { at: Date.now(), items };
  return items;
}

async function stripe(env, method, path, params, tries) {
  const left = tries === undefined ? STRIPE_RETRIES : tries;
  try {
    const r = await fetch('https://api.stripe.com/v1/' + path, {
      method,
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params ? params : undefined
    });
    if (r.status >= 500 && left > 0) return stripe(env, method, path, params, left - 1);
    return r.json();
  } catch (e) {
    if (left > 0) return stripe(env, method, path, params, left - 1);
    throw e;
  }
}

function stamp(d) {
  const p = {};
  new Intl.DateTimeFormat('en-US', { timeZone: STORE_TIMEZONE, year: 'numeric', month: 'numeric', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  return MONTHS[Number(p.month) - 1] + ' ' + p.day + ', ' + p.year + ' - ' + p.hour + ':' + p.minute;
}

async function markPaid(env, sessionId, paymentId, amountTotal, ctx) {
  const got = await getDoc(env, 'orders/' + sessionId);
  if (!got) return null;
  const order = got.data;
  const number = order.number || '';
  if (order.status !== 'PENDING') return number;
  const patch = { status: 'NEW', txn: paymentId || sessionId, total: amountTotal / 100, paidAt: new Date() };
  const done = await firestore(env, 'POST', ':commit', {
    writes: [{ update: { name: got.name, fields: toFields(patch) }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: got.updateTime } }]
  });
  if (!done.ok && done.status !== 400 && done.status !== 409) throw new Error('could not mark paid');
  if (!done.ok) return number;
  Object.assign(order, patch);
  const after = (async () => {
    if (order.promoCloud === true && order.promo) { try { await consumePromo(env, order.promo, number); } catch (e) {} }
    try { await sendReceipt(env, sessionId, order, workerBase(env)); } catch (e) {}
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(after); else await after;
  return number;
}

function workerBase(env) {
  return (env.WORKER_URL || '').replace(/\/$/, '');
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

async function handleWebhook(request, env, ctx) {
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
    await markPaid(env, obj.id, obj.payment_intent, obj.amount_total || 0, ctx);
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
  const code = cleanCode(b.promo);
  let rate = (code && promos[code]) || 0;
  let owner = false;
  let promoCloud = false;
  if (code && !rate) {
    if (isOwnerCode(env, code)) { rate = 1; owner = true; }
    else {
      const found = await lookupPromo(env, code);
      if (found) { rate = found.rate; promoCloud = true; }
    }
  }
  if (code && !rate) return json({ error: 'that code is not valid anymore' }, 400, origin);

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
    if (prod.soldOut === true) return json({ error: 'sold out', slug: it.slug }, 409, origin);
    const qty = Math.round(Number(it.qty));
    if (!(qty >= 1 && qty <= MAX_QTY)) return json({ error: 'bad quantity' }, 400, origin);
    const allowedSizes = (prod.sizes && prod.sizes.length ? prod.sizes : SIZES).map(z => String(z).toUpperCase());
    const size = allowedSizes.includes(String(it.size || '').toUpperCase()) ? String(it.size).toUpperCase() : '';
    if (!size) return json({ error: 'bad size' }, 400, origin);
    if ((prod.soldSizes || []).includes(size)) return json({ error: 'size sold out', slug: it.slug, size }, 409, origin);
    const color = String(it.color || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);
    if (prod.cloud && prod.colors.length && !prod.colors.includes(color)) return json({ error: 'bad color' }, 400, origin);
    const unit = Math.round(prod.price * 100);
    const unitAfter = Math.round(prod.price * 100 * (1 - rate));
    subC += unit * qty;
    afterC += unitAfter * qty;
    const label = prod.name + (size || color ? ' (' + [size, color.toUpperCase()].filter(Boolean).join(' / ') + ')' : '');
    summary.push(label + ' x' + qty);
    const img = prod.cloud ? (prod.cover || '') : (color ? '../tees/' + prod.slug + '/' + color + '.png' : '');
    lines.push({ name: prod.name, variant: [size ? 'SIZE ' + size : '', color.toUpperCase()].filter(Boolean).join(' / '), qty: 'x' + qty, img, slug: prod.slug, size, color: color.toUpperCase(), unit: prod.price, n: qty });
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
  const shipC = (!owner && ship.id === 'std' && subC >= freeOver * 100) ? 0 : Math.round(ship.price * 100);
  const addr = b.address || {};
  const st = String(addr.state || '').trim().toUpperCase();
  const taxC = afterC > 0 ? TAX_FLAT : 0;

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
  if (total < STRIPE_MIN_TOTAL) return json({ error: 'order total is too small to charge' }, 400, origin);
  const name = String(b.name || '').slice(0, 100);
  const cc = countryCode(addr.country);
  const coverPct = STRIPE_PCT + (cc === 'US' ? 0 : STRIPE_INTL_PCT + STRIPE_FX_PCT);
  const feeC = Math.min(total, Math.round(total * (FEE_RATE + coverPct)) + STRIPE_FLAT);
  if (feeC > 0) p.set('payment_intent_data[application_fee_amount]', String(feeC));
  p.set('payment_intent_data[transfer_data][destination]', env.CONNECTED_ACCOUNT_ID);

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
    street: String(addr.line1 || '').toUpperCase().slice(0, 200),
    street2: String(addr.line2 || '').toUpperCase().slice(0, 200),
    city: String(addr.city || '').toUpperCase().slice(0, 100),
    state: st.slice(0, 20),
    zip: String(addr.postal_code || '').slice(0, 20),
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
    subtotal: subC / 100,
    discount: (subC - afterC) / 100,
    shipCost: shipC / 100,
    promo: code && rate ? code : '',
    promoRate: rate,
    promoCloud,
    receiptKey: randomKey()
  };
  try {
    const saved = await firestore(env, 'POST', 'orders?documentId=' + encodeURIComponent(j.id), { fields: toFields(order) });
    if (!saved.ok) return json({ error: 'could not save order' }, 502, origin);
  } catch (e) {
    return json({ error: 'could not save order' }, 502, origin);
  }
  return json({ url: j.url }, 200, origin);
}

async function verifySession(url, env, origin, ctx) {
  const id = url.searchParams.get('session_id') || '';
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ paid: false }, 400, origin);
  const j = await stripe(env, 'GET', 'checkout/sessions/' + id);
  if (j.error) return json({ paid: false }, 404, origin);
  const paid = j.payment_status === 'paid';
  let number = '';
  let receiptUrl = '';
  if (paid) {
    try { number = await markPaid(env, id, j.payment_intent, j.amount_total || 0, ctx) || ''; } catch (e) {}
    try { const doc = await getDoc(env, 'orders/' + id); if (doc && doc.data.receiptKey) receiptUrl = receiptUrlFor(id, doc.data.receiptKey); } catch (e) {}
  }
  return json({ paid, total: (j.amount_total || 0) / 100, number, receiptUrl }, 200, origin);
}

async function promoCheck(url, env, origin) {
  const code = cleanCode(url.searchParams.get('promo'));
  if (!code) return json({ rate: 0 }, 200, origin);
  if (isOwnerCode(env, code)) return json({ rate: 1, code }, 200, origin);
  let store = null;
  try { store = await loadStore(env); } catch (e) {}
  const local = store && store.promos && store.promos[code];
  if (local) return json({ rate: local, code }, 200, origin);
  const found = await lookupPromo(env, code);
  return json({ rate: found ? found.rate : 0, code }, 200, origin);
}

async function orderFor(url, env) {
  const id = String(url.searchParams.get('o') || '');
  const key = String(url.searchParams.get('k') || '');
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(id) || !/^[a-f0-9]{24,64}$/.test(key)) return null;
  const doc = await getDoc(env, 'orders/' + encodeURIComponent(id));
  if (!doc || doc.data.receiptKey !== key) return null;
  return { id, key, order: doc.data };
}

async function receiptPage(url, env, origin) {
  const hit = await orderFor(url, env);
  if (!hit) return json({ error: 'receipt not found' }, 404, origin);
  const r = hit.order.receipt || {};
  const out = renderReceipt(hit.order, { template: r.template || 'archive', code: r.code || '', rate: Number(r.rate) || 0, img: imgUrlFor(workerBase(env) || (url.origin), hit.id, hit.key), fragment: url.searchParams.get('format') === 'fragment' });
  return cors(new Response(out.html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, max-age=300' } }), origin);
}

async function itemImage(url, env, origin) {
  const hit = await orderFor(url, env);
  if (!hit) return new Response('not found', { status: 404 });
  const i = Number(url.searchParams.get('i'));
  const it = (hit.order.items || [])[i];
  const src = it ? String(it.img || '') : '';
  if (!src) return new Response('not found', { status: 404 });
  const m = src.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,(.*)$/i);
  if (m) {
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    return new Response(bytes, { status: 200, headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=' + IMG_CACHE_SECONDS, 'Access-Control-Allow-Origin': '*' } });
  }
  const base = env.STORE_URL || DEFAULT_STORE_URL;
  const target = /^https?:/i.test(src) ? src : base + '/' + src.replace(/^(\.\.\/|\.\/|\/)+/, '');
  return Response.redirect(target, 302);
}

async function resendReceipt(request, env, origin) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400, origin); }
  const who = await verifyStaff(env, b.token);
  if (!who) return json({ error: 'not staff' }, 403, origin);
  const id = String(b.order || '');
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(id)) return json({ error: 'bad order' }, 400, origin);
  const doc = await getDoc(env, 'orders/' + encodeURIComponent(id));
  if (!doc) return json({ error: 'order not found' }, 404, origin);
  const receipt = await sendReceipt(env, id, doc.data, workerBase(env) || new URL(request.url).origin);
  return json({ receipt }, 200, origin);
}

async function joinRoute(request, env, origin) {
  let b;
  try { b = await request.json(); } catch (e) { return json({ error: 'bad request' }, 400, origin); }
  const out = await handleJoin(env, b.email, b.source);
  return json(out, out.ok ? 200 : 400, origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/webhook') return handleWebhook(request, env, ctx);
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'forbidden' }, 403, origin);
    try {
      if (request.method === 'GET' && url.pathname === '/img') return await itemImage(url, env, origin);
      if (request.method === 'GET' && url.pathname === '/receipt') return await receiptPage(url, env, origin);
      if (request.method === 'GET' && url.searchParams.has('promo')) return await promoCheck(url, env, origin);
      if (request.method === 'GET') return await verifySession(url, env, origin, ctx);
      if (request.method === 'POST' && url.pathname === '/join') return await joinRoute(request, env, origin);
      if (request.method === 'POST' && url.pathname === '/resend') return await resendReceipt(request, env, origin);
      if (request.method === 'POST') return await createSession(request, env, origin);
    } catch (e) {
      return json({ error: 'payment server error, try again' }, 502, origin);
    }
    return json({ error: 'method not allowed' }, 405, origin);
  }
};

import { getDoc, firestore, toFields } from './db.js';
import { verifyStaff } from './staff.js';

const SHIPPO_URL = 'https://api.goshippo.com';
const PARCEL_LENGTH_IN = 13;
const PARCEL_WIDTH_IN = 10;
const PARCEL_HEIGHT_IN = 2;
const PARCEL_BASE_OZ = 2;
const OUNCES_BY_KIND = { tees: 8, hats: 5, pants: 20, shorts: 14 };
const OUNCES_DEFAULT = 8;
const SERVICE_BY_SHIP = { std: 'usps_ground_advantage', pri: 'usps_priority' };
const LABEL_FILE_TYPE = 'PDF_4x6';
const QUOTE_TTL_MS = 600000;
const BUY_LOCK_MS = 90000;

function shipFrom(env) {
  if (!env.SHIP_FROM) throw new Error('SHIP_FROM not set');
  const a = JSON.parse(env.SHIP_FROM);
  return { name: a.name, company: a.company || 'AVEIR STUDIOS', street1: a.street1, street2: a.street2 || '', city: a.city, state: a.state, zip: a.zip, country: 'US', phone: a.phone || '', email: a.email || '' };
}

async function shippo(env, method, path, body) {
  if (!env.SHIPPO_TOKEN) throw new Error('SHIPPO_TOKEN not set');
  const r = await fetch(SHIPPO_URL + path, {
    method,
    headers: { 'Authorization': 'ShippoToken ' + env.SHIPPO_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body: j };
}

function usCountry(v) {
  const c = String(v || '').trim().toUpperCase();
  return !c || ['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(c);
}

function addressTo(o) {
  let street1 = o.street || '', street2 = o.street2 || '', city = o.city || '', state = o.state || '', zip = o.zip || '';
  if (!city && !zip) {
    const m = String(o.line2 || '').match(/^(.*),\s*([A-Z]{2})\s+([0-9][0-9A-Z \-]*)$/);
    street1 = o.line1 || '';
    if (m) { city = m[1].trim(); state = m[2]; zip = m[3].trim(); }
  }
  return { name: o.name || '', street1, street2, city, state, zip, country: 'US', email: o.email || '', phone: o.phone && o.phone !== '-' ? o.phone : '' };
}

function ounces(o, kindBySlug) {
  const items = o.items || [];
  let oz = PARCEL_BASE_OZ;
  items.forEach(it => {
    const n = it.n !== undefined ? Number(it.n) : (Number(String(it.qty || '').replace(/[^0-9]/g, '')) || 1);
    const kind = (it.slug && kindBySlug[it.slug]) || 'tees';
    oz += (OUNCES_BY_KIND[kind] || OUNCES_DEFAULT) * Math.max(1, n);
  });
  return Math.max(1, Math.round(oz));
}

function pickRate(rates, shipId) {
  const usps = (rates || []).filter(r => String(r.provider || '').toUpperCase() === 'USPS');
  const want = SERVICE_BY_SHIP[shipId] || SERVICE_BY_SHIP.std;
  const exact = usps.filter(r => r.servicelevel && r.servicelevel.token === want);
  const pool = exact.length ? exact : usps;
  return pool.sort((a, b) => Number(a.amount) - Number(b.amount))[0] || null;
}

function errText(body, fallback) {
  const msgs = (body && body.messages) || [];
  const t = msgs.map(m => m.text || m.code || '').filter(Boolean).join(' / ');
  return (t || (body && (body.detail || body.error)) || fallback).toString().slice(0, 240);
}

async function commitPatch(env, doc, patch) {
  return firestore(env, 'POST', ':commit', {
    writes: [{ update: { name: doc.name, fields: toFields(patch) }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: doc.updateTime } }]
  });
}

async function quote(env, id, doc, kindBySlug) {
  const o = doc.data;
  const shipment = await shippo(env, 'POST', '/shipments/', {
    address_from: shipFrom(env),
    address_to: addressTo(o),
    parcels: [{ length: String(PARCEL_LENGTH_IN), width: String(PARCEL_WIDTH_IN), height: String(PARCEL_HEIGHT_IN), distance_unit: 'in', weight: String(ounces(o, kindBySlug)), mass_unit: 'oz' }],
    async: false
  });
  if (!shipment.ok) return { error: errText(shipment.body, 'shippo shipment failed ' + shipment.status) };
  const rate = pickRate(shipment.body.rates, o.shipId || 'std');
  if (!rate) return { error: errText(shipment.body, 'no USPS rate for this address') };
  const q = {
    rateId: rate.object_id,
    amount: Number(rate.amount) || 0,
    service: String((rate.servicelevel && rate.servicelevel.name) || 'USPS').toUpperCase(),
    days: rate.estimated_days || null,
    oz: ounces(o, kindBySlug),
    at: new Date()
  };
  await commitPatch(env, doc, { labelQuote: q });
  return { quote: { amount: q.amount, service: 'USPS ' + q.service, days: q.days, oz: q.oz } };
}

async function buy(env, id, doc) {
  const o = doc.data;
  const q = o.labelQuote;
  if (!q || !q.rateId || Date.now() - Date.parse(q.at) > QUOTE_TTL_MS) return { error: 'quote expired, hit PRINT LABEL again' };
  if (o.labelBuying && Date.now() - Date.parse(o.labelBuying) < BUY_LOCK_MS) return { error: 'label is already being bought' };
  const locked = await commitPatch(env, doc, { labelBuying: new Date() });
  if (!locked.ok) return { error: 'order changed, hit PRINT LABEL again' };
  const tx = await shippo(env, 'POST', '/transactions/', { rate: q.rateId, label_file_type: LABEL_FILE_TYPE, async: false });
  const t = tx.body || {};
  const fresh = await getDoc(env, 'orders/' + encodeURIComponent(id));
  if (!tx.ok || t.status !== 'SUCCESS' || !t.label_url) {
    if (fresh) await commitPatch(env, fresh, { labelBuying: null });
    return { error: errText(t, 'shippo label failed ' + tx.status) };
  }
  const label = {
    url: t.label_url,
    tracking: t.tracking_number || '',
    trackingUrl: t.tracking_url_provider || '',
    service: 'USPS ' + q.service,
    amount: q.amount,
    txId: t.object_id || '',
    at: new Date()
  };
  const patch = { label, labelBuying: null };
  if (label.tracking) patch.tracking = 'USPS ' + label.tracking;
  if (fresh) await commitPatch(env, fresh, patch);
  return { label };
}

export async function handleLabel(env, b, kindBySlug) {
  const who = await verifyStaff(env, b.token);
  if (!who) return { status: 403, body: { error: 'not staff' } };
  const id = String(b.order || '');
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(id)) return { status: 400, body: { error: 'bad order' } };
  const doc = await getDoc(env, 'orders/' + encodeURIComponent(id));
  if (!doc) return { status: 404, body: { error: 'order not found' } };
  if (doc.data.label && doc.data.label.url) return { status: 200, body: { label: doc.data.label } };
  if (!usCountry(doc.data.country)) return { status: 400, body: { error: 'international orders need customs forms, make that label in Shippo directly' } };
  const out = b.confirm === true ? await buy(env, id, doc) : await quote(env, id, doc, kindBySlug);
  return { status: out.error ? 400 : 200, body: out };
}

export async function handleLabelFile(env, b) {
  const who = await verifyStaff(env, b.token);
  if (!who) return { status: 403, error: 'not staff' };
  const id = String(b.order || '');
  if (!/^[A-Za-z0-9_-]{6,200}$/.test(id)) return { status: 400, error: 'bad order' };
  const doc = await getDoc(env, 'orders/' + encodeURIComponent(id));
  const url = doc && doc.data.label && doc.data.label.url;
  if (!url || !/^https:\/\//.test(url)) return { status: 404, error: 'no label' };
  const r = await fetch(url);
  if (!r.ok) return { status: 502, error: 'label file unavailable' };
  return { status: 200, bytes: await r.arrayBuffer() };
}

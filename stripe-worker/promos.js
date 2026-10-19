import { getDoc, createDoc, firestore, toFields } from './db.js';

const CODE_PREFIX = 'AVR';
const CODE_LENGTH = 6;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_PATTERN = /^[A-Z0-9]{3,24}$/;

export function makeCode() {
  const buf = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return CODE_PREFIX + s;
}

export function cleanCode(v) {
  const c = String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_PATTERN.test(c) ? c : '';
}

export function isOwnerCode(env, code) {
  return !!(env.OWNER_CODE && code && code === cleanCode(env.OWNER_CODE));
}

export async function lookupPromo(env, code) {
  const c = cleanCode(code);
  if (!c) return null;
  const doc = await getDoc(env, 'promos/' + c);
  if (!doc) return null;
  const d = doc.data;
  const rate = Number(d.rate) || 0;
  const maxUses = Number(d.maxUses) || 1;
  const uses = Number(d.uses) || 0;
  if (rate <= 0 || rate > 1 || uses >= maxUses) return null;
  return { code: c, rate, left: maxUses - uses, kind: d.kind || '' };
}

export async function createPromo(env, opts) {
  let code = cleanCode(opts.code) || makeCode();
  for (let tries = 0; tries < 5; tries++) {
    const r = await createDoc(env, 'promos', code, {
      code,
      rate: Number(opts.rate),
      kind: String(opts.kind || ''),
      email: String(opts.email || '').toLowerCase(),
      orderNumber: String(opts.orderNumber || ''),
      maxUses: Number(opts.maxUses) || 1,
      uses: 0,
      createdAt: new Date()
    });
    if (r.ok) return code;
    if (r.status !== 409) throw new Error('could not create promo');
    code = makeCode();
  }
  throw new Error('could not create promo');
}

export async function consumePromo(env, code, orderNumber) {
  const c = cleanCode(code);
  if (!c) return false;
  const doc = await getDoc(env, 'promos/' + c);
  if (!doc) return false;
  const uses = (Number(doc.data.uses) || 0) + 1;
  const patch = { uses, lastUsedAt: new Date(), lastOrder: String(orderNumber || '') };
  const r = await firestore(env, 'POST', ':commit', {
    writes: [{ update: { name: doc.name, fields: toFields(patch) }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: doc.updateTime } }]
  });
  return r.ok;
}

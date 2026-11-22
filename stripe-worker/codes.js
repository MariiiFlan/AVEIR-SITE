import { firestore, fromDoc, getDoc, patchDoc } from './db.js';
import { verifyStaff } from './staff.js';
import { createPromo, cleanCode, isOwnerCode } from './promos.js';

const MIN_PCT = 1;
const MAX_PCT = 90;
const MAX_BATCH = 50;
const MAX_USES = 1000;
const LIST_LIMIT = 300;

function int(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

async function list(env) {
  const q = { structuredQuery: { from: [{ collectionId: 'promos' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: LIST_LIMIT } };
  const r = await firestore(env, 'POST', ':runQuery', q);
  if (!r.ok || !Array.isArray(r.body)) throw new Error('could not load codes');
  return r.body.filter(x => x.document).map(x => {
    const d = fromDoc(x.document);
    return {
      code: d.code || x.document.name.split('/').pop(),
      pct: Math.round((Number(d.rate) || 0) * 100),
      kind: d.kind || '',
      uses: Number(d.uses) || 0,
      maxUses: Number(d.maxUses) || 1,
      note: d.note || '',
      email: d.email || '',
      orderNumber: d.orderNumber || '',
      lastOrder: d.lastOrder || '',
      disabled: d.disabled === true,
      createdAt: d.createdAt || ''
    };
  });
}

async function create(env, b, who, reserved) {
  const pct = Math.round(Number(b.pct));
  if (!(pct >= MIN_PCT && pct <= MAX_PCT)) return { status: 400, body: { error: 'pick a percent between ' + MIN_PCT + ' and ' + MAX_PCT } };
  const count = int(b.count, 1, MAX_BATCH, 1);
  const uses = int(b.uses, 1, MAX_USES, 1);
  const note = String(b.note || '').trim().slice(0, 60);
  const custom = cleanCode(b.code);
  if (String(b.code || '').trim() && !custom) return { status: 400, body: { error: 'custom codes are 3 to 24 letters or numbers' } };
  if (custom && count > 1) return { status: 400, body: { error: 'a custom code can only be made one at a time' } };
  if (custom && (isOwnerCode(env, custom) || reserved.includes(custom))) return { status: 400, body: { error: 'that code is already taken' } };
  const made = [];
  for (let i = 0; i < count; i++) {
    try {
      made.push(await createPromo(env, { code: custom, exact: !!custom, rate: pct / 100, kind: 'manual', maxUses: uses, note, createdBy: who.email }));
    } catch (e) {
      if (!made.length) return { status: 400, body: { error: String(e.message || 'could not make code') } };
      break;
    }
  }
  return { status: 200, body: { codes: made, pct, uses } };
}

async function kill(env, b) {
  const code = cleanCode(b.code);
  if (!code) return { status: 400, body: { error: 'bad code' } };
  if (!(await getDoc(env, 'promos/' + code))) return { status: 404, body: { error: 'code not found' } };
  const r = await patchDoc(env, 'promos/' + code, { disabled: true, disabledAt: new Date() });
  if (!r.ok) return { status: 404, body: { error: 'code not found' } };
  return { status: 200, body: { ok: true, code } };
}

export async function handleCodes(env, b, reserved) {
  const who = await verifyStaff(env, b.token);
  if (!who) return { status: 403, body: { error: 'not staff' } };
  if (who.role !== 'admin') return { status: 403, body: { error: 'admins only' } };
  if (b.action === 'create') return create(env, b, who, reserved || []);
  if (b.action === 'kill') return kill(env, b);
  if (b.action === 'list') return { status: 200, body: { codes: await list(env) } };
  return { status: 400, body: { error: 'unknown action' } };
}

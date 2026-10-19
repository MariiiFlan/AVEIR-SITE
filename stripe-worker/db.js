let googleToken = null;

export function b64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function serviceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('firebase not configured');
  return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
}

export async function accessToken(env) {
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

export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}

export function toFields(obj) {
  const out = {};
  for (const k in obj) out[k] = toValue(obj[k]);
  return out;
}

export function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k in f) o[k] = fromValue(f[k]); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  return null;
}

export function fromDoc(doc) {
  const f = (doc && doc.fields) || {};
  const o = {};
  for (const k in f) o[k] = fromValue(f[k]);
  return o;
}

export async function firestore(env, method, path, body) {
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

export async function getDoc(env, path) {
  const r = await firestore(env, 'GET', path);
  if (!r.ok) return null;
  return { name: r.body.name, updateTime: r.body.updateTime, data: fromDoc(r.body) };
}

export async function patchDoc(env, path, patch) {
  const mask = Object.keys(patch).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  return firestore(env, 'PATCH', path + '?' + mask, { fields: toFields(patch) });
}

export async function createDoc(env, collection, id, data) {
  return firestore(env, 'POST', collection + '?documentId=' + encodeURIComponent(id), { fields: toFields(data) });
}

export function projectId(env) {
  return serviceAccount(env).project_id;
}

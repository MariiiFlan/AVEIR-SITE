import { getDoc, projectId } from './db.js';

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const JWKS_CACHE_MS = 3600000;
let jwks = null;

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function decodeJson(part) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part)));
}

async function keys() {
  if (jwks && jwks.at > Date.now() - JWKS_CACHE_MS) return jwks.list;
  const r = await fetch(JWKS_URL);
  const j = await r.json();
  jwks = { at: Date.now(), list: j.keys || [] };
  return jwks.list;
}

export async function verifyStaff(env, idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) return null;
  let head, payload;
  try { head = decodeJson(parts[0]); payload = decodeJson(parts[1]); } catch (e) { return null; }
  if (head.alg !== 'RS256' || !head.kid) return null;
  const jwk = (await keys()).find(k => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  const pid = projectId(env);
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== pid || payload.iss !== 'https://securetoken.google.com/' + pid) return null;
  if (!(payload.exp > now) || !payload.sub) return null;
  const seat = await getDoc(env, 'staff/' + encodeURIComponent(payload.sub));
  if (!seat) return null;
  return { uid: payload.sub, email: String(payload.email || seat.data.email || '').toLowerCase(), role: seat.data.role || '' };
}

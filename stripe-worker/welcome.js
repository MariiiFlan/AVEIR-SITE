import { esc, wrap, footer, sendMail, SITE_URL, F_HEAD, F_MONO, INK, CREAM, PINK, MAGENTA } from './mail.js';
import { createPromo, lookupPromo } from './promos.js';
import { getDoc, patchDoc } from './db.js';

const WELCOME_RATE = 0.25;
const WELCOME_SOURCES = ['home', 'menu'];
const WELCOME_RESEND_MINUTES = 10;
const SHOP_PATH = '/all/';
const DAY_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function today() {
  const d = new Date();
  return DAY_MONTHS[d.getMonth()] + ' ' + ('0' + d.getDate()).slice(-2) + ', ' + d.getFullYear();
}

export function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length < 200 && /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/.test(e) ? e : '';
}

export function renderWelcome(code, rate) {
  const pct = Math.round(rate * 100);
  const body = '<tr><td style="background:' + MAGENTA + ';padding:30px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:0.35em;color:' + INK + ';">AVEIR STUDIOS</td></tr>' +
    '<tr><td style="font-family:' + F_HEAD + ';font-size:96px;line-height:0.85;color:' + INK + ';padding:18px 0 20px;">WELCOME<br>TO THE<br>CULTURE.</td></tr>' +
    '<tr><td style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:0.2em;color:' + INK + ';border-top:2px solid ' + INK + ';border-bottom:2px solid ' + INK + ';padding:10px 0;">YOU&#39;RE ON THE LIST. FIRST ONE&#39;S ON US, KIND OF.</td></tr>' +
    '<tr><td style="padding:24px 0 6px;font-family:' + F_HEAD + ';font-size:44px;line-height:1;color:' + CREAM + ';">' + pct + '% OFF YOUR FIRST ORDER</td></tr>' +
    '<tr><td style="font-family:' + F_MONO + ';font-size:12px;font-weight:700;letter-spacing:0.2em;color:' + INK + ';padding-bottom:22px;">CODE: <span style="background:' + INK + ';color:' + PINK + ';padding:4px 10px;">' + esc(code) + '</span> &nbsp; ONE USE</td></tr>' +
    '<tr><td><a href="' + SITE_URL + SHOP_PATH + '" style="display:inline-block;background:' + INK + ';color:' + PINK + ';font-family:' + F_MONO + ';font-size:10px;font-weight:700;letter-spacing:0.22em;padding:14px 26px;">SHOP THE DROP &rarr;</a></td></tr>' +
    '<tr><td style="font-family:' + F_HEAD + ';font-size:28px;color:' + CREAM + ';padding-top:26px;">KEEP FASHION WEIRD</td></tr>' +
    '</table></td></tr>' + footer();
  const text = ['AVEIR STUDIOS', 'WELCOME TO THE CULTURE.', '', pct + '% OFF YOUR FIRST ORDER', 'CODE: ' + code + ' (ONE USE)', '', 'SHOP THE DROP: ' + SITE_URL + SHOP_PATH, '', 'SMALL RUNS - NO RESTOCKS. ALL DROP SALES FINAL.'].join('\n');
  return { html: wrap('WELCOME TO THE CULTURE', body, pct + '% off your first order. Code inside.'), text, subject: 'WELCOME TO THE CULTURE. ' + pct + '% OFF INSIDE.' };
}

export async function handleJoin(env, email, source) {
  const e = cleanEmail(email);
  if (!e) return { ok: false, error: 'bad email' };
  const src = String(source || 'site').slice(0, 30);
  const path = 'subscribers/' + encodeURIComponent(e);
  const existing = await getDoc(env, path);
  const d = existing ? existing.data : null;
  const base = d ? {} : { email: e, joined: today(), ts: Date.now(), source: src };
  if (!WELCOME_SOURCES.includes(src)) {
    if (!d) await patchDoc(env, path, base);
    return { ok: true, sent: false };
  }
  let code = d && d.welcomeCode ? String(d.welcomeCode) : '';
  if (code) {
    const still = await lookupPromo(env, code);
    const last = d && d.welcomeSentAt ? Date.parse(d.welcomeSentAt) : 0;
    if (!still) return { ok: true, sent: false, used: true };
    if (last && Date.now() - last < WELCOME_RESEND_MINUTES * 60000) return { ok: true, sent: false, recent: true };
  } else {
    code = await createPromo(env, { rate: WELCOME_RATE, kind: 'welcome', email: e });
  }
  const r = renderWelcome(code, WELCOME_RATE);
  const res = await sendMail(env, { to: e, subject: r.subject, html: r.html, text: r.text, copy: false });
  await patchDoc(env, path, Object.assign(base, { welcomeCode: code, welcomeSentAt: new Date(), welcomeStatus: res.ok ? 'SENT' : 'FAILED', welcomeError: res.error || '' }));
  return { ok: res.ok, sent: res.ok, error: res.error || '' };
}

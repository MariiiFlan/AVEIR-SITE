import { esc, money, wrap, footer, sendMail, SITE_URL, F_HEAD, F_MONO, INK, CREAM, PINK, MAGENTA, PLUM } from './mail.js';
import { createPromo } from './promos.js';
import { patchDoc } from './db.js';
import { renderPdf, toBase64, pdfReady } from './pdf.js';

export const TEMPLATES = ['archive', 'boarding', 'pass'];
const DISCOUNT_CHANCE = 0.35;
const DISCOUNT_MIN_PCT = 10;
const DISCOUNT_MAX_PCT = 35;
const RECEIPT_PATH = '/receipt/';
const DROP_LABEL = 'DROP 001';

export function pickTemplate() {
  return TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
}

export function rollDiscount() {
  if (Math.random() >= DISCOUNT_CHANCE) return 0;
  return (DISCOUNT_MIN_PCT + Math.floor(Math.random() * (DISCOUNT_MAX_PCT - DISCOUNT_MIN_PCT + 1))) / 100;
}

export function randomKey() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export function normalize(o) {
  const placed = String(o.placed || '');
  const cut = placed.indexOf(' - ');
  const items = (o.items || []).map((it, i) => {
    const variant = String(it.variant || '').replace(' — ', ' / ');
    const m = variant.match(/SIZE\s+([^\s/]+)/i);
    const size = it.size ? String(it.size).toUpperCase() : (m ? m[1].toUpperCase() : '');
    let color = it.color ? String(it.color).toUpperCase() : variant.replace(/SIZE\s+[^\s/]+/i, '').replace(/^\s*\/\s*/, '').trim().toUpperCase();
    const qty = it.n !== undefined ? num(it.n) : (num(String(it.qty || '').replace(/[^0-9]/g, '')) || 1);
    const unit = it.unit !== undefined && it.unit !== null ? num(it.unit) : null;
    return { i, name: String(it.name || '').toUpperCase(), size, color, qty, unit, img: it.img || '', variant: [size ? 'SIZE ' + size : '', color].filter(Boolean).join(' / ') };
  });
  const allUnits = items.length && items.every(it => it.unit !== null);
  const shipM = String(o.shipMethod || '').replace(' — ', ' - ');
  const shipName = shipM.split(' - ')[0] || 'STANDARD';
  const shipCost = o.shipCost !== undefined ? num(o.shipCost) : (/FREE/i.test(shipM) ? 0 : num((shipM.match(/\$([0-9.]+)/) || [])[1]));
  const tax = num(o.tax);
  const total = num(o.total);
  const subtotal = o.subtotal !== undefined ? num(o.subtotal) : (allUnits ? items.reduce((a, it) => a + it.unit * it.qty, 0) : Math.max(0, total - tax - shipCost));
  const discount = o.discount !== undefined ? num(o.discount) : Math.max(0, subtotal + shipCost + tax - total);
  const city = o.city || String(o.line2 || '').split(',')[0] || '';
  return {
    number: String(o.number || ''),
    numberBare: String(o.number || '').replace(/^#/, ''),
    date: cut > 0 ? placed.slice(0, cut) : placed,
    time: cut > 0 ? placed.slice(cut + 3) : '',
    name: String(o.name || '').toUpperCase(),
    street: String(o.street || o.line1 || '').toUpperCase(),
    street2: String(o.street2 || '').toUpperCase(),
    city: String(city).toUpperCase(),
    state: String(o.state || '').toUpperCase(),
    zip: String(o.zip || ''),
    country: String(o.country || 'UNITED STATES').toUpperCase(),
    cityState: [String(city).toUpperCase(), String(o.state || '').toUpperCase()].filter(Boolean).join(', '),
    email: String(o.email || ''),
    items, subtotal, discount, shipCost, shipName, tax, total,
    promo: String(o.promo || '')
  };
}

function addressLines(n) {
  return [n.name, n.street, n.street2, [n.city, n.state].filter(Boolean).join(', ') + (n.zip ? ' ' + n.zip : ''), n.country].filter(s => s && s.trim());
}

function barcode(seed, ink, h) {
  let cells = '';
  let x = 0;
  for (let i = 0; i < 64; i++) {
    const c = seed.charCodeAt(i % seed.length) + i * 7;
    const w = 1 + (c % 3);
    const on = i % 2 === 0;
    cells += '<td style="width:' + w + 'px;height:' + h + 'px;background:' + (on ? ink : 'transparent') + ';font-size:0;line-height:0;">&nbsp;</td>';
    x += w;
  }
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="width:' + x + 'px;"><tr>' + cells + '</tr></table>';
}

function itemRows(n, img, theme) {
  const line = theme === 'dark' ? '#2c2c2c' : 'rgba(20,10,17,0.3)';
  const ink = theme === 'dark' ? CREAM : INK;
  const dim = theme === 'dark' ? '#9a9a9a' : PLUM;
  const bg = theme === 'dark' ? '#1a1a1a' : '#ffffff';
  return n.items.map(it => '<tr>' +
    '<td style="padding:10px 12px 10px 0;border-bottom:1px dashed ' + line + ';width:48px;"><img src="' + esc(img(it.i)) + '" width="48" height="48" alt="" style="width:48px;height:48px;object-fit:contain;background:' + bg + ';"></td>' +
    '<td style="padding:10px 0;border-bottom:1px dashed ' + line + ';font-family:' + F_MONO + ';color:' + ink + ';"><div style="font-size:12px;font-weight:700;letter-spacing:0.06em;">' + esc(it.name) + '</div><div style="font-size:10px;letter-spacing:0.14em;color:' + dim + ';padding-top:3px;">' + esc(it.variant) + '</div></td>' +
    '<td style="padding:10px 0;border-bottom:1px dashed ' + line + ';font-family:' + F_MONO + ';font-size:11px;font-weight:700;color:' + PINK + ';text-align:right;white-space:nowrap;">x' + it.qty + '</td>' +
    '<td style="padding:10px 0 10px 14px;border-bottom:1px dashed ' + line + ';font-family:' + F_MONO + ';font-size:12px;color:' + ink + ';text-align:right;white-space:nowrap;">' + (it.unit === null ? '' : esc(money(it.unit * it.qty))) + '</td>' +
    '</tr>').join('');
}

function totalsRows(n, theme) {
  const ink = theme === 'dark' ? CREAM : INK;
  const row = (l, v, big) => '<tr><td style="padding:' + (big ? '12px 0 0' : '6px 0') + ';font-family:' + F_MONO + ';font-size:' + (big ? '16px' : '10px') + ';font-weight:' + (big ? '700' : '400') + ';letter-spacing:0.14em;color:' + ink + ';' + (big ? 'border-top:2px solid ' + ink + ';' : 'opacity:0.75;') + '">' + esc(l) + '</td><td style="padding:' + (big ? '12px 0 0' : '6px 0') + ';font-family:' + F_MONO + ';font-size:' + (big ? '16px' : '10px') + ';font-weight:' + (big ? '700' : '400') + ';letter-spacing:0.14em;color:' + ink + ';text-align:right;' + (big ? 'border-top:2px solid ' + ink + ';' : 'opacity:0.75;') + '">' + esc(v) + '</td></tr>';
  let out = row('SUBTOTAL', money(n.subtotal));
  if (n.discount > 0) out += row('PROMO' + (n.promo ? ' ' + n.promo : ''), '-' + money(n.discount));
  out += row('SHIPPING - ' + n.shipName, n.shipCost === 0 ? 'FREE' : money(n.shipCost));
  out += row('TAX', money(n.tax));
  out += row('TOTAL', money(n.total), true);
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + out + '</table>';
}

function discountBand(code, rate) {
  if (!code || !rate) return '';
  return '<tr><td style="padding:14px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + PINK + ';"><tr>' +
    '<td style="padding:22px 26px;font-family:' + F_MONO + ';color:' + INK + ';">' +
    '<div style="font-size:9px;letter-spacing:0.3em;">YOU PULLED A CODE</div>' +
    '<div style="font-family:' + F_HEAD + ';font-size:44px;line-height:1;padding:8px 0 6px;">' + Math.round(rate * 100) + '% OFF YOUR NEXT ONE</div>' +
    '<div style="font-size:12px;font-weight:700;letter-spacing:0.2em;">CODE: <span style="background:' + INK + ';color:' + PINK + ';padding:4px 10px;">' + esc(code) + '</span> &nbsp; ONE USE</div>' +
    '</td></tr></table></td></tr>';
}

function downloadRow(url, theme) {
  return '<tr><td align="center" style="padding:18px 0 0;"><a href="' + esc(url) + '" style="display:inline-block;background:' + (theme === 'pink' ? INK : CREAM) + ';color:' + (theme === 'pink' ? PINK : INK) + ';font-family:' + F_MONO + ';font-size:10px;font-weight:700;letter-spacing:0.22em;padding:14px 26px;">VIEW / DOWNLOAD RECEIPT &rarr;</a></td></tr>';
}

function tplArchive(n, img) {
  const polas = n.items.map(it => '<td class="stack" width="50%" valign="top" style="padding:10px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td style="padding:0 12px 14px;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:-8px auto 6px;"><tr><td style="width:70px;height:16px;background:#ff6ad5;font-size:0;line-height:0;">&nbsp;</td></tr></table>' +
    '<img src="' + esc(img(it.i)) + '" width="236" alt="' + esc(it.name) + '" style="width:100%;max-width:236px;height:auto;background:#eeeeee;margin:0 auto;">' +
    '<div style="font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.14em;line-height:1.7;color:' + INK + ';padding-top:10px;">' + esc(it.name) + '<br>' + esc(it.variant) + '</div>' +
    '</td></tr></table></td>');
  let rows = '';
  for (let i = 0; i < polas.length; i += 2) rows += '<tr>' + polas[i] + (polas[i + 1] || '<td class="stack" width="50%"></td>') + '</tr>';
  return '<tr><td style="background:' + CREAM + ';padding:26px 26px 30px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.25em;color:' + PLUM + ';border-bottom:1px solid #e3c6da;padding-bottom:10px;">AVEIR ARCHIVE &nbsp;/&nbsp; ORDER ' + esc(n.number) + ' &nbsp;/&nbsp; ' + esc(n.date) + '</td></tr>' +
    '<tr><td style="padding:22px 0 10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr>' +
    '<tr><td style="font-family:' + F_HEAD + ';font-size:40px;line-height:1;color:' + INK + ';padding:8px 0 14px;">ADDED TO THE ARCHIVE.</td></tr>' +
    '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td class="stack" width="50%" valign="top" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:0.08em;line-height:1.8;color:' + INK + ';padding-right:10px;"><div style="font-size:8px;letter-spacing:0.22em;color:' + PLUM + ';">SHIPPING TO</div>' + addressLines(n).map(esc).join('<br>') + '</td>' +
    '<td class="stack" width="50%" valign="top" style="font-family:' + F_MONO + ';font-size:10px;letter-spacing:0.08em;line-height:1.8;color:' + INK + ';"><div style="font-size:8px;letter-spacing:0.22em;color:' + PLUM + ';">PAID</div>' + esc(money(n.subtotal)) + (n.discount > 0 ? ' - ' + esc(money(n.discount)) : '') + ' + ' + (n.shipCost === 0 ? 'FREE SHIP' : esc(money(n.shipCost)) + ' SHIP') + ' + ' + esc(money(n.tax)) + ' TAX<div style="font-family:' + F_HEAD + ';font-size:30px;line-height:1.2;">' + esc(money(n.total)) + '</div></td>' +
    '</tr></table></td></tr>' +
    '<tr><td style="padding:18px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + itemRows(n, img, 'light') + '</table></td></tr>' +
    '<tr><td style="padding:12px 0 0;">' + totalsRows(n, 'light') + '</td></tr>' +
    '<tr><td style="font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.18em;color:' + PLUM + ';padding-top:20px;">SMALL RUNS - NO RESTOCKS. TRACKING COMES WHEN IT SHIPS.</td></tr>' +
    '</table></td></tr>';
}

function tplBoarding(n, img) {
  const field = (l, v) => '<td class="stack" width="33%" valign="top" style="padding:0 8px 14px 0;font-family:' + F_MONO + ';color:' + INK + ';"><div style="font-size:8px;letter-spacing:0.22em;color:#7a6a74;padding-bottom:4px;">' + l + '</div><div style="font-size:11px;font-weight:700;letter-spacing:0.08em;">' + esc(v) + '</div></td>';
  const seat = n.items.map(it => it.size).filter((s, i, a) => s && a.indexOf(s) === i).join(' ') || '-';
  return '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td class="stack" valign="top" style="background:' + CREAM + ';padding:22px 24px 24px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="font-family:' + F_HEAD + ';font-size:26px;color:' + INK + ';border-bottom:3px solid ' + INK + ';padding-bottom:8px;">AVEIR STUDIOS</td><td align="right" style="font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.2em;color:' + INK + ';border-bottom:3px solid ' + INK + ';padding-bottom:8px;">BOARDING PASS / ' + DROP_LABEL + '</td></tr>' +
    '<tr><td colspan="2" style="padding-top:16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' + field('PASSENGER', n.name) + field('FROM', 'AVEIR STUDIOS') + field('TO', n.cityState || n.country) + '</tr><tr>' + field('DATE', n.date) + field('BOARDING', n.time || '-') + field('CLASS', n.shipName) + '</tr></table></td></tr>' +
    '<tr><td colspan="2"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + itemRows(n, img, 'light') + '</table></td></tr>' +
    '<tr><td colspan="2" style="padding:12px 0 0;">' + totalsRows(n, 'light') + '</td></tr>' +
    '<tr><td colspan="2" style="padding-top:18px;">' + barcode(n.numberBare, INK, 40) + '</td></tr>' +
    '</table></td>' +
    '<td class="stack" width="170" valign="top" style="background:' + PINK + ';padding:22px 18px;border-left:3px dashed ' + CREAM + ';">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="height:100%;">' +
    '<tr><td valign="top" style="font-family:' + F_HEAD + ';font-size:34px;line-height:0.95;color:' + INK + ';">#' + esc(n.numberBare.split('-')[0]) + '<br>' + esc(n.numberBare.split('-').slice(1).join('-')) + '</td></tr>' +
    '<tr><td style="padding-top:26px;font-family:' + F_MONO + ';color:' + INK + ';">' +
    '<div style="font-size:8px;letter-spacing:0.22em;opacity:0.6;">SEAT</div><div style="font-size:12px;font-weight:700;padding:4px 0 12px;">' + esc(seat) + '</div>' +
    '<div style="font-size:8px;letter-spacing:0.22em;opacity:0.6;">GATE</div><div style="font-size:12px;font-weight:700;padding:4px 0 12px;">' + esc(DROP_LABEL.replace(/\D/g, '')) + '</div>' +
    '<div style="font-size:8px;letter-spacing:0.22em;opacity:0.6;">PAID</div><div style="font-size:12px;font-weight:700;padding:4px 0 12px;">' + esc(money(n.total)) + '</div>' +
    '</td></tr>' +
    '<tr><td valign="bottom" style="padding-top:30px;font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.3em;color:' + INK + ';opacity:0.7;">KEEP THIS PASS</td></tr>' +
    '</table></td>' +
    '</tr></table></td></tr>' +
    '<tr><td style="background:' + CREAM + ';padding:14px 24px 20px;font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.14em;line-height:1.8;color:' + INK + ';"><span style="color:#7a6a74;letter-spacing:0.22em;font-size:8px;">SHIP TO</span><br>' + addressLines(n).map(esc).join(' &middot; ') + '</td></tr>';
}

function tplPass(n, img) {
  const first = n.items[0];
  const fieldRow = (l, v) => '<div style="font-size:8px;letter-spacing:0.22em;color:#7a6a74;padding-bottom:3px;">' + l + '</div><div style="font-size:12px;font-weight:700;letter-spacing:0.08em;padding-bottom:10px;">' + esc(v) + '</div>';
  const classes = n.items.map(it => [it.size, it.color].filter(Boolean).join(' / ')).join(' &nbsp;&nbsp; ');
  return '<tr><td style="background:' + CREAM + ';border-radius:14px;padding:18px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td class="stack" width="150" valign="top" style="padding-right:18px;">' + (first ? '<table role="presentation" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #cfc9bf;"><tr><td style="width:150px;height:190px;text-align:center;vertical-align:middle;"><img src="' + esc(img(first.i)) + '" width="140" height="140" alt="" style="width:140px;height:140px;object-fit:contain;margin:0 auto;"></td></tr></table>' : '') + '</td>' +
    '<td class="stack" valign="top" style="font-family:' + F_MONO + ';color:' + INK + ';padding-top:4px;">' +
    '<div style="font-family:' + F_HEAD + ';font-size:30px;line-height:1;padding-bottom:12px;">AVEIR <span style="font-family:' + F_MONO + ';font-size:11px;letter-spacing:0.3em;color:' + MAGENTA + ';">CULTURE PASS</span></div>' +
    fieldRow('NAME', n.name) + fieldRow('ID', n.numberBare) + fieldRow('ISSUED', n.date) + fieldRow('CITY', n.cityState || n.country) +
    '<div style="font-size:8px;letter-spacing:0.22em;color:#7a6a74;padding-bottom:3px;">CLASS</div><div style="font-size:12px;font-weight:700;letter-spacing:0.08em;">' + classes + '</div>' +
    '</td></tr></table></td></tr>' +
    '<tr><td style="height:14px;font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="background:' + INK + ';border-radius:14px;padding:0 0 18px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    '<tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="height:38px;background:#000000;font-size:0;line-height:0;">&nbsp;</td></tr>' +
    '<tr><td style="padding:14px 20px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + itemRows(n, img, 'dark') + '</table></td></tr>' +
    '<tr><td style="padding:10px 20px 0;">' + totalsRows(n, 'dark') + '</td></tr>' +
    '<tr><td style="padding:18px 20px 0;">' + barcode(n.numberBare, CREAM, 30) + '</td></tr>' +
    '<tr><td style="padding:16px 20px 0;font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.14em;line-height:1.8;color:#9a9a9a;"><span style="letter-spacing:0.22em;font-size:8px;">SHIP TO</span><br>' + addressLines(n).map(esc).join(' &middot; ') + '</td></tr>' +
    '</table></td></tr>';
}

const TPL = { archive: tplArchive, boarding: tplBoarding, pass: tplPass };
const BUTTON_THEME = { archive: 'dark', boarding: 'dark', pass: 'dark' };

export function renderReceipt(order, opts) {
  const n = normalize(order);
  const template = TPL[opts.template] ? opts.template : 'archive';
  const img = opts.img || (() => '');
  let body = TPL[template](n, img);
  body += discountBand(opts.code, opts.rate);
  if (opts.receiptUrl) body += downloadRow(opts.receiptUrl, BUTTON_THEME[template]);
  body += footer();
  const subject = 'AVEIR ORDER ' + n.number + (opts.code ? ' + A CODE FOR YOU' : '');
  const preheader = n.items.map(it => it.name).join(', ') + '. ' + money(n.total) + ' PAID.';
  const text = [
    'AVEIR STUDIOS', 'ORDER ' + n.number + ' / ' + n.date + (n.time ? ' ' + n.time : ''), '',
    ...n.items.map(it => 'x' + it.qty + '  ' + it.name + '  ' + it.variant + (it.unit === null ? '' : '  ' + money(it.unit * it.qty))), '',
    'SUBTOTAL ' + money(n.subtotal),
    n.discount > 0 ? 'PROMO ' + n.promo + ' -' + money(n.discount) : '',
    'SHIPPING ' + n.shipName + ' ' + (n.shipCost === 0 ? 'FREE' : money(n.shipCost)),
    'TAX ' + money(n.tax),
    'TOTAL ' + money(n.total), '',
    'SHIP TO', ...addressLines(n), '',
    opts.code ? Math.round(opts.rate * 100) + '% OFF YOUR NEXT ORDER. CODE: ' + opts.code + ' (ONE USE)' : '',
    opts.receiptUrl ? 'VIEW / DOWNLOAD YOUR RECEIPT: ' + opts.receiptUrl : '', '',
    'SMALL RUNS - NO RESTOCKS. ALL DROP SALES FINAL.', SITE_URL
  ].filter(l => l !== '').join('\n');
  if (opts.fragment) {
    return { html: '<table role="presentation" width="600" cellpadding="0" cellspacing="0" data-number="' + esc(n.numberBare) + '" style="width:600px;max-width:600px;">' + body + '</table>', text, subject, template };
  }
  return { html: wrap(subject, body, preheader), text, subject, template };
}

export async function receiptPdf(env, order, opts) {
  if (!pdfReady(env)) return null;
  const r = renderReceipt(order, { template: opts.template, code: opts.code, rate: opts.rate, img: opts.img });
  return renderPdf(env, r.html, (order.items || []).length);
}

export function receiptUrlFor(orderId, key) {
  return SITE_URL + RECEIPT_PATH + '?o=' + encodeURIComponent(orderId) + '&k=' + encodeURIComponent(key);
}

export function imgUrlFor(workerBase, orderId, key) {
  return (i) => workerBase + '/img?o=' + encodeURIComponent(orderId) + '&i=' + i + '&k=' + encodeURIComponent(key);
}

export async function sendReceipt(env, orderId, order, workerBase) {
  const prev = order.receipt || {};
  let key = order.receiptKey || '';
  const patch = {};
  if (!key) { key = randomKey(); patch.receiptKey = key; }
  let template = TEMPLATES.includes(prev.template) ? prev.template : pickTemplate();
  let code = prev.code || '';
  let rate = Number(prev.rate) || 0;
  if (!prev.template) {
    rate = rollDiscount();
    if (rate > 0) {
      try { code = await createPromo(env, { rate, kind: 'receipt', email: order.email, orderNumber: order.number }); } catch (e) { code = ''; rate = 0; }
    }
  }
  const to = String(order.email || '').trim();
  let result;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    result = { ok: false, error: 'no customer email' };
  } else {
    const r = renderReceipt(order, { template, code, rate, img: imgUrlFor(workerBase, orderId, key), receiptUrl: receiptUrlFor(orderId, key) });
    const pdf = await receiptPdf(env, order, { template, code, rate, img: imgUrlFor(workerBase, orderId, key) });
    const attachments = pdf ? [{ filename: 'AVEIR-' + String(order.number || 'RECEIPT').replace(/^#/, '') + '.pdf', content: toBase64(pdf) }] : [];
    result = await sendMail(env, { to, subject: r.subject, html: r.html, text: r.text, copy: true, attachments });
    result.pdf = !!pdf;
  }
  patch.receipt = {
    template, code, rate,
    pdf: result.pdf === true,
    status: result.ok ? 'SENT' : 'FAILED',
    sentAt: new Date(),
    id: result.id || '',
    error: result.error || '',
    tries: (Number(prev.tries) || 0) + 1
  };
  await patchDoc(env, 'orders/' + encodeURIComponent(orderId), patch);
  return patch.receipt;
}

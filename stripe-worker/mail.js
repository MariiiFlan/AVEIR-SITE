const RESEND_URL = 'https://api.resend.com/emails';
export const MAIL_FROM = 'AVEIR STUDIOS <orders@aveir.us>';
export const MAIL_REPLY_TO = 'aveir.avr@gmail.com';
export const MAIL_COPY_TO = 'aveir.avr@gmail.com';
export const SITE_URL = 'https://aveir.us';
export const SITE_HANDLE = '@aveir.avr';
export const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Anton&family=Space+Mono:wght@400;700&display=swap';
export const F_HEAD = "'Anton','Impact','Arial Black',sans-serif";
export const F_MONO = "'Space Mono','Courier New',monospace";
export const INK = '#140a11';
export const CREAM = '#f2efe9';
export const PINK = '#ff06bc';
export const MAGENTA = '#cc0494';
export const PLUM = '#6b0a50';
export const BLACK = '#0a0a0a';

export function esc(s) {
  return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function money(n) {
  const v = Number(n) || 0;
  return '$' + v.toFixed(2);
}

export function wrap(title, body, preheader) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>' + esc(title) + '</title>' +
    '<link href="' + FONT_LINK + '" rel="stylesheet">' +
    '<style>body{margin:0;padding:0;background:' + BLACK + ';} table{border-collapse:collapse;} img{border:0;display:block;} a{text-decoration:none;} @media (max-width:620px){.wrap{width:100% !important;} .stack{display:block !important;width:100% !important;}}</style>' +
    '</head><body style="margin:0;padding:0;background:' + BLACK + ';">' +
    (preheader ? '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">' + esc(preheader) + '</div>' : '') +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + BLACK + ';"><tr><td align="center" style="padding:28px 12px;">' +
    '<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">' +
    body +
    '</table></td></tr></table></body></html>';
}

export function footer() {
  return '<tr><td style="padding:22px 6px 0;font-family:' + F_MONO + ';font-size:9px;letter-spacing:0.18em;line-height:1.9;color:#7a7a7a;text-align:center;">' +
    'AVEIR STUDIOS &nbsp;&middot;&nbsp; <a href="' + SITE_URL + '" style="color:' + PINK + ';">AVEIR.US</a> &nbsp;&middot;&nbsp; ' + esc(SITE_HANDLE) + '<br>' +
    'SMALL RUNS - NO RESTOCKS. ALL DROP SALES FINAL.<br>' +
    'REPLY TO THIS EMAIL IF SOMETHING IS WRONG WITH YOUR ORDER.' +
    '</td></tr>';
}

export async function sendMail(env, msg) {
  if (!env.RESEND_KEY) return { ok: false, error: 'RESEND_KEY not set' };
  const body = {
    from: MAIL_FROM,
    to: [msg.to],
    reply_to: MAIL_REPLY_TO,
    subject: msg.subject,
    html: msg.html,
    text: msg.text
  };
  if (msg.copy && MAIL_COPY_TO && MAIL_COPY_TO.toLowerCase() !== String(msg.to).toLowerCase()) body.bcc = [MAIL_COPY_TO];
  if (msg.attachments && msg.attachments.length) body.attachments = msg.attachments;
  try {
    const r = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: String((j && (j.message || j.error)) || ('resend ' + r.status)).slice(0, 200) };
    return { ok: true, id: j.id || '' };
  } catch (e) {
    return { ok: false, error: 'resend unreachable' };
  }
}

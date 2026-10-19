const PDF_PAGE_WIDTH_PX = 680;
const PDF_BASE_HEIGHT_PX = 1180;
const PDF_HEIGHT_PER_ITEM_PX = 90;
const PDF_TIMEOUT_MS = 25000;
const PDF_PAGE_CSS = 'html,body{margin:0;padding:0;} body{background:#0a0a0a;} @page{margin:0;}';

function endpoint(env) {
  return 'https://api.cloudflare.com/client/v4/accounts/' + env.CF_ACCOUNT_ID + '/browser-run/pdf';
}

export function pdfReady(env) {
  return !!(env.CF_ACCOUNT_ID && env.BROWSER_TOKEN);
}

export async function renderPdf(env, html, itemCount) {
  if (!pdfReady(env)) return null;
  const height = PDF_BASE_HEIGHT_PX + Math.max(0, (itemCount || 0) - 2) * PDF_HEIGHT_PER_ITEM_PX;
  const body = {
    html,
    addStyleTag: [{ content: PDF_PAGE_CSS }],
    gotoOptions: { waitUntil: 'networkidle0', timeout: PDF_TIMEOUT_MS },
    pdfOptions: { printBackground: true, preferCSSPageSize: false, width: PDF_PAGE_WIDTH_PX + 'px', height: height + 'px', margin: { top: '0', right: '0', bottom: '0', left: '0' } }
  };
  try {
    const r = await fetch(endpoint(env), {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + env.BROWSER_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 100 || buf[0] !== 0x25 || buf[1] !== 0x50) return null;
    return buf;
  } catch (e) {
    return null;
  }
}

export function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

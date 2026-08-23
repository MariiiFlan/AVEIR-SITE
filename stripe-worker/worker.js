// ============================================================
// AVEIR — Stripe Connect checkout worker (Cloudflare Workers)
// Money flow per sale:  buyer -> Stripe -> 97.5% to cousin's
// connected account, 2.5% platform fee stays on YOUR account.
//
// SETUP (one time, ~10 min):
// 1. dash.cloudflare.com -> Workers & Pages -> Create Worker
//    Name it: aveir-checkout  ->  paste this whole file  ->  Deploy
// 2. Worker -> Settings -> Variables -> add two SECRETS:
//      STRIPE_SECRET_KEY      = sk_live_... (YOUR Stripe secret key)
//      CONNECTED_ACCOUNT_ID   = acct_...    (cousin's Connect account id)
// 3. Copy the worker URL (https://aveir-checkout.XXXX.workers.dev)
//    and paste it into checkout/index.html -> STRIPE_WORKER_URL
//
// Stripe side: your account -> enable Connect -> add cousin as a
// connected account (Express onboarding link) -> his acct_ id shows
// under Connect -> Accounts once he finishes.
// ============================================================
const FEE_RATE = 0.025;

function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'POST') return cors(new Response('POST only', { status: 405 }));
    let b;
    try { b = await request.json(); } catch (e) { return cors(Response.json({ error: 'bad json' }, { status: 400 })); }
    if (!Array.isArray(b.items) || !b.items.length) return cors(Response.json({ error: 'no items' }, { status: 400 }));

    const p = new URLSearchParams();
    p.set('mode', 'payment');
    p.set('success_url', b.success_url);
    p.set('cancel_url', b.cancel_url);
    if (b.email) p.set('customer_email', b.email);

    let total = 0, i = 0;
    for (const it of b.items) {
      const amount = Math.max(0, Math.round(it.amount));
      const qty = Math.max(1, Math.round(it.qty));
      total += amount * qty;
      p.set(`line_items[${i}][quantity]`, String(qty));
      p.set(`line_items[${i}][price_data][currency]`, 'usd');
      p.set(`line_items[${i}][price_data][unit_amount]`, String(amount));
      p.set(`line_items[${i}][price_data][product_data][name]`, String(it.name).slice(0, 120));
      i++;
    }
    for (const extra of [['SHIPPING — ' + (b.shipName || 'STANDARD'), b.shipCents], ['SALES TAX', b.taxCents]]) {
      const cents = Math.max(0, Math.round(extra[1] || 0));
      if (cents > 0) {
        total += cents;
        p.set(`line_items[${i}][quantity]`, '1');
        p.set(`line_items[${i}][price_data][currency]`, 'usd');
        p.set(`line_items[${i}][price_data][unit_amount]`, String(cents));
        p.set(`line_items[${i}][price_data][product_data][name]`, extra[0]);
        i++;
      }
    }

    const fee = Math.round(total * FEE_RATE);
    p.set('payment_intent_data[application_fee_amount]', String(fee));
    p.set('payment_intent_data[transfer_data][destination]', env.CONNECTED_ACCOUNT_ID);

    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: p
    });
    const j = await r.json();
    if (j.error) return cors(Response.json({ error: j.error.message }, { status: 400 }));
    return cors(Response.json({ url: j.url }));
  }
};

// A local stand-in for Stripe and PayPal: only the endpoints Community Connect
// uses, in memory, with fake keys. It also plays the "hosted checkout" pages a
// payer would see, and sends SIGNED webhooks to the portal the way the real
// providers do. Nothing here reaches the network. Test use only.
//
//   node e2e/mocks/payments-mock.cjs            (PORT=4390 PORTAL=http://localhost:3300
//                                                 STRIPE_WEBHOOK_SECRET=whsec_… PAYPAL_WEBHOOK_ID=WH-…)
//   require('./payments-mock.cjs').createPaymentsMock({ port, portal, stripeWebhookSecret, paypalWebhookId })
//
// Point the portal and the worker at it with STRIPE_API_BASE, STRIPE_CONNECT_BASE,
// PAYPAL_API_BASE and PAYPAL_SANDBOX_API_BASE = http://localhost:<port>.
const http = require('http');
const crypto = require('crypto');

function createPaymentsMock(opts = {}) {
  const state = {
    requests: [], sessions: new Map(), intents: new Map(), refunds: new Map(), payouts: [], orders: new Map(),
    captures: new Map(), webhooksSent: [], n: 0, idem: new Map(), accounts: new Map(),
  };
  const id = (p) => `${p}${(++state.n).toString().padStart(6, '0')}`;
  let base = '';
  const portal = () => (opts.portal || process.env.PORTAL || '').replace(/\/+$/, '');

  function parseForm(body) {
    const out = {};
    for (const [k, v] of new URLSearchParams(body)) {
      const keys = k.replace(/\]/g, '').split('[');
      let o = out;
      keys.forEach((key, i) => {
        if (i === keys.length - 1) o[key] = v;
        else o = o[key] = o[key] || {};
      });
    }
    return out;
  }
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json', ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const fee = (cents) => Math.round(cents * 0.029) + 30;

  async function postWebhook(path, payload, headers) {
    const target = portal();
    const raw = JSON.stringify(payload);
    state.webhooksSent.push({ path, type: payload.type || payload.event_type, id: payload.id });
    if (!target) return { status: 0 };
    try {
      const r = await fetch(target + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
      return { status: r.status, text: await r.text() };
    } catch (e) {
      console.error('[payments-mock] webhook delivery failed:', e.message);
      return { status: 0, error: e.message };
    }
  }
  function stripeWebhook(type, object, account) {
    const secret = opts.stripeWebhookSecret || process.env.STRIPE_WEBHOOK_SECRET || '';
    const event = { id: id('evt_'), object: 'event', type, account: account || undefined, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } };
    const raw = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    return postWebhook('/api/webhooks/stripe', event, { 'stripe-signature': `t=${t},v1=${sig}` }).then((r) => ({ ...r, event }));
  }
  function paypalWebhook(event_type, resource) {
    const tid = crypto.randomUUID();
    const event = { id: id('WH-EVT-'), event_type, resource_type: 'checkout-order', resource, create_time: new Date().toISOString() };
    return postWebhook('/api/webhooks/paypal', event, {
      'paypal-transmission-id': tid, 'paypal-transmission-time': new Date().toISOString(), 'paypal-transmission-sig': `mock-sig-${tid}`,
      'paypal-cert-url': `${base}/certs/mock.pem`, 'paypal-auth-algo': 'SHA256withRSA',
    }).then((r) => ({ ...r, event }));
  }

  function intentFor(session) {
    const piId = id('pi_');
    const ch = { id: id('ch_'), payment_intent: piId, balance_transaction: { id: id('txn_'), fee: fee(session.amount_total), amount: session.amount_total },
                 payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242', wallet: null } } };
    const pi = { id: piId, object: 'payment_intent', amount: session.amount_total, amount_received: session.amount_total, status: 'succeeded',
                 metadata: session.metadata, latest_charge: ch, account: session.account };
    state.intents.set(piId, pi);
    return pi;
  }

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      state.requests.push({ method: req.method, path: p, query: url.search, account: req.headers['stripe-account'] || null,
                            idempotency: req.headers['idempotency-key'] || req.headers['paypal-request-id'] || null,
                            authAssertion: req.headers['paypal-auth-assertion'] || null, auth: (req.headers.authorization || '').slice(0, 12), body });
      try {
        // ── Stripe ──
        if (p === '/oauth/token' && req.method === 'POST') {
          const f = parseForm(body);
          if (!/^ac_/.test(f.code || '')) return send(res, 400, { error: 'invalid_grant', error_description: 'Authorization code does not exist' });
          const acct = id('acct_mock');
          state.accounts.set(acct, { charges_enabled: true });
          return send(res, 200, { access_token: `sk_acct_${crypto.randomBytes(8).toString('hex')}`, refresh_token: `rt_${crypto.randomBytes(8).toString('hex')}`,
                                  stripe_user_id: acct, livemode: false, scope: 'read_write' });
        }
        let m;
        if ((m = p.match(/^\/v1\/accounts\/([^/]+)$/))) {
          return send(res, 200, { id: m[1], charges_enabled: true, payouts_enabled: true, details_submitted: true, business_profile: { name: 'Mock Temple' } });
        }
        if (p === '/v1/checkout/sessions' && req.method === 'POST') {
          const f = parseForm(body);
          const key = req.headers['idempotency-key'];
          if (key && state.idem.has(key)) return send(res, 200, state.idem.get(key));
          const li = f.line_items && f.line_items['0'];
          const amount = Number(li && li.price_data && li.price_data.unit_amount);
          const s = { id: id('cs_test_'), object: 'checkout.session', amount_total: amount, currency: 'usd', metadata: f.metadata || {},
                      client_reference_id: f.client_reference_id || null, success_url: f.success_url, cancel_url: f.cancel_url,
                      payment_status: 'unpaid', status: 'open', payment_intent: null, account: req.headers['stripe-account'] || null,
                      name: li && li.price_data && li.price_data.product_data && li.price_data.product_data.name };
          s.url = `${base}/pay/stripe/${s.id}`;
          state.sessions.set(s.id, s);
          if (key) state.idem.set(key, s);
          return send(res, 200, s);
        }
        if ((m = p.match(/^\/pay\/stripe\/([^/]+)$/))) {
          const s = state.sessions.get(m[1]);
          if (!s) return send(res, 404, '<h1>No such checkout</h1>');
          if (req.method === 'GET') {
            return send(res, 200, `<!doctype html><title>Mock Stripe Checkout</title><h1>Mock Stripe Checkout (test mode)</h1>
              <p>${s.name || ''}</p><p id="amount">$${(s.amount_total / 100).toFixed(2)}</p><p>Card 4242 4242 4242 4242</p>
              <form method="post"><button type="submit" id="pay">Pay $${(s.amount_total / 100).toFixed(2)}</button></form>`);
          }
          if (s.payment_status !== 'paid') {
            const pi = intentFor(s);
            s.payment_intent = pi.id; s.payment_status = 'paid'; s.status = 'complete';
            await stripeWebhook('checkout.session.completed', { ...s, url: undefined }, s.account);
          }
          res.writeHead(303, { location: s.success_url || `${base}/done` });
          return res.end();
        }
        if ((m = p.match(/^\/v1\/payment_intents\/([^/]+)$/))) {
          const pi = state.intents.get(m[1]);
          return pi ? send(res, 200, pi) : send(res, 404, { error: { message: `No such payment_intent: '${m[1]}'` } });
        }
        if (p === '/v1/refunds' && req.method === 'POST') {
          const key = req.headers['idempotency-key'];
          if (key && state.idem.has(key)) return send(res, 200, state.idem.get(key));
          const f = parseForm(body);
          const pi = state.intents.get(f.payment_intent);
          if (!pi) return send(res, 400, { error: { message: `No such payment_intent: '${f.payment_intent}'` } });
          const r = { id: id('re_'), object: 'refund', amount: Number(f.amount || pi.amount), payment_intent: pi.id, status: 'succeeded' };
          state.refunds.set(r.id, r);
          if (key) state.idem.set(key, r);
          return send(res, 200, r);
        }
        if (p === '/v1/payouts' && req.method === 'GET') {
          const acct = req.headers['stripe-account'];
          return send(res, 200, { object: 'list', data: state.payouts.filter((x) => x.account === acct).map(({ txns, ...po }) => po), has_more: false });
        }
        if (p === '/v1/balance_transactions' && req.method === 'GET') {
          const po = state.payouts.find((x) => x.id === url.searchParams.get('payout'));
          return send(res, 200, { object: 'list', data: po ? po.txns : [], has_more: false });
        }
        if (p === '/__mock/payout' && req.method === 'POST') {
          // Test hook: pay out the given PaymentIntents of an account, then send payout.paid.
          const f = JSON.parse(body || '{}');
          const txns = (f.intents || []).map((pid) => state.intents.get(pid)).filter(Boolean).map((pi) => ({
            id: id('txn_'), type: 'charge', amount: pi.amount, fee: pi.latest_charge.balance_transaction.fee, source: { id: pi.latest_charge.id, payment_intent: pi.id } }));
          const gross = txns.reduce((a, t) => a + t.amount, 0), fees = txns.reduce((a, t) => a + t.fee, 0);
          const po = { id: id('po_'), object: 'payout', amount: gross - fees, status: 'paid', arrival_date: Math.floor(Date.now() / 1000) + 2 * 86400,
                       account: f.account, txns };
          state.payouts.push(po);
          const { txns: _t, ...pub } = po;
          const hook = await stripeWebhook('payout.paid', pub, f.account);
          return send(res, 200, { payout: pub, webhook: hook.status });
        }
        if (p === '/__mock/stripe-event' && req.method === 'POST') {
          const f = JSON.parse(body || '{}');
          const hook = await stripeWebhook(f.type, f.object, f.account);
          return send(res, 200, { status: hook.status, event: hook.event });
        }

        // ── PayPal ──
        if (p === '/v1/oauth2/token' && req.method === 'POST') {
          if (!/^Basic /.test(req.headers.authorization || '')) return send(res, 401, { error: 'invalid_client' });
          return send(res, 200, { access_token: `A21_${crypto.randomBytes(8).toString('hex')}`, token_type: 'Bearer', expires_in: 32400 });
        }
        if (p === '/v2/customer/partner-referrals' && req.method === 'POST') {
          const f = JSON.parse(body || '{}');
          const ret = f.partner_config_override && f.partner_config_override.return_url;
          return send(res, 201, { links: [{ rel: 'self', href: `${base}/v2/customer/partner-referrals/x` },
                                          { rel: 'action_url', href: `${base}/pay/paypal-onboard?tracking=${encodeURIComponent(f.tracking_id)}&return=${encodeURIComponent(ret)}` }] });
        }
        if (p === '/pay/paypal-onboard') {
          const ret = url.searchParams.get('return');
          const sep = ret.includes('?') ? '&' : '?';
          res.writeHead(302, { location: `${ret}${sep}merchantId=${encodeURIComponent(url.searchParams.get('tracking'))}&merchantIdInPayPal=MOCKMERCHANT01&permissionsGranted=true&accountStatus=BUSINESS_ACCOUNT` });
          return res.end();
        }
        if ((m = p.match(/^\/v1\/customer\/partners\/([^/]+)\/merchant-integrations\/([^/]+)$/))) {
          return send(res, 200, { merchant_id: m[2], tracking_id: 't', payments_receivable: true, primary_email_confirmed: true, primary_email: 'treasurer@mock-temple.test' });
        }
        if (p === '/v2/checkout/orders' && req.method === 'POST') {
          const rid = req.headers['paypal-request-id'];
          if (rid && state.idem.has(rid)) return send(res, 201, state.idem.get(rid));
          const f = JSON.parse(body || '{}');
          const o = { id: id('ORDER'), status: 'CREATED', purchase_units: f.purchase_units, return_url: f.payment_source && f.payment_source.paypal
                        && f.payment_source.paypal.experience_context && f.payment_source.paypal.experience_context.return_url };
          o.links = [{ rel: 'self', href: `${base}/v2/checkout/orders/${o.id}` }, { rel: 'payer-action', href: `${base}/pay/paypal/${o.id}` }];
          state.orders.set(o.id, o);
          if (rid) state.idem.set(rid, o);
          return send(res, 201, o);
        }
        if ((m = p.match(/^\/pay\/paypal\/([^/]+)$/))) {
          const o = state.orders.get(m[1]);
          if (!o) return send(res, 404, '<h1>No such order</h1>');
          const amt = o.purchase_units[0].amount.value;
          if (req.method === 'GET') {
            return send(res, 200, `<!doctype html><title>Mock PayPal</title><h1>Mock PayPal (sandbox)</h1><p id="amount">$${amt}</p>
              <form method="post"><button type="submit" id="pay">Pay with PayPal $${amt}</button></form>`);
          }
          if (o.status === 'CREATED') {
            o.status = 'APPROVED';
            await paypalWebhook('CHECKOUT.ORDER.APPROVED', { id: o.id, status: 'APPROVED', purchase_units: o.purchase_units });
          }
          res.writeHead(303, { location: o.return_url || `${base}/done` });
          return res.end();
        }
        if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/)) && req.method === 'POST') {
          const o = state.orders.get(m[1]);
          if (!o) return send(res, 404, { name: 'RESOURCE_NOT_FOUND', message: 'Order not found' });
          if (o.status === 'COMPLETED') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }], message: 'Order already captured' });
          if (o.status !== 'APPROVED') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }], message: 'Payer has not approved' });
          const pu = o.purchase_units[0];
          const cents = Math.round(Number(pu.amount.value) * 100);
          const cap = { id: id('CAP'), status: 'COMPLETED', amount: pu.amount, custom_id: pu.custom_id,
                        seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: (fee(cents) / 100).toFixed(2) } } };
          state.captures.set(cap.id, cap);
          o.status = 'COMPLETED';
          o.payment_source = { paypal: { email_address: 'payer@mock.test' } };
          pu.payments = { captures: [cap] };
          return send(res, 201, o);
        }
        if ((m = p.match(/^\/v2\/checkout\/orders\/([^/]+)$/)) && req.method === 'GET') {
          const o = state.orders.get(m[1]);
          return o ? send(res, 200, o) : send(res, 404, { name: 'RESOURCE_NOT_FOUND' });
        }
        if ((m = p.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/)) && req.method === 'POST') {
          const rid = req.headers['paypal-request-id'];
          if (rid && state.idem.has(rid)) return send(res, 201, state.idem.get(rid));
          if (!state.captures.has(m[1])) return send(res, 404, { name: 'RESOURCE_NOT_FOUND', message: 'Capture not found' });
          const r = { id: id('REF'), status: 'COMPLETED', amount: JSON.parse(body || '{}').amount };
          state.refunds.set(r.id, r);
          if (rid) state.idem.set(rid, r);
          return send(res, 201, r);
        }
        if (p === '/v1/notifications/verify-webhook-signature' && req.method === 'POST') {
          const f = JSON.parse(body || '{}');
          const want = opts.paypalWebhookId || process.env.PAYPAL_WEBHOOK_ID || '';
          const okSig = f.transmission_sig === `mock-sig-${f.transmission_id}` && f.webhook_id === want;
          return send(res, 200, { verification_status: okSig ? 'SUCCESS' : 'FAILURE' });
        }
        if (p === '/__mock/state') {
          return send(res, 200, { requests: state.requests.slice(-200), webhooksSent: state.webhooksSent, refunds: [...state.refunds.values()],
                                  payouts: state.payouts.map(({ txns, ...po }) => po) });
        }
        send(res, 404, { error: { message: `mock: no route for ${req.method} ${p}` } });
      } catch (e) {
        console.error('[payments-mock] error', e);
        send(res, 500, { error: { message: String(e && e.message) } });
      }
    });
  });

  return {
    state,
    server,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
        base = `http://localhost:${server.address().port}`;
        resolve(base);
      }));
    },
    get base() { return base; },
    close() { return new Promise((r) => server.close(() => r())); },
    stripeWebhook,
    paypalWebhook,
  };
}

module.exports = { createPaymentsMock };

if (require.main === module) {
  const mock = createPaymentsMock();
  mock.listen(Number(process.env.PORT || 4390)).then((b) => console.log(`payments mock on ${b} → webhooks to ${process.env.PORTAL || '(none)'}`));
}

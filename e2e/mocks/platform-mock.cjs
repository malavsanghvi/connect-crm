// A local stand-in for the providers the platform setup wizard tests (o-platform-setup):
// Stripe (GET /v1/balance), PayPal (POST /v1/oauth2/token), Twilio (GET /2010-04-01/Accounts/<sid>.json),
// Anthropic (GET /v1/models), Resend (/domains), Postmark (/server, /domains). Fake keys only, no network.
// Keys it accepts are passed in; everything else answers 401. Every request is recorded, with the
// credential it carried, so a test can prove WHICH key the caller used.
const http = require('http');

function createPlatformMock(opts = {}) {
  const keys = {
    stripe: new Set(opts.stripeKeys || ['sk_test_mock_platform_key', 'sk_live_mock_platform_key']),
    paypal: new Set(opts.paypalPairs || ['sb_mock_client:sb_mock_secret']),
    twilio: new Set(opts.twilioPairs || ['AC00000000000000000000000000000001:mock_twilio_token']),
    anthropic: new Set(opts.anthropicKeys || ['sk-ant-mock-key-000']),
    resend: new Set(opts.resendKeys || ['re_mock_key_0001']),
    postmark: new Set(opts.postmarkTokens || ['pm-server-mock', 'pm-account-mock']),
  };
  const state = { requests: [], domains: new Map() };
  let seq = 0;
  const send = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  const basic = (h) => (/^Basic /.test(h || '') ? Buffer.from(h.slice(6), 'base64').toString() : null);
  const bearer = (h) => (/^Bearer /.test(h || '') ? h.slice(7) : null);
  const resendDomain = (d) => ({
    id: d.id, name: d.name, status: d.status,
    records: [
      { record: 'SPF', type: 'MX', name: `send.${d.name}`, value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, status: d.status === 'verified' ? 'verified' : 'pending' },
      { record: 'SPF', type: 'TXT', name: `send.${d.name}`, value: 'v=spf1 include:amazonses.com ~all', status: d.status === 'verified' ? 'verified' : 'pending' },
      { record: 'DKIM', type: 'TXT', name: `resend._domainkey.${d.name}`, value: 'p=MOCKDKIMKEY', status: d.status === 'verified' ? 'verified' : 'pending' },
    ],
  });

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      const auth = req.headers.authorization || req.headers['x-api-key'] || req.headers['x-postmark-server-token'] || req.headers['x-postmark-account-token'] || '';
      state.requests.push({ method: req.method, path: p, auth: String(auth) });
      // Stripe
      if (req.method === 'GET' && p === '/v1/balance') {
        const k = bearer(req.headers.authorization);
        if (!k || !keys.stripe.has(k)) return send(res, 401, { error: { message: `Invalid API Key provided: ${k ? k.slice(0, 8) + '****' + k.slice(-4) : ''}` } });
        return send(res, 200, { object: 'balance', livemode: k.includes('_live_'), available: [] });
      }
      // PayPal
      if (req.method === 'POST' && p === '/v1/oauth2/token') {
        const pair = basic(req.headers.authorization);
        if (!pair || !keys.paypal.has(pair)) return send(res, 401, { error: 'invalid_client', error_description: 'Client Authentication failed' });
        return send(res, 200, { access_token: `A21_mock_${++seq}`, token_type: 'Bearer', expires_in: 32400 });
      }
      // Twilio
      const tw = p.match(/^\/2010-04-01\/Accounts\/([^/]+)\.json$/);
      if (req.method === 'GET' && tw) {
        const pair = basic(req.headers.authorization);
        if (!pair || !keys.twilio.has(pair) || !pair.startsWith(`${tw[1]}:`)) return send(res, 401, { code: 20003, message: 'Authenticate' });
        return send(res, 200, { sid: tw[1], friendly_name: 'Community Connect (mock)', status: 'active' });
      }
      // Anthropic
      if (req.method === 'GET' && p === '/v1/models') {
        if (!keys.anthropic.has(String(req.headers['x-api-key'] || ''))) return send(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
        return send(res, 200, { data: [{ id: 'claude-opus-5', type: 'model' }], has_more: false });
      }
      // Resend
      if (p === '/domains' || p.startsWith('/domains/')) {
        if (req.headers.authorization) {
          if (!keys.resend.has(bearer(req.headers.authorization) || '')) return send(res, 401, { name: 'validation_error', message: 'API key is invalid' });
          if (req.method === 'GET' && p === '/domains') return send(res, 200, { data: [...state.domains.values()].map((d) => ({ id: d.id, name: d.name, status: d.status })) });
          if (req.method === 'POST' && p === '/domains') {
            const name = JSON.parse(raw || '{}').name;
            const d = { id: `dom_mock_${++seq}`, name, status: 'pending' };
            state.domains.set(d.id, d);
            return send(res, 200, resendDomain(d));
          }
          const m = p.match(/^\/domains\/([^/]+)(\/verify)?$/);
          const d = m && state.domains.get(m[1]);
          if (!d) return send(res, 404, { message: 'Domain not found' });
          if (m[2]) { if (opts.verifyDomains) d.status = 'verified'; return send(res, 200, { object: 'domain', id: d.id }); }
          return send(res, 200, resendDomain(d));
        }
        // Postmark
        const t = String(req.headers['x-postmark-account-token'] || '');
        if (!keys.postmark.has(t)) return send(res, 401, { ErrorCode: 10, Message: 'Bad or missing API token' });
        return send(res, 200, { TotalCount: 0, Domains: [] });
      }
      if (req.method === 'GET' && p === '/server') {
        if (!keys.postmark.has(String(req.headers['x-postmark-server-token'] || ''))) return send(res, 401, { ErrorCode: 10, Message: 'Bad or missing API token' });
        return send(res, 200, { ID: 1, Name: 'Community Connect (mock)' });
      }
      send(res, 404, { error: `platform mock has no ${req.method} ${p}` });
    });
  });
  const api = {
    state,
    base: null,
    listen(port = 0) {
      return new Promise((resolve) => server.listen(port, '127.0.0.1', () => { api.base = `http://127.0.0.1:${server.address().port}`; resolve(api.base); }));
    },
    close() { return new Promise((resolve) => server.close(() => resolve())); },
  };
  return api;
}

module.exports = { createPlatformMock };

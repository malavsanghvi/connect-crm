// Local stand-ins for the messaging providers — Resend, Postmark, Twilio and
// Expo push — for tests and the o-messaging e2e flow. Never a real network call,
// never a real key (any non-empty key is accepted and recorded as "present").
//
//   node e2e/mock-providers.cjs              # PORT=4390, MAILPIT=http://localhost:55624 (optional relay)
//   RESEND_API_BASE=POSTMARK_API_BASE=TWILIO_API_BASE=EXPO_PUSH_API_BASE=http://localhost:4390
//
// Every accepted email / text / push lands in the inbox:
//   GET  /_inbox[?to=&channel=]       what was "sent" (newest last)
//   POST /_mock/domains/<name>/verify  make a domain's DNS "verify" at the next check
//   POST /_mock/reset
// With MAILPIT set, every email is also relayed into Mailpit (its send API), so
// the sign-in helpers that read codes from Mailpit keep working when the Auth
// send-email hook routes sign-in codes through the provider.
// Addresses that fail on purpose: email to reject@…  → 422; text to +15005550009 → 400;
// a push token containing "Dead" → DeviceNotRegistered.
'use strict';
const http = require('http');

function createMockProviders(opts = {}) {
  const mailpit = opts.mailpit || null;
  const state = { inbox: [], domains: new Map(), verified: new Set(), n: 0 };
  const id = (p) => `${p}${(++state.n).toString().padStart(6, '0')}`;

  function parseFrom(from) {
    const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(from || '');
    return m ? { Name: m[1].trim(), Email: m[2].trim() } : { Name: '', Email: String(from || '').trim() };
  }
  async function relay(mail) {
    if (!mailpit) return;
    try {
      const r = await fetch(`${mailpit.replace(/\/+$/, '')}/api/v1/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ From: parseFrom(mail.from), To: [{ Email: mail.to }], Subject: mail.subject, HTML: mail.html, Text: mail.text }),
      });
      if (!r.ok) console.error(`[mock-providers] Mailpit relay answered ${r.status}: ${await r.text()}`);
    } catch (e) {
      console.error('[mock-providers] Mailpit relay failed:', e.message);
    }
  }
  function resendDomain(d) {
    const ok = state.verified.has(d.name);
    return {
      object: 'domain', id: d.id, name: d.name, status: ok ? 'verified' : 'pending', region: 'us-east-1',
      records: [
        { record: 'SPF', name: `send.${d.name}`, type: 'MX', ttl: 'Auto', status: ok ? 'verified' : 'pending', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
        { record: 'SPF', name: `send.${d.name}`, type: 'TXT', ttl: 'Auto', status: ok ? 'verified' : 'pending', value: 'v=spf1 include:amazonses.com ~all' },
        { record: 'DKIM', name: `resend._domainkey.${d.name}`, type: 'TXT', ttl: 'Auto', status: ok ? 'verified' : 'pending', value: 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDmockkey' },
      ],
    };
  }
  function postmarkDomain(d) {
    const ok = state.verified.has(d.name);
    return {
      ID: d.id, Name: d.name, DKIMPendingHost: ok ? '' : `20260924pm._domainkey.${d.name}`, DKIMPendingTextValue: ok ? '' : 'k=rsa;p=MIGfMockPending',
      DKIMHost: `20260924pm._domainkey.${d.name}`, DKIMTextValue: 'k=rsa;p=MIGfMock', DKIMVerified: ok,
      ReturnPathDomain: `pm-bounces.${d.name}`, ReturnPathDomainCNAMEValue: 'pm.mtasv.net', ReturnPathDomainVerified: ok,
    };
  }
  const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const url = new URL(req.url, 'http://mock');
      const p = url.pathname;
      const json = () => { try { return JSON.parse(raw || '{}'); } catch { return {}; } };
      const auth = req.headers.authorization || req.headers['x-postmark-server-token'] || req.headers['x-postmark-account-token'] || '';
      try {
        if (p === '/_inbox' && req.method === 'GET') {
          const to = url.searchParams.get('to'); const ch = url.searchParams.get('channel');
          return send(res, 200, state.inbox.filter((m) => (!to || m.to === to) && (!ch || m.channel === ch)));
        }
        if (p === '/_mock/reset') { state.inbox = []; state.domains.clear(); state.verified.clear(); return send(res, 200, { ok: true }); }
        const mv = /^\/_mock\/domains\/([^/]+)\/verify$/.exec(p);
        if (mv) { state.verified.add(decodeURIComponent(mv[1])); return send(res, 200, { ok: true }); }
        if (!auth && !p.startsWith('/--/api/v2/push')) return send(res, 401, { message: 'Missing API key', name: 'missing_api_key' });

        // Resend
        if (p === '/emails' && req.method === 'POST') {
          const b = json(); const to = Array.isArray(b.to) ? b.to[0] : b.to;
          if (/^reject@/.test(to)) return send(res, 422, { statusCode: 422, name: 'validation_error', message: 'The recipient was rejected (mock).' });
          const m = { provider: 'resend', channel: 'email', id: id('re_'), from: b.from, to, subject: b.subject, html: b.html, text: b.text, reply_to: b.reply_to || null, headers: b.headers || {}, at: new Date().toISOString() };
          state.inbox.push(m); await relay(m);
          return send(res, 200, { id: m.id });
        }
        if (p === '/domains' && req.method === 'POST' && req.headers.authorization) {
          const b = json(); const d = { id: id('dom_'), name: b.name };
          state.domains.set(d.id, d);
          return send(res, 201, resendDomain(d));
        }
        let m = /^\/domains\/([^/]+)(\/verify)?$/.exec(p);
        if (m && req.headers.authorization) {
          const d = state.domains.get(m[1]);
          if (!d) return send(res, 404, { name: 'not_found', message: 'Domain not found' });
          if (m[2]) return send(res, 200, { object: 'domain', id: d.id });
          return send(res, 200, resendDomain(d));
        }
        // Postmark
        if (p === '/email' && req.method === 'POST') {
          const b = json();
          if (/^reject@/.test(b.To)) return send(res, 422, { ErrorCode: 406, Message: 'You tried to send to a recipient that has been marked as inactive (mock).' });
          const mm = { provider: 'postmark', channel: 'email', id: id('pm-'), from: b.From, to: b.To, subject: b.Subject, html: b.HtmlBody, text: b.TextBody, reply_to: b.ReplyTo || null, headers: b.Headers || [], at: new Date().toISOString() };
          state.inbox.push(mm); await relay(mm);
          return send(res, 200, { To: b.To, SubmittedAt: mm.at, MessageID: mm.id, ErrorCode: 0, Message: 'OK' });
        }
        if (p === '/domains' && req.method === 'POST') {
          const b = json(); const d = { id: state.n + 1000, name: b.Name }; state.n++;
          state.domains.set(String(d.id), d);
          return send(res, 200, postmarkDomain(d));
        }
        m = /^\/domains\/([^/]+)(\/verifyDkim|\/verifyReturnPath)?$/.exec(p);
        if (m) {
          const d = state.domains.get(m[1]);
          if (!d) return send(res, 404, { ErrorCode: 510, Message: 'Domain not found.' });
          return send(res, 200, postmarkDomain(d));
        }
        // Twilio
        m = /^\/2010-04-01\/Accounts\/([^/]+)\/Messages\.json$/.exec(p);
        if (m && req.method === 'POST') {
          const f = Object.fromEntries(new URLSearchParams(raw));
          const to = String(f.To || '').replace(/^whatsapp:/, '');
          if (to === '+15005550009') return send(res, 400, { code: 21211, message: `The 'To' number ${to} is not a valid phone number.`, status: 400 });
          const t = { provider: 'twilio', channel: String(f.To || '').startsWith('whatsapp:') ? 'whatsapp' : 'sms', id: id('SM'), to, from: f.From || null, messaging_service_sid: f.MessagingServiceSid || null, body: f.Body, status_callback: f.StatusCallback || null, account: m[1], at: new Date().toISOString() };
          state.inbox.push(t);
          return send(res, 201, { sid: t.id, status: 'queued', to: f.To, body: f.Body, error_code: null });
        }
        // Expo push
        if (p === '/--/api/v2/push/send' && req.method === 'POST') {
          const list = JSON.parse(raw || '[]');
          const data = list.map((n) => {
            if (/Dead/.test(n.to)) return { status: 'error', message: `"${n.to}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } };
            const t = { provider: 'expo', channel: 'push', id: id('push-'), to: n.to, title: n.title || null, body: n.body, data: n.data || {}, at: new Date().toISOString() };
            state.inbox.push(t);
            return { status: 'ok', id: t.id };
          });
          return send(res, 200, { data });
        }
        return send(res, 404, { message: `mock-providers: no route for ${req.method} ${p}` });
      } catch (e) {
        return send(res, 500, { message: e.message });
      }
    });
  });
  return { server, state };
}

module.exports = { createMockProviders };

if (require.main === module) {
  const port = Number(process.env.PORT || 4390);
  const { server } = createMockProviders({ mailpit: process.env.MAILPIT || null });
  server.listen(port, '0.0.0.0', () => console.log(`mock providers on http://localhost:${port}${process.env.MAILPIT ? ` (relaying email to ${process.env.MAILPIT})` : ''}`));
}

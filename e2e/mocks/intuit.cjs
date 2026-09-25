// A local stand-in for Intuit (QuickBooks Online) used by the worker tests and
// the o-quickbooks e2e flow. Never a real network call, never a real key.
//
//   GET  /connect/oauth2?client_id&redirect_uri&state&...   -> 302 redirect_uri?code&state&realmId
//        (?deny=1 on the mock's own query answers error=access_denied instead)
//   POST /oauth2/v1/tokens/bearer   authorization_code | refresh_token (Basic auth checked)
//   GET  /v3/company/:realm/companyinfo/:realm
//   GET  /v3/company/:realm/query?query=select * from <Entity> [where ...] STARTPOSITION n MAXRESULTS m
//   POST /v3/company/:realm/<salesreceipt|refundreceipt|deposit|journalentry|creditmemo|payment>?requestid=
//        (the same requestid answers the first result again, as Intuit does)
//   GET  /__mock/state  (created entities, token calls, request log) · POST /__mock/reset · POST /__mock/set
//        (/__mock/set {addAccount, addItem} adds a chart row, e.g. a "Pledge write-offs" account and its item;
//         {lists: {Customer: [...], Invoice: [...], ...}} sets whole lists, e.g. a donor's history)
//
//   node e2e/mocks/intuit.cjs <port>   (or require it and call startIntuitMock)
const http = require('http');
const crypto = require('crypto');

const REALM = '9130350000000001';

function defaultLists() {
  return {
    Account: [
      { Id: '1', Name: 'Donations', FullyQualifiedName: 'Donations', AccountType: 'Income', AccountSubType: 'NonProfitIncome', Classification: 'Revenue', Active: true, CurrencyRef: { value: 'USD' } },
      { Id: '2', Name: 'Chase Operating', FullyQualifiedName: 'Chase Operating', AccountType: 'Bank', AccountSubType: 'Checking', Classification: 'Asset', Active: true, CurrencyRef: { value: 'USD' } },
      { Id: '3', Name: 'Undeposited Funds', FullyQualifiedName: 'Undeposited Funds', AccountType: 'Other Current Asset', AccountSubType: 'UndepositedFunds', Classification: 'Asset', Active: true, CurrencyRef: { value: 'USD' } },
      { Id: '4', Name: 'Stripe Clearing', FullyQualifiedName: 'Stripe Clearing', AccountType: 'Bank', AccountSubType: 'Checking', Classification: 'Asset', Active: true, CurrencyRef: { value: 'USD' } },
      { Id: '5', Name: 'Merchant Fees', FullyQualifiedName: 'Merchant Fees', AccountType: 'Expense', AccountSubType: 'BankCharges', Classification: 'Expense', Active: true, CurrencyRef: { value: 'USD' } },
      { Id: '6', Name: 'Construction Donations', FullyQualifiedName: 'Donations:Construction Donations', AccountType: 'Income', AccountSubType: 'NonProfitIncome', Classification: 'Revenue', Active: true, SubAccount: true, ParentRef: { value: '1' }, CurrencyRef: { value: 'USD' } },
      { Id: '7', Name: 'Store Sales', FullyQualifiedName: 'Store Sales', AccountType: 'Income', AccountSubType: 'SalesOfProductIncome', Classification: 'Revenue', Active: true, CurrencyRef: { value: 'USD' } },
      { Id: '8', Name: 'Sales Tax Payable', FullyQualifiedName: 'Sales Tax Payable', AccountType: 'Other Current Liability', AccountSubType: 'SalesTaxPayable', Classification: 'Liability', Active: true, CurrencyRef: { value: 'USD' } },
      { Id: '9', Name: 'Old Fundraiser', FullyQualifiedName: 'Old Fundraiser', AccountType: 'Income', AccountSubType: 'NonProfitIncome', Classification: 'Revenue', Active: false, CurrencyRef: { value: 'USD' } },
    ],
    Class: [
      { Id: '30', Name: 'General', FullyQualifiedName: 'General', Active: true },
      { Id: '31', Name: 'Construction', FullyQualifiedName: 'Construction', Active: true },
      { Id: '32', Name: 'Retired class', FullyQualifiedName: 'Retired class', Active: false },
    ],
    Department: [{ Id: '40', Name: 'Houston temple', FullyQualifiedName: 'Houston temple', Active: true }],
    Item: [
      { Id: '20', Name: 'Donation', Type: 'Service', Active: true, IncomeAccountRef: { value: '1', name: 'Donations' } },
      { Id: '21', Name: 'Construction donation', Type: 'Service', Active: true, IncomeAccountRef: { value: '6', name: 'Construction Donations' } },
      { Id: '22', Name: 'Store sale', Type: 'Service', Active: true, IncomeAccountRef: { value: '7', name: 'Store Sales' } },
    ],
    TaxCode: [{ Id: 'TAX', Name: 'TAX', Active: true, Taxable: true }, { Id: 'NON', Name: 'NON', Active: true, Taxable: false }],
    PaymentMethod: [
      { Id: '50', Name: 'Cash', Type: 'NON_CREDIT_CARD', Active: true },
      { Id: '51', Name: 'Check', Type: 'NON_CREDIT_CARD', Active: true },
      { Id: '52', Name: 'Visa', Type: 'CREDIT_CARD', Active: true },
    ],
  };
}

function startIntuitMock({ port = 0, clientId = 'intuit-test-client', clientSecret = 'intuit-test-secret-000' } = {}) {
  const state = { lists: defaultLists(), created: [], byRequest: new Map(), tokens: [], log: [], nextId: 1000, codes: new Map(),
                  refresh: new Map(), access: new Set(), companyName: 'Jain Society of Houston (Intuit test company)', failNextCreate: null };

  function issue() {
    const access = 'at_' + crypto.randomBytes(12).toString('hex');
    const refresh = 'rt_' + crypto.randomBytes(12).toString('hex');
    state.access.add(access); state.refresh.set(refresh, true);
    return { access_token: access, refresh_token: refresh, token_type: 'bearer', expires_in: 3600, x_refresh_token_expires_in: 8726400 };
  }
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', intuit_tid: crypto.randomUUID(), ...headers });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const fault = (res, status, message, detail, code = '6000') =>
    send(res, status, { Fault: { Error: [{ Message: message, Detail: detail, code }], type: status === 401 ? 'AUTHENTICATION' : 'ValidationFault' }, time: new Date().toISOString() });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      state.log.push({ method: req.method, path: url.pathname, at: Date.now() });
      try {
        if (req.method === 'GET' && url.pathname === '/connect/oauth2') {
          const redirect = new URL(url.searchParams.get('redirect_uri'));
          if (url.searchParams.get('client_id') !== clientId) return send(res, 400, { error: 'invalid_client' });
          redirect.searchParams.set('state', url.searchParams.get('state') || '');
          if (url.searchParams.get('deny') === '1') {
            redirect.searchParams.set('error', 'access_denied');
          } else {
            const code = 'AB11' + crypto.randomBytes(16).toString('hex');
            state.codes.set(code, url.searchParams.get('redirect_uri'));
            redirect.searchParams.set('code', code);
            redirect.searchParams.set('realmId', REALM);
          }
          res.writeHead(302, { location: redirect.toString() }); return res.end();
        }
        if (req.method === 'POST' && url.pathname === '/oauth2/v1/tokens/bearer') {
          const auth = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
          if (auth !== `${clientId}:${clientSecret}`) return send(res, 401, { error: 'invalid_client' });
          const form = new URLSearchParams(body);
          state.tokens.push({ grant: form.get('grant_type'), at: Date.now() });
          if (form.get('grant_type') === 'authorization_code') {
            const redirect = state.codes.get(form.get('code'));
            if (!redirect || redirect !== form.get('redirect_uri')) return send(res, 400, { error: 'invalid_grant' });
            state.codes.delete(form.get('code'));
            return send(res, 200, issue());
          }
          if (form.get('grant_type') === 'refresh_token') {
            if (!state.refresh.get(form.get('refresh_token'))) return send(res, 400, { error: 'invalid_grant' });
            return send(res, 200, issue());
          }
          return send(res, 400, { error: 'unsupported_grant_type' });
        }
        if (req.method === 'POST' && url.pathname === '/__mock/reset') { Object.assign(state, { created: [], byRequest: new Map(), tokens: [], log: [], lists: defaultLists() }); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && url.pathname === '/__mock/set') {
          const b = JSON.parse(body || '{}');
          if (b.renameAccount) { const a = state.lists.Account.find((x) => x.Id === b.renameAccount.id); a.Name = b.renameAccount.name; a.FullyQualifiedName = b.renameAccount.name; }
          if (b.failNextCreate) state.failNextCreate = b.failNextCreate;
          if (b.addAccount && !state.lists.Account.some((x) => x.Id === b.addAccount.Id)) state.lists.Account.push({ Active: true, CurrencyRef: { value: 'USD' }, ...b.addAccount });
          if (b.addItem && !state.lists.Item.some((x) => x.Id === b.addItem.Id)) state.lists.Item.push({ Active: true, Type: 'Service', ...b.addItem });
          if (b.lists) for (const [k, rows] of Object.entries(b.lists)) state.lists[k] = rows;   // e.g. Customer / Invoice / SalesReceipt history
          if (b.revokeAll) { state.refresh.clear(); state.access.clear(); }
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && url.pathname === '/__mock/state') {
          return send(res, 200, { created: state.created, tokens: state.tokens, log: state.log.slice(-200), requestIds: [...state.byRequest.keys()] });
        }

        const m = url.pathname.match(/^\/v3\/company\/([0-9]+)\/([a-z]+)(?:\/([0-9]+))?$/);
        if (!m) return send(res, 404, { error: 'not found' });
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        if (!state.access.has(token)) return fault(res, 401, 'AuthenticationFailed', 'Token expired or invalid', '3200');
        if (m[1] !== REALM) return fault(res, 403, 'ApplicationAuthorizationFailed', 'Unknown company', '003100');
        if (req.method === 'GET' && m[2] === 'companyinfo') {
          return send(res, 200, { CompanyInfo: { Id: '1', CompanyName: state.companyName, LegalName: state.companyName, Country: 'US' }, time: new Date().toISOString() });
        }
        if (req.method === 'GET' && m[2] === 'query') {
          const q = url.searchParams.get('query') || '';
          const mm = q.match(/from\s+(\w+)/i);
          const entity = mm && mm[1];
          const rows = state.lists[entity];
          if (!rows) return fault(res, 400, 'QueryParserError', `Unknown entity ${entity}`, '4000');
          let out = rows;
          const ids = q.match(/Id\s+in\s*\(([^)]*)\)/i);
          if (ids) { const want = ids[1].split(',').map((s) => s.trim().replace(/'/g, '')); out = rows.filter((r) => want.includes(r.Id)); }
          else if (!/Active\s+in/i.test(q)) out = rows.filter((r) => r.Active !== false);
          const start = Number((q.match(/STARTPOSITION\s+(\d+)/i) || [])[1] || 1);
          const max = Number((q.match(/MAXRESULTS\s+(\d+)/i) || [])[1] || 100);
          const page = out.slice(start - 1, start - 1 + max);
          return send(res, 200, { QueryResponse: page.length ? { [entity]: page, startPosition: start, maxResults: page.length } : {}, time: new Date().toISOString() });
        }
        const ENT = { salesreceipt: 'SalesReceipt', refundreceipt: 'RefundReceipt', deposit: 'Deposit', journalentry: 'JournalEntry',
                      creditmemo: 'CreditMemo', payment: 'Payment' }[m[2]];
        if (req.method === 'POST' && ENT) {
          const rid = url.searchParams.get('requestid');
          if (rid && state.byRequest.has(rid)) return send(res, 200, state.byRequest.get(rid));
          if (state.failNextCreate) { const f = state.failNextCreate; state.failNextCreate = null; return fault(res, f.status || 400, f.message, f.detail, f.code); }
          const doc = JSON.parse(body);
          for (const l of doc.Line || []) {
            const ref = (l.SalesItemLineDetail && l.SalesItemLineDetail.ItemRef) || null;
            if (ref && !state.lists.Item.some((i) => i.Id === ref.value && i.Active)) return fault(res, 400, 'Invalid Reference Id', `Item ${ref.value} not found`, '2500');
            const acc = (l.DepositLineDetail && l.DepositLineDetail.AccountRef) || (l.JournalEntryLineDetail && l.JournalEntryLineDetail.AccountRef);
            if (acc && !state.lists.Account.some((a) => a.Id === acc.value && a.Active)) return fault(res, 400, 'Invalid Reference Id', `Account ${acc.value} not found`, '2500');
          }
          if (ENT === 'CreditMemo' && !(doc.CustomerRef && doc.CustomerRef.value)) return fault(res, 400, 'Required param missing', 'CustomerRef is required', '2020');
          if (ENT === 'Payment') {
            // Applying a credit memo: a $0 payment whose lines link an invoice and a credit memo created here.
            const links = (doc.Line || []).flatMap((l) => l.LinkedTxn || []);
            const cm = links.find((x) => x.TxnType === 'CreditMemo');
            if (cm && !state.created.some((c) => c.entity === 'CreditMemo' && c.doc.Id === cm.TxnId)) return fault(res, 400, 'Invalid Reference Id', `CreditMemo ${cm.TxnId} not found`, '2500');
          }
          if (ENT === 'JournalEntry') {
            const sum = (t) => (doc.Line || []).filter((l) => l.JournalEntryLineDetail.PostingType === t).reduce((s, l) => s + l.Amount, 0);
            if (Math.abs(sum('Debit') - sum('Credit')) > 0.001) return fault(res, 400, 'Business Validation Error', 'Transaction must balance', '6060');
          }
          const id = String(state.nextId++);
          const total = ENT === 'Payment' ? Number(doc.TotalAmt || 0)
            : (doc.Line || []).filter((l) => ENT !== 'JournalEntry' || l.JournalEntryLineDetail.PostingType === 'Debit').reduce((s, l) => s + l.Amount, 0);
          const saved = { ...doc, Id: id, SyncToken: '0', TotalAmt: Math.round(total * 100) / 100, MetaData: { CreateTime: new Date().toISOString() } };
          const answer = { [ENT]: saved, time: new Date().toISOString() };
          state.created.push({ entity: ENT, requestId: rid, doc: saved });
          if (rid) state.byRequest.set(rid, answer);
          return send(res, 200, answer);
        }
        return send(res, 405, { error: 'method not allowed' });
      } catch (err) {
        return send(res, 500, { error: String(err && err.message || err) });
      }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    resolve({ base, realm: REALM, state, clientId, clientSecret, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

module.exports = { startIntuitMock, REALM };

if (require.main === module) {
  startIntuitMock({ port: Number(process.argv[2] || 8499) }).then((m) => console.log(`intuit mock listening on ${m.base}`));
}

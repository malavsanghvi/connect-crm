// Local mock servers for the o-qbo-match flow and the worker tests (test data only; never real keys).
//
//   startQbo({ company, token, realm })  a QuickBooks Online v3 API subset:
//       GET /v3/company/:realm/query?query=select * from <Entity> [where …] STARTPOSITION n MAXRESULTS m
//       GET /v3/company/:realm/cdc?entities=A,B&changedSince=ISO
//     Bearer token checked (401 otherwise). Supported where-clauses: `Active IN (true, false)`,
//     `TxnDate >= 'd'`, `TxnDate < 'd'`, `Balance > '0'`, joined by AND.
//     .touch(entity, id, patch) changes a row and bumps its MetaData.LastUpdatedTime (for CDC).
//   startAnthropic()  POST /v1/messages answering the qbo.match_suggest_ai prompt: for each customer,
//     the candidate household whose name says "family" (else the first), confidence 0.9.
//     .requests keeps every request body, so a test can check what left the database.
const http = require('http');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

function matches(row, cond) {
  const c = cond.trim();
  let m;
  if (/^Active\s+IN\s*\(\s*true\s*,\s*false\s*\)$/i.test(c)) return true;
  if ((m = c.match(/^(\w+)\s*(>=|<=|>|<|=)\s*'([^']*)'$/))) {
    const [, field, op, raw] = m;
    const v = row[field];
    const a = typeof v === 'number' ? v : String(v ?? '');
    const b = typeof v === 'number' ? Number(raw) : raw;
    return op === '>=' ? a >= b : op === '<=' ? a <= b : op === '>' ? a > b : op === '<' ? a < b : a === b;
  }
  throw new Error(`mock: unsupported condition ${c}`);
}

async function startQbo({ company, token = 'mock-access-token', realm = '9130355' } = {}) {
  const data = JSON.parse(JSON.stringify(company));
  const started = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  for (const [k, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) r.MetaData = { CreateTime: started, LastUpdatedTime: started, ...(r.MetaData || {}) };
    data[k] = rows;
  }
  const log = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push(`${req.method} ${url.pathname}${url.search}`);
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== `Bearer ${token}`) {
      return send(401, { Fault: { Error: [{ Message: 'AuthenticationFailed', Detail: 'Token expired', code: '3200' }], type: 'AUTHENTICATION' } });
    }
    const m = url.pathname.match(/^\/v3\/company\/([^/]+)\/(query|cdc)$/);
    if (!m || m[1] !== realm) return send(404, { Fault: { Error: [{ Message: 'Not found' }] } });
    if (m[2] === 'query') {
      const q = url.searchParams.get('query') || '';
      const qm = q.match(/^select \* from (\w+)(?: where (.*?))?\s+STARTPOSITION (\d+) MAXRESULTS (\d+)$/i);
      if (!qm) return send(400, { Fault: { Error: [{ Message: 'QueryParserError', Detail: q }] } });
      const [, entity, where, start, max] = qm;
      let rows = (data[entity] || []).filter((r) => !where || where.split(/\s+AND\s+/i).every((c) => matches(r, c)));
      if (entity === 'Customer' && !(where || '').match(/Active/i)) rows = rows.filter((r) => r.Active !== false);
      const page = rows.slice(Number(start) - 1, Number(start) - 1 + Number(max));
      return send(200, { QueryResponse: { [entity]: page, startPosition: Number(start), maxResults: page.length }, time: new Date().toISOString() });
    }
    const since = url.searchParams.get('changedSince') || '';
    const entities = (url.searchParams.get('entities') || '').split(',').filter(Boolean);
    const qr = entities.map((e) => ({ [e]: (data[e] || []).filter((r) => r.MetaData.LastUpdatedTime >= since), startPosition: 1 }));
    return send(200, { CDCResponse: [{ QueryResponse: qr }], time: new Date().toISOString() });
  });
  const url = await listen(server);
  return {
    url, log, data,
    touch(entity, id, patch) {
      const row = (data[entity] || []).find((r) => r.Id === id);
      if (!row) throw new Error(`mock: no ${entity} ${id}`);
      Object.assign(row, patch, { MetaData: { ...row.MetaData, LastUpdatedTime: new Date().toISOString() } });
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

async function startAnthropic() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      requests.push(b);
      let body = {};
      try { body = JSON.parse(b); } catch { /* answered below */ }
      const text = String(((body.messages || [])[0] || {}).content || '');
      const matches = [];
      let current = null;
      for (const line of text.split('\n')) {
        let m;
        if ((m = line.match(/^QuickBooks customer (\S+): /))) { current = { qbo_id: m[1], cands: [] }; matches.push(current); }
        else if ((m = line.match(/^\s+- household ([0-9a-f-]{36}): "([^"]*)"/)) && current) current.cands.push({ id: m[1], name: m[2] });
      }
      const out = matches.map((c) => {
        const pick = c.cands.find((h) => /family/i.test(h.name)) || c.cands[0];
        return { qbo_id: c.qbo_id, household_id: pick ? pick.id : null, confidence: 0.9, reason: pick ? `"${pick.name}" is the family most likely behind this QuickBooks name.` : 'No household fits.' };
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_mock', type: 'message', role: 'assistant', model: body.model || 'claude-opus-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({ matches: out }) }], usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });
  const url = await listen(server);
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}

module.exports = { startQbo, startAnthropic };

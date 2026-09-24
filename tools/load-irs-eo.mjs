#!/usr/bin/env node
// Load the IRS Tax Exempt Organization Search bulk data into app.irs_exempt_orgs,
// which app.irs_lookup reads (Setup › Legal identity, Platform › Verification).
//
//   node tools/load-irs-eo.mjs --bmf eo1.csv --bmf eo2.csv --bmf eo3.csv --bmf eo4.csv \
//        --pub78 data-download-pub78.txt [--revocations data-download-revocation.txt] \
//        [--db postgres://…] [--dry-run]
//
// Sources (refreshed monthly by the IRS; download and unzip them first):
//   --bmf          Exempt Organizations Business Master File extract, CSV with a header
//                  (EIN,NAME,ICO,STREET,CITY,STATE,ZIP,GROUP,SUBSECTION,…,DEDUCTIBILITY,…,STATUS,…)
//                  https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf
//   --pub78        Publication 78 data, pipe-delimited, no header: EIN|Name|City|State|Country|Deductibility codes
//   --revocations  Automatic Revocation of Exemption list, pipe-delimited, no header:
//                  EIN|Legal Name|DBA|Address|City|State|ZIP|Country|Exemption Type|Revocation Date|Posting Date|Reinstatement Date
// Each may be a local path or an http(s) URL of the plain (unzipped) file. Pass every file
// in one run: a run rewrites the stored fields of each EIN it contains from that run's files.
//
// The database is DATABASE_URL, SUPABASE_DB_URL or --db. Rows are upserted by EIN in one
// transaction through psql; the per-row audit trigger is paused for the bulk load and a
// single 'irs_exempt_orgs.load' audit entry records the counts and files instead.
// Tests use small fixture files; never download the full IRS files in tests.

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

/** Split one CSV line (RFC 4180 quoting; the BMF has no embedded newlines). */
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "12-3456789", "123456789", " 012345678 " → "123456789"; anything else → null. */
export function normalizeEin(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  return /^\d{9}$/.test(d) ? d : null;
}

function clean(v) {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s === "" ? null : s;
}

/** One BMF row (fields by header name) → a record, or null when the EIN is unusable. */
export function bmfRecord(fields, header) {
  const get = (name) => fields[header.indexOf(name)];
  const ein = normalizeEin(get("EIN"));
  const name = clean(get("NAME"));
  if (!ein || !name) return null;
  return {
    ein,
    name,
    city: clean(get("CITY")),
    state: clean(get("STATE")),
    subsection: clean(get("SUBSECTION")),
    deductibility: clean(get("DEDUCTIBILITY")),
  };
}

/** One Pub. 78 line → a record, or null. */
export function pub78Record(line) {
  const f = line.split("|");
  const ein = normalizeEin(f[0]);
  const name = clean(f[1]);
  if (!ein || !name) return null;
  return { ein, name, city: clean(f[2]), state: clean(f[3]), deductibility: clean(f[5]) };
}

const MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

/** "15-MAY-2020" or "2020-05-15" or "05/15/2020" → "2020-05-15"; else null. */
export function irsDate(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  let m = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(s);
  if (m && MONTHS[m[2]]) return `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** One revocation line → a record (reinstated ones are not revoked any more), or null. */
export function revocationRecord(line) {
  const f = line.split("|");
  const ein = normalizeEin(f[0]);
  const name = clean(f[1]);
  if (!ein || !name) return null;
  return { ein, name, city: clean(f[4]), state: clean(f[5]), revokedOn: irsDate(f[9]), reinstatedOn: irsDate(f[11]) };
}

/**
 * @typedef {{ein: string, name: string, city: string|null, state: string|null, subsection: string|null, deductibility: string|null}} BmfRecord
 * @typedef {{ein: string, name: string, city: string|null, state: string|null, deductibility: string|null}} Pub78Record
 * @typedef {{ein: string, name: string, city: string|null, state: string|null, revokedOn: string|null, reinstatedOn: string|null}} RevocationRecord
 */

/**
 * Merge the three sources into rows for app.irs_exempt_orgs:
 * in the BMF → active (Pub. 78 flags it); only in Pub. 78 → pub78_only;
 * revoked and not reinstated and not back in the BMF → revoked.
 * @param {{bmf?: BmfRecord[], pub78?: Pub78Record[], revocations?: RevocationRecord[]}} sources
 */
export function mergeSources({ bmf = [], pub78 = [], revocations = [] }) {
  const rows = new Map();
  for (const r of bmf) {
    rows.set(r.ein, { ein: r.ein, name: r.name, city: r.city, state: r.state, subsection: r.subsection, deductibility: r.deductibility, status: "active", sources: new Set(["eo_bmf"]), in_pub78: false, revoked_on: null });
  }
  for (const r of pub78) {
    const row = rows.get(r.ein);
    if (row) {
      row.in_pub78 = true;
      row.sources.add("pub78");
      if (!row.deductibility) row.deductibility = r.deductibility;
    } else {
      rows.set(r.ein, { ein: r.ein, name: r.name, city: r.city, state: r.state, subsection: null, deductibility: r.deductibility, status: "pub78_only", sources: new Set(["pub78"]), in_pub78: true, revoked_on: null });
    }
  }
  for (const r of revocations) {
    if (r.reinstatedOn) continue;
    const row = rows.get(r.ein);
    if (row && row.sources.has("eo_bmf")) continue; // back in the current master file
    if (row) {
      row.status = "revoked";
      row.revoked_on = r.revokedOn;
      row.sources.add("revocation");
    } else {
      rows.set(r.ein, { ein: r.ein, name: r.name, city: r.city, state: r.state, subsection: null, deductibility: null, status: "revoked", sources: new Set(["revocation"]), in_pub78: false, revoked_on: r.revokedOn });
    }
  }
  return [...rows.values()].map((r) => ({ ...r, source: [...r.sources].join("+"), sources: undefined }));
}

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A row as a CSV line for COPY (empty = NULL). */
export function copyLine(r) {
  return [r.ein, r.name, r.city, r.state, r.subsection, r.deductibility, r.status, r.source, r.in_pub78 ? "t" : "f", r.revoked_on].map(csvCell).join(",");
}

// ── IO ─────────────────────────────────────────────────────────────────────
async function* lines(source) {
  let input;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok || !res.body) throw new Error(`could not download ${source}: HTTP ${res.status}`);
    input = Readable.fromWeb(res.body);
  } else {
    input = createReadStream(source);
  }
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) yield line.replace(/^\uFEFF/, "");
}

async function readBmf(source) {
  const out = [];
  let header = null;
  let skipped = 0;
  for await (const line of lines(source)) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!header) {
      header = fields.map((h) => h.trim().toUpperCase());
      if (!header.includes("EIN") || !header.includes("NAME")) throw new Error(`${source} is not an EO BMF file (no EIN/NAME header)`);
      continue;
    }
    const r = bmfRecord(fields, header);
    if (r) out.push(r);
    else skipped++;
  }
  return { rows: out, skipped };
}

async function readPiped(source, parse) {
  const out = [];
  let skipped = 0;
  for await (const line of lines(source)) {
    if (!line.trim()) continue;
    const r = parse(line);
    if (r) out.push(r);
    else skipped++;
  }
  return { rows: out, skipped };
}

function parseArgs(argv) {
  const a = { bmf: [], pub78: [], revocations: [], db: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const val = argv[++i];
      if (!val) throw new Error(`${k} needs a value`);
      return val;
    };
    if (k === "--bmf") a.bmf.push(v());
    else if (k === "--pub78") a.pub78.push(v());
    else if (k === "--revocations") a.revocations.push(v());
    else if (k === "--db") a.db = v();
    else if (k === "--dry-run") a.dryRun = true;
    else throw new Error(`unknown option ${k}`);
  }
  if (a.bmf.length + a.pub78.length + a.revocations.length === 0) throw new Error("give at least one --bmf, --pub78 or --revocations file");
  if (!a.dryRun && !a.db) throw new Error("set DATABASE_URL (or --db) to the database to load into");
  return a;
}

function sqlLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function runPsql(db, script) {
  return new Promise((resolve, reject) => {
    const p = spawn("psql", [db, "-qX", "-v", "ON_ERROR_STOP=1"], { stdio: ["pipe", "inherit", "inherit"] });
    p.on("error", (e) => reject(new Error(`could not start psql: ${e.message}`)));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`psql exited with code ${code}; nothing was loaded`))));
    p.stdin.on("error", (e) => reject(new Error(`could not write to psql: ${e.message}`)));
    Readable.from(script).pipe(p.stdin);
  });
}

function* loadScript(rows, summary) {
  yield "begin;\n";
  yield "create temp table irs_load (ein text, name text, city text, state text, subsection text, deductibility text, status text, source text, in_pub78 boolean, revoked_on date) on commit drop;\n";
  yield "\\copy irs_load from stdin with (format csv)\n";
  for (const r of rows) yield `${copyLine(r)}\n`;
  yield "\\.\n";
  yield "alter table app.irs_exempt_orgs disable trigger audit_irs_exempt_orgs;\n";
  yield `insert into app.irs_exempt_orgs (ein, name, city, state, subsection, deductibility, status, source, in_pub78, revoked_on, loaded_at)
select ein, name, city, state, subsection, deductibility, status, source, coalesce(in_pub78, false), revoked_on, now() from irs_load
on conflict (ein) do update set name = excluded.name, city = excluded.city, state = excluded.state, subsection = excluded.subsection,
  deductibility = excluded.deductibility, status = excluded.status, source = excluded.source, in_pub78 = excluded.in_pub78,
  revoked_on = excluded.revoked_on, loaded_at = excluded.loaded_at;\n`;
  yield "alter table app.irs_exempt_orgs enable trigger audit_irs_exempt_orgs;\n";
  yield "\\o /dev/null\n";
  yield `select set_config('app.client_app', 'job', true);\n`;
  yield `select app.log_audit(null, 'irs_exempt_orgs.load', 'irs_exempt_orgs', 'bulk', null, ${sqlLiteral(JSON.stringify(summary))}::jsonb, 'IRS exempt-organization data refresh');\n`;
  yield "\\o\n";
  yield "commit;\n";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bmf = [];
  const pub78 = [];
  const revocations = [];
  const files = [];
  for (const f of args.bmf) {
    const r = await readBmf(f);
    bmf.push(...r.rows);
    files.push({ file: f, kind: "eo_bmf", rows: r.rows.length, skipped: r.skipped });
  }
  for (const f of args.pub78) {
    const r = await readPiped(f, pub78Record);
    pub78.push(...r.rows);
    files.push({ file: f, kind: "pub78", rows: r.rows.length, skipped: r.skipped });
  }
  for (const f of args.revocations) {
    const r = await readPiped(f, revocationRecord);
    revocations.push(...r.rows);
    files.push({ file: f, kind: "revocation", rows: r.rows.length, skipped: r.skipped });
  }
  const rows = mergeSources({ bmf, pub78, revocations });
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const summary = { rows: rows.length, counts, files: files.map((f) => ({ ...f, file: f.file.split("/").pop() })) };
  for (const f of files) console.log(`read ${f.kind} ${f.file}: ${f.rows} rows${f.skipped ? `, ${f.skipped} skipped (no usable EIN or name)` : ""}`);
  console.log(`merged: ${rows.length} organizations (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")})`);
  if (args.dryRun) {
    console.log("dry run: nothing written");
    return;
  }
  await runPsql(args.db, loadScript(rows, summary));
  console.log(`loaded ${rows.length} organizations into app.irs_exempt_orgs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`load-irs-eo: ${e.message}`);
    process.exit(1);
  });
}

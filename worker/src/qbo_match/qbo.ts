// QuickBooks Online reads for donor matching (o-qbo-match): customers and
// their history, and the pure mapping from QuickBooks JSON to the rows that
// app.qbo_worker_store_customers / app.qbo_worker_store_transactions take.
//
// The connection (Intuit OAuth, token refresh) belongs to o-quickbooks. Here:
//   - the access token comes from the vault (ctx.secret(connection, "access_token"));
//   - the realm (company ID) from integration_connections.external_account_id;
//   - the base URL from INTUIT_API_BASE, else Intuit's production or sandbox
//     host by the connection's mode. Tests point INTUIT_API_BASE at a local mock.

import type { Env } from "../config";
import { HttpError, type Http } from "../http";

export const QBO_PRODUCTION = "https://quickbooks.api.intuit.com";
export const QBO_SANDBOX = "https://sandbox-quickbooks.api.intuit.com";
export const MINOR_VERSION = "75";
export const PAGE_SIZE = 1000;

/** The transaction types pulled for each customer (JournalEntry / Deposit carry no donor). */
export const TXN_TYPES = ["SalesReceipt", "Payment", "Invoice", "CreditMemo", "RefundReceipt"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export function apiBase(env: Env, mode: string | null | undefined): string {
  const override = env.INTUIT_API_BASE?.trim();
  if (override) return override.replace(/\/+$/, "");
  return mode === "test" ? QBO_SANDBOX : QBO_PRODUCTION;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Dollars (QuickBooks sends numbers) → integer cents. */
export function cents(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** A phone as QuickBooks shows it → E.164 (US numbers without a country code get +1), or null. */
export function toE164(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const plus = s.trim().startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (plus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export type CustomerRow = {
  qbo_id: string;
  display_name: string;
  given_name: string | null;
  family_name: string | null;
  company_name: string | null;
  emails: string[];
  phones: string[];
  address: Record<string, string>;
  parent_qbo_id: string | null;
  is_sub_customer: boolean;
  active: boolean;
  open_balance_cents: number;
  raw: Obj;
};

export function mapCustomer(c: unknown): CustomerRow | null {
  const o = obj(c);
  const id = str(o.Id);
  if (!id) return null;
  const addr = obj(o.BillAddr);
  const address: Record<string, string> = {};
  for (const [k, from] of [["line1", "Line1"], ["line2", "Line2"], ["city", "City"], ["state", "CountrySubDivisionCode"], ["zip", "PostalCode"], ["country", "Country"]] as const) {
    const v = str(addr[from]);
    if (v) address[k] = v;
  }
  const emails = [str(obj(o.PrimaryEmailAddr).Address)]
    .flatMap((e) => (e ? e.split(/[,;\s]+/) : []))
    .map((e) => e.toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  const phones = [obj(o.PrimaryPhone).FreeFormNumber, obj(o.Mobile).FreeFormNumber, obj(o.AlternatePhone).FreeFormNumber]
    .map(toE164)
    .filter((p): p is string => p !== null);
  const parent = str(obj(o.ParentRef).value);
  return {
    qbo_id: id,
    display_name: str(o.DisplayName) ?? str(o.FullyQualifiedName) ?? `QuickBooks customer ${id}`,
    given_name: str(o.GivenName),
    family_name: str(o.FamilyName),
    company_name: str(o.CompanyName),
    emails: [...new Set(emails)],
    phones: [...new Set(phones)],
    address,
    parent_qbo_id: parent,
    is_sub_customer: o.Job === true || parent !== null,
    active: o.Active !== false,
    open_balance_cents: cents(o.Balance),
    raw: o,
  };
}

export type TxnLine = { amount_cents: number; description: string | null; item: string | null; account: string | null; class_id: string | null; class_name: string | null };
export type TxnLink = { type: string; id: string; amount_cents: number };
export type TransactionRow = {
  qbo_type: TxnType;
  qbo_id: string;
  customer_qbo_id: string | null;
  txn_date: string;
  doc_number: string | null;
  total_cents: number;
  open_balance_cents: number;
  memo: string | null;
  lines: TxnLine[];
  linked: TxnLink[];
  payment_method: string | null;
  reference_number: string | null;
  raw: Obj;
};

function mapLine(l: Obj, txnClass: Obj): TxnLine | null {
  const type = str(l.DetailType);
  if (type === "SubTotalLineDetail" || type === "DiscountLineDetail" || type === "GroupLineDetail") return null;
  const detail = obj(l[type ?? ""] ?? l.SalesItemLineDetail);
  const cls = Object.keys(obj(detail.ClassRef)).length ? obj(detail.ClassRef) : txnClass;
  return {
    amount_cents: cents(l.Amount),
    description: str(l.Description),
    item: str(obj(detail.ItemRef).name),
    account: str(obj(detail.AccountRef).name),
    class_id: str(cls.value),
    class_name: str(cls.name),
  };
}

/** Payment → invoices it paid, from its lines' LinkedTxn (each line's Amount is what went to that invoice). */
function paymentLinks(o: Obj): TxnLink[] {
  const out: TxnLink[] = [];
  for (const line of arr(o.Line)) {
    const l = obj(line);
    const amount = cents(l.Amount);
    for (const lt of arr(l.LinkedTxn)) {
      const x = obj(lt);
      const id = str(x.TxnId);
      const type = str(x.TxnType);
      if (id && type) out.push({ type, id, amount_cents: amount });
    }
  }
  return out;
}

export function mapTransaction(type: TxnType, t: unknown): TransactionRow | null {
  const o = obj(t);
  const id = str(o.Id);
  const date = str(o.TxnDate);
  if (!id || !date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const txnClass = obj(o.ClassRef);
  const lines = type === "Payment" ? [] : arr(o.Line).map((l) => mapLine(obj(l), txnClass)).filter((l): l is TxnLine => l !== null);
  const total = cents(o.TotalAmt);
  const open = type === "Invoice" ? cents(o.Balance) : type === "CreditMemo" ? cents(o.RemainingCredit) : 0;
  return {
    qbo_type: type,
    qbo_id: id,
    customer_qbo_id: str(obj(o.CustomerRef).value),
    txn_date: date.slice(0, 10),
    doc_number: str(o.DocNumber),
    total_cents: total,
    open_balance_cents: open,
    memo: str(o.PrivateNote) ?? str(obj(o.CustomerMemo).value),
    lines,
    linked: type === "Payment" ? paymentLinks(o) : arr(o.LinkedTxn).flatMap((lt) => {
      const x = obj(lt);
      const lid = str(x.TxnId);
      const ltype = str(x.TxnType);
      return lid && ltype ? [{ type: ltype, id: lid, amount_cents: 0 }] : [];
    }),
    payment_method: str(obj(o.PaymentMethodRef).name),
    reference_number: str(o.PaymentRefNum),
    raw: o,
  };
}

/** QuickBooks' query language: a string literal. */
export function qLiteral(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export type QboClient = {
  /** Every row of a query, page by page (STARTPOSITION / MAXRESULTS). */
  queryAll(entity: string, where?: string): Promise<Obj[]>;
  /** Change data capture since a time: entity → rows (deleted rows carry status "Deleted"). */
  cdc(entities: string[], since: string): Promise<Record<string, Obj[]>>;
};

export class QboAuthError extends Error {
  override name = "QboAuthError";
}

/** What QuickBooks said, in plain words (its Fault.Error[].Message / Detail). */
export function faultMessage(body: unknown): string | null {
  const f = obj(obj(body).Fault ?? obj(body).fault);
  const e = obj(arr(f.Error ?? f.error)[0]);
  const m = [str(e.Message), str(e.Detail)].filter(Boolean).join(": ");
  return m || null;
}

export function createQboClient(http: Http, base: string, realm: string, token: string, opts: { pageSize?: number; timeoutMs?: number } = {}): QboClient {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const root = `${base}/v3/company/${encodeURIComponent(realm)}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  async function get(path: string): Promise<Obj> {
    const res = await http.request(`${root}${path}`, { headers, timeoutMs: opts.timeoutMs ?? 30000, retries: 3, backoffMs: 1000 });
    if (res.status === 401 || res.status === 403) {
      throw new QboAuthError(`QuickBooks refused the access token (${res.status}); it may have expired. The token refresh renews it and the pull tries again.`);
    }
    if (!res.ok) {
      let detail: string | null = null;
      try {
        detail = faultMessage(JSON.parse(res.text));
      } catch {
        detail = null;
      }
      throw new HttpError(`QuickBooks answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
    }
    return obj(res.json());
  }

  return {
    async queryAll(entity, where) {
      const out: Obj[] = [];
      for (let start = 1; ; start += pageSize) {
        const q = `select * from ${entity}${where ? ` where ${where}` : ""} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
        const body = await get(`/query?query=${encodeURIComponent(q)}&minorversion=${MINOR_VERSION}`);
        const rows = arr(obj(body.QueryResponse)[entity]).map(obj);
        out.push(...rows);
        if (rows.length < pageSize) break;
        if (out.length > 500_000) throw new Error(`QuickBooks returned more than 500,000 ${entity} rows; stopped to protect the database.`);
      }
      return out;
    },
    async cdc(entities, since) {
      const body = await get(`/cdc?entities=${encodeURIComponent(entities.join(","))}&changedSince=${encodeURIComponent(since)}&minorversion=${MINOR_VERSION}`);
      const out: Record<string, Obj[]> = {};
      for (const r of arr(body.CDCResponse)) {
        for (const qr of arr(obj(r).QueryResponse)) {
          for (const [k, v] of Object.entries(obj(qr))) {
            if (Array.isArray(v)) out[k] = [...(out[k] ?? []), ...v.map(obj)];
          }
        }
      }
      return out;
    },
  };
}

/** The first day of the history window (years back from today). */
export function windowStart(years: number, today = new Date()): string {
  const d = new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()));
  return d.toISOString().slice(0, 10);
}

/** Split into batches for the store functions. */
export function batches<T>(rows: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

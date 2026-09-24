// qbo.pull_lists: pull the chart of accounts, classes, locations, items, tax
// codes and payment methods from the connected QuickBooks company into the
// read-only copies (plan §1.7.2). Queued after connecting, daily by the hourly
// round (qbo.refresh_token), and by "Pull now". Payload: { connection_id }.
// The copies are written only through app.qbo_worker_store_list; the run and
// the rename/inactive warnings through app.qbo_worker_pull_done.

import { providerStatus, type Env } from "../config";
import { messageOf, PermanentError } from "../errors";
import { QboClient } from "../qbo/client";
import type { Job, JobContext } from "../types";

export const kind = "qbo.pull_lists";

export const configured = (env: Env) => providerStatus(env, "intuit");

type Row = Record<string, unknown>;
type Ref = { value?: string } | undefined;

const str = (v: unknown) => (typeof v === "string" ? v : null);
const active = (r: Row) => r.Active !== false;

/** QuickBooks entity -> our list name, and how a row maps. Pure (tested). */
export const LISTS: { list: string; entity: string; map: (r: Row) => Row }[] = [
  {
    list: "accounts",
    entity: "Account",
    map: (r) => ({
      qbo_id: str(r.Id), name: str(r.Name), fully_qualified_name: str(r.FullyQualifiedName), account_type: str(r.AccountType),
      account_sub_type: str(r.AccountSubType), classification: str(r.Classification), active: active(r),
      currency: str((r.CurrencyRef as Ref)?.value), raw: r,
    }),
  },
  { list: "classes", entity: "Class", map: (r) => ({ qbo_id: str(r.Id), name: str(r.FullyQualifiedName) ?? str(r.Name), active: active(r), raw: r }) },
  { list: "locations", entity: "Department", map: (r) => ({ qbo_id: str(r.Id), name: str(r.FullyQualifiedName) ?? str(r.Name), active: active(r), raw: r }) },
  { list: "items", entity: "Item", map: (r) => ({ qbo_id: str(r.Id), name: str(r.FullyQualifiedName) ?? str(r.Name), active: active(r), raw: r }) },
  { list: "tax_codes", entity: "TaxCode", map: (r) => ({ qbo_id: str(r.Id), name: str(r.Name), active: active(r), raw: r }) },
  { list: "payment_methods", entity: "PaymentMethod", map: (r) => ({ qbo_id: str(r.Id), name: str(r.Name), active: active(r), raw: r }) },
];

export async function run(job: Job, ctx: JobContext) {
  const id = job.payload?.connection_id;
  if (typeof id !== "string") throw new PermanentError("qbo.pull_lists: connection_id is required.");
  const counts: Record<string, number> = {};
  const changed: Record<string, number> = {};
  try {
    const qbo = await QboClient.open(ctx, id);
    for (const l of LISTS) {
      const rows = (await qbo.queryAll<Row>(l.entity, "Active IN (true, false)")).map(l.map).filter((r) => r.qbo_id);
      counts[l.list] = rows.length;
      const n = await ctx.db.query<{ n: number }>("select app.qbo_worker_store_list($1, $2, $3) as n", [id, l.list, JSON.stringify(rows)]);
      changed[l.list] = Number(n[0]?.n ?? 0);
    }
  } catch (err) {
    const msg = messageOf(err);
    try {
      await ctx.db.query("select app.qbo_worker_pull_done($1, $2, false, $3, $4, $5)", [id, job.id, JSON.stringify(counts), JSON.stringify(changed), msg]);
    } catch (recordErr) {
      ctx.log.error("could not record the failed QuickBooks pull", { error: recordErr });
    }
    throw err;
  }
  const done = await ctx.db.query<{ r: { warnings: unknown[] } }>("select app.qbo_worker_pull_done($1, $2, true, $3, $4, null) as r", [
    id, job.id, JSON.stringify(counts), JSON.stringify(changed),
  ]);
  const warnings = done[0]?.r?.warnings ?? [];
  ctx.log.info("QuickBooks lists pulled", { counts, changed, warnings: warnings.length });
  return { counts, changed, warnings: warnings.length };
}

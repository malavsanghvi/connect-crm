// qbo.test_post: one SalesReceipt, RefundReceipt, Deposit and JournalEntry of
// $1.00, built from the approved mapping exactly like real postings (plan
// §1.7.5). Payload { test_id }.
//   post     creates them in the connected company (an Intuit sandbox company,
//            or a live company's real books when the treasurer confirmed it);
//   dry_run  the real company connected read-only: creates nothing, reads every
//            account, item and class the documents use back from QuickBooks and
//            reports the JSON that would be sent.
// The result goes to app.qbo_test_posts for the treasurer to approve.

import { providerStatus, type Env } from "../config";
import { messageOf, PermanentError } from "../errors";
import { QboClient } from "../qbo/client";
import { references, toQbo, totalCents, type QboDoc } from "../qbo/documents";
import type { Job, JobContext } from "../types";

export const kind = "qbo.test_post";
export const configured = (env: Env) => providerStatus(env, "intuit");

type Plan = { ok: boolean; error?: string; mode?: "post" | "dry_run"; connection_id?: string; docs?: QboDoc[] };
type Result = { entity: string; ok: boolean; qbo_id?: string; doc_number?: string | null; total_cents?: number; error?: string; checked?: string[]; body?: unknown };

async function checkRefs(qbo: QboClient, doc: QboDoc): Promise<string[]> {
  const refs = references(doc);
  const problems: string[] = [];
  const lookups: [string, string[]][] = [["Account", refs.accounts], ["Item", refs.items], ["Class", refs.classes]];
  for (const [entity, ids] of lookups) {
    if (ids.length === 0) continue;
    const rows = await qbo.queryAll<{ Id: string; Name?: string; Active?: boolean }>(entity, `Id in (${ids.map((i) => `'${i.replace(/'/g, "")}'`).join(", ")})`);
    for (const id of ids) {
      const r = rows.find((x) => x.Id === id);
      if (!r) problems.push(`${entity} ${id} is not in QuickBooks`);
      else if (r.Active === false) problems.push(`${entity} "${r.Name ?? id}" is inactive in QuickBooks`);
    }
  }
  return problems;
}

export async function run(job: Job, ctx: JobContext) {
  const testId = job.payload?.test_id;
  if (typeof testId !== "string") throw new PermanentError("qbo.test_post: test_id is required.");
  const plan = (await ctx.db.query<{ p: Plan }>("select app.qbo_worker_test_post_plan($1) as p", [testId]))[0]?.p;
  if (!plan?.ok) return { ok: false, error: plan?.error ?? "The test post could not be planned." };

  const results: Result[] = [];
  let qbo: QboClient;
  try {
    qbo = await QboClient.open(ctx, plan.connection_id!);
  } catch (err) {
    await ctx.db.query("select app.qbo_worker_test_post_done($1, false, '[]', $2)", [testId, messageOf(err)]);
    throw err;
  }
  for (const doc of plan.docs ?? []) {
    try {
      const body = toQbo(doc);
      if (plan.mode === "dry_run") {
        const problems = await checkRefs(qbo, doc);
        results.push({ entity: doc.entity, ok: problems.length === 0, total_cents: totalCents(doc), checked: problems.length ? problems : ["every account, item and class exists and is active"], error: problems.join("; ") || undefined, body });
      } else {
        const saved = await qbo.create(doc.entity, body, `${testId}-${doc.entity}`);
        results.push({ entity: doc.entity, ok: true, qbo_id: saved.Id, doc_number: doc.doc_number ?? null, total_cents: totalCents(doc) });
      }
    } catch (err) {
      results.push({ entity: doc.entity, ok: false, error: messageOf(err) });
    }
  }
  const ok = results.length === 4 && results.every((r) => r.ok);
  const firstError = results.find((r) => !r.ok);
  await ctx.db.query("select app.qbo_worker_test_post_done($1, $2, $3, $4)", [
    testId, ok, JSON.stringify(results), ok ? null : `${firstError?.entity}: ${firstError?.error}`,
  ]);
  ctx.log.info("QuickBooks test post finished", { test: testId, mode: plan.mode, ok });
  return { ok, mode: plan.mode, results: results.map(({ body: _b, ...r }) => r) };
}

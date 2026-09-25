// qbo.post: the poster. Takes the center's queued ledger postings from the
// database (app.qbo_worker_claim decides what may post: never history, never
// before the go-live date, never into a closed month, never to a read-only
// company, only with an approved mapping and test post) and creates each one
// in QuickBooks once: requestid = the posting's id, so a retry after a lost
// answer gets the first result back instead of a second entry.
//
// A pledge write-off from a QuickBooks invoice posts a CreditMemo and then
// applies it to that invoice with a $0 Payment (requestid = the posting id +
// "-apply"), as QuickBooks applies credits.
//
// CustomerRef comes from the donor matching stream's app.qbo_customer_for; when
// that is not built yet the entries post without a customer and this says so
// once in the log.

import { providerStatus, type Env } from "../config";
import { isRetryable, messageOf } from "../errors";
import { QboClient, QboRejectedError } from "../qbo/client";
import { applyCreditMemo, toQbo, type QboDoc } from "../qbo/documents";
import { ReconnectNeededError } from "../qbo/intuit";
import type { Job, JobContext } from "../types";

export const kind = "qbo.post";
export const configured = (env: Env) => providerStatus(env, "intuit");

type Unit = { unit_id: string; posting_ids: string[]; doc: QboDoc };
type Claim = { ready: boolean; reason?: string; realm_connection?: string; units: Unit[]; skipped?: number; failed?: number };

let warnedNoMatching = false;
/** Log once per process that donor matching is not there yet (tests reset it). */
export function noteCustomerStatus(ctx: JobContext, status: string | null | undefined): void {
  if (status === "not_built" && !warnedNoMatching) {
    warnedNoMatching = true;
    ctx.log.warn("donor matching (app.qbo_customer_for) is not built yet: entries post to QuickBooks without a customer");
  }
}
export function resetWarnings(): void {
  warnedNoMatching = false;
}

export async function run(job: Job, ctx: JobContext) {
  if (!job.center_id) throw new Error("qbo.post runs for one community (center_id).");
  const totals = { posted: 0, failed: 0, retrying: 0, skipped: 0, rounds: 0 };
  let qbo: QboClient | null = null;
  for (let round = 0; round < 20; round++) {
    const claim = (await ctx.db.query<{ c: Claim }>("select app.qbo_worker_claim($1, 25) as c", [job.center_id]))[0]?.c;
    if (!claim) throw new Error("The poster got no answer from the database.");
    totals.rounds++;
    totals.skipped += claim.skipped ?? 0;
    totals.failed += claim.failed ?? 0;
    if (!claim.ready) return { ...totals, ready: false, reason: claim.reason };
    if (claim.units.length === 0) break;
    qbo ??= await QboClient.open(ctx, claim.realm_connection!);
    for (const u of claim.units) {
      noteCustomerStatus(ctx, u.doc.customer_status);
      try {
        const saved = await qbo.create(u.doc.entity, toQbo(u.doc), u.unit_id);
        // A pledge write-off's credit memo is applied to the invoice it came from (same requestid rule:
        // a retry after a lost answer gets the first Payment back, never a second).
        if (u.doc.entity === "CreditMemo" && u.doc.apply_to_invoice) {
          try {
            await qbo.create("Payment", applyCreditMemo(u.doc, saved.Id), `${u.unit_id}-apply`);
          } catch (err) {
            if (err instanceof QboRejectedError) {
              throw new QboRejectedError(`QuickBooks created credit memo ${saved.Id} but would not apply it to invoice ${u.doc.apply_to_invoice}: ${messageOf(err)}`);
            }
            throw err;
          }
        }
        await ctx.db.query("select app.qbo_worker_posting_done($1::uuid[], $2, $3, $4)", [u.posting_ids, u.doc.entity, saved.Id, job.id]);
        totals.posted += u.posting_ids.length;
      } catch (err) {
        const retry = !(err instanceof QboRejectedError) && isRetryable(err);
        await ctx.db.query("select app.qbo_worker_posting_failed($1::uuid[], $2, $3, $4)", [u.posting_ids, messageOf(err), retry, job.id]);
        if (retry) totals.retrying += u.posting_ids.length;
        else totals.failed += u.posting_ids.length;
        ctx.log.error("QuickBooks posting failed", { unit: u.unit_id, entity: u.doc.entity, retry, error: err });
        // A dead sign-in fails everything else too: stop, the connection shows why.
        if (err instanceof ReconnectNeededError) return { ...totals, ready: false, reason: messageOf(err) };
        if (retry) return totals; // QuickBooks is unwell: leave the rest queued for the next run
      }
    }
  }
  ctx.log.info("QuickBooks posting run finished", totals);
  return totals;
}

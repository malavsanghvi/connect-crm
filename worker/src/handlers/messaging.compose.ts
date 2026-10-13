// messaging.compose: write one automatic email (0770) for one record and queue it for each recipient. Payload:
// { automation_id, ref_id, period? }. Queued by the database when a payment goes through, a pledge is recorded or someone
// registers for an event, while that email's switch is on (and by app.email_receipts_for_uploaded for uploaded donations).
//
//   1. app.worker_email_context: the community's place, so its age of majority is worked out here (src/lib/age-of-majority.ts).
//   2. app.worker_email_facts: the record's facts and its adult recipients, or why it gets no email (the database writes that
//      reason to the log once, so the treasurer sees it).
//   3. For each recipient: the values in the community's currency, locale and time zone, a child's name kept out
//      (src/lib/merge/build.ts), then app.worker_email_enqueue: once per record and address, through app.enqueue_notice, so
//      suppressions, opt-outs, the member's own switch and the sandbox's test recipients all apply.
// No provider secret is needed here (messaging.send does the sending), so it is always configured.

import { ageOfMajority } from "../../../src/lib/age-of-majority";
import { isEmailTrigger } from "../../../src/lib/merge/catalogue";
import { factValues, sendValues, type EmailFacts, type EmailRecipient } from "../../../src/lib/merge/build";
import { PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "messaging.compose";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ComposeResult = { automation_id: string; ref_id: string; queued: number; skipped: number; duplicate: number; reason?: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

export async function run(job: Job, ctx: JobContext): Promise<ComposeResult> {
  const automationId = String(job.payload.automation_id ?? "");
  const refId = String(job.payload.ref_id ?? "");
  const period = typeof job.payload.period === "string" ? job.payload.period : "";
  if (!UUID.test(automationId) || !UUID.test(refId)) {
    throw new PermanentError("messaging.compose needs an automation_id and a ref_id.");
  }
  const out: ComposeResult = { automation_id: automationId, ref_id: refId, queued: 0, skipped: 0, duplicate: 0 };

  const place = (await ctx.db.query<{ c: Record<string, unknown> | null }>("select app.worker_email_context($1::uuid) as c", [automationId]))[0]?.c;
  if (!place) {
    out.reason = "The automatic email no longer exists.";
    return out;
  }
  const majority = ageOfMajority({
    country: str(place.country),
    state_region: str(place.state_region),
    rules: { age_of_majority: place.age_of_majority },
  });

  const facts = (await ctx.db.query<{ f: EmailFacts | null }>(
    "select app.worker_email_facts($1::uuid, $2::uuid, $3::int) as f",
    [automationId, refId, majority],
  ))[0]?.f;
  if (!facts) throw new Error("The database returned no facts for the automatic email.");
  if (facts.skip) {
    out.reason = facts.skip;
    out.skipped = 1;
    ctx.log.info("messaging.compose: not sent", { automation: automationId, ref: refId, reason: facts.skip });
    return out;
  }
  const trigger = facts.automation?.key ?? facts.trigger;
  if (!isEmailTrigger(trigger)) throw new PermanentError(`Unknown automatic email "${String(trigger)}".`);

  const householdId = str(facts.household?.id) ?? "";
  for (const r of (facts.recipients ?? []) as EmailRecipient[]) {
    if (!str(r.address)) continue;
    const vars = sendValues(trigger, factValues(trigger, facts, r));
    const res = (await ctx.db.query<{ r: { outcome?: string; reason?: string | null } | null }>(
      "select app.worker_email_enqueue($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::jsonb) as r",
      [automationId, refId, period, UUID.test(householdId) ? householdId : null, r.person_id && UUID.test(r.person_id) ? r.person_id : null, r.address, JSON.stringify(vars)],
    ))[0]?.r;
    if (res?.outcome === "queued") out.queued += 1;
    else if (res?.outcome === "duplicate") out.duplicate += 1;
    else out.skipped += 1;
  }
  ctx.log.info("messaging.compose: automatic email written", { ...out });
  return out;
}

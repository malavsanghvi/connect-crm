// messaging.email_schedules_sweep: every 5 minutes, the scheduled emails (0771) whose time has come. For each run the database
// hands out (app.worker_email_schedules_due) the audience comes in batches of households (app.worker_email_schedule_batch); each
// adult's values are written in the community's currency, locale and time zone with a child's name kept out
// (src/lib/merge/build.ts scheduleValues) and the email is queued through app.worker_email_enqueue (0770): once per household,
// adult and run, with every consent rule of app.enqueue_notice. At most MAX_PER_RUN emails per scheduled email in one sweep
// (whole households only, so no adult of a household is left behind); a larger audience goes on in the next sweep, in the same
// run. The database claims each run for this sweep (two sweeps never take the same run); the sweep releases it when it stops
// early. When nothing is left, app.worker_email_schedule_done sets the next run. Platform-wide, scheduled by the generic `every`
// scheduler (worker/src/server.ts); no provider secret is needed here (messaging.send sends).

import { ageOfMajority } from "../../../src/lib/age-of-majority";
import { scheduleValues, sendValues, type EmailRecipient, type ScheduleFacts } from "../../../src/lib/merge/build";
import { isScheduleAudience, scheduleKey } from "../../../src/lib/merge/catalogue";
import type { Job, JobContext } from "../types";

export const kind = "messaging.email_schedules_sweep";
export const every = 300;

/** Runs taken per sweep. */
export const RUNS = 20;
/** Households per batch. */
export const BATCH = 100;
/** Emails per scheduled email in one sweep (the rate limit the owner approved). */
export const MAX_PER_RUN = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Due = { automation_id: string; period: string; audience: string };
type Batch = {
  center?: ScheduleFacts["center"];
  audience?: string;
  households?: { household: ScheduleFacts["household"]; recipients: EmailRecipient[]; data: ScheduleFacts["data"] }[];
  more?: boolean;
  stop?: string;
};

export type RunResult = { automation_id: string; period: string; queued: number; skipped: number; duplicate: number; done: boolean; stop?: string; error?: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Let another sweep take the run (the database's 10-minute claim ends now). */
async function release(due: Due, ctx: JobContext): Promise<void> {
  await ctx.db.query("select app.worker_email_schedule_release($1::uuid)", [due.automation_id]);
}

async function runOne(due: Due, ctx: JobContext): Promise<RunResult> {
  const out: RunResult = { automation_id: due.automation_id, period: due.period, queued: 0, skipped: 0, duplicate: 0, done: false };
  if (!isScheduleAudience(due.audience)) throw new Error(`Unknown audience "${due.audience}".`);
  const key = scheduleKey(due.audience);
  const place = (await ctx.db.query<{ c: Record<string, unknown> | null }>("select app.worker_email_context($1::uuid) as c", [due.automation_id]))[0]?.c ?? {};
  const majority = ageOfMajority({ country: str(place.country), state_region: str(place.state_region), rules: { age_of_majority: place.age_of_majority } });

  for (;;) {
    const batch = (await ctx.db.query<{ b: Batch | null }>(
      "select app.worker_email_schedule_batch($1::uuid, $2::text, $3::int, $4::int) as b",
      [due.automation_id, due.period, majority, BATCH],
    ))[0]?.b ?? {};
    if (batch.stop) {
      out.stop = batch.stop;
      await release(due, ctx);
      return out;
    }
    for (const h of batch.households ?? []) {
      const householdId = str(h.household?.id);
      if (!householdId || !UUID.test(householdId)) continue;
      const facts: ScheduleFacts = { center: batch.center, household: h.household, recipients: h.recipients, data: h.data };
      for (const r of h.recipients ?? []) {
        if (!str(r.address)) continue;
        const vars = sendValues(key, scheduleValues(due.audience, facts, r));
        const res = (await ctx.db.query<{ r: { outcome?: string } | null }>(
          "select app.worker_email_enqueue($1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::text, $7::jsonb) as r",
          [due.automation_id, householdId, due.period, householdId, r.person_id && UUID.test(r.person_id) ? r.person_id : null, r.address, JSON.stringify(vars)],
        ))[0]?.r;
        if (res?.outcome === "queued") out.queued += 1;
        else if (res?.outcome === "duplicate") out.duplicate += 1;
        else out.skipped += 1;
      }
      // The rate limit, between households: the rest of this run waits for the next sweep (a household already written to is
      // not handed out again; one that was not is).
      if (out.queued >= MAX_PER_RUN) {
        await release(due, ctx);
        return out;
      }
    }
    if (!batch.more) {
      await ctx.db.query("select app.worker_email_schedule_done($1::uuid, $2::text) as d", [due.automation_id, due.period]);
      out.done = true;
      return out;
    }
  }
}

export async function run(_job: Job, ctx: JobContext): Promise<{ runs: RunResult[] }> {
  const due = (await ctx.db.query<{ d: Due[] | null }>("select app.worker_email_schedules_due($1::int) as d", [RUNS]))[0]?.d ?? [];
  const runs: RunResult[] = [];
  for (const d of due) {
    try {
      runs.push(await runOne(d, ctx));
    } catch (e) {
      // One run failing does not stop the others; it is taken up again in 5 minutes, where it stopped.
      const error = e instanceof Error ? e.message : String(e);
      runs.push({ automation_id: d.automation_id, period: d.period, queued: 0, skipped: 0, duplicate: 0, done: false, error });
      ctx.log.error("messaging.email_schedules_sweep: a run failed", { automation: d.automation_id, period: d.period, error });
      await release(d, ctx).catch(() => undefined);
    }
  }
  if (runs.length > 0) ctx.log.info("messaging.email_schedules_sweep: scheduled emails queued", { runs });
  return { runs };
}

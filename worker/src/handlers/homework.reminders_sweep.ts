// homework.reminders_sweep: every 15 minutes, homework whose reminder time has come reminds the learners who have not
// handed it in, and the household adults of a child (owner request 2026-10-06, migration 0588). Whoever sets the
// homework chooses how many hours before it is due (1 to 720; the due moment is the end of the due day in the
// community's time zone); no reminder unless they do. The database does all of it (app.worker_homework_reminders_sweep):
// who is due, once per learner and due date, quiet hours (the whole reminder waits for their end unless they end only
// after the homework is due; then the email goes and the push is not sent), the community's switch (Settings ›
// Notifications), the Gyan Path module and an unknown time zone. It works in batches of BATCH learners, one transaction
// each, so a big backlog never holds locks for long: this handler calls again while a batch comes back full ("more"),
// at most MAX_BATCHES times; whatever is left goes in the next run. Only the first call does the housekeeping
// (cancelling reminders still queued in a community that switched them off, auditing unknown time zones). The messages
// go out through the usual messaging.send jobs (suppressions and sandbox rules apply there); a hand-in, archiving or a
// change of the homework cancels a reminder that has not gone out. No note is ever part of it. Platform-wide, scheduled
// by the generic `every` scheduler in worker/src/server.ts; no provider secret is needed, so it is always configured.

import type { Job, JobContext } from "../types";

export const kind = "homework.reminders_sweep";
export const every = 900;

/** Learners a batch reminds at most (the database's own default). */
export const BATCH = 100;
/** A run's limit: 20 batches of 100 is 2,000 learners every 15 minutes; the rest wait for the next run. */
export const MAX_BATCHES = 20;

export type RemindersSweepResult = {
  /** Batches called this run. */
  batches: number;
  /** Learners reminded this run. */
  reminded: number;
  /** Messages queued to go out: pushes to every login and emails, the household adults of a child included. */
  messages: number;
  /** Messages refused at once (a suppressed address, an opt-out): counted apart, never as sent. */
  suppressed: number;
  /** Pushes not sent because quiet hours last until after the homework is due (the email went). */
  dropped_pushes: number;
  /** Learners reminded with no message queued at all: no login, no email and no household adult to tell. */
  unreached: number;
  /** Learners whose reminder waits for the end of their community's quiet hours. */
  held_for_quiet_hours: number;
  /** Learners skipped because they were handing in at that moment (a later batch or run decides). */
  busy: number;
  /** Reminders still queued that were cancelled because their community switched reminders or Gyan Path off. */
  cancelled: number;
  /** Communities skipped because their time zone is not a known zone (each is named in its audit log). */
  skipped_time_zone: number;
  /** True when the last batch was full after MAX_BATCHES: more learners wait for the next run. */
  more: boolean;
};

type BatchResult = Partial<Record<Exclude<keyof RemindersSweepResult, "batches">, unknown>>;

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<RemindersSweepResult> {
  const out: RemindersSweepResult = {
    batches: 0, reminded: 0, messages: 0, suppressed: 0, dropped_pushes: 0, unreached: 0,
    held_for_quiet_hours: 0, busy: 0, cancelled: 0, skipped_time_zone: 0, more: false,
  };
  for (let i = 0; i < MAX_BATCHES; i++) {
    const rows = await ctx.db.query<{ result: BatchResult | null }>(
      "select app.worker_homework_reminders_sweep($1::int, $2::boolean) as result",
      [BATCH, i === 0],
    );
    const r = rows[0]?.result ?? {};
    out.batches += 1;
    out.reminded += count(r.reminded);
    out.messages += count(r.messages);
    out.suppressed += count(r.suppressed);
    out.dropped_pushes += count(r.dropped_pushes);
    out.unreached += count(r.unreached);
    out.busy += count(r.busy);
    out.cancelled += count(r.cancelled);
    out.skipped_time_zone += count(r.skipped_time_zone);
    // Every batch counts the same waiting learners again: the run reports the most any batch saw.
    out.held_for_quiet_hours = Math.max(out.held_for_quiet_hours, count(r.held_for_quiet_hours));
    // Another batch only when this one was full (never loop on an odd answer).
    out.more = r.more === true;
    if (!out.more) break;
  }
  if (out.skipped_time_zone > 0) {
    // The reminders of those communities wait until their time zone is mended; the audit log names each one.
    ctx.log.warn("homework.reminders_sweep: some communities have an unknown time zone and got no reminder", { ...out });
  } else {
    ctx.log.info("homework.reminders_sweep: learners who have not handed in were reminded", { ...out });
  }
  return out;
}

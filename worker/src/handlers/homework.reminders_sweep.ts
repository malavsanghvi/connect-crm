// homework.reminders_sweep: every 15 minutes, homework whose reminder time has come reminds the learners who have not
// handed it in, and the household adults of a child (owner request 2026-10-06, migration 0588). Whoever sets the
// homework chooses how many hours before it is due (1 to 720; the due moment is the end of the due day in the
// community's time zone); no reminder unless they do. The database does all of it (app.worker_homework_reminders_sweep):
// who is due, once per learner and due date, quiet hours (a reminder waits for their end unless they end after the
// homework is due), the community's switch (Settings › Notifications) and the Gyan Path module. It queues the messages
// through the usual messaging.send jobs (suppressions, quiet hours and sandbox rules apply there); a hand-in cancels a
// reminder that has not gone out. No note is ever part of it. Platform-wide, scheduled by the generic `every`
// scheduler in worker/src/server.ts; no provider secret is needed, so it is always configured.

import type { Job, JobContext } from "../types";

export const kind = "homework.reminders_sweep";
export const every = 900;

export type RemindersSweepResult = {
  /** Learners reminded this run (at most 500; the rest go on the next run). */
  reminded: number;
  /** Messages queued: pushes to every login and emails, the household adults of a child included. */
  messages: number;
  /** Learners reminded with no message at all: no login, no email and no household adult to tell. */
  unreached: number;
  /** Learners whose reminder waits for the end of their community's quiet hours. */
  held_for_quiet_hours: number;
  /** Learners skipped because they were handing in at that moment (the next run decides). */
  busy: number;
};

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<RemindersSweepResult> {
  const rows = await ctx.db.query<{ result: Partial<Record<keyof RemindersSweepResult, unknown>> | null }>(
    "select app.worker_homework_reminders_sweep() as result",
  );
  const r = rows[0]?.result ?? {};
  const result: RemindersSweepResult = {
    reminded: count(r.reminded),
    messages: count(r.messages),
    unreached: count(r.unreached),
    held_for_quiet_hours: count(r.held_for_quiet_hours),
    busy: count(r.busy),
  };
  ctx.log.info("homework.reminders_sweep: learners who have not handed in were reminded", { ...result });
  return result;
}

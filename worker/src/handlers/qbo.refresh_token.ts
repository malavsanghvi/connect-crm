// qbo.refresh_token: keep QuickBooks sign-ins alive and run the daily round.
//   payload { connection_id }  renew that connection's sign-in now
//   no payload (hourly, queued by the service itself for every connected
//   company, app.qbo_worker_due): renew sign-ins renewed over 20 hours ago or
//   about to expire (Intuit's refresh token rolls forward each time, so a
//   connection used daily never expires), queue the daily pull of the lists,
//   and queue the poster where postings wait. Expiry and refusal alerts are
//   raised in the database (app.qbo_worker_tokens_refreshed /
//   app.qbo_worker_connection_problem).

import { providerStatus, type Env } from "../config";
import { messageOf } from "../errors";
import { QboClient } from "../qbo/client";
import type { Job, JobContext } from "../types";

export const kind = "qbo.refresh_token";
export const configured = (env: Env) => providerStatus(env, "intuit");
/** Queued hourly by the service (server.ts schedules handlers that declare `every`). */
export const every = 3600;

type Due = { connection_id: string; center_id: string; refresh: boolean; pull: boolean; post: boolean };

export async function run(job: Job, ctx: JobContext) {
  if (typeof job.payload?.connection_id === "string") {
    const qbo = await QboClient.open(ctx, job.payload.connection_id);
    const t = await qbo.refresh();
    return { refreshed: 1, refresh_expires_at: t.refreshExpiresAt };
  }
  const due = (await ctx.db.query<{ d: Due[] }>("select app.qbo_worker_due() as d"))[0]?.d ?? [];
  const out = { connections: due.length, refreshed: 0, pulls: 0, posts: 0, problems: [] as string[] };
  for (const d of due) {
    try {
      if (d.refresh) {
        await (await QboClient.open(ctx, d.connection_id)).refresh();
        out.refreshed++;
      }
      if (d.pull) {
        await ctx.db.query("select app.enqueue_job($1, 'qbo.pull_lists', $2, now(), 3)", [d.center_id, JSON.stringify({ connection_id: d.connection_id, why: "daily" })]);
        out.pulls++;
      }
      if (d.post) {
        await ctx.db.query("select app.enqueue_job($1, 'qbo.post', $2, now(), 5)", [d.center_id, JSON.stringify({ why: "hourly" })]);
        out.posts++;
      }
    } catch (err) {
      // One company's problem is recorded on its connection; the others still get their round.
      ctx.log.error("QuickBooks round failed for a connection", { connection: d.connection_id, error: err });
      out.problems.push(`${d.connection_id}: ${messageOf(err)}`);
    }
  }
  if (out.problems.length > 0 && out.problems.length === due.length) throw new Error(`Every QuickBooks connection failed its round: ${out.problems[0]}`);
  return out;
}

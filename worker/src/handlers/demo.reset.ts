// demo.reset: B88, keeps the demo communities fresh. Runs every hour; the database decides which demo community
// (if any) is due (app.worker_demo_reset_due): one that someone changed, reset around 3 a.m. in its own time zone; one
// nobody touched, only when its dates would otherwise go stale (every 3 days); one that failed to load, again. A reset
// deletes and reloads only a sandbox flagged as a demo community, in one transaction (all or nothing), so a failure
// leaves the previous demo data as it was. Platform-wide, scheduled by the generic `every` scheduler in
// worker/src/server.ts; no provider secret is needed, so it is always configured.

import type { Job, JobContext } from "../types";

export const kind = "demo.reset";
export const every = 3600;

export type DemoResetCenter = { center_id: string; name?: string; status: "reset" | "failed" | "skipped"; why?: string; error?: string };
export type DemoResetResult = { checked: number; reset: number; skipped: number; failed: number; centers: DemoResetCenter[] };

const count = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};

export async function run(_job: Job, ctx: JobContext): Promise<DemoResetResult> {
  const rows = await ctx.db.query<{ r: Partial<DemoResetResult> | null }>("select app.worker_demo_reset_due() as r");
  const raw = rows[0]?.r ?? {};
  const centers = Array.isArray(raw.centers) ? raw.centers : [];
  const out: DemoResetResult = {
    checked: count(raw.checked), reset: count(raw.reset), skipped: count(raw.skipped), failed: count(raw.failed), centers,
  };
  const failed = centers.filter((c) => c.status === "failed");
  if (failed.length > 0) {
    // The database already kept the previous demo data and wrote the reason on the community's demo state; the next
    // run tries again in an hour.
    ctx.log.error("demo.reset: a demo community could not be reset", { failed });
  } else {
    ctx.log.info("demo.reset: demo communities checked", { checked: out.checked, reset: out.reset, skipped: out.skipped });
  }
  return out;
}

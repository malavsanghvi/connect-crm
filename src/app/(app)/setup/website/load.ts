// Setup › Your website: what the screen needs from the database, in one place for the page and the actions.
// Reads go through app.site_found_status (the saved addresses and the latest read of each website, no report) and
// app.site_found_report (one finished read). Both check settings.manage themselves (migration 0640).

import { failure, type DbErrorLike } from "@/lib/errors";
import { buildFoundView, parseSiteStatus, type FoundView, type SiteStatus } from "@/lib/site-found";
import type { AppSupabase } from "@/lib/supabase/server";

// The functions are new in 0640: until the generated types include them they are called through the untyped
// signature (as content/niva/discover-actions.ts does), and every answer is parsed field by field.
type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
export const rpc = (db: AppSupabase): RpcCaller => (db as unknown as { rpc: RpcCaller }).rpc.bind(db);

/** A finished read as a view, or the sentence saying why it cannot be shown (with its own Try again on the screen). */
export type ViewSlot = { ok: true; view: FoundView } | { ok: false; error: string };
export type Snapshot = { status: SiteStatus; views: Record<string, ViewSlot> };

export type Loaded = { ok: true; data: Snapshot } | { ok: false; cause: unknown; error: string };

/**
 * The status, plus the views of finished reads the caller does not have yet (`have`: job ids it already shows).
 * A report that cannot be fetched or understood is reported next to that website, not as a failure of the whole screen.
 */
export async function loadSnapshot(db: AppSupabase, centerId: string, have: readonly number[] = [], doing = "load your website's details"): Promise<Loaded> {
  const res = await rpc(db)("site_found_status", { p_center: centerId });
  if (res.error) {
    const f = failure(`Could not ${doing}`, res.error);
    return { ok: false, cause: res.error, error: f.error };
  }
  const status = parseSiteStatus(res.data);
  if (!status) {
    console.error("[setup/website] site_found_status returned an unexpected shape:", res.data);
    const error = `Could not ${doing} — the database answered in a shape this screen does not understand (has the latest migration been applied?).`;
    return { ok: false, cause: new Error(error), error };
  }
  const views: Record<string, ViewSlot> = {};
  await Promise.all(
    status.jobs
      .filter((j) => j.status === "done" && !have.includes(j.id))
      .map(async (j) => {
        const rep = await rpc(db)("site_found_report", { p_center: centerId, p_job: j.id });
        if (rep.error) {
          views[String(j.id)] = { ok: false, error: failure("Could not load what was found", rep.error).error };
          return;
        }
        const r = rep.data && typeof rep.data === "object" ? (rep.data as { result?: unknown }).result : null;
        const view = buildFoundView(r);
        if (!view) {
          console.error("[setup/website] a finished read is not a report this screen understands, job", j.id);
          views[String(j.id)] = { ok: false, error: "Could not show what was found — the report is not in a form this screen understands. Try looking at the website again." };
          return;
        }
        views[String(j.id)] = { ok: true, view };
      }),
  );
  return { ok: true, data: { status, views } };
}

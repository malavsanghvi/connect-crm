// calendar.refresh_feeds: the daily refresh of every subscribed calendar layer.
// The service queues one platform-wide job an hour; the database hands back
// the layers not refreshed for about a day (app.worker_calendar_feeds_due), so
// each layer is fetched once a day. One layer failing is recorded on that
// layer and does not stop the others.

import { messageOf } from "../errors";
import { recordFailure, syncLayer, type FeedLayer } from "../calendar/feed";
import type { Job, JobContext } from "../types";

export const kind = "calendar.refresh_feeds";
export const every = 3600;

export async function run(job: Job, ctx: JobContext) {
  const limit = typeof job.payload?.limit === "number" ? Math.min(Math.max(job.payload.limit, 1), 200) : 50;
  const layers = await ctx.db.query<FeedLayer>("select * from app.worker_calendar_feeds_due($1)", [limit]);
  let refreshed = 0;
  const failures: { layer_id: string; name: string; error: string }[] = [];
  for (const layer of layers) {
    try {
      await syncLayer(layer, ctx);
      refreshed++;
    } catch (err) {
      const message = messageOf(err);
      failures.push({ layer_id: layer.layer_id, name: layer.name, error: message.slice(0, 300) });
      ctx.log.error("calendar feed refresh failed", { layer: layer.layer_id, error: message });
      await recordFailure(ctx, layer.layer_id, message);
    }
  }
  ctx.log.info("calendar feed refresh pass finished", { due: layers.length, refreshed, failed: failures.length });
  return { due: layers.length, refreshed, failed: failures.length, failures: failures.slice(0, 20) };
}

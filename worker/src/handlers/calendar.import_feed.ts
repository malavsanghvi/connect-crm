// calendar.import_feed: bring one subscribed calendar layer up to date now.
// Queued by app.subscribe_calendar_layer / app.refresh_calendar_layer (Calendar ›
// Layers › Subscribe / Refresh now) with { layer_id }. The feed is fetched from
// its public address, parsed (VEVENT, RRULE basics) within the subscription's
// window and upserted by UID, so running it twice changes nothing the second
// time. A failure is recorded on the layer as well as on the job.

import { PermanentError, messageOf } from "../errors";
import { recordFailure, syncLayer, type FeedLayer } from "../calendar/feed";
import type { Job, JobContext } from "../types";

export const kind = "calendar.import_feed";

export async function run(job: Job, ctx: JobContext) {
  const layerId = typeof job.payload?.layer_id === "string" ? job.payload.layer_id : null;
  if (!layerId) throw new PermanentError("The job does not say which calendar layer to refresh.");
  const rows = await ctx.db.query<FeedLayer>("select * from app.worker_calendar_feed_layer($1::uuid)", [layerId]);
  const layer = rows[0];
  if (!layer) throw new PermanentError("The calendar layer no longer exists or is no longer subscribed to a calendar link.");
  try {
    return await syncLayer(layer, ctx);
  } catch (err) {
    await recordFailure(ctx, layer.layer_id, messageOf(err));
    throw err;
  }
}

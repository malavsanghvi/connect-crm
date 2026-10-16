// payments.release_chip_ins: once a day, give back the Chip In allowance of every reservation that can no longer be paid
// (docs/PAYMENT_ADDONS.md §6.4, §10.3; migration 0861). A member's yearly Chip In limit reserves the amount when a checkout
// starts; the reservation is released at once when the checkout fails or expires (worker_checkout_closed), and this sweep is the
// safety net for a lost provider event. The database does all of it (app.worker_release_chip_ins); it never touches a payment.
// Platform-wide, scheduled by the generic `every` scheduler in worker/src/server.ts; no provider secret is needed, so it is
// always configured. While no organization asks for a Chip In there are no reservations and it releases none.

import type { Job, JobContext } from "../types";

export const kind = "payments.release_chip_ins";
export const every = 24 * 3600;

export type SweepResult = { released: number };

export async function run(_job: Job, ctx: JobContext): Promise<SweepResult> {
  const rows = await ctx.db.query<{ released: unknown }>("select app.worker_release_chip_ins() as released");
  const n = Number(rows[0]?.released);
  const released = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  ctx.log.info("payments.release_chip_ins: Chip In reservations that can no longer be paid were released", { released });
  return { released };
}

import "server-only";

import { cache } from "react";

import { explainError } from "@/lib/errors";
import { chipInNotice, type HomeNotice } from "@/lib/home/notices";
import { parseChipInSummary } from "@/lib/payments/chip-in-platform";
import type { CrmSession } from "@/lib/session";

// The notices at the top of Home for the organization's owner (src/lib/home/notices.ts). Read as the signed-in owner through the
// database's own summary (app.chip_in_summary), so row level security decides what comes back. A read that fails becomes a notice
// that says so, with how to retry, never a missing notice.

/** The code PostgREST gives for a function the database does not have yet, and Postgres' own for the same. */
const NOT_THERE_YET = new Set(["PGRST202", "42883"]);
/** "Not allowed": Giving is not part of this organization (the module is off or not enabled), so there is no Chip In to tell about. */
const NOT_APPLICABLE = "42501";

export const loadHomeNotices = cache(async (session: CrmSession): Promise<HomeNotice[]> => {
  // Only the organization's owner: the notice carries the platform's setting for the whole organization (decision 12).
  if (!session.isOwner) return [];
  if (session.modulesOff.includes("giving")) return [];
  try {
    const res = await session.db.rpc("chip_in_summary", { p_center: session.center.id });
    if (res.error) {
      // Only a database without the function yet, or without Giving for this organization, is skipped silently.
      if (res.error.code && (NOT_THERE_YET.has(res.error.code) || res.error.code === NOT_APPLICABLE)) return [];
      throw res.error;
    }
    const parsed = parseChipInSummary(res.data);
    if (!parsed.ok) throw new Error(parsed.error);
    const notice = chipInNotice(parsed.value, new Date(), session.center.time_zone);
    return notice ? [notice] : [];
  } catch (error) {
    console.error("[home-notices] could not read the Chip In summary:", error);
    const why = explainError(error);
    return [
      {
        key: "chip-in-unreadable",
        tone: "warning",
        title: "Could not check for changes to your Chip In settings",
        lines: [`${why[0].toUpperCase()}${why.slice(1)}. Reload the page to try again.`],
      },
    ];
  }
});

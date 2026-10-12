import "server-only";

import type { PendingReviewsData } from "@/lib/commands/catalog/people/pending-reviews";
import { runScreenCommand } from "@/lib/commands/screen";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import { buildInbox, type InboxModel } from "./inbox";

export type InboxLoad = { ok: true; model: InboxModel } | { ok: false; error: string };

/**
 * The Inbox for the People home. `null` when the role cannot see applications or family requests at all (the home then shows the plain
 * counts it always had). Otherwise the same read the "To review" list uses (people.pending_reviews), with what each row offers worked
 * out for THIS person; a failed read comes back as a sentence, never as an empty list.
 */
export async function loadInbox(session: CrmSession, duplicates: InboxModel["duplicates"]): Promise<InboxLoad | null> {
  if (!canAccess(session, "householdRequests")) return null;
  const res = await runScreenCommand<PendingReviewsData>("people.pending_reviews", {}, "load what is waiting for a decision");
  if (!res.ok) return { ok: false, error: res.error };
  if (!res.data) return { ok: false, error: "The answer was empty. Reload the page to try again." };
  return {
    ok: true,
    model: buildInbox(res.data, {
      now: new Date().toISOString(),
      timeZone: session.center.time_zone,
      duplicates,
      applicationsHref: "/memberships/applications",
      requestsHref: "/people/requests",
    }),
  };
}

import "server-only";

import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { communityFormat } from "@/lib/community-format";
import { peopleTotals } from "@/lib/data/people-list";
import { todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { householdCardLine } from "@/lib/find/labels";
import { listsMenu } from "@/lib/find/lists";
import { parseRecents, recentCookieName } from "@/lib/find/recents";
import { familyHref } from "@/lib/find/rows";
import { isModuleEnabled } from "@/lib/modules";
import { tierLabel } from "@/lib/people";
import { canAccess, visibleNav } from "@/lib/permissions";
import { hrefWith } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { chipsFor, NO_FILTERS, paramsFromFilters } from "./ask";
import { ENDING_SOON_DAYS, loadQuickCounts, loadZones } from "./load";
import type { InboxTile, PeopleHomeModel, RecentFamily, SavedViewItem } from "./home-model";
import type { Problem } from "./model";
import { loadPinnedFamilies, loadSavedViews } from "./saved-load";
import { MAX_VIEWS, viewFilters, viewHref } from "./saved-views";

const BASE = "/people";

/** The recent families, in the order they were opened, read again under THIS person's access (a family they cannot see is skipped). */
async function loadRecents(session: CrmSession, cookieValue: string | undefined, problems: Problem[]): Promise<RecentFamily[]> {
  const ids = parseRecents(cookieValue);
  if (ids.length === 0) return [];
  const { db, center } = session;
  try {
    const live = await db.from("households").select("id").in("id", ids).eq("center_id", center.id).is("merged_into_id", null);
    if (live.error) throw live.error;
    const keep = new Set((live.data ?? []).map((h) => h.id));
    const ordered = ids.filter((id) => keep.has(id));
    if (ordered.length === 0) return [];
    const { cards } = await adultHouseholdCards(db, ordered, { today: todayInTz(center.time_zone), currency: center.currency, majority: communityMajority(center) });
    return cards.map((c) => ({ id: c.household_id, title: c.household_name?.trim() || "Family", cardLine: householdCardLine(c), href: familyHref(c.household_id) }));
  } catch (error) {
    console.error("[people home] could not read the recent families:", error);
    problems.push({ what: "your recent families", message: explainError(error) });
    return [];
  }
}

/** Everything the People home draws. Each part fails alone and says so; nothing is hidden or shown as zero when it could not be read. */
export async function loadPeopleHome(session: CrmSession, recentCookieValue: string | undefined): Promise<PeopleHomeModel> {
  const problems: Problem[] = [];
  const [totals, counts, recents, views, pinned, zones] = await Promise.all([
    peopleTotals(session),
    loadQuickCounts(session),
    loadRecents(session, recentCookieValue, problems),
    loadSavedViews(session),
    loadPinnedFamilies(session),
    loadZones(session),
  ]);
  if (views.error) problems.push({ what: "your saved views", message: views.error });
  if (pinned.error) problems.push({ what: "your pinned families", message: pinned.error });
  // Each view's filters in words (an area by its name), for the hover text; with the areas unread it says "an area you can't see".
  const wording = { zones: zones.zones, fmt: communityFormat(session.center), tierLabel };
  const savedViews: SavedViewItem[] = views.views.map((v) => ({ id: v.id, name: v.name, href: viewHref(v), summary: chipsFor(viewFilters(v), wording).map((c) => c.label).join(" · ") }));
  if (totals.error) {
    console.error("[people home] totals failed; showing none:", totals.error);
    problems.push({ what: "the totals", message: explainError(totals.error) });
  }
  problems.push(...counts.problems);
  const n = (v: number, one: string, many: string) => `${v.toLocaleString("en-US")} ${v === 1 ? one : many}`;
  const summary = totals.households !== null && totals.people !== null && !totals.error ? `${n(totals.households, "family", "families")} · ${n(totals.people, "person", "people")}` : null;

  const seesApplications = canAccess(session, "applications");
  const seesRequests = canAccess(session, "householdRequests");
  const inbox: InboxTile[] = [];
  if (seesApplications || seesRequests) {
    inbox.push({ key: "reviews", label: "Applications and family requests", count: counts.waiting, href: `${BASE}?view=reviews`, hint: "Membership applications and family change requests waiting for a decision" });
  }
  inbox.push({ key: "duplicates", label: "Possible duplicates", count: counts.duplicates, href: `${BASE}?view=duplicates`, hint: "Pairs of families or people that may be the same" });

  const peopleTabs = visibleNav(session).find((m) => m.key === "people")?.tabs ?? [];
  return {
    summary,
    cookieName: recentCookieName(session.userId, session.center.id),
    recents,
    inbox,
    endingSoon: { count: counts.ending, href: `${BASE}?ending=${ENDING_SOON_DAYS}` },
    pins: pinned.pinned,
    pinsHidden: pinned.hidden,
    savedViews,
    maxViews: MAX_VIEWS,
    contactGapHref: hrefWith(BASE, {}, { ...paramsFromFilters({ ...NO_FILTERS, noEmail: true }), view: "people" }),
    lists: listsMenu(peopleTabs),
    canAddFamily: canAccess(session, "householdsEdit") && isModuleEnabled(session, "people"),
    problems,
  };
}

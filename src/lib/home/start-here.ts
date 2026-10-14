// Home card "Start here" (docs/DEMO_ROLE_WORK.md): for a person who holds a screen but no staff queue and no other Home card (no assignments,
// not the member-app card). Without it Home said "Nothing here for your role" above a navigation that does hold their work. It names the one screen
// the person's permissions point to, links to it, and where a count is cheap and the person's own access can read it, says what waits there.
//
// It is derived from what the person holds and the screens the navigation shows them (src/lib/permissions.ts NAV), never from a role key, so a
// role the community renamed, cloned or built itself gets the same card. The permissions that point to a screen are the screen's own work, narrower
// than who may open it (the executive viewer may open Orders by pickup through store.view, but their work is Reports). Pure: the counts are read in
// src/lib/data/home-cards.ts.

import { isModuleEnabled, moduleForPath } from "@/lib/modules";
import { can, canAccess, NAV, visibleNav, type AccessKey, type ScopedContext } from "@/lib/permissions";
import { plural, visibleTaskSources } from "@/lib/tasks";

import { problemSentence, type Read } from "./read";

export type StartKey = "reports" | "content" | "volunteers" | "store" | "committee" | "nav";

export type StartScreen = {
  key: StartKey;
  /** The screen in the navigation's own words ("Content › Library"), which a community's kind may rename. */
  screen: string;
  href: string;
  /** One plain sentence naming the screen. */
  sentence: string;
};

type StartEntry = {
  key: Exclude<StartKey, "nav">;
  href: string;
  /** The screen's name when the navigation does not list it. */
  label: string;
  /** The page's own rule for opening it. */
  access: AccessKey;
  /** What a person must hold to be sent here: the screen's own work (any of these). */
  holds: readonly string[];
  sentence: (screen: string) => string;
};

/**
 * In order, the first a person qualifies for wins: the specific work screens first, the broad read-only one (Reports) before them because a person
 * who holds reports.view and nothing that acts on a queue is a reader of the community's numbers.
 */
export const START_ENTRIES: readonly StartEntry[] = [
  { key: "reports", href: "/reports", label: "Reports", access: "reports", holds: ["reports.view"], sentence: (s) => `${s} shows how your community is doing.` },
  {
    key: "content",
    href: "/content/library",
    label: "Library",
    access: "contentDraft",
    holds: ["content.draft", "content.manage"],
    sentence: (s) => `Your work is in ${s}: the drafts you write and send for approval.`,
  },
  {
    key: "volunteers",
    href: "/events/volunteers",
    label: "Volunteers",
    access: "volunteers",
    holds: ["volunteers.view", "volunteers.manage", "safety.view", "safety.manage"],
    sentence: (s) => `Your work is in ${s}: the volunteer groups, who has signed up, and the shifts.`,
  },
  {
    key: "store",
    href: "/store/orders",
    label: "Orders by pickup",
    access: "storeOrders",
    holds: ["store.pickup", "kitchen.view"],
    sentence: (s) => `Your work is in ${s}: the orders to prepare and hand out, by pickup slot.`,
  },
  {
    key: "committee",
    href: "/pathshala/committee",
    label: "Committee",
    access: "pathshalaCommittee",
    holds: ["governance.vote", "governance.manage"],
    sentence: (s) => `Your work is in ${s}: the actions and events of the next two weeks.`,
  },
];

/** The nav module and tab that list this address, if the navigation lists it. */
function navTabOf(href: string) {
  for (const m of NAV) {
    const t = m.tabs.find((x) => x.href === href);
    if (t) return { module: m, tab: t };
  }
  return null;
}

/** May the person open this entry's screen: through the navigation when it lists the screen, else by the page's own rule and its module. */
function opens(ctx: ScopedContext, e: StartEntry): boolean {
  if (!can(ctx, e.holds)) return false;
  if (navTabOf(e.href)) return visibleNav(ctx).some((m) => m.tabs.some((t) => t.href === e.href));
  const mod = moduleForPath(e.href);
  return canAccess(ctx, e.access) && (mod === null || isModuleEnabled(ctx, mod));
}

/** The screen's name as the navigation shows it to this person (a kind may rename the module and the tab). */
function screenName(ctx: ScopedContext, e: StartEntry): string {
  const nav = visibleNav(ctx);
  for (const m of nav) {
    const t = m.tabs.find((x) => x.href === e.href);
    if (t) return `${m.label} › ${t.label}`;
  }
  // Volunteers is a page of Events that the navigation does not list as a tab.
  const events = nav.find((m) => m.key === "events");
  return events && e.key === "volunteers" ? `${events.label} › ${e.label}` : e.label;
}

/**
 * The screen to start from, or null when the person has no screen at all. A permission that points to one of the entries above picks it;
 * otherwise the first module of the navigation (after Home) opens on its landing tab.
 */
export function startScreenFor(ctx: ScopedContext): StartScreen | null {
  const entry = START_ENTRIES.find((e) => opens(ctx, e));
  if (entry) {
    const screen = screenName(ctx, entry);
    return { key: entry.key, screen, href: entry.href, sentence: entry.sentence(screen) };
  }
  const first = visibleNav(ctx).find((m) => m.key !== "home");
  if (!first) return null;
  const tab = first.tabs.find((t) => t.href === first.href) ?? first.tabs[0];
  const screen = tab && first.tabs.length > 1 ? `${first.label} › ${tab.label}` : first.label;
  return { key: "nav", screen, href: first.href, sentence: `Your work is in ${screen}.` };
}

/** Whether Home should carry this card: no staff queue and no other card. */
export function wantsStartHere(ctx: ScopedContext, others: { memberWork: boolean; assignments: boolean }): boolean {
  return visibleTaskSources(ctx).length === 0 && !others.memberWork && !others.assignments;
}

// ---------------------------------------------------------------------------
// What waits there
// ---------------------------------------------------------------------------

/** The counts that were asked for (a key is absent when it was not asked: the person's access cannot read it, or the screen has none). */
export type StartCounts = {
  drafts?: Read<number>;
  askedToVolunteer?: Read<number>;
  shiftsWithFreePlaces?: Read<number>;
  ordersWaiting?: Read<number>;
  committee?: Read<{ atRisk: number; unassigned: number }>;
};

export type StartHere = StartScreen & { lines: string[]; problems: string[] };

/** The shifts with a capacity that still have places, given the people assigned or confirmed on each; shifts already over are left out. */
export function countShiftsWithFreePlaces(
  shifts: readonly { id: string; capacity: number | null; starts_at: string | null; ends_at: string | null }[],
  assignments: readonly { shift_id: string; status: string }[],
  now: Date,
): number {
  const taken = new Map<string, number>();
  for (const a of assignments) if (a.status === "assigned" || a.status === "confirmed") taken.set(a.shift_id, (taken.get(a.shift_id) ?? 0) + 1);
  return shifts.filter((s) => {
    if (s.capacity === null || s.capacity <= 0) return false;
    const over = (s.ends_at ?? s.starts_at) !== null && Date.parse((s.ends_at ?? s.starts_at) as string) < now.getTime();
    return !over && s.capacity > (taken.get(s.id) ?? 0);
  }).length;
}

export function buildStartHere(screen: StartScreen, counts: StartCounts): StartHere {
  const lines: string[] = [];
  const problems: string[] = [];
  const asked = Object.values(counts).filter((c) => c !== undefined).length;
  const read = (r: Read<number> | undefined, what: string, say: (n: number) => string) => {
    if (!r) return;
    if (!r.ok) problems.push(problemSentence(what, r.error));
    else if (r.value > 0) lines.push(say(r.value));
  };
  read(counts.drafts, "count the drafts", (n) => `${plural(n, "draft")} to finish.`);
  read(counts.askedToVolunteer, "count the people who asked to volunteer", (n) => `${plural(n, "person", "people")} asked to volunteer.`);
  read(counts.shiftsWithFreePlaces, "count the shifts with free places", (n) => `${plural(n, "shift")} with free places.`);
  read(counts.ordersWaiting, "count the orders waiting for pickup", (n) => `${plural(n, "order")} waiting for pickup.`);
  if (counts.committee) {
    if (!counts.committee.ok) problems.push(problemSentence("count the committee's actions", counts.committee.error));
    else {
      const { atRisk, unassigned } = counts.committee.value;
      if (atRisk > 0) lines.push(`${plural(atRisk, "action")} overdue or due within 3 days.`);
      if (unassigned > 0) lines.push(`${plural(unassigned, "action")} in the next two weeks with no owner.`);
    }
  }
  // Everything that was asked came back and none of it is waiting: say so, so a blank card is never read as a broken one.
  if (asked > 0 && lines.length === 0 && problems.length === 0) lines.push("Nothing is waiting right now.");
  return { ...screen, lines, problems };
}

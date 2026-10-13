// What the People home draws (the New look's /people with no list address): the title, the big find box, the inbox, recent families,
// the saved-views strip and the Lists menu. Pure types, so the page, the dev preview and the tests share one shape.

import type { ListLink } from "@/lib/find/lists";

import type { Problem } from "./model";

export type RecentFamily = { id: string; title: string; cardLine: string; href: string };

/** A family the person pinned: the household card line, never a name alone. */
export type PinnedFamilyCard = { id: string; householdId: string; title: string; cardLine: string; href: string };

/** One of the person's own saved views: where it opens, and its filters in words (for the hover text). */
export type SavedViewItem = { id: string; name: string; href: string; summary: string };

/** A count of what is waiting, with where it opens. `count` is null when it could not be read (said in `problems`). */
export type InboxTile = { key: string; label: string; count: number | null; href: string; hint: string };

export type PeopleHomeModel = {
  /** "11 families · 24 people", or null when the totals could not be read. */
  summary: string | null;
  /** The cookie that remembers recent families in this browser (named for this person and community); null in the dev preview. */
  cookieName: string | null;
  recents: RecentFamily[];
  /** Counts of what waits for a decision, each opening where it is decided. */
  inbox: InboxTile[];
  /** The saved view everyone has: memberships ending soon (null when it cannot be counted). */
  endingSoon: { count: number | null; href: string } | null;
  /** The family pages the person pinned, in the order they pinned them, read again under THEIR access. */
  pins: PinnedFamilyCard[];
  /** Pins that are no longer shown to them (merged, or a family they can no longer see): counted, never drawn. */
  pinsHidden: number;
  /** The person's own saved views, in the order they keep them. */
  savedViews: SavedViewItem[];
  /** The most views a person can keep (the database holds the same number). */
  maxViews: number;
  /** Where "Adults with no email" opens: the first contact-gap list, offered to everyone as a place to start. */
  contactGapHref: string;
  lists: ListLink[];
  problems: Problem[];
};

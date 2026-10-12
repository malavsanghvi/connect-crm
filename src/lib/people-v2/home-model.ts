// What the People home draws (the New look's /people with no list address): the title, the big find box, the inbox, recent families,
// the saved-views strip and the Lists menu. Pure types, so the page, the dev preview and the tests share one shape.

import type { ListLink } from "@/lib/find/lists";

import type { Problem } from "./model";

export type RecentFamily = { id: string; title: string; cardLine: string; href: string };

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
  /** The one saved view that exists today: memberships ending soon (null when it cannot be counted). */
  endingSoon: { count: number | null; href: string } | null;
  lists: ListLink[];
  /** The viewer may add a family (people.manage, with the People module on), so the home offers "Add a family". */
  canAddFamily: boolean;
  problems: Problem[];
};

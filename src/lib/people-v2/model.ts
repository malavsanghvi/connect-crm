// What the People workspace (new look) draws, already worded and formatted: the server page fills it from the database, the dev
// preview fills it from invented sample data, and the view only draws it. Money is formatted in the organization's currency
// before it gets here; households always come with their numbers and adults (never a name alone).

import type { HouseholdCard } from "@/lib/commands/types";
import type { ListLink } from "@/lib/find/lists";

import type { AskChip, HouseholdFilters, Zone } from "./ask";
import type { SortKey } from "./list";

export type PeopleView = "households" | "people" | "reviews" | "duplicates";

export const PEOPLE_VIEWS: readonly PeopleView[] = ["households", "people", "reviews", "duplicates"];

export function peopleView(v: string | undefined): PeopleView {
  return (PEOPLE_VIEWS as readonly string[]).includes(v ?? "") ? (v as PeopleView) : "households";
}

/** A section that may be hidden by the person's role or fail to load: said in words either way. */
export type Section<T> = { state: "ok"; data: T } | { state: "hidden"; reason: string } | { state: "error"; message: string };

export type Problem = { what: string; message: string };

export type QuickChip = { key: string; label: string; href: string | null; current: boolean; comingNext?: boolean; title?: string };

export type AskModel = {
  /** The cookie that remembers recent families for the find box on a phone (null in the dev preview). */
  cookieName: string | null;
  /** The sentence as the person typed it (kept in the box). */
  said: string;
  /** True when the box was used and nothing in it could be read. */
  unread: boolean;
  filters: HouseholdFilters;
  chips: (AskChip & { removeHref: string })[];
  /** Hidden fields the "Add a filter" form keeps (the view, the sort). */
  keep: Record<string, string>;
  zones: Zone[];
  tiers: { key: string; label: string }[];
  placeholder: string;
  /** The filters in words without any typed search (D2), for the sentences sent to Niva. */
  forNiva: string;
  year: number;
  /** Where the box's GET form goes. */
  action: string;
};

export type HouseholdRowView = {
  id: string;
  href: string;
  selected: boolean;
  name: string;
  /** "No. 0212 · RNA-H-2041": the household number and the organization's own household IDs. */
  ids: string;
  primary: string;
  area: string;
  /** Formatted; null when the role cannot see giving. */
  open: string | null;
  lastGift: string;
  lastRsvp: string;
};

export type PersonRowView = {
  id: string;
  href: string;
  selected: boolean;
  name: string;
  ids: string;
  relationship: string;
  household: string;
  age: string;
  contact: string;
};

export type ListPaging = { showing: string; prevHref: string | null; nextHref: string | null };

export type HouseholdsSection = {
  rows: HouseholdRowView[];
  paging: ListPaging;
  sort: SortKey;
  sortHrefs: Record<SortKey, string>;
  /** Sorting by open balance needs a giving permission. */
  canSortByOpen: boolean;
  /** The card was opened by the person (not the first row shown by default): highlighted on every screen size. */
  selectionExplicit: boolean;
  emptyTitle: string;
  emptyHint: string | null;
};

export type PeopleSection = { rows: PersonRowView[]; paging: ListPaging; bands: QuickChip[]; emptyTitle: string };

/** One adult on a contact-gap list: who they are, which family (the household card line, never a name alone) and what is on file. */
export type GapRowView = {
  id: string;
  /** Opens the family (with this person's details when that screen exists). */
  href: string;
  name: string;
  /** "Member 1042 · RCC-M-77", or "No member number". */
  ids: string;
  relationship: string;
  /** The family's name without any child's first name, or "Not in a family". */
  family: string;
  /** "No. 0127 · RCC-H-0961 · Priya & Anil · Riverside"; null for a person in no family. */
  cardLine: string | null;
  mobile: string;
  email: string;
  /** "On the app" / "Not on the app". */
  app: string;
  age: string;
};

/** A list of ADULTS who have a contact gap (no email, no mobile, no address, not on the app): adults only, always. */
export type GapSection = { rows: GapRowView[]; paging: ListPaging; /** "6 adults". */ count: string; emptyTitle: string; emptyHint: string };

/** What can be done with the list on screen: save it as a view, export it. */
export type ListActions = {
  list: "households" | "people";
  /** The filters as the address holds them: what a saved view keeps (a typed search is dropped). */
  params: Record<string, string>;
  sort: string | null;
  /** The name the "Save this view" field starts with. */
  suggested: string;
  /** Why the list cannot be saved yet (it has no filter), in words; null when it can. */
  blockedReason: string | null;
  /** Where the export is fetched (it asks for a fresh 2FA code); null when this list is not exported. */
  exportHref: string | null;
  /** Said next to the export: what it holds, or why there is none. */
  exportNote: string;
};

export type ReviewItem = { id: string; title: string; detail: string; household: HouseholdCard | null; href: string };

export type ReviewsSection = Section<{
  applications: ReviewItem[];
  applicationsTotal: number | null;
  requests: ReviewItem[];
  requestsTotal: number;
  /** Requests that mention a child: counted only, decided on the family requests screen. */
  forScreen: number;
  note: string | null;
  applicationsHref: string;
  requestsHref: string;
}>;

export type DuplicateSide = { id: string; title: string; lines: string[]; card: HouseholdCard | null };

export type DuplicateItem = {
  candidateId: string;
  kind: "person" | "household";
  sides: [DuplicateSide, DuplicateSide];
  compareHref: string;
  /** People: the record the system would keep (the one that signs in, else the fuller one). The person decides. */
  suggestedKeepId: string | null;
  /** Both people sign in to the app: they cannot be merged here. */
  blocked: string | null;
};

export type DuplicatesSection = Section<{ items: DuplicateItem[]; forScreen: number; mergeScreenHref: string }>;

export type CardFact = { label: string; value: string; tone?: "money" | "mono" | "strong" };

export type HouseholdPanel = {
  id: string;
  name: string;
  ids: string;
  facts: CardFact[];
  recordPaymentHref: string | null;
  fullPageHref: string;
  /** Another household the system matched to this one (merge_candidates). */
  noticed: { name: string; ids: string; place: string | null; compareHref: string; candidateId: string } | null;
  adults: { name: string; role: string; contact: string; onApp: boolean }[];
  /** Shown to the person on screen only; never in anything sent to Niva (D2). */
  children: { name: string; age: string }[];
  membership: Section<{ label: string; detail: string }[]>;
  giving: Section<{ open: string; lastGift: string; pledges: { label: string; progress: string; closed: boolean }[] }>;
  requests: Section<{ what: string; when: string; href: string }[]>;
  activity: Section<{ when: string; what: string; detail: string }[]>;
  /** The sentence the card's "Ask Niva" sends: the household's numbers and its ADULTS only (D2). */
  nivaPrompt: string;
  problems: Problem[];
};

export type PanelState =
  | { state: "none" }
  | { state: "ok"; card: HouseholdPanel; explicit: boolean; closeHref: string }
  | { state: "error"; message: string; explicit: boolean; closeHref: string };

export type PeopleWorkspaceModel = {
  view: PeopleView;
  /** The heading of this list: "Families", "People", "To review" or "Possible duplicates". */
  title: string;
  /** The Lists menu (the whole lists and the screens that stay), the same as on the People home. */
  lists: ListLink[];
  quick: QuickChip[];
  ask: AskModel;
  /** "17 households", "$4,860.00" (null when balances are not visible). */
  summary: { count: string; open: string | null } | null;
  /** What "Draft a reminder for these" asks Niva (no names: D2). null when there is nothing to draft for. */
  draftPrompt: string | null;
  households: HouseholdsSection | null;
  people: PeopleSection | null;
  /** A list of adults with a contact gap (replaces `people` when a gap is asked). */
  gap: GapSection | null;
  /** Save this view, Export: null for the review and duplicate views. */
  actions: ListActions | null;
  reviews: ReviewsSection | null;
  duplicates: DuplicatesSection | null;
  panel: PanelState;
  problems: Problem[];
  notes: string[];
};

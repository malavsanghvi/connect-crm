// DEV ONLY. Invented people and families for the saved-views preview: a neutral residents' club with names from many cultures and scripts.
// Nothing here is real and nothing reads a database. The lists are drawn by the SAME pure core as the real screens (the filter reader, the
// gap rules, the saved-view encoding); only the reads are replaced by these lists.

import { communityFormat } from "@/lib/community-format";
import { householdCardLine } from "@/lib/find/labels";
import { listsMenu } from "@/lib/find/lists";
import { personHref } from "@/lib/find/rows";
import {
  chipsFor,
  countText,
  filtersForNiva,
  hasGap,
  listHeading,
  NO_FILTERS,
  paramsFromFilters,
  type FilterKey,
  type HouseholdFilters,
} from "@/lib/people-v2/ask";
import { contactCell, gapPeople, PEOPLE_EXPORT_HEADER, peopleExportLines, type ExportCard, type GapPerson } from "@/lib/people-v2/gaps";
import type { PeopleHomeModel, PinnedFamilyCard, SavedViewItem } from "@/lib/people-v2/home-model";
import { pageOf, showingText } from "@/lib/people-v2/list";
import type { GapRowView, ListActions, PeopleWorkspaceModel } from "@/lib/people-v2/model";
import { tierLabel } from "@/lib/people";
import { suggestedViewName, viewFilters, viewHref, viewParams, type SavedViewRow } from "@/lib/people-v2/saved-views";
import { sampleModel } from "../admin-people/fixtures";

export const COMMUNITY = "Lakeside Residents' Club";
const TODAY = "2026-10-12";
const fmt = communityFormat({ currency: "USD", country: "US" });
export const ZONES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "North Shore" },
  { id: "22222222-2222-4222-8222-222222222222", name: "East Bank" },
  { id: "33333333-3333-4333-8333-333333333333", name: "South Shore" },
];

type Fam = { id: string; name: string; number: string; org: string; adults: string[]; city: string; zone: string; address: boolean };

const FAMILIES: Fam[] = [
  { id: "f-hassan", name: "Hassan household", number: "0301", org: "LRC-H-1102", adults: ["Samira Hassan", "Karim Hassan"], city: "Lakeside", zone: "North Shore", address: true },
  { id: "f-okafor", name: "Okafor household", number: "0212", org: "LRC-H-2041", adults: ["Chidi Okafor", "Ngozi Okafor"], city: "Lakeside", zone: "North Shore", address: true },
  { id: "f-nakamura", name: "Nakamura household", number: "0455", org: "LRC-H-1377", adults: ["Haruka Nakamura", "Sam Nakamura"], city: "Lakeside", zone: "East Bank", address: true },
  { id: "f-fernandez", name: "Fernández Ruiz household", number: "0662", org: "LRC-H-1810", adults: ["Carmen Fernández", "Luis Ruiz"], city: "Lakeside", zone: "South Shore", address: true },
  { id: "f-patel", name: "Patel household", number: "0127", org: "LRC-H-0961", adults: ["Priya Patel", "Anil Patel"], city: "Lakeside", zone: "North Shore", address: true },
  { id: "f-fedorov", name: "Фёдоров household", number: "0540", org: "LRC-H-1488", adults: ["Николай Фёдоров", "Мила Фёдорова"], city: "Lakeside", zone: "South Shore", address: false },
  { id: "f-tanaka", name: "田中 household", number: "0470", org: "LRC-H-1390", adults: ["太郎 田中", "花子 田中"], city: "Lakeside", zone: "East Bank", address: true },
  { id: "f-shams", name: "شمس household", number: "0821", org: "LRC-H-2040", adults: ["محمد شمس"], city: "Lakeside", zone: "East Bank", address: true },
];
const byId = new Map(FAMILIES.map((f) => [f.id, f]));
export const cardLine = (f: Fam): string => householdCardLine({ household_number: f.number, org_household_id: f.org, adults: f.adults, household_name: f.name, city: f.city, zone: f.zone });

/** Invented adults (and two children, who must never appear in a gap list or an export). */
const PEOPLE: GapPerson[] = [
  { id: "p-anil", name: "Anil Patel", memberNumber: "10521", email: null, phone: "+17135550138", dateOfBirth: "1952-04-02", role: "spouse", onApp: false, onTeam: false, household: { id: "f-patel", name: "Patel household", number: "0127", hasAddress: true, zoneId: ZONES[0].id } },
  { id: "p-luis", name: "Luis Ruiz", memberNumber: null, email: null, phone: "+18325550167", dateOfBirth: "1986-09-09", role: "spouse", onApp: true, onTeam: true, household: { id: "f-fernandez", name: "Fernández Ruiz household", number: "0662", hasAddress: true, zoneId: ZONES[2].id } },
  { id: "p-ngozi", name: "Ngozi Okafor", memberNumber: "10802", email: null, phone: "+18325550191", dateOfBirth: "1971-01-20", role: "spouse", onApp: false, onTeam: false, household: { id: "f-okafor", name: "Okafor household", number: "0212", hasAddress: true, zoneId: ZONES[0].id } },
  { id: "p-sam", name: "Sam Nakamura", memberNumber: "10471", email: null, phone: null, dateOfBirth: "1985-06-15", role: "spouse", onApp: true, onTeam: false, household: { id: "f-nakamura", name: "Nakamura household", number: "0455", hasAddress: true, zoneId: ZONES[1].id } },
  { id: "p-taro", name: "太郎 田中", memberNumber: "10533", email: null, phone: "+14155550142", dateOfBirth: "1979-03-30", role: "primary", onApp: true, onTeam: false, household: { id: "f-tanaka", name: "田中 household", number: "0470", hasAddress: true, zoneId: ZONES[1].id } },
  { id: "p-mila", name: "Мила Фёдорова", memberNumber: null, email: null, phone: "+18325550103", dateOfBirth: "1984-11-02", role: "spouse", onApp: false, onTeam: false, household: { id: "f-fedorov", name: "Фёдоров household", number: "0540", hasAddress: false, zoneId: ZONES[2].id } },
  { id: "p-mohammed", name: "محمد شمس", memberNumber: "10640", email: null, phone: "+17135550111", dateOfBirth: "1957-02-14", role: "primary", onApp: false, onTeam: false, household: { id: "f-shams", name: "شمس household", number: "0821", hasAddress: true, zoneId: ZONES[1].id } },
  { id: "p-lena", name: "Lena Brandt", memberNumber: null, email: null, phone: "+17135550199", dateOfBirth: "1993-05-05", role: null, onApp: true, onTeam: false, household: null },
  { id: "p-samira", name: "Samira Hassan", memberNumber: "10482", email: "samira.hassan@example.org", phone: "+17135550136", dateOfBirth: "1985-07-07", role: "primary", onApp: true, onTeam: false, household: { id: "f-hassan", name: "Hassan household", number: "0301", hasAddress: true, zoneId: ZONES[0].id } },
  { id: "p-layla", name: "Layla Hassan", memberNumber: null, email: null, phone: null, dateOfBirth: "2015-03-04", role: "child", onApp: false, onTeam: false, household: { id: "f-hassan", name: "Hassan household", number: "0301", hasAddress: true, zoneId: ZONES[0].id } },
  { id: "p-omar", name: "Omar Hassan", memberNumber: null, email: null, phone: null, dateOfBirth: null, role: "child", onApp: false, onTeam: false, household: { id: "f-hassan", name: "Hassan household", number: "0301", hasAddress: true, zoneId: ZONES[0].id } },
];

const ageOf = (dob: string | null) => (dob ? String(Number(TODAY.slice(0, 4)) - Number(dob.slice(0, 4)) - (dob.slice(5) > TODAY.slice(5) ? 1 : 0)) : "—");

/** A people list for these filters, drawn the way the real page draws it. */
export function gapRows(filters: HouseholdFilters): { rows: GapRowView[]; total: number } {
  const all = gapPeople(PEOPLE, filters, { today: TODAY, majority: 18 });
  const slice = pageOf(all, 1, 25);
  return {
    total: slice.total,
    rows: slice.items.map((p) => {
      const fam = p.household ? byId.get(p.household.id) : undefined;
      return {
        id: p.id,
        href: personHref(p.id, p.household?.id ?? null),
        name: p.name,
        ids: p.memberNumber ? `Member ${p.memberNumber}` : "No member number",
        relationship: p.role === "primary" ? "Primary" : p.role === "spouse" ? "Spouse" : "—",
        family: fam ? fam.name : "Not in a family",
        cardLine: fam ? cardLine(fam) : null,
        mobile: contactCell(p.phone, "phone"),
        email: contactCell(p.email, "email"),
        app: p.onApp ? "On the app" : "Not on the app",
        age: ageOf(p.dateOfBirth),
      };
    }),
  };
}

const ctx = { zones: ZONES, fmt, tierLabel };

/** The workspace model of a list of adults with a contact gap (or an empty one), by the real rules. */
export function gapWorkspace(filters: HouseholdFilters, opts: { noAccessToExport?: boolean } = {}): PeopleWorkspaceModel {
  const base = sampleModel({ view: "people", hh: null, niva: true });
  const { rows, total } = gapRows(filters);
  const chips = chipsFor(filters, ctx).map((c) => ({ ...c, removeHref: `/dev/people-views?state=gaplist&${removeQuery(filters, c.key)}` }));
  const saved = viewParams(filters);
  const actions: ListActions = {
    list: "people",
    params: saved,
    sort: null,
    suggested: suggestedViewName(filters, chips.map((c) => c.label)),
    blockedReason: Object.keys(saved).length === 0 ? "Add a filter first; then you can save this list as a view." : null,
    exportHref: opts.noAccessToExport ? null : `/dev/people-views/export?${new URLSearchParams(paramsFromFilters(filters)).toString()}`,
    exportNote: opts.noAccessToExport
      ? "A list of children is not exported."
      : "Export holds adults only: a child's record is not part of a list export. It asks for a fresh 2FA code and is recorded in the audit log.",
  };
  return {
    ...base,
    view: "people",
    title: listHeading(filters) ?? "People",
    quick: base.quick,
    ask: { ...base.ask, said: "adults with no email", chips, filters, forNiva: filtersForNiva(filters, ctx), keep: { view: "people" }, action: "/dev/people-views" },
    summary: null,
    draftPrompt: null,
    households: null,
    people: null,
    gap: {
      rows,
      count: hasGap(filters) ? countText(filters, total, fmt.locale) : `${total} people`,
      paging: { showing: showingText({ from: rows.length ? 1 : 0, to: rows.length, total }, fmt.locale), prevHref: null, nextHref: null },
      emptyTitle: "No adult matches",
      emptyHint: "Everyone here has what you asked about on file, or a filter above narrows it too far. Remove a filter to see more.",
    },
    actions,
    panel: { state: "none" },
    problems: [],
    notes: [],
  };
}

function removeQuery(filters: HouseholdFilters, key: FilterKey): string {
  return new URLSearchParams(paramsFromFilters({ ...filters, [key]: null })).toString();
}

export const GAP_FILTERS: HouseholdFilters = { ...NO_FILTERS, noEmail: true };

// ── The People home ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const pin = (id: string, pinId: string): PinnedFamilyCard => {
  const f = byId.get(id) as Fam;
  return { id: pinId, householdId: id, title: f.name, cardLine: cardLine(f), href: `/dev/people-views?state=family` };
};

const VIEW_ROWS: SavedViewRow[] = [
  { id: "v1", name: "Adults with no email address", list: "people", params: { noemail: "1", band: "adults" }, sort: null, position: 0, createdAt: "2026-10-10T10:00:00Z" },
  { id: "v2", name: "Seniors with no mobile", list: "people", params: { nomobile: "1", band: "seniors" }, sort: null, position: 1, createdAt: "2026-10-10T11:00:00Z" },
  { id: "v3", name: "名簿の更新 (30 days)", list: "households", params: { ending: "30" }, sort: "area", position: 2, createdAt: "2026-10-11T09:00:00Z" },
  { id: "v4", name: "Не в приложении", list: "people", params: { noapp: "1", zone: ZONES[2].id }, sort: null, position: 3, createdAt: "2026-10-11T10:00:00Z" },
];
/** The names of the invented saved views (the preview refuses a new view with one of these names, the way the server does). */
export const SAVED_NAMES: string[] = VIEW_ROWS.map((v) => v.name);

/** The CSV lines of an export of this list, by the same rules as the real one (adults only, the family's card, no child's name). */
export function exportLines(filters: HouseholdFilters): (string | number)[][] {
  const cards = new Map<string, ExportCard>(FAMILIES.map((f) => [f.id, { name: f.name, number: f.number, orgId: f.org, city: f.city, zone: f.zone, adults: f.adults }]));
  const list = gapPeople(PEOPLE, filters, { today: TODAY, majority: 18 });
  return [[...PEOPLE_EXPORT_HEADER], ...peopleExportLines(list, cards, (role) => (role === "primary" ? "Primary" : role === "spouse" ? "Spouse" : ""), TODAY)];
}

const viewItems = (): SavedViewItem[] =>
  VIEW_ROWS.map((v) => ({
    id: v.id,
    name: v.name,
    href: viewHref(v).replace("/people?", "/dev/people-views?state=gaplist&"),
    summary: chipsFor(viewFilters(v), ctx).map((c) => c.label).join(" · "),
  }));

export function sampleHomeViews(opts: { empty: boolean; error: boolean }): PeopleHomeModel {
  return {
    summary: "8 families · 11 people",
    cookieName: null,
    recents: opts.empty
      ? []
      : ["f-okafor", "f-patel", "f-fedorov", "f-tanaka"].map((id) => {
          const f = byId.get(id) as Fam;
          return { id, title: f.name, cardLine: cardLine(f), href: "/dev/people-views?state=family" };
        }),
    inbox: [
      { key: "reviews", label: "Applications and family requests", count: 5, href: "/people?view=reviews", hint: "Membership applications and family change requests waiting for a decision" },
      { key: "duplicates", label: "Possible duplicates", count: 1, href: "/people?view=duplicates", hint: "Pairs of families or people that may be the same" },
    ],
    endingSoon: { count: 23, href: "/dev/people-views?state=gaplist&ending=60" },
    pins: opts.empty || opts.error ? [] : [pin("f-hassan", "pin-1"), pin("f-nakamura", "pin-2"), pin("f-fernandez", "pin-3")],
    pinsHidden: opts.empty ? 0 : opts.error ? 0 : 1,
    savedViews: opts.empty || opts.error ? [] : viewItems(),
    maxViews: 30,
    contactGapHref: "/dev/people-views?state=gaplist",
    lists: listsMenu([{ href: "/people/directory" }, { href: "/people/voting" }, { href: "/memberships/applications" }]),
    problems: opts.error
      ? [
          { what: "your saved views", message: "the database could not be reached — check the connection and try again." },
          { what: "your pinned families", message: "the database could not be reached — check the connection and try again." },
        ]
      : [],
  };
}

// DEV ONLY. Invented people and families for the People home preview: a neutral neighbourhood association with names from many
// cultures and scripts. Nothing here is real and nothing reads a database. The find box in the preview runs the SAME pure core as the
// real search (classify, match, rank, assemble); only the lookup is replaced by these lists.

import { identifierRules } from "@/lib/center-rules";
import type { HouseholdCard } from "@/lib/commands/types";
import { communityFormat } from "@/lib/community-format";
import { toFindRows } from "@/lib/find/assemble";
import { isChildRecord } from "@/lib/find/child";
import { classifyInput, readsAsFilter } from "@/lib/find/classify";
import { canonicalId } from "@/lib/find/match";
import { hitKindVisible } from "@/lib/find/pattern";
import { listsMenu } from "@/lib/find/lists";
import { familyHref } from "@/lib/find/rows";
import { filterFor, rankCandidates } from "@/lib/find/search";
import { householdCardLine } from "@/lib/find/labels";
import type { FamilyCandidate, FindResult, IdentifierHit, PersonCandidate } from "@/lib/find/types";
import type { PeopleHomeModel } from "@/lib/people-v2/home-model";

export const SAMPLE_COMMUNITY = "Riverside Neighbours Association";
const TODAY = "2026-10-12";
const RULES = identifierRules({ identifiers: { org_member_label: "RNA member ID", org_household_label: "RNA household ID", legacy_systems: [{ system: "neon", label: "Old CRM ID" }] } });
const fmt = communityFormat({ currency: "USD", country: "US" });
const ZONES = [
  { id: "z-north", name: "North Riverside" },
  { id: "z-east", name: "East Bank" },
  { id: "z-south", name: "South Riverside" },
];

type Fx = { kind: string; system: string; value: string };
type FxPerson = { id: string; first: string; last: string; preferred?: string; hh: string; role: string; primary?: boolean; age: number; email?: string; phone?: string; member?: string; ids?: Fx[] };
type FxHousehold = { id: string; name: string; number: string; org: string; city: string; zone: string; ids?: Fx[] };

const H: FxHousehold[] = [
  { id: "h-hassan", name: "Hassan household", number: "0301", org: "RNA-H-1102", city: "Riverside", zone: "North Riverside", ids: [{ kind: "crm", system: "neon", value: "20417" }, { kind: "accounting", system: "quickbooks", value: "88412" }] },
  { id: "h-hassan2", name: "Hassan household", number: "0788", org: "RNA-H-1999", city: "Riverside", zone: "East Bank" },
  { id: "h-nakamura", name: "Nakamura household", number: "0455", org: "RNA-H-1377", city: "Riverside", zone: "East Bank" },
  { id: "h-osei", name: "Osei household", number: "0614", org: "RNA-H-1640", city: "Riverside", zone: "South Riverside" },
  { id: "h-fernandez", name: "Fernández Ruiz household", number: "0662", org: "RNA-H-1810", city: "Riverside", zone: "South Riverside" },
  { id: "h-patel", name: "Patel household", number: "0127", org: "RNA-H-0961", city: "Riverside", zone: "North Riverside" },
  { id: "h-sharma", name: "शर्मा household", number: "0733", org: "RNA-H-1921", city: "Riverside", zone: "North Riverside" },
  { id: "h-tanaka", name: "田中 household", number: "0470", org: "RNA-H-1390", city: "Riverside", zone: "East Bank" },
  { id: "h-ivanov", name: "Иванов household", number: "0540", org: "RNA-H-1488", city: "Riverside", zone: "South Riverside" },
  { id: "h-hasan-ar", name: "الحسن household", number: "0821", org: "RNA-H-2040", city: "Riverside", zone: "Old Town" },
  { id: "h-kim", name: "Kim household", number: "0388", org: "RNA-H-1522", city: "Riverside", zone: "East Bank" },
  { id: "h-lopez", name: "Lopez Bakery household", number: "0212", org: "RNA-H-0805", city: "Riverside", zone: "North Riverside", ids: [{ kind: "bank_payer", system: "chase", value: "LOPEZ BAKERY LLC" }] },
];

const P: FxPerson[] = [
  { id: "p-samira", first: "Samira", last: "Hassan", hh: "h-hassan", role: "primary", primary: true, age: 41, phone: "+17135550136", email: "samira.hassan@example.org", member: "10482", ids: [{ kind: "org_member", system: "rna", value: "0417" }] },
  { id: "p-karim", first: "Karim", last: "Hassan", hh: "h-hassan", role: "spouse", age: 43, member: "10483" },
  { id: "p-layla", first: "Layla", last: "Hassan", hh: "h-hassan", role: "child", age: 11 },
  { id: "p-omar", first: "Omar", last: "Hassan", hh: "h-hassan", role: "child", age: 8 },
  { id: "p-yusuf", first: "Yusuf", last: "Hassan", hh: "h-hassan2", role: "primary", primary: true, age: 52, member: "10990", phone: "+17135550177" },
  { id: "p-mariam", first: "Mariam", last: "Hassan", hh: "h-hassan2", role: "spouse", age: 50 },
  { id: "p-haruka", first: "Haruka", last: "Nakamura", hh: "h-nakamura", role: "primary", primary: true, age: 38, member: "10470" },
  { id: "p-sam", first: "Samuel", preferred: "Sam", last: "Nakamura", hh: "h-nakamura", role: "spouse", age: 40, member: "10471", phone: "+14155550142" },
  { id: "p-kwame", first: "Kwame", last: "Osei", hh: "h-osei", role: "primary", primary: true, age: 55 },
  { id: "p-ama", first: "Ama", last: "Osei", hh: "h-osei", role: "spouse", age: 53 },
  { id: "p-samuel", first: "Samuel", last: "Osei", hh: "h-osei", role: "child", age: 22, email: "samuel.osei@example.org" },
  { id: "p-carmen", first: "Carmen", last: "Fernández", hh: "h-fernandez", role: "primary", primary: true, age: 58 },
  { id: "p-luis", first: "Luis", last: "Ruiz", hh: "h-fernandez", role: "spouse", age: 60 },
  { id: "p-sofia", first: "Sofía", last: "Fernández", hh: "h-fernandez", role: "child", age: 30, phone: "+14155550199" },
  { id: "p-priya", first: "Priya", last: "Patel", hh: "h-patel", role: "primary", primary: true, age: 44, ids: [{ kind: "crm", system: "neon", value: "30551" }] },
  { id: "p-anil", first: "Anil", last: "Patel", hh: "h-patel", role: "spouse", age: 46 },
  { id: "p-dev", first: "Dev", last: "Patel", hh: "h-patel", role: "child", age: 14 },
  { id: "p-priya2", first: "प्रिया", last: "शर्मा", hh: "h-sharma", role: "primary", primary: true, age: 36 },
  { id: "p-arjun", first: "Arjun", last: "शर्मा", hh: "h-sharma", role: "spouse", age: 38 },
  { id: "p-taro", first: "太郎", last: "田中", hh: "h-tanaka", role: "primary", primary: true, age: 47, member: "10533" },
  { id: "p-hanako", first: "花子", last: "田中", hh: "h-tanaka", role: "spouse", age: 45 },
  { id: "p-nikolai", first: "Николай", last: "Иванов", hh: "h-ivanov", role: "primary", primary: true, age: 49 },
  { id: "p-mila", first: "Mila", last: "Ivanova", hh: "h-ivanov", role: "spouse", age: 47 },
  { id: "p-mohammed", first: "محمد", last: "الحسن", hh: "h-hasan-ar", role: "primary", primary: true, age: 57 },
  { id: "p-minjun", first: "Min-jun", last: "Kim", hh: "h-kim", role: "primary", primary: true, age: 29 },
  { id: "p-ana", first: "Ana", last: "Lopez", hh: "h-lopez", role: "primary", primary: true, age: 51, email: "ana@lopezbakery.example", phone: "+14155550134" },
];

const dobOf = (age: number) => `${Number(TODAY.slice(0, 4)) - age - 1}-06-15`;

function cardOf(h: FxHousehold): HouseholdCard {
  const adults = P.filter((p) => p.hh === h.id && !isChildRecord(dobOf(p.age), p.role, TODAY, 18)).sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
  return {
    household_id: h.id,
    household_name: h.name,
    household_number: h.number,
    org_household_id: h.org,
    adults: adults.map((a) => `${a.preferred ?? a.first} ${a.last}`),
    primary_adult: adults[0] ? `${adults[0].first} ${adults[0].last}` : null,
    zone: h.zone,
    city: h.city,
    last_gift_on: null,
    open_pledge_cents: null,
    open_pledge: null,
  };
}

export type PreviewMode = { finance: boolean; fail: boolean; problem: boolean };

/** A stand-in for the server's lookup: the same pure steps, over the lists above. */
export function fixtureSearch(raw: string, mode: PreviewMode): FindResult {
  const typed = raw.replace(/\s+/g, " ").trim();
  if (mode.fail) return { ok: false, error: "Could not search — the server did not respond. Check your connection and try again." };
  const vocab = { zones: ZONES, year: 2026 };
  const q = classifyInput(typed, vocab);
  const none = { query: q.text, kind: q.kind, rows: [], more: 0, filter: null, problem: null };
  if (typed.length < 2) return { ok: true, data: none };
  if (q.kind === "question") return { ok: true, data: { ...none, filter: filterFor(typed, vocab, fmt) } };
  let search = q;
  let filter = null;
  if (q.kind === "filter") {
    filter = filterFor(typed, vocab, fmt);
    const leftover = readsAsFilter(typed, vocab)?.filters.q ?? null;
    if (!leftover) return { ok: true, data: { ...none, filter } };
    search = classifyInput(leftover, vocab);
  }

  // What app.resolve_identifier would say: exact matches, finance kinds only for finance readers.
  const target = canonicalId(search.search);
  const hitsFor = (ids: Fx[], pseudo: Fx[]): IdentifierHit[] =>
    [...pseudo, ...ids].filter((i) => hitKindVisible(i.kind, mode.finance) && /[\p{L}\p{N}]/u.test(search.search) && canonicalId(i.value) === target).map((i) => ({ kind: i.kind, system: i.system, value: i.value }));

  const families = new Map<string, FamilyCandidate>(
    H.map((h) => [h.id, { id: h.id, displayName: h.name, householdNumber: h.number, hits: hitsFor(h.ids ?? [], [{ kind: "connect_household", system: "connect", value: h.number }, { kind: "org_household", system: "rna", value: h.org }]) }]),
  );
  const people: PersonCandidate[] = P.map((p) => ({
    id: p.id,
    firstName: p.first,
    lastName: p.last,
    preferredName: p.preferred ?? null,
    email: p.email ?? null,
    phoneE164: p.phone ?? null,
    memberNumber: p.member ?? null,
    isChild: isChildRecord(dobOf(p.age), p.role, TODAY, 18),
    isDeceased: false,
    householdId: p.hh,
    relationship: p.primary ? "primary" : p.role,
    hits: hitsFor(p.ids ?? [], []),
  }));
  const { items, more } = rankCandidates(search, RULES, people, families, { canSeeChildren: true });
  const cards = new Map(H.map((h) => [h.id, cardOf(h)]));
  return {
    ok: true,
    data: {
      query: q.text,
      kind: q.kind,
      rows: toFindRows(items, cards),
      more,
      filter,
      problem: mode.problem ? "Some matches could not be looked up just now, so this list may be missing a few. Try again." : null,
    },
  };
}

export const RECENT_IDS = ["h-hassan", "h-nakamura", "h-osei", "h-fernandez", "h-lopez", "h-tanaka"];

export function sampleHome(opts: { recents: boolean; withInbox: boolean }): PeopleHomeModel {
  const cards = new Map(H.map((h) => [h.id, cardOf(h)]));
  return {
    summary: `${H.length} families · ${P.length} people`,
    cookieName: null,
    recents: opts.recents ? RECENT_IDS.map((id) => ({ id, title: cards.get(id)?.household_name ?? "Family", cardLine: householdCardLine(cards.get(id) as HouseholdCard), href: familyHref(id) })) : [],
    inbox: opts.withInbox
      ? [
          { key: "reviews", label: "Applications and family requests", count: 5, href: "/people?view=reviews", hint: "Membership applications and family change requests waiting for a decision" },
          { key: "duplicates", label: "Possible duplicates", count: 1, href: "/people?view=duplicates", hint: "Pairs of families or people that may be the same" },
        ]
      : [],
    endingSoon: { count: 23, href: "/people?ending=60" },
    lists: listsMenu([{ href: "/people/directory" }, { href: "/people/voting" }, { href: "/memberships/applications" }]),
    problems: [],
  };
}

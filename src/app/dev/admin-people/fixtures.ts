// DEV ONLY. Invented sample data for the People workspace preview: a neutral neighbourhood association with members from many
// cultures. Nothing here is real and nothing reads a database. The model is built with the same pure helpers the real page uses.

import { communityFormat, moneyExample, moneyIn } from "@/lib/community-format";
import type { HouseholdCard } from "@/lib/commands/types";
import { listsMenu } from "@/lib/find/lists";
import { AGE_BANDS, tierLabel } from "@/lib/people";
import { chipsFor, FILTER_PARAM, filtersForNiva, readAsk, TIERS, type FilterKey, type Zone } from "@/lib/people-v2/ask";
import { filterHouseholds, openTotal, pageOf, showingText, sortHouseholds, type BaseHousehold } from "@/lib/people-v2/list";
import type { HouseholdPanel, PanelState, PeopleView, PeopleWorkspaceModel } from "@/lib/people-v2/model";
import { hrefWith } from "@/lib/search-params";

export const SAMPLE_COMMUNITY = "Riverside Neighbours Association";
const BASE = "/dev/admin-people";
const fmt = communityFormat({ currency: "USD", country: "US" });
const YEAR = 2026;
const money = (cents: number) => moneyIn(cents, fmt);

const ZONES: Zone[] = [
  { id: "a0000000-0000-4000-8000-000000000001", name: "North Riverside" },
  { id: "a0000000-0000-4000-8000-000000000002", name: "Old Town" },
  { id: "a0000000-0000-4000-8000-000000000003", name: "Hillcrest" },
];
const [NORTH, OLD, HILL] = ZONES.map((z) => z.id);

type Sample = BaseHousehold & {
  org: string;
  primary: string;
  pid: string;
  open: number;
  gift: [string, number] | null;
  rsvp: [string, number] | null;
  adults: [string, string, string][];
  children: [string, number][];
  ids: string;
};

const id = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S = (n: number, name: string, num: string, zoneId: string, rest: Omit<Sample, "id" | "name" | "number" | "zoneId" | "city" | "tiers"> & { tiers?: string[] }): Sample => ({
  id: id(n),
  name,
  number: num,
  zoneId,
  city: zoneId === NORTH ? "Riverside" : zoneId === OLD ? "Riverside" : "Hillcrest",
  tiers: rest.tiers ?? ["yearly"],
  ...rest,
});

const SAMPLES: Sample[] = [
  S(1, "Chidi & Ngozi Okafor Household", "0212", NORTH, { org: "RNA-H-2041", primary: "Chidi Okafor", pid: "0417", open: 25000, gift: ["2026-09-14", 25000], rsvp: ["Harvest Fair", 2025], adults: [["Chidi Okafor", "Primary", "(555) 010-2041 · chidi.okafor@example.org"], ["Ngozi Okafor", "Spouse", "(555) 010-2042 · ngozi@example.org"]], children: [["Ada Okafor", 9], ["Emeka Okafor", 6]], ids: "Neon 4374 · QuickBooks 1187 · Bank payer CHIDI OKAFOR" }),
  S(2, "García López household", "0562", NORTH, { org: "RNA-H-2390", primary: "María García", pid: "0775", open: 48000, gift: ["2026-08-02", 10100], rsvp: ["Spring Clean-up", 2025], adults: [["María García", "Primary", "(555) 010-2390"], ["Luis López", "Spouse", "luis.lopez@example.org"]], children: [["Sofía López", 11]], ids: "Neon 4420 · QuickBooks 1213" }),
  S(3, "Nguyen household", "0301", NORTH, { org: "RNA-H-1960", primary: "Thanh Nguyen", pid: "0398", open: 17500, gift: ["2026-06-21", 5100], rsvp: ["Lantern Walk", 2025], adults: [["Thanh Nguyen", "Primary", "(555) 010-1960"], ["Linh Nguyen", "Spouse", "linh.n@example.org"]], children: [], ids: "Neon 4115 · Bank payer T NGUYEN" }),
  S(4, "Haddad household", "0847", NORTH, { org: "RNA-H-2704", primary: "Karim Haddad", pid: "1021", open: 12000, gift: ["2026-09-09", 20000], rsvp: ["Summer Picnic", 2025], adults: [["Karim Haddad", "Primary", "(555) 010-2704"], ["Leila Haddad", "Spouse", "(555) 010-2705"]], children: [["Sami Haddad", 12], ["Noor Haddad", 8]], ids: "QuickBooks 1301 · Bank payer KARIM HADDAD" }),
  S(5, "Kowalski household", "0219", NORTH, { org: "RNA-H-1705", primary: "Anna Kowalski", pid: "0286", open: 105000, gift: ["2026-05-30", 50000], rsvp: ["Winter Supper", 2024], tiers: ["life"], adults: [["Anna Kowalski", "Primary", "anna.k@example.org"], ["Piotr Kowalski", "Spouse", "(555) 010-1706"]], children: [], ids: "Neon 4107 · QuickBooks 1085" }),
  S(6, "Mensah household", "0655", NORTH, { org: "RNA-H-2512", primary: "Kwame Mensah", pid: "0880", open: 20500, gift: ["2026-07-12", 10100], rsvp: ["Lantern Walk", 2025], adults: [["Kwame Mensah", "Primary", "(555) 010-2512"], ["Abena Mensah", "Spouse", "abena@example.org"]], children: [["Kofi Mensah", 5]], ids: "Neon 4552 · QuickBooks 1266" }),
  S(7, "O'Brien household", "0733", NORTH, { org: "RNA-H-2631", primary: "Siobhan O'Brien", pid: "0941", open: 13000, gift: ["2026-04-03", 5100], rsvp: ["Spring Clean-up", 2025], adults: [["Siobhan O'Brien", "Primary", "(555) 010-2631"]], children: [], ids: "Neon 4601 · Bank payer S OBRIEN" }),
  S(8, "Tanaka household", "0402", NORTH, { org: "RNA-H-2208", primary: "Yuki Tanaka", pid: "0511", open: 30000, gift: ["2025-11-20", 15000], rsvp: null, adults: [["Yuki Tanaka", "Primary", "(555) 010-2208"], ["Hiro Tanaka", "Spouse", "hiro.t@example.org"]], children: [], ids: "QuickBooks 1140" }),
  S(9, "Patel household", "0918", NORTH, { org: "RNA-H-2777", primary: "Meera Patel", pid: "1102", open: 22000, gift: null, rsvp: ["Harvest Fair", 2024], adults: [["Meera Patel", "Primary", "(555) 010-2777"], ["Ravi Patel", "Spouse", "(555) 010-2778"]], children: [["Arjun Patel", 10]], ids: "Neon 4711" }),
  S(10, "Johansson household", "0120", OLD, { org: "RNA-H-1102", primary: "Erik Johansson", pid: "0150", open: 40000, gift: ["2026-03-01", 10000], rsvp: ["Harvest Fair", 2025], adults: [["Erik Johansson", "Primary", "(555) 010-1102"]], children: [], ids: "Neon 4002" }),
  S(11, "Silva household", "0388", HILL, { org: "RNA-H-2216", primary: "Ana Silva", pid: "0466", open: 0, gift: ["2026-09-01", 2500], rsvp: ["Summer Picnic", 2026], adults: [["Ana Silva", "Primary", "(555) 010-2216"]], children: [], ids: "QuickBooks 1190" }),
  S(12, "Cohen household", "0450", NORTH, { org: "RNA-H-2301", primary: "Miriam Cohen", pid: "0602", open: 9000, gift: ["2026-02-11", 9000], rsvp: null, adults: [["Miriam Cohen", "Primary", "(555) 010-2301"]], children: [], ids: "Neon 4333" }),
  S(13, "Adeyemi household", "0505", NORTH, { org: "RNA-H-2350", primary: "Tunde Adeyemi", pid: "0650", open: 60000, gift: ["2026-01-15", 30000], rsvp: ["Spring Clean-up", 2026], adults: [["Tunde Adeyemi", "Primary", "(555) 010-2350"]], children: [], ids: "QuickBooks 1222" }),
];

/** Which households answered an RSVP in the sample year (they drop out of "No RSVP in 2026"). */
const RSVPD = new Set(SAMPLES.filter((s) => s.rsvp?.[1] === YEAR).map((s) => s.id));
const BALANCES = new Map(SAMPLES.map((s) => [s.id, s.open]));

const SAID = `Households in North Riverside with an open balance over ${moneyExample(10000, fmt)} that have not RSVP’d this year`;

function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return new Intl.DateTimeFormat(fmt.locale, iso.startsWith(String(YEAR)) ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

function card(s: Sample): HouseholdCard {
  return {
    household_id: s.id,
    household_name: s.name,
    household_number: s.number,
    org_household_id: s.org,
    adults: s.adults.map((a) => a[0]),
    primary_adult: s.primary,
    zone: ZONES.find((z) => z.id === s.zoneId)?.name ?? null,
    city: s.city,
    last_gift_on: s.gift?.[0] ?? null,
    open_pledge_cents: s.open,
    open_pledge: money(s.open),
  };
}

function panelFor(s: Sample): HouseholdPanel {
  const area = ZONES.find((z) => z.id === s.zoneId)?.name ?? s.city ?? "Not recorded";
  const lastGift = s.gift ? `${shortDay(s.gift[0])} · ${money(s.gift[1])}` : "None yet";
  const other = SAMPLES[10];
  return {
    id: s.id,
    name: s.name,
    ids: `Household ${s.number} · ${s.org}`,
    facts: [
      { label: "Primary member", value: `${s.primary} (member ${s.pid})`, tone: "strong" },
      { label: "Members", value: [...s.adults.map((a) => a[0].split(" ")[0]), ...s.children.map((c) => `${c[0].split(" ")[0]} (child)`)].join(", ") },
      { label: "Area", value: area },
      { label: "Last gift", value: lastGift },
      { label: "Open balance", value: money(s.open), tone: "money" },
      { label: "Other IDs", value: s.ids, tone: "mono" },
    ],
    recordPaymentHref: "/giving/payments",
    fullPageHref: "/households",
    noticed: s.id === SAMPLES[0].id ? { name: "Okafor family", ids: `${other.number} · ${other.org}`, place: "Hillcrest", compareHref: "/people/merge", candidateId: "c0000000-0000-4000-8000-000000000001" } : null,
    adults: s.adults.map(([name, role, contact]) => ({ name, role, contact, onApp: role === "Primary" })),
    children: s.children.map(([name, age]) => ({ name, age: `Age ${age}` })),
    membership: { state: "ok", data: [{ label: `${tierLabel(s.tiers[0])} · Active`, detail: s.tiers[0] === "life" ? "since Mar 4, 2019 · no end date" : "since Jan 1, 2026 · ends Dec 31, 2026" }] },
    giving: {
      state: "ok",
      data: {
        open: money(s.open),
        lastGift,
        pledges: [
          { label: `Annual dues ${YEAR} · Jan 1, ${YEAR}`, progress: `${money(25000 - Math.min(25000, s.open))} of ${money(25000)}`, closed: s.open === 0 },
          { label: `Hall renovation fund · Mar 15, ${YEAR}`, progress: `${money(10000)} of ${money(10000)}`, closed: true },
        ],
      },
    },
    requests: { state: "ok", data: s.id === SAMPLES[0].id ? [{ what: "Family change request · add a family member", when: "Oct 2, 2026", href: "/people/requests" }] : [] },
    activity: {
      state: "ok",
      data: [
        { when: "Sep 14, 2026", what: "Payment recorded", detail: money(25000) },
        { when: "Aug 30, 2026", what: "Address changed", detail: "" },
      ],
    },
    nivaPrompt: `Show everything we have on household ${s.number}, Household ID ${s.org} (adults: ${s.adults.map((a) => a[0]).join(", ")}), including its IDs, membership, giving and anything open.`,
    problems: [],
  };
}

export function sampleModel(opts: { view: PeopleView; hh: string | null; niva: boolean }): PeopleWorkspaceModel {
  const reading = readAsk(SAID, { zones: ZONES, year: YEAR });
  const filters = reading.filters;
  const ctx = { zones: ZONES, fmt, tierLabel };
  const keep: Record<string, string> = opts.view === "households" ? {} : { view: opts.view };
  const link = (over: Record<string, string | null>) => hrefWith(BASE, keep, over);
  const filtered = filterHouseholds(SAMPLES, filters, { searchIds: null, balances: BALANCES, rsvpd: RSVPD, ending: null });
  const sorted = sortHouseholds(filtered, "name", { balances: BALANCES, zoneName: (z) => ZONES.find((x) => x.id === z)?.name ?? null });
  const slice = pageOf(sorted, 1, 7);
  const rows = slice.items as Sample[];
  const selected = opts.hh ?? (opts.view === "households" ? (rows[0]?.id ?? null) : null);
  const sel = SAMPLES.find((s) => s.id === selected) ?? null;
  const forNiva = filtersForNiva(filters, ctx);
  const panel: PanelState = sel ? { state: "ok", card: panelFor(sel), explicit: !!opts.hh, closeHref: link({ hh: null }) } : { state: "none" };

  return {
    view: opts.view,
    title: opts.view === "people" ? "People" : opts.view === "reviews" ? "To review" : opts.view === "duplicates" ? "Possible duplicates" : "Families",
    lists: listsMenu([{ href: "/people/directory" }, { href: "/people/voting" }, { href: "/memberships/applications" }]),
    quick: [
      { key: "all", label: "All households", href: BASE, current: false },
      { key: "duplicates", label: "Possible duplicates · 4", href: `${BASE}?view=duplicates`, current: opts.view === "duplicates" },
      { key: "ending", label: "Memberships ending soon · 23", href: BASE, current: false },
      { key: "reviews", label: "To review · 3", href: `${BASE}?view=reviews`, current: opts.view === "reviews" },
      { key: "save", label: "+ Save this view", href: null, current: false, comingNext: true, title: "Saved views are not built yet." },
    ],
    ask: {
      cookieName: null,
      said: SAID,
      unread: false,
      filters,
      chips: chipsFor(filters, ctx).map((c) => ({ ...c, removeHref: link({ [FILTER_PARAM[c.key as FilterKey]]: null }) })),
      keep: {},
      zones: ZONES,
      tiers: TIERS.map((t) => ({ key: t, label: tierLabel(t) })),
      placeholder: `Try: households in North Riverside with an open balance over ${moneyExample(10000, fmt)}`,
      forNiva,
      year: YEAR,
      action: BASE,
    },
    summary: opts.view === "households" ? { count: `${slice.total} households`, open: money(openTotal(filtered, BALANCES) ?? 0) } : null,
    draftPrompt: `Draft a reminder message for the ${slice.total} households on my People list (${forNiva}). Only draft it: do not send anything.`,
    households:
      opts.view === "households"
        ? {
            rows: rows.map((r) => ({
              id: r.id,
              href: link({ hh: r.id }),
              selected: r.id === selected,
              name: r.name,
              ids: `No. ${r.number} · ${r.org}`,
              primary: r.primary,
              area: ZONES.find((z) => z.id === r.zoneId)?.name ?? "—",
              open: money(r.open),
              lastGift: r.gift ? `${shortDay(r.gift[0])} · ${money(r.gift[1])}` : "None yet",
              lastRsvp: r.rsvp ? `${r.rsvp[0]} ${r.rsvp[1]}` : "None yet",
            })),
            paging: { showing: showingText(slice, fmt.locale), prevHref: null, nextHref: slice.pages > 1 ? link({ page: "2" }) : null },
            sort: "name",
            sortHrefs: { name: BASE, open: `${BASE}?sort=open`, area: `${BASE}?sort=area` },
            canSortByOpen: true,
            selectionExplicit: !!opts.hh,
            emptyTitle: "No household matches these filters",
            emptyHint: null,
          }
        : null,
    people:
      opts.view === "people"
        ? {
            rows: SAMPLES.slice(0, 8).flatMap((s) =>
              s.adults.map(([name, role, contact], i) => ({
                id: `${s.id}-${i}`,
                href: link({ hh: s.id }),
                selected: s.id === selected,
                name,
                ids: `Member ${String(Number(s.pid) + i).padStart(4, "0")}`,
                relationship: role,
                household: `${s.name} · ${s.number}`,
                age: "—",
                contact,
              })),
            ),
            paging: { showing: "Showing 15 of 214", prevHref: null, nextHref: `${BASE}?view=people&page=2` },
            bands: AGE_BANDS.map((b) => ({ key: b.key, label: b.label, href: BASE, current: b.key === "all" })),
            emptyTitle: "No people yet",
          }
        : null,
    reviews:
      opts.view === "reviews"
        ? {
            state: "ok",
            data: {
              applications: [{ id: "r1", title: "Tunde Adeyemi", detail: "Yearly · waiting for the center review · fee " + money(5000), household: card(SAMPLES[12]), href: "/memberships/applications" }],
              applicationsTotal: 1,
              requests: [{ id: "r2", title: "Add a family member", detail: "Add Grace Okafor, asked for as their parent", household: card(SAMPLES[0]), href: "/people/requests" }],
              requestsTotal: 2,
              forScreen: 1,
              note: null,
              applicationsHref: "/memberships/applications",
              requestsHref: "/people/requests",
            },
          }
        : null,
    duplicates:
      opts.view === "duplicates"
        ? {
            state: "ok",
            data: {
              items: [
                {
                  candidateId: "c0000000-0000-4000-8000-000000000001",
                  kind: "household",
                  sides: [
                    { id: SAMPLES[0].id, title: SAMPLES[0].name, lines: [], card: card(SAMPLES[0]) },
                    { id: SAMPLES[10].id, title: "Okafor family", lines: [], card: { ...card(SAMPLES[10]), household_name: "Okafor family", adults: ["Chidi Okafor"], primary_adult: "Chidi Okafor" } },
                  ],
                  compareHref: "/people/merge",
                  suggestedKeepId: null,
                  blocked: null,
                },
                {
                  candidateId: "c0000000-0000-4000-8000-000000000002",
                  kind: "person",
                  sides: [
                    { id: "p1", title: "María García", lines: ["Member 0775", "Signs in to the app", "5 of 6 profile details on file"], card: null },
                    { id: "p2", title: "Maria Garcia", lines: ["No member number", "Does not sign in to the app", "2 of 6 profile details on file"], card: null },
                  ],
                  compareHref: "/people/merge",
                  suggestedKeepId: "p1",
                  blocked: null,
                },
              ],
              forScreen: 1,
              mergeScreenHref: "/people/merge",
            },
          }
        : null,
    gap: null,
    actions: null,
    panel,
    problems: [],
    notes: [],
  };
}

export const SAMPLE_IDS = { first: SAMPLES[0].id };

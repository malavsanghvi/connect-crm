import { redirect } from "next/navigation";

import { NoAccess } from "@/components/ui";
import { PeopleWorkspace } from "@/components/people-v2/people-workspace";
import type { PendingReviewsData } from "@/lib/commands/catalog/people/pending-reviews";
import type { SuggestDuplicatesData } from "@/lib/commands/catalog/people/suggest-duplicates";
import { runScreenCommand } from "@/lib/commands/screen";
import type { HouseholdCard } from "@/lib/commands/types";
import { communityFormat, moneyExample, moneyIn } from "@/lib/community-format";
import { listPeople } from "@/lib/data/people-list";
import { todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { parseAmountToCents } from "@/lib/money";
import { AGE_BANDS, isAgeBand, relationshipLabel, tierLabel, type AgeBand } from "@/lib/people";
import { canAccess } from "@/lib/permissions";
import {
  chipsFor,
  FILTER_PARAM,
  filtersForNiva,
  filtersFromParams,
  hasFilters,
  paramsFromFilters,
  readAsk,
  TIERS,
  type FilterKey,
  type HouseholdFilters,
} from "@/lib/people-v2/ask";
import { showingText, sortKey } from "@/lib/people-v2/list";
import { ENDING_SOON_DAYS, loadHouseholdList, loadHouseholdPanel, loadQuickCounts, loadZones } from "@/lib/people-v2/load";
import { peopleView, type DuplicateItem, type DuplicateSide, type PanelState, type PeopleWorkspaceModel, type Problem, type QuickChip } from "@/lib/people-v2/model";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

const BASE = "/people";
const PAGE_SIZE = 25;

/**
 * People in the new look: the household list with the ask-your-data box and the household card beside it, plus the people list,
 * what is waiting for a decision and the suggested duplicates. The classic People page is untouched (page.tsx picks by look).
 */
export async function PeopleV2({ session, sp }: { session: CrmSession; sp: RawSearchParams }) {
  if (!canAccess(session, "households")) {
    return (
      <>
        <h1 className="mb-4 font-display text-[30px] font-semibold text-ink">People</h1>
        <NoAccess area="People" access="households" />
      </>
    );
  }
  const { center } = session;
  const fmt = communityFormat(center);
  const year = Number(todayInTz(center.time_zone).slice(0, 4));
  const view = peopleView(param(sp, "view"));
  const sort = sortKey(param(sp, "sort"));
  const said = (param(sp, "said") ?? "").slice(0, 300);
  const page = pageParam(sp);
  const problems: Problem[] = [];
  const notes: string[] = [];

  const zonesRes = await loadZones(session);
  if (zonesRes.error) problems.push({ what: "the areas", message: "the list of areas did not load, so an area in your sentence cannot be recognised." });
  const zones = zonesRes.zones;

  // The ask box and the "Add a filter" form send plain GETs; turn them into the page's own filter address once.
  const asked = param(sp, "ask");
  const overAmount = sp.over_amount;
  if (asked !== undefined || overAmount !== undefined) {
    const keepView = view === "people" ? "people" : undefined;
    const keepSort = sort !== "name" ? sort : undefined;
    if (asked !== undefined) {
      const reading = readAsk(asked, { zones, year });
      redirect(hrefWith(BASE, {}, { ...paramsFromFilters(reading.filters), view: keepView, sort: keepSort, said: asked.trim().slice(0, 300) || undefined, unread: reading.understood || !asked.trim() ? undefined : "1" }));
    }
    const typed = (Array.isArray(overAmount) ? overAmount[0] : overAmount)?.trim() ?? "";
    const cents = typed === "" ? null : parseAmountToCents(typed);
    const filters: HouseholdFilters = { ...filtersFromParams(sp), overCents: cents !== null && cents >= 0 ? cents : null };
    redirect(hrefWith(BASE, {}, { ...paramsFromFilters(filters), view: keepView, sort: keepSort, bad: typed !== "" && (cents === null || cents < 0) ? "amount" : undefined }));
  }
  if (param(sp, "bad") === "amount") notes.push("That open balance amount could not be read, so it was left out. Type it as a number, for example 100 or 99.50.");

  const filters = filtersFromParams(sp);
  const fparams = paramsFromFilters(filters);
  const bandParam = param(sp, "band");
  const band: AgeBand = isAgeBand(bandParam) ? bandParam : "all";
  const keep: Record<string, string> = {
    ...fparams,
    ...(view !== "households" ? { view } : {}),
    ...(sort !== "name" ? { sort } : {}),
    ...(said ? { said } : {}),
    ...(view === "people" && band !== "all" ? { band } : {}),
  };
  const link = (over: Record<string, string | number | null | undefined>) => hrefWith(BASE, keep, over);
  const ctx = { zones, fmt, tierLabel };
  const hh = param(sp, "hh");

  const counts = await loadQuickCounts(session);
  problems.push(...counts.problems);
  const seesReviews = canAccess(session, "householdRequests") || canAccess(session, "applications");
  const onlyEnding = filters.endingDays === ENDING_SOON_DAYS && Object.keys(fparams).length === 1;
  const quick: QuickChip[] = [
    { key: "all", label: "All households", href: BASE, current: view === "households" && !hasFilters(filters) },
    { key: "duplicates", label: counts.duplicates === null ? "Possible duplicates" : `Possible duplicates · ${counts.duplicates}`, href: `${BASE}?view=duplicates`, current: view === "duplicates" },
    { key: "ending", label: counts.ending === null ? "Memberships ending soon" : `Memberships ending soon · ${counts.ending}`, href: `${BASE}?ending=${ENDING_SOON_DAYS}`, current: view === "households" && onlyEnding, title: `Active memberships that end in the next ${ENDING_SOON_DAYS} days` },
    ...(seesReviews ? [{ key: "reviews", label: counts.waiting === null ? "To review" : `To review · ${counts.waiting}`, href: `${BASE}?view=reviews`, current: view === "reviews", title: "Membership applications and family change requests waiting for a decision" }] : []),
    { key: "save", label: "+ Save this view", href: null, current: false, comingNext: true, title: "Saved views are not built yet." },
  ];

  const model: PeopleWorkspaceModel = {
    view,
    tabs: [
      { key: "people", label: "People", href: hrefWith(BASE, {}, { view: "people", q: filters.q ?? undefined }), current: view === "people" },
      { key: "households", label: "Households", href: hrefWith(BASE, {}, { ...fparams, sort: sort !== "name" ? sort : undefined, said: said || undefined }), current: view === "households" },
      { key: "memberships", label: "Memberships", href: "/memberships/applications", current: false },
    ],
    quick,
    ask: {
      said,
      unread: param(sp, "unread") === "1",
      filters,
      chips: chipsFor(filters, ctx).map((c) => ({ ...c, removeHref: link({ [FILTER_PARAM[c.key as FilterKey]]: null, said: null, unread: null, page: null, hh: null }) })),
      keep: { ...(view === "people" ? { view } : {}), ...(sort !== "name" ? { sort } : {}) },
      zones,
      tiers: TIERS.map((t) => ({ key: t, label: tierLabel(t) })),
      placeholder: `Try: households${zones[0] ? ` in ${zones[0].name}` : ""} with an open balance over ${moneyExample(10000, fmt)} that have not RSVP'd this year`,
      forNiva: filtersForNiva(filters, ctx),
      year,
      action: BASE,
    },
    summary: null,
    draftPrompt: null,
    households: null,
    people: null,
    reviews: null,
    duplicates: null,
    panel: { state: "none" },
    problems,
    notes,
  };

  let selected: string | null = isUuid(hh) ? hh : null;
  let pageKeep: number | null = null;

  if (view === "households") {
    const list = await loadHouseholdList(session, filters, { sort, page, pageSize: PAGE_SIZE, zones });
    problems.push(...list.problems);
    notes.push(...list.notes);
    pageKeep = list.page > 1 ? list.page : null;
    if (!selected) selected = list.rows[0]?.id ?? null;
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    const thisYear = String(year);
    const giftDate = (iso: string) =>
      new Intl.DateTimeFormat(fmt.locale, iso.startsWith(thisYear) ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
    const n = list.total;
    model.summary = { count: `${n.toLocaleString(fmt.locale)} household${n === 1 ? "" : "s"}`, open: list.openTotalCents === null ? null : moneyIn(list.openTotalCents, fmt) };
    model.draftPrompt =
      n > 0 ? `Draft a reminder message for the ${n} household${n === 1 ? "" : "s"} on my People list${model.ask.forNiva ? ` (${model.ask.forNiva})` : ""}. Only draft it: do not send anything.` : null;
    model.households = {
      rows: list.rows.map((r) => ({
        id: r.id,
        href: link({ hh: r.id, page: pageKeep }),
        selected: r.id === selected,
        name: r.name,
        ids: [r.number ? `No. ${r.number}` : "No household number", ...r.orgIds].join(" · "),
        primary: r.primary?.name ?? "—",
        area: (r.zoneId ? zoneName.get(r.zoneId) : null) ?? r.city ?? "—",
        open: r.openCents === null ? null : moneyIn(r.openCents, fmt),
        lastGift: r.lastGift === undefined ? "—" : r.lastGift === null ? "None yet" : `${giftDate(r.lastGift.on)} · ${moneyIn(r.lastGift.cents, fmt)}`,
        lastRsvp: r.lastRsvp === undefined ? "—" : r.lastRsvp === null ? "None yet" : r.lastRsvp.year && !r.lastRsvp.event.includes(String(r.lastRsvp.year)) ? `${r.lastRsvp.event} ${r.lastRsvp.year}` : r.lastRsvp.event,
      })),
      paging: {
        showing: showingText(list, fmt.locale),
        prevHref: list.page > 1 ? link({ page: list.page - 1 > 1 ? list.page - 1 : null }) : null,
        nextHref: list.page < list.pages ? link({ page: list.page + 1 }) : null,
      },
      sort,
      sortHrefs: { name: link({ sort: null, page: null }), open: link({ sort: "open", page: null }), area: link({ sort: "area", page: null }) },
      canSortByOpen: list.canSeeGiving,
      selectionExplicit: isUuid(hh),
      emptyTitle: hasFilters(filters) ? "No household matches these filters" : "No households yet",
      emptyHint: filters.q ? "Try part of the name, or an identifier exactly as the other system shows it." : hasFilters(filters) ? "Remove a filter above to see more households." : null,
    };
  } else if (view === "people") {
    const list = await listPeople(session, { search: filters.q ?? undefined, band, page, pageSize: PAGE_SIZE });
    if (list.error) problems.push({ what: list.rows.length ? "some details for these people" : "people", message: explainError(list.error) });
    if (list.note) notes.push(list.note);
    if (filters.zone || filters.tier || filters.overCents !== null || filters.noRsvpYear !== null || filters.endingDays !== null) {
      notes.push("Area, membership, balance and RSVP filters apply to the Households list; the People list uses the name or ID search.");
    }
    pageKeep = page > 1 ? page : null;
    const from = (page - 1) * PAGE_SIZE + 1;
    const to = from + list.rows.length - 1;
    model.people = {
      rows: list.rows.map((p) => {
        const minor = p.age !== null && p.age < 18;
        return {
          id: p.id,
          href: p.household ? link({ hh: p.household.id, page: pageKeep }) : `/people/${p.id}`,
          selected: !!p.household && p.household.id === selected,
          name: p.name,
          ids: [p.memberNumber ? `Member ${p.memberNumber}` : "No member number", ...p.orgIds].join(" · "),
          relationship: p.role ? relationshipLabel(p.isPrimary ? "primary" : p.role, p.gender) : "—",
          household: p.household ? `${p.household.name}${p.household.number ? ` · ${p.household.number}` : ""}` : "No household",
          age: p.age === null ? "—" : String(p.age),
          contact: minor ? "Via parents" : p.email || p.phone || "—",
        };
      }),
      paging: {
        showing: list.rows.length === 0 ? "" : list.total !== null ? showingText({ from, to, total: list.total }, fmt.locale) : `Showing ${list.rows.length}`,
        prevHref: page > 1 ? link({ page: page - 1 > 1 ? page - 1 : null }) : null,
        nextHref: list.total !== null ? (page * PAGE_SIZE < list.total ? link({ page: page + 1 }) : null) : list.rows.length === PAGE_SIZE ? link({ page: page + 1 }) : null,
      },
      bands: AGE_BANDS.map((b) => ({ key: b.key, label: b.label, href: link({ band: b.key === "all" ? null : b.key, page: null, hh: null }), current: band === b.key })),
      emptyTitle: filters.q || band !== "all" ? "No one matches that search" : "No people yet",
    };
  } else if (view === "reviews") {
    model.reviews = await reviews(session);
  } else {
    model.duplicates = await duplicates();
  }

  if (selected) {
    const id = selected;
    const res = await loadHouseholdPanel(session, id, {
      compare: (other) => `/people/merge?household=${id}&other=${other}`,
      recordPayment: `/giving/payments?household=${id}`,
      fullPage: `/households/${id}`,
      requests: "/people/requests",
      applications: "/memberships/applications",
    });
    const closeHref = link({ hh: null, page: pageKeep });
    const explicit = isUuid(hh);
    model.panel = (res.card ? { state: "ok", card: res.card, explicit, closeHref } : { state: "error", message: res.error ?? "It could not be read.", explicit, closeHref }) satisfies PanelState;
  }

  return <PeopleWorkspace model={model} />;
}

async function reviews(session: CrmSession): Promise<PeopleWorkspaceModel["reviews"]> {
  if (!canAccess(session, "householdRequests")) {
    return { state: "hidden", reason: "Applications and family requests need the people.view or people.manage permission. Ask your organization's admin." };
  }
  const res = await runScreenCommand<PendingReviewsData>("people.pending_reviews", {}, "load what is waiting for a decision");
  if (!res.ok) return { state: "error", message: res.error };
  const d = res.data;
  if (!d) return { state: "error", message: "The answer was empty. Reload the page to try again." };
  return {
    state: "ok",
    data: {
      applications: d.applications.map((a) => ({ id: a.id, title: a.applicant, detail: [a.tier, a.step, a.fee ? `fee ${a.fee}` : null].filter(Boolean).join(" · "), household: a.household, href: "/memberships/applications" })),
      applicationsTotal: d.applications_total,
      requests: d.family_requests.map((r) => ({ id: r.id, title: r.kind, detail: r.summary, household: r.household, href: "/people/requests" })),
      requestsTotal: d.family_requests_total,
      forScreen: d.family_requests_for_the_screen,
      note: d.note ?? null,
      applicationsHref: "/memberships/applications",
      requestsHref: "/people/requests",
    },
  };
}

function cardSide(card: HouseholdCard): DuplicateSide {
  return { id: card.household_id, title: card.household_name ?? "Household", lines: [], card };
}

async function duplicates(): Promise<PeopleWorkspaceModel["duplicates"]> {
  const res = await runScreenCommand<SuggestDuplicatesData>("people.suggest_duplicates", { kind: "any" }, "load the suggested duplicates");
  if (!res.ok) return { state: "error", message: res.error };
  const d = res.data;
  if (!d) return { state: "error", message: "The answer was empty. Reload the page to try again." };
  let hidden = 0;
  const items: DuplicateItem[] = [];
  for (const s of d.suggestions) {
    if (s.kind === "household") {
      const [x, y] = s.households;
      if (!x || !y) {
        hidden += 1;
        continue;
      }
      items.push({ candidateId: s.candidate_id, kind: "household", sides: [cardSide(x), cardSide(y)], compareHref: `/people/merge?household=${x.household_id}&other=${y.household_id}`, suggestedKeepId: null, blocked: null });
      continue;
    }
    if (!s.first || !s.second) {
      hidden += 1;
      continue;
    }
    const side = (p: NonNullable<typeof s.first>): DuplicateSide => ({
      id: p.id,
      title: p.name,
      lines: [p.member_number ? `Member ${p.member_number}` : "No member number", p.signs_in ? "Signs in to the app" : "Does not sign in to the app", `${p.details_on_file} of 6 profile details on file`],
      card: null,
    });
    items.push({
      candidateId: s.candidate_id,
      kind: "person",
      sides: [side(s.first), side(s.second)],
      compareHref: `/people/merge?person=${s.first.id}&other=${s.second.id}`,
      suggestedKeepId: s.suggested_keep_id ?? null,
      blocked: s.first.signs_in && s.second.signs_in ? "Both records sign in to the app, so they cannot be merged here. Ask the platform team." : null,
    });
  }
  return { state: "ok", data: { items, forScreen: d.for_the_screen + hidden, mergeScreenHref: "/people/merge" } };
}

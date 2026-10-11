import "server-only";

// The People workspace's reads (new look). Only existing tables and loaders: households, their members and memberships, pledges and
// payments, RSVPs and events, identifiers, merge suggestions and requests. RLS decides what comes back; a part the role cannot see
// is said in words, and a part that fails is said with the reason (never an empty table that looks like "nobody").

import { identifierRules } from "@/lib/center-rules";
import { communityMajority, isAdultMember } from "@/lib/commands/child-filter";
import { communityFormat, moneyIn } from "@/lib/community-format";
import { loadHouseholdRecord } from "@/lib/data/people-records";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { householdCards, orgIds, personName } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { addDays, startOfDayInTz, todayInTz } from "@/lib/dates";
import { explainError, type DbErrorLike } from "@/lib/errors";
import { identifierKindLabel } from "@/lib/identifiers";
import { formatPhone, relationshipLabel, tierLabel } from "@/lib/people";
import { can, canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import type { HouseholdFilters, Zone } from "./ask";
import { filterHouseholds, openTotal, pageOf, sortHouseholds, type BaseHousehold, type FilterSets, type SortKey } from "./list";
import type { CardFact, HouseholdPanel, Problem, Section } from "./model";

const GIFT_STATUSES = ["captured", "settled", "pending_clearing", "partially_refunded"] as const;
/** RSVP rows that mean the household answered (not just invited, not withdrawn). */
const NOT_ANSWERED = "(invited,cancelled)";
export const ENDING_SOON_DAYS = 60;

type Fail = { what: string; error: unknown };
const problem = (f: Fail): Problem => ({ what: f.what, message: explainError(f.error) });

export function seesGiving(session: CrmSession): boolean {
  return can(session, ["giving.view", "giving.manage", "giving.record_offline"]);
}

export async function loadZones(session: CrmSession): Promise<{ zones: Zone[]; error: DbErrorLike | null }> {
  const res = await session.db.from("zones").select("id, name").eq("center_id", session.center.id).order("name");
  return { zones: (res.data ?? []).map((z) => ({ id: z.id, name: z.name })), error: res.error };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sets the filters need
// ---------------------------------------------------------------------------------------------------------------------------------

async function openBalances(session: CrmSession): Promise<{ map: Map<string, number>; error: DbErrorLike | null; truncated: boolean }> {
  const { db, center } = session;
  const res = await fetchAll((from, to) =>
    db.from("pledges").select("id, household_id, amount_cents, paid_cents").eq("center_id", center.id).in("status", ["open", "partially_paid"]).order("id").range(from, to),
  );
  const map = new Map<string, number>();
  for (const p of res.data) map.set(p.household_id, (map.get(p.household_id) ?? 0) + Math.max(0, p.amount_cents - p.paid_cents));
  return { map, error: res.error, truncated: res.truncated };
}

async function rsvpdIn(session: CrmSession, year: number): Promise<{ set: Set<string>; error: DbErrorLike | null }> {
  const { db, center } = session;
  const tz = center.time_zone;
  const events = await fetchAll((from, to) =>
    db
      .from("events")
      .select("id")
      .eq("center_id", center.id)
      .gte("starts_at", startOfDayInTz(`${year}-01-01`, tz))
      .lt("starts_at", startOfDayInTz(`${year + 1}-01-01`, tz))
      .order("id")
      .range(from, to),
  );
  if (events.error) return { set: new Set(), error: events.error };
  const set = new Set<string>();
  for (const part of chunk(events.data.map((e) => e.id))) {
    const r = await fetchAll((from, to) =>
      db.from("rsvps").select("id, household_id").eq("center_id", center.id).in("event_id", part).not("status", "in", NOT_ANSWERED).not("household_id", "is", null).order("id").range(from, to),
    );
    if (r.error) return { set, error: r.error };
    for (const row of r.data) if (row.household_id) set.add(row.household_id);
  }
  return { set, error: null };
}

export async function endingWithin(session: CrmSession, days: number): Promise<{ set: Set<string>; error: DbErrorLike | null }> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const r = await fetchAll((from, to) =>
    db.from("memberships").select("id, household_id").eq("center_id", center.id).eq("status", "active").gte("ends_on", today).lte("ends_on", addDays(today, days)).order("id").range(from, to),
  );
  return { set: new Set(r.data.map((m) => m.household_id)), error: r.error };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The household list
// ---------------------------------------------------------------------------------------------------------------------------------

export type HouseholdListRow = BaseHousehold & {
  openCents: number | null;
  primary: { name: string; memberNumber: string | null } | null;
  orgIds: string[];
  /** undefined: not visible to the role; null: none yet. */
  lastGift: { on: string; cents: number } | null | undefined;
  lastRsvp: { event: string; year: number | null } | null | undefined;
};

export type HouseholdListData = {
  rows: HouseholdListRow[];
  total: number;
  page: number;
  pages: number;
  from: number;
  to: number;
  openTotalCents: number | null;
  canSeeGiving: boolean;
  problems: Problem[];
  notes: string[];
};

type MembershipEmbed = { tier: string; status: string }[];

export async function loadHouseholdList(
  session: CrmSession,
  f: HouseholdFilters,
  opts: { sort: SortKey; page: number; pageSize: number; zones: Zone[] },
): Promise<HouseholdListData> {
  const { db, center } = session;
  const cid = center.id;
  const giving = seesGiving(session);
  const fails: Fail[] = [];
  const notes: string[] = [];

  const [base, search, balances, rsvpd, ending] = await Promise.all([
    fetchAll((from, to) => {
      let q = db
        .from("households")
        .select("id, display_name, household_number, zone_id, city, memberships(tier, status)")
        .eq("center_id", cid)
        .is("merged_into_id", null)
        .eq("memberships.status", "active");
      if (f.zone) q = q.eq("zone_id", f.zone);
      if (f.tier) q = q.eq("memberships.tier", f.tier).not("memberships", "is", null);
      return q.order("display_name").order("id").range(from, to);
    }),
    f.q ? searchHouseholds(db, cid, f.q, { limit: 1000 }) : null,
    giving ? openBalances(session) : null,
    f.noRsvpYear !== null ? rsvpdIn(session, f.noRsvpYear) : null,
    f.endingDays !== null ? endingWithin(session, f.endingDays) : null,
  ]);

  if (base.error) fails.push({ what: "households", error: base.error });
  if (base.truncated) notes.push("This organization has more households than one list can hold; narrow it with a filter to see the rest.");
  if (search?.error) fails.push({ what: "the search results", error: search.error });
  if (balances?.error) fails.push({ what: "open balances", error: balances.error });
  if (rsvpd?.error) fails.push({ what: "the RSVPs for that year", error: rsvpd.error });
  if (ending?.error) fails.push({ what: "the memberships that end soon", error: ending.error });
  if (f.overCents !== null && !giving) notes.push("Open balances need a giving permission, so the balance filter was not used.");

  const all: BaseHousehold[] = base.data.map((h) => ({
    id: h.id,
    name: h.display_name,
    number: h.household_number,
    zoneId: h.zone_id,
    city: h.city,
    tiers: ((h.memberships as unknown as MembershipEmbed | null) ?? []).map((m) => m.tier),
  }));
  const balanceMap = balances && !balances.error ? balances.map : null;
  const sets: FilterSets = {
    searchIds: search ? new Set(search.householdIds) : null,
    balances: balanceMap,
    rsvpd: rsvpd && !rsvpd.error ? rsvpd.set : null,
    ending: ending && !ending.error ? ending.set : null,
  };
  // A failed filter shows no one rather than everyone: the failure is said above the list.
  const failedFilter = (f.q && search?.error) || (f.noRsvpYear !== null && rsvpd?.error) || (f.endingDays !== null && ending?.error) || (f.overCents !== null && giving && balances?.error);
  const zoneName = new Map(opts.zones.map((z) => [z.id, z.name]));
  const filtered = failedFilter ? [] : filterHouseholds(all, f, sets);
  const sorted = sortHouseholds(filtered, opts.sort, { balances: balanceMap, zoneName: (id) => (id ? (zoneName.get(id) ?? null) : null) });
  const slice = pageOf(sorted, opts.page, opts.pageSize);
  const ids = slice.items.map((h) => h.id);

  const [primaries, org, gifts, rsvps] = await Promise.all([
    primaryMembers(session, ids),
    orgIds(db, cid, { householdIds: ids }),
    giving ? lastGifts(session, ids) : null,
    lastRsvps(session, ids),
  ]);
  if (primaries.error) fails.push({ what: "the primary members", error: primaries.error });
  if (org.error) fails.push({ what: "the organization's household IDs", error: org.error });
  if (gifts?.error) fails.push({ what: "the last gifts", error: gifts.error });
  if (rsvps.error) fails.push({ what: "the last RSVPs", error: rsvps.error });

  const rows: HouseholdListRow[] = slice.items.map((h) => ({
    ...h,
    openCents: balanceMap ? (balanceMap.get(h.id) ?? 0) : null,
    primary: primaries.map.get(h.id) ?? null,
    orgIds: org.byHousehold.get(h.id) ?? [],
    lastGift: gifts && !gifts.error ? (gifts.map.get(h.id) ?? null) : undefined,
    lastRsvp: rsvps.error ? undefined : (rsvps.map.get(h.id) ?? null),
  }));

  return {
    rows,
    total: slice.total,
    page: slice.page,
    pages: slice.pages,
    from: slice.from,
    to: slice.to,
    openTotalCents: openTotal(filtered, balanceMap),
    canSeeGiving: giving && !!balanceMap,
    problems: fails.map(problem),
    notes,
  };
}

async function primaryMembers(session: CrmSession, ids: string[]): Promise<{ map: Map<string, { name: string; memberNumber: string | null }>; error: DbErrorLike | null }> {
  const map = new Map<string, { name: string; memberNumber: string | null }>();
  if (ids.length === 0) return { map, error: null };
  const { db } = session;
  const links = await db.from("household_members").select("household_id, person_id").in("household_id", ids).eq("is_primary", true).is("left_at", null);
  if (links.error) return { map, error: links.error };
  const personIds = [...new Set((links.data ?? []).map((l) => l.person_id))];
  if (personIds.length === 0) return { map, error: null };
  const people = await db.from("people").select("id, first_name, last_name, preferred_name, member_number").in("id", personIds);
  if (people.error) return { map, error: people.error };
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));
  for (const l of links.data ?? []) {
    const p = byId.get(l.person_id);
    if (p && !map.has(l.household_id)) map.set(l.household_id, { name: personName(p), memberNumber: p.member_number });
  }
  return { map, error: null };
}

async function lastGifts(session: CrmSession, ids: string[]): Promise<{ map: Map<string, { on: string; cents: number }>; error: DbErrorLike | null }> {
  const { db, center } = session;
  const map = new Map<string, { on: string; cents: number }>();
  const results = await Promise.all(
    ids.map((id) =>
      db
        .from("payments")
        .select("household_id, amount_cents, refunded_cents, received_on")
        .eq("center_id", center.id)
        .eq("household_id", id)
        .in("status", [...GIFT_STATUSES])
        .eq("is_opening_balance", false)
        .order("received_on", { ascending: false })
        .limit(1),
    ),
  );
  for (const r of results) {
    if (r.error) return { map, error: r.error };
    const p = r.data?.[0];
    if (p) map.set(p.household_id, { on: p.received_on, cents: p.amount_cents - (p.refunded_cents ?? 0) });
  }
  return { map, error: null };
}

async function lastRsvps(session: CrmSession, ids: string[]): Promise<{ map: Map<string, { event: string; year: number | null }>; error: DbErrorLike | null }> {
  const { db, center } = session;
  const map = new Map<string, { event: string; year: number | null }>();
  if (ids.length === 0) return { map, error: null };
  const results = await Promise.all(
    ids.map((id) =>
      db.from("rsvps").select("household_id, event_id, created_at").eq("center_id", center.id).eq("household_id", id).not("status", "in", NOT_ANSWERED).order("created_at", { ascending: false }).limit(1),
    ),
  );
  const latest: { household_id: string; event_id: string }[] = [];
  for (const r of results) {
    if (r.error) return { map, error: r.error };
    const row = r.data?.[0];
    if (row?.household_id) latest.push({ household_id: row.household_id, event_id: row.event_id });
  }
  if (latest.length === 0) return { map, error: null };
  const events = await db.from("events").select("id, name, starts_at").in("id", [...new Set(latest.map((l) => l.event_id))]);
  if (events.error) return { map, error: events.error };
  const byId = new Map((events.data ?? []).map((e) => [e.id, e]));
  for (const l of latest) {
    const e = byId.get(l.event_id);
    if (e) map.set(l.household_id, { event: e.name, year: e.starts_at ? Number(e.starts_at.slice(0, 4)) : null });
  }
  return { map, error: null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The counts on the quick chips
// ---------------------------------------------------------------------------------------------------------------------------------

export type QuickCounts = { duplicates: number | null; ending: number | null; waiting: number | null; problems: Problem[] };

export async function loadQuickCounts(session: CrmSession): Promise<QuickCounts> {
  const { db, center } = session;
  const seeApps = canAccess(session, "applications");
  const seeRequests = canAccess(session, "householdRequests");
  const [dups, ending, apps, reqs] = await Promise.all([
    db.from("merge_candidates").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "open"),
    endingWithin(session, ENDING_SOON_DAYS),
    seeApps ? db.from("membership_applications").select("id", { count: "exact", head: true }).eq("center_id", center.id).in("status", ["awaiting_center", "awaiting_ec"]) : null,
    seeRequests ? db.from("household_change_requests").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "open") : null,
  ]);
  const fails: Fail[] = [];
  if (dups.error) fails.push({ what: "the count of possible duplicates", error: dups.error });
  if (ending.error) fails.push({ what: "the count of memberships ending soon", error: ending.error });
  if (apps?.error) fails.push({ what: "the count of applications", error: apps.error });
  if (reqs?.error) fails.push({ what: "the count of family requests", error: reqs.error });
  const waiting = !seeApps && !seeRequests ? null : apps?.error || reqs?.error ? null : (apps?.count ?? 0) + (reqs?.count ?? 0);
  return { duplicates: dups.error ? null : (dups.count ?? 0), ending: ending.error ? null : ending.set.size, waiting, problems: fails.map(problem) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The household card (side panel)
// ---------------------------------------------------------------------------------------------------------------------------------

function shortDate(iso: string, tz: string, locale: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(locale, { timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? "UTC" : tz, month: "short", day: "numeric", year: "numeric" }).format(d);
}

/** "Neon 4374", "QuickBooks 1187", "Bank payer ANA LOPEZ": the system's own name when there is one, else the kind of identifier. */
export function otherIdLabel(row: { kind: string; system: string | null; label: string | null; value: string }, rules: { orgMemberLabel: string; orgHouseholdLabel: string }): string {
  if (row.label?.trim()) return `${row.label.trim()} ${row.value}`;
  if (row.kind === "bank_payer") return `Bank payer ${row.value}`;
  const sys = (row.system ?? "").trim();
  const known: Record<string, string> = { qbo: "QuickBooks", quickbooks: "QuickBooks", neon: "Neon", namo: "NamoCRM", namocrm: "NamoCRM" };
  if (sys && !["connect", "manual", "import", "portal"].includes(sys.toLowerCase())) return `${known[sys.toLowerCase()] ?? sys.charAt(0).toUpperCase() + sys.slice(1)} ${row.value}`;
  return `${identifierKindLabel(row.kind, rules)} ${row.value}`;
}

export type PanelLinks = { compare: (otherId: string) => string; recordPayment: string; fullPage: string; requests: string; applications: string };

/** Everything the household card shows, already worded. `error` when the household itself cannot be read. */
export async function loadHouseholdPanel(session: CrmSession, id: string, links: PanelLinks): Promise<{ card: HouseholdPanel | null; error: string | null }> {
  const { db, center } = session;
  const fmt = communityFormat(center);
  const tz = center.time_zone;
  const rules = identifierRules(center.rules);
  const today = todayInTz(tz);
  const majority = communityMajority(center);
  const { record: h, error } = await loadHouseholdRecord(session, id);
  if (error) return { card: null, error: explainError(error) };
  if (!h) return { card: null, error: "This household was not found. It may have been merged into another one, or your role cannot see it." };

  const fails: Fail[] = [];
  const members = h.members.ok ? h.members.data : [];
  if (!h.members.ok) fails.push({ what: "the members", error: h.members.error });
  const isAdult = (m: (typeof members)[number]) => isAdultMember({ date_of_birth: m.dateOfBirth, role: m.isPrimary ? "primary" : m.role }, today, majority);
  const adults = members.filter(isAdult);
  const children = members.filter((m) => !isAdult(m));
  const giving = seesGiving(session);
  const otherIds = h.duplicates?.ok ? h.duplicates.data.map((d) => d.otherId) : [];

  const [contacts, memberships, gift, ids, reqs, apps, others] = await Promise.all([
    adults.length ? db.from("people").select("id, email, phone_e164").in("id", adults.map((a) => a.personId)) : null,
    db.from("memberships").select("tier, status, starts_on, ends_on").eq("household_id", id).order("starts_on", { ascending: false }).limit(5),
    giving
      ? db.from("payments").select("amount_cents, refunded_cents, received_on").eq("household_id", id).in("status", [...GIFT_STATUSES]).eq("is_opening_balance", false).order("received_on", { ascending: false }).limit(1)
      : null,
    db
      .from("external_ids")
      .select("person_id, household_id, kind, system, label, value")
      .eq("center_id", center.id)
      .is("valid_to", null)
      .or([`household_id.eq.${id}`, ...adults.map((a) => `person_id.eq.${a.personId}`)].join(",")),
    canAccess(session, "householdRequests") ? db.from("household_change_requests").select("id, kind, created_at").eq("household_id", id).eq("status", "open").order("created_at") : null,
    canAccess(session, "applications") ? db.from("membership_applications").select("id, tier, status, created_at").eq("household_id", id).in("status", ["awaiting_center", "awaiting_ec"]) : null,
    otherIds.length ? householdCards(db, otherIds.slice(0, 1)) : null,
  ]);
  if (contacts?.error) fails.push({ what: "the adults' contact details", error: contacts.error });
  if (ids.error) fails.push({ what: "the other IDs", error: ids.error });
  if (others?.error) fails.push({ what: "the matched household", error: others.error });

  const contactOf = new Map((contacts?.data ?? []).map((p) => [p.id, p]));
  const primary = members.find((m) => m.isPrimary) ?? adults[0] ?? null;
  const area = h.zoneName ?? h.address.city ?? "Not recorded";
  const openText = !giving ? null : h.giving?.ok ? moneyIn(h.giving.data.openCents, fmt) : null;
  const giftRow = gift?.data?.[0];
  const lastGiftText = !giving ? null : gift?.error ? "Could not load" : giftRow ? `${shortDate(giftRow.received_on, tz, fmt.locale)} · ${moneyIn(giftRow.amount_cents - (giftRow.refunded_cents ?? 0), fmt)}` : "None yet";
  const otherIdText = (ids.data ?? [])
    .filter((r) => r.kind !== "org_household" || r.household_id !== id)
    .filter((r) => r.kind !== "org_member")
    .map((r) => otherIdLabel(r, rules));
  const orgHousehold = h.orgIds;
  const idsLine = [h.number ? `Household ${h.number}` : "No household number yet", ...orgHousehold].join(" · ");

  const facts: CardFact[] = [
    { label: "Primary member", value: primary ? `${primary.name}${primary.memberNumber ? ` (member ${primary.memberNumber})` : ""}` : "None recorded", tone: "strong" },
    {
      label: "Members",
      value: members.length ? members.map((m) => `${m.name.split(" ")[0]}${isAdult(m) ? "" : " (child)"}`).join(", ") : h.members.ok ? "No current members" : "Could not load",
    },
    { label: "Area", value: area },
    { label: "Last gift", value: lastGiftText ?? "Needs a giving permission" },
    { label: "Open balance", value: openText ?? (giving ? "Could not load" : "Needs a giving permission"), tone: openText ? "money" : undefined },
    { label: "Other IDs", value: otherIdText.length ? otherIdText.join(" · ") : ids.error ? "Could not load" : "None on file", tone: "mono" },
  ];

  const other = others?.map.get(otherIds[0] ?? "");
  const dupe = h.duplicates?.ok ? h.duplicates.data[0] : undefined;
  const noticed =
    dupe && other
      ? {
          name: other.household_name ?? dupe.otherName,
          ids: [other.household_number, other.org_household_id].filter(Boolean).join(" · "),
          place: other.city ?? other.zone ?? null,
          compareHref: links.compare(dupe.otherId),
          candidateId: dupe.candidateId,
        }
      : dupe
        ? { name: dupe.otherName, ids: "", place: null, compareHref: links.compare(dupe.otherId), candidateId: dupe.candidateId }
        : null;

  const membership: HouseholdPanel["membership"] = memberships.error
    ? { state: "error", message: explainError(memberships.error) }
    : {
        state: "ok",
        data: (memberships.data ?? []).map((m) => ({
          label: `${tierLabel(m.tier)} · ${m.status === "active" ? "Active" : m.status.charAt(0).toUpperCase() + m.status.slice(1)}`,
          detail: [`since ${shortDate(m.starts_on, tz, fmt.locale)}`, m.ends_on ? `ends ${shortDate(m.ends_on, tz, fmt.locale)}` : "no end date"].join(" · "),
        })),
      };

  const givingSection: HouseholdPanel["giving"] = !giving
    ? { state: "hidden", reason: "Giving needs a giving permission." }
    : !h.giving || !h.giving.ok
      ? { state: "error", message: explainError(h.giving && !h.giving.ok ? h.giving.error : "not loaded") }
      : {
          state: "ok",
          data: {
            open: moneyIn(h.giving.data.openCents, fmt),
            lastGift: lastGiftText ?? "None yet",
            pledges: h.giving.data.pledges.slice(0, 6).map((p) => ({ label: `${p.label} · ${shortDate(p.date, tz, fmt.locale)}`, progress: `${moneyIn(p.paid, fmt)} of ${moneyIn(p.amount, fmt)}`, closed: p.closed })),
          },
        };

  const requests: HouseholdPanel["requests"] =
    reqs === null && apps === null
      ? { state: "hidden", reason: "Requests need a people permission." }
      : reqs?.error || apps?.error
        ? { state: "error", message: explainError(reqs?.error ?? apps?.error) }
        : {
            state: "ok",
            data: [
              ...(apps?.data ?? []).map((a) => ({ what: `Membership application · ${tierLabel(a.tier)} · ${a.status === "awaiting_ec" ? "waiting for the committee" : "waiting for review"}`, when: shortDate(a.created_at, tz, fmt.locale), href: links.applications })),
              ...(reqs?.data ?? []).map((r) => ({ what: `Family change request · ${REQUEST_KIND[r.kind] ?? r.kind}`, when: shortDate(r.created_at, tz, fmt.locale), href: links.requests })),
            ],
          };

  const activity: HouseholdPanel["activity"] =
    h.activity === null
      ? { state: "hidden", reason: "Recent activity needs the audit permission." }
      : !h.activity.ok
        ? { state: "error", message: explainError(h.activity.error) }
        : { state: "ok", data: h.activity.data.slice(0, 6).map((a) => ({ when: shortDate(a.at, tz, fmt.locale), what: a.what, detail: a.detail })) };

  // D2: the sentence names the household by its numbers and its ADULTS only, never its display name (it can carry a child's name).
  const adultNames = adults.map((a) => a.name);
  const numbers = [h.number ? `household ${h.number}` : "this household", orgHousehold[0] ? `${rules.orgHouseholdLabel} ${orgHousehold[0]}` : null].filter(Boolean).join(", ");
  const nivaPrompt = `Show everything we have on ${numbers}${adultNames.length ? ` (adults: ${adultNames.join(", ")})` : ""}, including its IDs, membership, giving and anything open.`;

  return {
    error: null,
    card: {
      id: h.id,
      name: h.name,
      ids: idsLine,
      facts,
      recordPaymentHref: canAccess(session, "recordPayment") && !h.mergedIntoId ? links.recordPayment : null,
      fullPageHref: links.fullPage,
      noticed,
      adults: adults.map((a) => {
        const c = contactOf.get(a.personId);
        return {
          name: a.name,
          role: relationshipLabel(a.isPrimary ? "primary" : a.role, a.gender),
          contact: [c?.phone_e164 ? formatPhone(c.phone_e164) : null, c?.email ?? null].filter(Boolean).join(" · ") || "No phone or email on file",
          onApp: a.onApp,
        };
      }),
      children: children.map((c) => ({ name: c.name, age: c.age === null ? "Age not recorded" : `Age ${c.age}` })),
      membership,
      giving: givingSection,
      requests,
      activity,
      nivaPrompt,
      problems: fails.map(problem),
    },
  };
}

const REQUEST_KIND: Record<string, string> = {
  add_member: "add a family member",
  change_relationship: "change a relationship",
  remove_member: "remove a family member",
  new_household: "move to a new household",
};

export type { Section };

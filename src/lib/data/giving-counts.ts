import "server-only";

// Giving › the counts tab (docs/GIVING_REDESIGN.md slice 5, B93): what the tab, the Start a count sheet and the Match its deposit
// sheet read. Row-level security decides what each person sees; the pure core (src/lib/giving-counts) turns it into rows.
// countsForBankLines() is for the Bank tab's Deposits view: a deposit line a count was matched to shows that count, read-only.

import { identifierRules } from "@/lib/center-rules";
import { communityFormat } from "@/lib/community-format";
import { householdCards, personName, userNames } from "@/lib/data/lookups";
import { addDays, formatDate, todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { isChildRecord } from "@/lib/find/child";
import { denominationsFor } from "@/lib/giving-counts/denominations";
import {
  countChips,
  countRow,
  countsSummary,
  countViewFromParam,
  depositChoices,
  depositWindow,
  lastCounters,
  linkedCountLabel,
  noDepositText,
  preselectDeposit,
  type CountCan,
  type CounterChoice,
  type CountIn,
  type CountsModel,
  type CountView,
  type DepositChoice,
  type LinkedCount,
  type LinkedLine,
} from "@/lib/giving-counts/model";
import { PAGE_SIZE, pager, switchedOff } from "@/lib/giving-lists/model";
import { familyFrom, type Family } from "@/lib/giving-today/queue";
import { GIVING_ADDONS, givingTabs } from "@/lib/giving-today/tabs";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";
import { countsWord } from "@/lib/wording";
import { workspaceLabel } from "@/lib/workspaces";

const PATH = "/giving/counts";
const COUNT_COLUMNS = "id, counted_on, counters, total_cents, bag_numbers, deposit_ref, payment_id, bank_transaction_id, event_id";

export function countCan(session: CrmSession): CountCan {
  const bankOn = isModuleEnabled(session, GIVING_ADDONS.bank);
  return {
    record: canAccess(session, "countingRecord"),
    match: bankOn && canAccess(session, "bankConfirm"),
    unmatch: bankOn && canAccess(session, "givingManage"),
  };
}

function format(session: CrmSession) {
  const { center } = session;
  const fmt = communityFormat(center);
  return { currency: fmt.currency, locale: fmt.locale, timeZone: center.time_zone, today: todayInTz(center.time_zone) };
}

/** "Operating ••1530": the account a line came in on. */
function accountName(a: { name: string; last4: string | null } | undefined): string | null {
  if (!a) return null;
  return a.last4 ? `${a.name} ••${a.last4}` : a.name;
}

async function accountsById(session: CrmSession, ids: string[]): Promise<Map<string, { name: string; last4: string | null }>> {
  const map = new Map<string, { name: string; last4: string | null }>();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return map;
  const res = await session.db.from("bank_accounts").select("id, name, last4").in("id", wanted);
  if (res.error) console.error("[giving-counts] bank account names could not be read; lines show without them:", res.error);
  for (const a of res.data ?? []) map.set(a.id, { name: a.name, last4: a.last4 });
  return map;
}

// ---------------------------------------------------------------------------- The tab

type RawCount = {
  id: string;
  counted_on: string;
  counters: string[];
  total_cents: number;
  bag_numbers: string[];
  deposit_ref: string | null;
  payment_id: string | null;
  bank_transaction_id: string | null;
  event_id: string | null;
};

export async function loadCountsTab(session: CrmSession, sp: RawSearchParams): Promise<CountsModel> {
  const { db, center } = session;
  const f = format(session);
  const rules = identifierRules(center.rules);
  const word = countsWord(session.kind);
  const can = countCan(session);
  const bankOn = isModuleEnabled(session, GIVING_ADDONS.bank);
  const view = countViewFromParam(param(sp, "view"));
  const page = pageParam(sp);
  const retry = hrefWith(PATH, sp, {});
  const shell: CountsModel = {
    title: workspaceLabel("giving", session.kind),
    tabs: givingTabs(session),
    ...f,
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    q: "",
    searchLabel: "",
    searchBase: PATH,
    pager: null,
    expandSingle: false,
    problems: [],
    note: null,
    recordHref: null,
    body: { state: "ok", rows: [], empty: "" },
    view,
    chips: [],
    can,
    bankOn,
    countsWord: word,
    summary: null,
  };
  if (!isModuleEnabled(session, GIVING_ADDONS.counts)) return { ...shell, can: { record: false, match: false, unmatch: false }, body: switchedOff(session.kind, "giving_counts", center.short_name || center.name) };
  if (!canAccess(session, "counting")) return { ...shell, can: { record: false, match: false, unmatch: false }, body: { state: "no_access", area: word, access: "counting" } };

  const from = (page - 1) * PAGE_SIZE;
  // Waiting: no slip reference, no payment, no bank line (isDeposited in the pure core says the same).
  let list = db.from("counting_sessions").select(COUNT_COLUMNS, { count: "exact" }).eq("center_id", center.id);
  if (view === "waiting") list = list.is("deposit_ref", null).is("payment_id", null).is("bank_transaction_id", null);
  if (view === "deposited") list = list.or("deposit_ref.not.is.null,payment_id.not.is.null,bank_transaction_id.not.is.null");
  const [res, all, waiting] = await Promise.all([
    list.order("counted_on", { ascending: false }).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    db.from("counting_sessions").select("id", { count: "exact", head: true }).eq("center_id", center.id),
    db
      .from("counting_sessions")
      .select("total_cents")
      .eq("center_id", center.id)
      .is("deposit_ref", null)
      .is("payment_id", null)
      .is("bank_transaction_id", null)
      .limit(1000),
  ]);
  if (res.error) return { ...shell, body: { state: "error", error: failure(`Could not read the ${word.toLowerCase()}`, res.error).error, retry } };
  const problems: string[] = [];
  if (all.error || waiting.error) console.error("[giving-counts] the chip numbers could not be read:", all.error ?? waiting.error);
  const waitingRows = waiting.error ? null : (waiting.data ?? []);
  const waitingCount = waitingRows ? waitingRows.length : null;
  const waitingCents = waitingRows ? waitingRows.reduce((a, r) => a + r.total_cents, 0) : null;
  const chips = countChips(
    view,
    { all: all.error ? null : (all.count ?? null), waiting: waitingCount, deposited: all.error || waitingCount === null ? null : Math.max(0, (all.count ?? 0) - waitingCount) },
    (v: CountView) => hrefWith(PATH, {}, { view: v === "all" ? undefined : v }),
  );

  const rows = (res.data ?? []) as RawCount[];
  const lineIds = rows.flatMap((r) => (r.bank_transaction_id ? [r.bank_transaction_id] : []));
  const eventIds = [...new Set(rows.flatMap((r) => (r.event_id ? [r.event_id] : [])))];
  const [names, lines, events] = await Promise.all([
    userNames(db, center.id, rows.flatMap((r) => r.counters)),
    lineIds.length > 0 && bankOn && canAccess(session, "bank")
      ? db.from("bank_transactions").select("id, posted_on, amount_cents, bank_account_id").in("id", lineIds)
      : Promise.resolve(null),
    eventIds.length > 0 ? db.from("events").select("id, name").in("id", eventIds) : Promise.resolve(null),
  ]);
  if (lines?.error) problems.push(failure("Could not read the bank deposits the counts were matched to; those rows say only that they are matched", lines.error).error);
  if (events?.error) console.error("[giving-counts] event names could not be read; rows show without them:", events.error);
  const accounts = await accountsById(session, (lines?.data ?? []).map((l) => l.bank_account_id));
  const lineBy = new Map<string, LinkedLine>(
    (lines?.data ?? []).map((l) => [l.id, { id: l.id, postedOn: l.posted_on, amountCents: l.amount_cents, account: accountName(accounts.get(l.bank_account_id)) }]),
  );
  const eventBy = new Map((events?.data ?? []).map((e) => [e.id, e.name]));
  const ctx = { ...f, can, bankOn };
  const counts: CountIn[] = rows.map((r) => ({
    id: r.id,
    countedOn: r.counted_on,
    totalCents: r.total_cents,
    bags: r.bag_numbers,
    counters: r.counters.map((u) => names.get(u)?.name ?? "a counter"),
    event: r.event_id ? (eventBy.get(r.event_id) ?? null) : null,
    depositRef: r.deposit_ref,
    paymentId: r.payment_id,
    matched: r.bank_transaction_id !== null,
    line: r.bank_transaction_id ? (lineBy.get(r.bank_transaction_id) ?? null) : null,
  }));
  return {
    ...shell,
    chips,
    problems,
    summary: countsSummary(waitingCount, waitingCents, f),
    note: !can.record ? "You can see the counts. Counting and recording deposits are for a counter with giving.record_offline." : null,
    body: {
      state: "ok",
      rows: counts.map((c) => countRow(c, ctx)),
      empty: view === "waiting" ? "No count is waiting for its deposit." : view === "deposited" ? "No count is deposited yet." : "No counts yet. Start one when the box is opened.",
    },
    pager: pager(page, res.count ?? rows.length, (n) => hrefWith(PATH, sp, { page: n })),
  };
}

// ---------------------------------------------------------------------------- Start a count

/** Adults with a login in the community, each with their household card (never a child: section 7). */
export async function counterChoices(session: CrmSession): Promise<{ options: CounterChoice[]; error: string | null }> {
  const { db, center } = session;
  const today = todayInTz(center.time_zone);
  const cu = await db.from("center_users").select("user_id, person_id").eq("center_id", center.id).not("person_id", "is", null).limit(1000);
  if (cu.error) return { options: [], error: failure("Could not list the people who can count", cu.error).error };
  const personIds = (cu.data ?? []).map((x) => x.person_id).filter((x): x is string => !!x);
  if (personIds.length === 0) return { options: [], error: null };
  const [pp, hm] = await Promise.all([
    db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth").in("id", personIds),
    db.from("household_members").select("person_id, household_id, is_primary, role").in("person_id", personIds).is("left_at", null),
  ]);
  if (pp.error || hm.error) return { options: [], error: failure("Could not list the people who can count", pp.error ?? hm.error).error };
  const memberOf = new Map<string, { household_id: string; role: string }>();
  for (const m of [...(hm.data ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
    if (!memberOf.has(m.person_id)) memberOf.set(m.person_id, { household_id: m.household_id, role: m.role });
  }
  const cards = await householdCards(db, [...memberOf.values()].map((m) => m.household_id));
  const families = new Map<string, Family>();
  for (const [id, c] of cards.map) families.set(id, familyFrom(c));
  const personBy = new Map((pp.data ?? []).map((x) => [x.id, x]));
  const options = (cu.data ?? [])
    .flatMap((x) => {
      const person = x.person_id ? personBy.get(x.person_id) : undefined;
      if (!person) return [];
      const m = memberOf.get(person.id);
      if (isChildRecord(person.date_of_birth, m?.role ?? null, today)) return [];
      const householdId = m?.household_id ?? null;
      return [{ userId: x.user_id, name: personName(person), householdId, family: householdId ? (families.get(householdId) ?? null) : null }];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    options,
    error: cards.error ? failure("Could not read some counters' households; those show without their card", cards.error).error : null,
  };
}

export type CountSheetData = {
  counters: CounterChoice[];
  /** The last count's counters who can still count, filled in. */
  last: string[];
  events: { id: string; label: string }[];
  /** The community's notes and coins (minor units), or null: the total only. */
  denominations: number[] | null;
  currency: string;
  locale: string;
  today: string;
  countsWord: string;
  /** A part that could not be read (the sheet still works without it). */
  problem: string | null;
};

export async function loadCountSheet(session: CrmSession): Promise<{ ok: true; data: CountSheetData } | { ok: false; error: string }> {
  const { db, center } = session;
  const f = format(session);
  const [counters, last, events] = await Promise.all([
    counterChoices(session),
    db.from("counting_sessions").select("counters").eq("center_id", center.id).order("counted_on", { ascending: false }).order("created_at", { ascending: false }).limit(1),
    db
      .from("events")
      .select("id, name, starts_at")
      .eq("center_id", center.id)
      .gte("starts_at", addDays(f.today, -7))
      .lte("starts_at", addDays(f.today, 2))
      .order("starts_at", { ascending: false })
      .limit(20),
  ]);
  if (counters.error && counters.options.length === 0) return { ok: false, error: counters.error };
  if (last.error) console.error("[giving-counts] the last count's counters could not be read; the sheet starts empty:", last.error);
  if (events.error) console.error("[giving-counts] recent events could not be read; the sheet offers none:", events.error);
  return {
    ok: true,
    data: {
      counters: counters.options,
      last: lastCounters(last.data?.[0]?.counters ?? null, counters.options),
      events: (events.data ?? []).map((e) => ({ id: e.id, label: `${e.name} · ${formatDate(e.starts_at, f.timeZone)}` })),
      denominations: denominationsFor(f.currency) ? [...(denominationsFor(f.currency) ?? [])] : null,
      currency: f.currency,
      locale: f.locale,
      today: f.today,
      countsWord: countsWord(session.kind),
      problem: counters.error,
    },
  };
}

// ---------------------------------------------------------------------------- Match its deposit

export type DepositChoices = {
  count: { id: string; countedOn: string; totalCents: number; bags: string[] };
  choices: DepositChoice[];
  preselect: string | null;
  /** Said when no line fits. */
  none: string;
  currency: string;
  locale: string;
  timeZone: string;
};

export async function loadDepositChoices(session: CrmSession, countId: string): Promise<{ ok: true; data: DepositChoices } | { ok: false; error: string }> {
  const { db, center } = session;
  const f = format(session);
  const c = await db.from("counting_sessions").select("id, counted_on, total_cents, bag_numbers, bank_transaction_id").eq("id", countId).eq("center_id", center.id).maybeSingle();
  if (c.error) return failure("Could not read the count", c.error);
  if (!c.data) return { ok: false, error: "Could not read the count — it was not found, or you can't see it." };
  if (c.data.bank_transaction_id) return { ok: false, error: "This count is already matched to a bank deposit. Reload the page to see it." };
  const count = { id: c.data.id, countedOn: c.data.counted_on, totalCents: c.data.total_cents, bags: c.data.bag_numbers };
  const base = { count, currency: f.currency, locale: f.locale, timeZone: f.timeZone, none: noDepositText(count, f) };
  if (count.totalCents <= 0) return { ok: false, error: "Record the counted total before matching the deposit (Mark deposited takes the total)." };
  const w = depositWindow(count.countedOn);
  const lines = await db
    .from("bank_transactions")
    .select("id, posted_on, amount_cents, description, bank_account_id, status")
    .eq("center_id", center.id)
    .eq("amount_cents", count.totalCents)
    .in("status", ["unmatched", "suggested"])
    .gte("posted_on", w.from)
    .lte("posted_on", w.to)
    .order("posted_on", { ascending: true })
    .limit(50);
  if (lines.error) return failure("Could not read the bank deposits", lines.error);
  const ids = (lines.data ?? []).map((l) => l.id);
  const [taken, accounts] = await Promise.all([
    ids.length > 0 ? db.from("counting_sessions").select("bank_transaction_id").in("bank_transaction_id", ids) : Promise.resolve(null),
    accountsById(session, (lines.data ?? []).map((l) => l.bank_account_id)),
  ]);
  if (taken?.error) return failure("Could not check which deposits are already matched", taken.error);
  const takenIds = new Set((taken?.data ?? []).map((t) => t.bank_transaction_id));
  const choices = depositChoices(
    count,
    (lines.data ?? []).map((l) => ({
      id: l.id,
      postedOn: l.posted_on,
      amountCents: l.amount_cents,
      description: l.description,
      account: accountName(accounts.get(l.bank_account_id)),
      status: l.status,
      taken: takenIds.has(l.id),
    })),
    f,
  );
  return { ok: true, data: { ...base, choices, preselect: preselectDeposit(choices) } };
}

// ---------------------------------------------------------------------------- For the Bank tab

/**
 * The counts matched to these bank lines, for the Bank tab's Deposits view to show read-only ("Count of Oct 5, 2026 · bags 118,
 * 119"). Empty when Offering counts is off or the person cannot read counts; an error is said once, the lines still show.
 */
export async function countsForBankLines(session: CrmSession, lineIds: readonly string[]): Promise<{ map: Map<string, LinkedCount>; error: string | null }> {
  const map = new Map<string, LinkedCount>();
  const ids = [...new Set(lineIds)];
  if (ids.length === 0 || !isModuleEnabled(session, GIVING_ADDONS.counts) || !canAccess(session, "counting")) return { map, error: null };
  const res = await session.db
    .from("counting_sessions")
    .select("id, counted_on, total_cents, bag_numbers, bank_transaction_id")
    .eq("center_id", session.center.id)
    .in("bank_transaction_id", ids);
  if (res.error) return { map, error: failure("Could not read the counts matched to these deposits", res.error).error };
  const f = format(session);
  for (const r of res.data ?? []) {
    if (!r.bank_transaction_id) continue;
    const c = { id: r.id, countedOn: r.counted_on, totalCents: r.total_cents, bags: r.bag_numbers };
    map.set(r.bank_transaction_id, { ...c, label: linkedCountLabel(c, f) });
  }
  return { map, error: null };
}

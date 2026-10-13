import "server-only";

// Giving › Today (New look): what is waiting, read through what already exists. The approvals and the bank counts are Home's
// own task list (loadHomeTasks, cached per request), so Home's "My tasks" and Today can never disagree; the rest comes from the
// readers the Bank, Payments and Accounting screens use and from the existing read commands (giving.pledges_behind,
// accounting.month_close_blockers). Each part loads on its own: one that fails says so next to its group, one the person may not
// see is left out, and the rest of the page still works. Nothing here writes.

import type { CardLabels } from "@/components/household-card";
import { identifierRules } from "@/lib/center-rules";
import type { PledgesBehindData } from "@/lib/commands/catalog/pledges-behind";
import type { CloseBlockersData } from "@/lib/commands/catalog/month-close-blockers";
import { runScreenCommand } from "@/lib/commands/screen";
import { communityFormat } from "@/lib/community-format";
import { readPaypalEmailOnly } from "@/lib/data/giving-lists";
import { canFindGiving } from "@/lib/giving-actions/context";
import { loadPledgeTotals } from "@/lib/data/giving-workspace";
import { loadHomeTasks } from "@/lib/data/home-tasks";
import { householdCards, userNames } from "@/lib/data/lookups";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { addDays, todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { CLOSE_ITEMS, firstOfMonth, longMonth } from "@/lib/giving";
import { GIVING_ADDONS, givingTabs, type GivingTab, type GivingTabKey } from "@/lib/giving-today/tabs";
import {
  bankTotalsFromTasks,
  buildQueue,
  familyFrom,
  type ApplyIn,
  type ApplyListIn,
  type BankIn,
  type BankTotals,
  type BehindIn,
  type CloseIn,
  type CountIn,
  type DepositLineIn,
  type ExactPairIn,
  type Family,
  type GiftLineIn,
  type GroupKey,
  type TodayCan,
  type TodayQueue,
} from "@/lib/giving-today/queue";
import type { Part, PledgeTotals } from "@/lib/giving-workspace/view";
import { pluginName } from "@/lib/kind-samples";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { isModuleEnabled } from "@/lib/modules";
import { enabledPaymentPlugins } from "@/lib/payments/plugins/enabled";
import { parseReportQueue, queueSections } from "@/lib/payments/zelle";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { GIVING_TASK_SOURCES } from "@/lib/tasks";
import { countsWord as countsWordFor } from "@/lib/wording";
import { workspaceLabel } from "@/lib/workspaces";

/** Bank lines listed in the queue (the oldest first); the rest are one "more" row. */
const GIFT_ROWS = 5;
const DEPOSIT_ROWS = 3;
const APPLY_ROWS = 5;
/** A payment recorded in the last 30 days whose family has an open pledge, not yet applied (older ones stay on Payments). */
const APPLY_WINDOW_DAYS = 30;
const COUNTED_STATUSES = ["captured", "pending_clearing", "settled", "partially_refunded"] as const;

export type MonthNumbers = {
  /** "October 2026". */
  label: string;
  recorded: Part<{ cents: number; onlyMine: boolean; truncated: boolean }>;
  open: Part<PledgeTotals>;
  matched: Part<{ matched: number; total: number }>;
};

export type GivingTodayModel = {
  title: string;
  communityName: string;
  today: string;
  timeZone: string;
  currency: string;
  locale: string;
  labels: CardLabels;
  tabs: GivingTab[];
  tabCounts: Partial<Record<GivingTabKey, number>>;
  queue: TodayQueue;
  /** `find`: the large box on Today can look things up for this person (People, or the Giving lane). */
  can: TodayCan & { record: boolean; find: boolean };
  /** The kind's word for the counts tile and tab. */
  countsWord: string;
  /** A note for a limited role (a finance volunteer, a second approver only), or null. */
  roleNote: string | null;
  month: MonthNumbers;
  recent: Part<Family[]>;
  initialTile: GroupKey | "all";
};

function ok<T>(data: T): Part<T> {
  return { state: "ok", data };
}

function err<T>(doing: string, error: unknown): Part<T> {
  return { state: "error", error: failure(doing, error).error };
}

// ---------------------------------------------------------------------------- Bank

async function countBank(session: CrmSession): Promise<BankTotals | { error: unknown }> {
  const { db, center } = session;
  const base = () =>
    db.from("bank_transactions").select("id", { count: "exact", head: true }).eq("center_id", center.id).in("status", ["unmatched", "suggested"]).gt("amount_cents", 0);
  const [lines, deposits, zelle] = await Promise.all([base(), base().eq("is_batch_deposit", true), db.rpc("payment_report_counts", { p_center: center.id })]);
  if (lines.error) return { error: lines.error };
  if (deposits.error) return { error: deposits.error };
  // Same as Home: a community without Zelle reports has none unseen.
  const c = (zelle.error ? null : zelle.data) as { unmatched?: unknown } | null;
  return { lines: lines.count ?? 0, deposits: deposits.count ?? 0, zelleUnseen: Number(c?.unmatched) || 0 };
}

/** The Zelle reports that match a bank line exactly (Today's row and the Bank tab's Zelle and To match views). */
export async function loadExact(session: CrmSession): Promise<{ pairs: ExactPairIn[] } | { error: string }> {
  const r = await session.db.rpc("payment_report_queue", { p_center: session.center.id });
  if (r.error) return { error: failure("Could not read the Zelle reports", r.error).error };
  const q = parseReportQueue(r.data);
  if (!q) {
    console.error("[giving-today] payment_report_queue returned an unexpected shape:", r.data);
    return { error: "Could not read the Zelle reports — the database answered in a shape this screen does not understand." };
  }
  return {
    pairs: queueSections(q).exact.map((p) => ({
      reportId: p.report_id,
      bankTransactionId: p.bank_transaction_id,
      amountCents: p.amount_cents,
      sentOn: p.sent_on,
      postedOn: p.posted_on,
      confirmation: p.confirmation,
      payerName: p.payer_name,
      family: p.household ? familyFrom(p.household) : null,
    })),
  };
}

type GiftLineRow = { id: string; posted_on: string; amount_cents: number; description: string; payer_name: string | null; originator_kind: string | null };
type DepositLineRow = { id: string; posted_on: string; amount_cents: number; description: string };

/** Gift lines with their suggested families (app.suggest_bank_matches), read the same way for Today and the Bank tab. */
export async function giftLinesIn(session: CrmSession, giftLines: readonly GiftLineRow[]): Promise<GiftLineIn[]> {
  const { db } = session;
  return Promise.all(
    giftLines.map(async (l) => {
      const r = await db.rpc("suggest_bank_matches", { p_txn: l.id });
      return {
        id: l.id,
        postedOn: l.posted_on,
        amountCents: l.amount_cents,
        description: l.description,
        payerName: l.payer_name,
        originatorKind: l.originator_kind,
        suggestions: (r.data ?? []).map((s) => ({
          family: familyFrom({ ...s, primary_member: s.primary_member ?? null }),
          reason: s.reason ?? "",
          ambiguous: Boolean(s.ambiguous),
          reportId: s.report_id ?? null,
        })),
        suggestionError: r.error ? failure("Could not load the suggested families", r.error).error : null,
      };
    }),
  );
}

/** Deposit lines with the recorded payments that may be in them (app.suggest_deposit_payments), each with its household card. */
export async function depositLinesIn(session: CrmSession, lines: readonly DepositLineRow[]): Promise<DepositLineIn[]> {
  const { db } = session;
  const depositRows = await Promise.all(
    lines.map(async (l) => {
      const r = await db.rpc("suggest_deposit_payments", { p_txn: l.id });
      return { line: l, rows: r.data ?? [], error: r.error ? failure("Could not load the recorded payments", r.error).error : null };
    }),
  );
  // The deposit screen names each payment's family; here each gets its household card where the person may read the payment.
  const paymentIds = depositRows.flatMap((d) => d.rows.map((c) => c.payment_id));
  const owners = new Map<string, string>();
  for (const part of chunk(paymentIds)) {
    const p = await db.from("payments").select("id, household_id").in("id", part);
    if (p.error) {
      console.error("[giving-today] reading the deposit's payments failed; the deposit lists names and receipts only:", p.error);
      break;
    }
    for (const x of p.data ?? []) owners.set(x.id, x.household_id);
  }
  const cards = await householdCards(db, [...owners.values()]);
  return depositRows.map(({ line, rows, error }) => ({
    id: line.id,
    postedOn: line.posted_on,
    amountCents: line.amount_cents,
    description: line.description,
    exact: Boolean(rows[0]?.exact_total),
    error,
    candidates: rows.map((c) => {
      const card = cards.map.get(owners.get(c.payment_id) ?? "");
      return {
        paymentId: c.payment_id,
        receipt: c.receipt_number ?? null,
        method: PAYMENT_METHOD_LABEL[c.method] ?? c.method,
        amountCents: c.amount_cents,
        receivedOn: c.received_on,
        checkNumber: c.check_number ?? null,
        family: card ? familyFrom(card) : null,
        householdName: c.household_name ?? null,
      };
    }),
  }));
}

async function loadBank(session: CrmSession, homeTotals: BankTotals | null, zelleOn: boolean, canConfirm: boolean): Promise<Part<BankIn>> {
  const { db, center } = session;
  const totals = homeTotals ?? (await countBank(session));
  if ("error" in totals) return err("Could not count the bank lines", totals.error);
  if (!canConfirm) return ok({ totals, exact: null, gifts: [], deposits: [], problems: [] });

  const problems: string[] = [];
  const exactRes = zelleOn ? await loadExact(session) : { pairs: [] as ExactPairIn[] };
  if ("error" in exactRes) problems.push(exactRes.error);
  const exact = "pairs" in exactRes ? exactRes.pairs : null;
  const inExact = new Set((exact ?? []).map((p) => p.bankTransactionId));

  const lines = (batch: boolean, limit: number) =>
    db
      .from("bank_transactions")
      .select("id, posted_on, amount_cents, description, payer_name, originator_kind")
      .eq("center_id", center.id)
      .in("status", ["unmatched", "suggested"])
      .gt("amount_cents", 0)
      .eq("is_batch_deposit", batch)
      .order("posted_on", { ascending: true })
      .order("id")
      .limit(limit);
  const [giftRes, depositRes] = await Promise.all([lines(false, GIFT_ROWS + inExact.size), lines(true, DEPOSIT_ROWS)]);
  if (giftRes.error) return err("Could not read the bank lines", giftRes.error);
  if (depositRes.error) return err("Could not read the bank deposits", depositRes.error);
  const giftLines = (giftRes.data ?? []).filter((l) => !inExact.has(l.id)).slice(0, GIFT_ROWS);

  const [gifts, deposits] = await Promise.all([giftLinesIn(session, giftLines), depositLinesIn(session, depositRes.data ?? [])]);
  return ok({ totals, exact, gifts, deposits, problems });
}

// ---------------------------------------------------------------------------- Pledges, payments, counts, close

async function loadBehind(): Promise<Part<BehindIn>> {
  const res = await runScreenCommand<PledgesBehindData>("giving.pledges_behind", { limit: 8 }, "read who is behind on pledges");
  if (!res.ok) return { state: "error", error: res.error };
  const d = res.data;
  if (!d) return { state: "error", error: "Could not read who is behind on pledges — nothing came back." };
  return ok({
    householdsBehind: d.households_behind,
    totalOpenCents: d.total_open_cents,
    showing: d.showing.map((h) => ({ family: familyFrom(h.household), pledges: h.pledges_behind, openCents: h.open_cents, oldestDays: h.oldest_days_overdue })),
  });
}

async function loadToApply(session: CrmSession, today: string): Promise<Part<ApplyListIn>> {
  const { db, center } = session;
  const pays = await db
    .from("payments")
    .select("id, receipt_number, household_id, received_on, method, amount_cents")
    .eq("center_id", center.id)
    .gte("received_on", addDays(today, -APPLY_WINDOW_DAYS))
    .in("status", ["captured", "pending_clearing", "settled"])
    .order("received_on", { ascending: true })
    .order("id")
    .limit(200);
  if (pays.error) return err("Could not read the payments to apply", pays.error);
  const rows = pays.data ?? [];
  const allocated = new Map<string, number>();
  for (const part of chunk(rows.map((r) => r.id))) {
    const a = await db.from("payment_allocations").select("payment_id, amount_cents").in("payment_id", part);
    if (a.error) return err("Could not read what the payments are applied to", a.error);
    for (const x of a.data ?? []) allocated.set(x.payment_id, (allocated.get(x.payment_id) ?? 0) + x.amount_cents);
  }
  const unapplied = rows.filter((r) => r.amount_cents - (allocated.get(r.id) ?? 0) > 0);
  if (unapplied.length === 0) return ok({ list: [], more: 0 });
  const withPledge = new Set<string>();
  for (const part of chunk([...new Set(unapplied.map((r) => r.household_id))])) {
    const p = await db.from("pledges").select("household_id").eq("center_id", center.id).in("status", ["open", "partially_paid"]).in("household_id", part);
    if (p.error) return err("Could not read the families' open pledges", p.error);
    for (const x of p.data ?? []) withPledge.add(x.household_id);
  }
  const due = unapplied.filter((r) => withPledge.has(r.household_id));
  const shown = due.slice(0, APPLY_ROWS);
  const cards = await householdCards(db, shown.map((r) => r.household_id));
  const list: ApplyIn[] = shown.flatMap((r) => {
    const card = cards.map.get(r.household_id);
    if (!card) return [];
    return [
      {
        paymentId: r.id,
        receipt: r.receipt_number,
        receivedOn: r.received_on,
        amountCents: r.amount_cents,
        unappliedCents: r.amount_cents - (allocated.get(r.id) ?? 0),
        method: PAYMENT_METHOD_LABEL[r.method] ?? r.method,
        family: familyFrom(card),
      },
    ];
  });
  return ok({ list, more: due.length - list.length });
}

async function loadCounts(session: CrmSession): Promise<Part<CountIn[]>> {
  const { db, center } = session;
  const res = await db
    .from("counting_sessions")
    .select("id, counted_on, counters, total_cents, bag_numbers")
    .eq("center_id", center.id)
    .is("deposit_ref", null)
    .is("payment_id", null)
    .order("counted_on", { ascending: true })
    .limit(10);
  if (res.error) return err("Could not read the counts", res.error);
  const rows = res.data ?? [];
  const names = await userNames(db, center.id, rows.flatMap((r) => r.counters));
  return ok(
    rows.map((r) => ({
      id: r.id,
      countedOn: r.counted_on,
      // total_cents 0 is how a count is saved before its total is known.
      totalCents: r.total_cents > 0 ? r.total_cents : null,
      bags: r.bag_numbers,
      counters: r.counters.map((u) => names.get(u)?.name ?? "a counter"),
    })),
  );
}

async function loadClose(today: string): Promise<Part<CloseIn>> {
  const res = await runScreenCommand<CloseBlockersData>("accounting.month_close_blockers", {}, "read the month-end checklist");
  if (!res.ok) return { state: "error", error: res.error };
  const d = res.data;
  if (!d) return { state: "error", error: "Could not read the month-end checklist — nothing came back." };
  const keyOf = (label: string) => CLOSE_ITEMS.find((i) => i.label === label && !i.automatic)?.key ?? null;
  return ok({ month: firstOfMonth(today), label: d.month, locked: d.locked, done: d.done, blockers: d.blockers.map((b) => ({ ...b, key: keyOf(b.item) })) });
}

// ---------------------------------------------------------------------------- The month and the recent families

async function loadRecorded(session: CrmSession, monthStart: string): Promise<MonthNumbers["recorded"]> {
  const { db, center } = session;
  const { data, error, truncated } = await fetchAll<{ amount_cents: number; refunded_cents: number }>((from, to) =>
    db
      .from("payments")
      .select("amount_cents, refunded_cents")
      .eq("center_id", center.id)
      .gte("received_on", monthStart)
      .in("status", [...COUNTED_STATUSES])
      .order("id")
      .range(from, to),
  );
  if (error) return err("Could not add up this month's payments", error);
  return ok({ cents: data.reduce((a, p) => a + p.amount_cents - p.refunded_cents, 0), onlyMine: !canAccess(session, "paymentsAll"), truncated });
}

async function loadMatched(session: CrmSession, monthStart: string): Promise<MonthNumbers["matched"]> {
  const { db, center } = session;
  const base = () =>
    db.from("bank_transactions").select("id", { count: "exact", head: true }).eq("center_id", center.id).gte("posted_on", monthStart).gt("amount_cents", 0).neq("status", "ignored");
  const [all, matched] = await Promise.all([base(), base().eq("status", "matched")]);
  if (all.error) return err("Could not count this month's bank lines", all.error);
  if (matched.error) return err("Could not count this month's matched bank lines", matched.error);
  return ok({ matched: matched.count ?? 0, total: all.count ?? 0 });
}

async function loadRecent(session: CrmSession): Promise<Part<Family[]>> {
  const { db, center } = session;
  const res = await db
    .from("payments")
    .select("household_id")
    .eq("center_id", center.id)
    .order("received_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40);
  if (res.error) return err("Could not read the recent families", res.error);
  const ids = [...new Set((res.data ?? []).map((r) => r.household_id))].slice(0, 4);
  const cards = await householdCards(db, ids);
  if (cards.error && cards.map.size === 0 && ids.length > 0) return err("Could not read the recent families", cards.error);
  return ok(ids.flatMap((id) => (cards.map.has(id) ? [familyFrom(cards.map.get(id)!)] : [])));
}

// ---------------------------------------------------------------------------- Everything

export function todayCan(session: CrmSession): TodayCan {
  return {
    approve: canAccess(session, "givingApprove"),
    manage: canAccess(session, "givingManage"),
    bankConfirm: canAccess(session, "bankConfirm"),
    allocate: canAccess(session, "allocatePayment"),
    countRecord: canAccess(session, "countingRecord"),
    closeManage: canAccess(session, "closeManage"),
  };
}

function roleNote(session: CrmSession, can: TodayCan): string | null {
  if (!canAccess(session, "payments") && can.approve) {
    return "You are the second approver. You can approve what someone else asked for; never your own request.";
  }
  if (!can.manage && canAccess(session, "recordPayment")) {
    return "Limited view: you see what you can act on. Approvals, write-offs and applying payments are for the treasurer and the second approver.";
  }
  return null;
}

export async function loadGivingToday(session: CrmSession, opts: { show?: string | null } = {}): Promise<GivingTodayModel> {
  const { center } = session;
  const fmt = communityFormat(center);
  const rules = identifierRules(center.rules);
  const today = todayInTz(center.time_zone);
  const monthStart = firstOfMonth(today);
  const can = todayCan(session);
  const seesPayments = canAccess(session, "payments");
  const seesBank = (canAccess(session, "bank") || can.bankConfirm) && isModuleEnabled(session, GIVING_ADDONS.bank);
  const seesPledges = canAccess(session, "pledges");
  // What a payment is applied to is readable by giving staff only (payment_allocations RLS), so a finance volunteer
  // (giving.record_offline) never gets a count that would wrongly call every payment unapplied.
  const seesApply = seesPledges && canAccess(session, "paymentsAll");
  const seesCounts = canAccess(session, "counting") && isModuleEnabled(session, GIVING_ADDONS.counts);
  const seesClose = canAccess(session, "close") && isModuleEnabled(session, "accounting");
  const countsWord = countsWordFor(session.kind);
  const zelleWord = pluginName("zelle");

  const [home, plugins] = await Promise.all([loadHomeTasks(session), seesBank ? enabledPaymentPlugins(session) : Promise.resolve(null)]);
  const tasks = home.tasks.filter((t) => GIVING_TASK_SOURCES.includes(t.source));
  const taskFailures = home.failures.filter((f) => GIVING_TASK_SOURCES.includes(f.source));
  const zelleOn = Array.isArray(plugins) && plugins.includes("zelle");

  const [bank, behind, apply, counts, close, recorded, open, matched, recent] = await Promise.all([
    seesBank ? loadBank(session, bankTotalsFromTasks(tasks), zelleOn, can.bankConfirm) : Promise.resolve(null),
    seesPledges ? loadBehind() : Promise.resolve(null),
    seesApply ? loadToApply(session, today) : Promise.resolve(null),
    seesCounts ? loadCounts(session) : Promise.resolve(null),
    seesClose ? loadClose(today) : Promise.resolve(null),
    seesPayments ? loadRecorded(session, monthStart) : Promise.resolve<MonthNumbers["recorded"]>({ state: "no_access" }),
    seesPledges ? loadPledgeTotals(session) : Promise.resolve<Part<PledgeTotals>>({ state: "no_access" }),
    seesBank ? loadMatched(session, monthStart) : Promise.resolve<MonthNumbers["matched"]>({ state: "no_access" }),
    seesPayments ? loadRecent(session) : Promise.resolve<Part<Family[]>>({ state: "no_access" }),
  ]);

  // The families the approval rows name, read once as household cards.
  const ids = tasks.flatMap((t) => (t.giving?.householdId ? [t.giving.householdId] : []));
  const cards = await householdCards(session.db, ids);
  if (cards.error) console.error("[giving-today] some household cards could not be read; those rows name the receipt or pledge instead:", cards.error);
  const families: Record<string, Family> = {};
  for (const [id, c] of cards.map) families[id] = familyFrom(c);

  const labels = { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel };
  // An approved card refund is recorded in place (slice 3); a PayPal connected by email only is refunded in PayPal, then recorded.
  const paypalEmailOnly = can.manage ? await readPaypalEmailOnly(session) : false;
  const queue = buildQueue(
    { tasks, taskFailures, families, bank, behind, apply, counts, close },
    {
      can,
      currency: fmt.currency,
      locale: fmt.locale,
      timeZone: center.time_zone,
      today,
      labels,
      countsWord,
      zelleWord,
      paypalEmailOnly,
      visible: {
        approvals: tasks.some((t) => ["refund", "payee", "writeoff", "credit"].includes(t.source)) || can.approve || can.manage,
        bank: seesBank,
        pledges: seesPledges,
        counts: seesCounts,
        books: seesClose,
      },
    },
  );
  const tile = (k: GroupKey) => queue.tiles.find((t) => t.key === k)?.count;
  const show = opts.show ?? null;
  return {
    title: workspaceLabel("giving", session.kind),
    communityName: center.name,
    today,
    timeZone: center.time_zone,
    currency: fmt.currency,
    locale: fmt.locale,
    labels,
    tabs: givingTabs(session),
    tabCounts: { bank: tile("bank"), pledges: tile("pledges"), counts: tile("counts"), books: tile("books") },
    queue,
    can: { ...can, record: canAccess(session, "recordPayment"), find: canAccess(session, "households") || canFindGiving(session) },
    countsWord,
    roleNote: roleNote(session, can),
    month: { label: longMonth(monthStart), recorded, open, matched },
    recent,
    initialTile: show && queue.tiles.some((t) => t.key === show) ? (show as GroupKey) : "all",
  };
}

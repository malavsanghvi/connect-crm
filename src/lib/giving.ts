// Pure display and validation rules for Giving, Accounting and Reports
// (prototype: AdminPortal.dc.html L579–666). No database access here — the
// pages fetch, these functions shape. Money is integer cents throughout.

import { dateInTz, isDateOnly } from "@/lib/dates";
import { formatCents } from "@/lib/money";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** "Apr 2026" — the prototype's pledge date format. Date-only values are not shifted. */
export function monthYear(value: string | null | undefined, timeZone: string): string {
  if (!value) return "—";
  const day = isDateOnly(value) ? value : dateInTz(value, timeZone);
  const [y, m] = day.split("-").map(Number);
  if (!y || !m) return value;
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** "Sep 25" (short month + day) for a YYYY-MM-DD date. */
export function monthDay(value: string | null | undefined): string {
  if (!value || !isDateOnly(value)) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "Tue, Oct 6" for a YYYY-MM-DD date. */
export function weekdayMonthDay(value: string | null | undefined): string {
  if (!value || !isDateOnly(value)) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/** First day of the month of a YYYY-MM-DD date. */
export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** First day of the month `n` months after (negative: before) a first-of-month date. */
export function addMonths(first: string, n: number): string {
  const [y, m] = first.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${yy}-${String(mm).padStart(2, "0")}-01`;
}

/** "September 2026" for a first-of-month date. */
export function longMonth(first: string): string {
  const [y, m] = first.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

// ---------------------------------------------------------------------------
// Pledges
// ---------------------------------------------------------------------------

export type StatusTone = "ok" | "warn" | "bad" | "muted";

/** The prototype's pledge status text: Closed (green) / Partial / Open (amber). */
export function pledgeStatusText(status: string, amountCents: number, paidCents: number): { label: string; tone: StatusTone } {
  if (status === "written_off") return { label: "Written off", tone: "muted" };
  if (status === "cancelled") return { label: "Cancelled", tone: "muted" };
  if (status === "paid" || paidCents >= amountCents) return { label: "Closed", tone: "ok" };
  if (paidCents > 0 || status === "partially_paid") return { label: "Partial", tone: "warn" };
  return { label: "Open", tone: "warn" };
}

/** Pledge list chips (prototype: All · Open · Closed). */
export const PLEDGE_VIEWS = {
  all: { label: "All", statuses: [] as readonly ("open" | "partially_paid" | "paid" | "written_off" | "cancelled")[] },
  open: { label: "Open", statuses: ["open", "partially_paid"] },
  closed: { label: "Closed", statuses: ["paid", "written_off", "cancelled"] },
} as const;
export type PledgeView = keyof typeof PLEDGE_VIEWS;

/** Old `?status=` values from the previous Pledges page still land on the right chip. */
export function pledgeViewFromParam(value: string | undefined): PledgeView {
  if (value === "open" || value === "outstanding" || value === "partially_paid") return "open";
  if (value === "closed" || value === "paid" || value === "written_off" || value === "cancelled") return "closed";
  return "all";
}

// ---------------------------------------------------------------------------
// Offline payment copy (prototype allocation preview)
// ---------------------------------------------------------------------------

/** Label of the reference field, which changes with the method (prototype L586). */
export function referenceFieldLabel(method: string): string {
  return method === "stock" ? "Shares and value on date received" : "Check number or reference";
}

/**
 * The memo stored for a stock gift: the shares/value description goes first
 * (payments has no stock columns; the memo is what the receipt and QuickBooks read).
 */
export function stockMemo(sharesAndValue: string, memo: string): string | null {
  const s = sharesAndValue.trim();
  const m = memo.trim();
  if (!s) return m || null;
  return (m ? `Stock: ${s} · ${m}` : `Stock: ${s}`).slice(0, 500);
}

// ---------------------------------------------------------------------------
// Refund requests
// ---------------------------------------------------------------------------

export function refundStatusText(p: { refund_approved_by: string | null; refund_second_approver: string | null; refunded_cents: number }): {
  label: string;
  tone: StatusTone;
} {
  if (p.refunded_cents > 0) return { label: "Refunded", tone: "ok" };
  if (p.refund_second_approver) return { label: "Approved", tone: "ok" };
  if (p.refund_approved_by) return { label: "Awaiting 2nd approver", tone: "warn" };
  return { label: "—", tone: "muted" };
}

// ---------------------------------------------------------------------------
// Recurring gifts
// ---------------------------------------------------------------------------

const PER_MONTH: Record<string, number> = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12, special_day: 1 / 12 };

export function frequencyText(frequency: string): string {
  if (frequency === "special_day") return "Yearly · on special day";
  return frequency ? frequency[0].toUpperCase() + frequency.slice(1).replace(/_/g, " ") : "—";
}

/**
 * What a recurring gift goes to, in the order the member chose it: a campaign,
 * else a fund (the member app's "Give towards" writes fund_id for funds), else a
 * special-day labh, else the general fund. A name that could not be loaded says so.
 */
export function recurringCause(
  r: { campaign_id: string | null; fund_id: string | null; special_day_id: string | null },
  campaignName: Map<string, string>,
  fundName: Map<string, string>,
): string {
  if (r.campaign_id) return campaignName.get(r.campaign_id) ?? "Campaign";
  if (r.fund_id) return fundName.get(r.fund_id) ?? "Fund";
  if (r.special_day_id) return "Special-day labh";
  return "General fund";
}

/**
 * Human status of a recurring gift (prototype: "Payment failed · retry Sep 25",
 * "Paused by donor"). 'pending_payment_method' (0026) is a gift set up in the
 * app that has no card or bank account yet — it is never charged.
 */
export function recurringStatusText(r: { status: string; next_charge_on: string | null }): {
  label: string;
  tone: StatusTone;
} {
  switch (r.status) {
    case "active":
      return { label: "Active", tone: "ok" };
    case "failed":
      return { label: r.next_charge_on ? `Payment failed · retry ${monthDay(r.next_charge_on)}` : "Payment failed", tone: "bad" };
    case "paused":
      return { label: "Paused by donor", tone: "warn" };
    case "pending_payment_method":
      return { label: "Waiting for a payment method", tone: "warn" };
    case "cancelled":
      return { label: "Cancelled", tone: "muted" };
    default:
      return { label: r.status, tone: "muted" };
  }
}

export type RecurringKpis = { active: number; paused: number; pending: number; monthlyRunRateCents: number; failedThisMonth: number };

/**
 * Recurring KPI row: active / paused / waiting-for-a-payment-method counts,
 * the monthly run rate of ACTIVE gifts only (pending ones are never charged),
 * and failures this month.
 */
export function recurringKpis(
  rows: { status: string; amount_cents: number; frequency: string; updated_at: string }[],
  monthStart: string,
  timeZone: string,
): RecurringKpis {
  let active = 0;
  let paused = 0;
  let pending = 0;
  let run = 0;
  let failed = 0;
  for (const r of rows) {
    if (r.status === "active") {
      active += 1;
      run += r.amount_cents * (PER_MONTH[r.frequency] ?? 0);
    } else if (r.status === "paused") paused += 1;
    else if (r.status === "pending_payment_method") pending += 1;
    else if (r.status === "failed" && dateInTz(r.updated_at, timeZone) >= monthStart) failed += 1;
  }
  return { active, paused, pending, monthlyRunRateCents: Math.round(run), failedThisMonth: failed };
}

// ---------------------------------------------------------------------------
// Bhandar counting sessions
// ---------------------------------------------------------------------------

/** Bag numbers typed as "12, 13 14" → ["12","13","14"] (unique, order kept). */
export function parseBagNumbers(text: string): string[] {
  const out: string[] = [];
  for (const b of text.split(/[\s,;]+/)) {
    const t = b.trim().slice(0, 30);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 50);
}

/**
 * Two counters from different households (the database trigger enforces the
 * same rule; this gives the reason before the round trip). A counter with no
 * household counts as their own.
 */
export function countersProblem(counters: { userId: string; householdId: string | null }[]): string | null {
  const ids = new Set(counters.map((c) => c.userId));
  if (ids.size < 2) return "Choose at least two counters.";
  const households = new Set(counters.map((c) => c.householdId ?? `self:${c.userId}`));
  if (households.size < 2) return "The counters must come from different households.";
  return null;
}

export function countingStatusText(s: { total_cents: number; deposit_ref: string | null; payment_id: string | null; counted_on: string }, today: string): {
  label: string;
  tone: StatusTone;
} {
  if (s.deposit_ref && s.payment_id) return { label: "Deposited · matched", tone: "ok" };
  if (s.deposit_ref) return { label: "Deposited", tone: "ok" };
  if (s.total_cents > 0) return { label: "Counted · awaiting deposit", tone: "warn" };
  if (s.counted_on > today) return { label: "Scheduled", tone: "warn" };
  return { label: "Not counted yet", tone: "warn" };
}

// ---------------------------------------------------------------------------
// Opportunities (0022: kind + options)
// ---------------------------------------------------------------------------

/** The builder's four types (prototype chips), mapped to opportunities.kind. */
export const OPPORTUNITY_TYPES = [
  { kind: "tier", label: "Sponsorship tiers" },
  { kind: "multi", label: "Fixed pujan list (multi-select)" },
  { kind: "amount", label: "Preset amounts + open" },
  { kind: "open", label: "Open amount" },
] as const;
export type OpportunityKind = "tier" | "multi" | "amount" | "open" | "fixed";

export type OptionRow = { key?: string; label: string; amount: string; recognition?: string };

export type OpportunityOption =
  | { key: string; label: string; amount_cents: number; recognition: string | null }
  | { key: string; label: string; amount_cents: number; note: null; fixed: true }
  | { amount_cents: number };

/** A stable option key from a label ("Pehli aarti" → "pehli-aarti"), unique among `taken`. */
export function optionKey(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "option";
  let k = base;
  let n = 2;
  while (taken.has(k)) k = `${base}-${n++}`;
  taken.add(k);
  return k;
}

/**
 * Turn the builder's rows into opportunities.options for a kind. Existing
 * keys are kept (pledges point at them); new rows get a key from the label.
 */
export function buildOptions(
  kind: OpportunityKind,
  rows: OptionRow[],
  parseCents: (s: string) => number | null,
): { ok: true; options: OpportunityOption[] } | { ok: false; error: string } {
  const filled = rows.filter((r) => r.label.trim() || r.amount.trim() || (r.recognition ?? "").trim());
  if (kind === "open" || kind === "fixed") return { ok: true, options: [] };
  if (kind === "amount") {
    const out: OpportunityOption[] = [];
    for (const r of filled) {
      const c = parseCents(r.amount);
      if (c === null || c <= 0) return { ok: false, error: `"${r.amount}" is not an amount — use dollars like 10000.` };
      out.push({ amount_cents: c });
    }
    if (out.length === 0) return { ok: false, error: "Add at least one preset amount." };
    return { ok: true, options: out };
  }
  if (filled.length === 0) return { ok: false, error: kind === "tier" ? "Add at least one sponsorship tier." : "Add at least one pujan." };
  const taken = new Set(filled.map((r) => r.key).filter((k): k is string => !!k));
  const out: OpportunityOption[] = [];
  const labels = new Set<string>();
  for (const r of filled) {
    const label = r.label.trim().slice(0, 120);
    if (!label) return { ok: false, error: "Every row needs a name." };
    if (labels.has(label.toLowerCase())) return { ok: false, error: `"${label}" is listed twice.` };
    labels.add(label.toLowerCase());
    const c = parseCents(r.amount);
    if (c === null || c <= 0) return { ok: false, error: `Enter an amount for "${label}", like 251.` };
    const key = r.key || optionKey(label, taken);
    out.push(
      kind === "tier"
        ? { key, label, amount_cents: c, recognition: (r.recognition ?? "").trim().slice(0, 200) || null }
        : { key, label, amount_cents: c, note: null, fixed: true },
    );
  }
  return { ok: true, options: out };
}

/** Read opportunities.options (jsonb) back into builder rows. */
export function optionRows(kind: string, options: unknown): OptionRow[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((o): OptionRow[] => {
    if (typeof o !== "object" || o === null) return [];
    const x = o as Record<string, unknown>;
    const cents = typeof x.amount_cents === "number" ? x.amount_cents : null;
    const amount = cents === null ? "" : String(cents / 100);
    if (kind === "amount") return [{ label: "", amount }];
    return [
      {
        key: typeof x.key === "string" ? x.key : undefined,
        label: typeof x.label === "string" ? x.label : "",
        amount,
        recognition: typeof x.recognition === "string" ? x.recognition : "",
      },
    ];
  });
}

/** Keys that were on the opportunity, have active pledges, and are missing from the new options. */
export function removedTakenKeys(before: { key: string; taken_count: number }[], after: OpportunityOption[]): string[] {
  const keep = new Set(after.flatMap((o) => ("key" in o ? [o.key] : [])));
  return before.filter((b) => b.taken_count > 0 && !keep.has(b.key)).map((b) => b.key);
}

/** Alert audiences in the builder and what segment_recipient_count (0025) can target. */
export const ALERT_AUDIENCES = [
  { key: "all_members", label: "All members", audience: { all_members: true } as Record<string, unknown> | null },
  { key: "past_donors", label: "Past donors to this campaign", audience: null },
  { key: "life_members", label: "Life members", audience: { membership_tiers: ["life"] } as Record<string, unknown> | null },
  { key: "temple_interest", label: "Interested in temple programs", audience: null },
] as const;

/** OR-merge the chosen audiences into one segment definition; null when nothing targetable is chosen. */
export function mergeAudience(keys: readonly string[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const a of ALERT_AUDIENCES) {
    if (!keys.includes(a.key) || !a.audience) continue;
    for (const [k, v] of Object.entries(a.audience)) {
      if (Array.isArray(v)) out[k] = [...new Set([...((out[k] as unknown[]) ?? []), ...v])];
      else out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Receipt templates (0022 receipt_templates)
// ---------------------------------------------------------------------------

export const RECEIPT_KINDS = [
  { kind: "donation_receipt", label: "Donation receipt" },
  { kind: "pledge_confirmation", label: "Pledge confirmation" },
  { kind: "year_end_statement", label: "Year-end statement" },
] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number]["kind"];

export function isReceiptKind(v: string): v is ReceiptKind {
  return RECEIPT_KINDS.some((k) => k.kind === v);
}

export type ReceiptPreviewLine = { text: string; tone: "navy" | "ink" | "muted"; strong?: boolean };

/**
 * The live preview beside the template editor (prototype L604). Sample
 * donor data is labelled as a sample; the header uses the center's name and
 * address from its settings.
 */
export function receiptPreviewLines(input: {
  kind: ReceiptKind;
  centerName: string;
  centerAddress: string | null;
  signedBy: string;
  note: string;
  year: number;
  currency: string;
}): ReceiptPreviewLine[] {
  const title =
    input.kind === "donation_receipt"
      ? "Donation receipt"
      : input.kind === "pledge_confirmation"
        ? "Pledge confirmation"
        : `Year-end statement ${input.year - 1}`;
  const amount = formatCents(40000, input.currency);
  const lines: ReceiptPreviewLine[] = [
    { text: [input.centerName, input.centerAddress].filter(Boolean).join(" · "), tone: "navy", strong: true },
    { text: `${title} · No. R-${input.year}-00000 (sample)`, tone: "ink", strong: true },
    input.kind === "pledge_confirmation"
      ? { text: `Sample donor · pledged ${amount} to Temple construction`, tone: "ink" }
      : input.kind === "year_end_statement"
        ? { text: `Sample donor · ${input.year - 1} gifts totalling ${amount}`, tone: "ink" }
        : { text: `Sample donor · ${amount} by check on a sample date`, tone: "ink" },
    { text: "Applied to: Temple construction (sample)", tone: "ink" },
    { text: "No goods or services were provided other than intangible religious benefits.", tone: "muted" },
  ];
  const note = input.note.trim();
  const signed = input.signedBy.trim();
  if (note || signed) lines.push({ text: [note, signed ? `— ${signed}` : ""].filter(Boolean).join(" "), tone: "muted" });
  return lines;
}

// ---------------------------------------------------------------------------
// QuickBooks exceptions
// ---------------------------------------------------------------------------

export type QboException = {
  reason: string;
  fix: string;
  /** Set only when the fix is deterministic: the named mapping now exists and is approved, so reposting is the fix. */
  applyPurpose: string | null;
};

/**
 * Explain a failed posting in plain English with a suggested fix. "Apply fix"
 * is offered only when the fix is deterministic: the error names a mapping
 * purpose that is now mapped AND approved, so the posting just needs to go
 * back in the queue. Anything else needs a person, so there is no button.
 */
export function classifyQboException(
  lastError: string | null,
  mappings: { purpose: string; label: string; mapped: boolean; approved: boolean }[],
): QboException {
  const err = (lastError ?? "").trim();
  const lower = err.toLowerCase();
  const named = mappings.find((m) => lower.includes(m.purpose.toLowerCase()) || lower.includes(m.label.toLowerCase()));
  const aboutMapping = /mapp|account|not mapped|no income account/.test(lower);
  if (named && aboutMapping) {
    if (named.mapped && named.approved) {
      return { reason: err || `No account mapped for ${named.label}`, fix: `${named.label} is now mapped and approved — repost`, applyPurpose: named.purpose };
    }
    if (named.mapped) {
      return { reason: err, fix: `Approve the ${named.label} mapping below, then retry`, applyPurpose: null };
    }
    return { reason: err, fix: `Map ${named.label} to a QuickBooks account below, then approve it`, applyPurpose: null };
  }
  if (/token|auth|expired|unauthori[sz]ed|401|reconnect/.test(lower)) {
    return { reason: err, fix: "Reconnect QuickBooks (the connection needs a new sign-in), then retry", applyPurpose: null };
  }
  if (/closed|locked|period/.test(lower)) {
    return { reason: err, fix: "The month is closed in QuickBooks — post it as an adjustment in the current month", applyPurpose: null };
  }
  if (/duplicate|already exists/.test(lower)) {
    return { reason: err, fix: "Check QuickBooks for an existing entry before retrying, so it is not posted twice", applyPurpose: null };
  }
  if (/customer|donor|name/.test(lower)) {
    return { reason: err, fix: "Link the household's QuickBooks customer ID (household → Identifiers), then retry", applyPurpose: null };
  }
  return { reason: err || "QuickBooks refused the posting without a reason", fix: "Read the error, fix the cause in QuickBooks, then retry", applyPurpose: null };
}

/** QuickBooks CLASS (fund / event / store) each mapping purpose posts with (prototype account mapping). */
export function qboClassFor(purpose: string): string {
  if (purpose === "income.boli" || purpose === "income.sponsorship") return "Fund, event";
  if (purpose.startsWith("income.")) return "Fund";
  if (purpose.startsWith("store.") || purpose === "sales_tax_payable") return "Store";
  if (purpose === "merchant_fees") return "Unrestricted";
  return "—";
}

// ---------------------------------------------------------------------------
// Month-end close (accounting_periods.checklist)
// ---------------------------------------------------------------------------

export const CLOSE_ITEMS = [
  { key: "exceptions_cleared", label: "All QuickBooks exceptions cleared", automatic: true },
  { key: "payouts_matched", label: "Payment payouts matched to bank deposits", automatic: false },
  { key: "refunds_reviewed", label: "Refunds reviewed and approved", automatic: false },
  { key: "statements_generated", label: "Pledge statements generated", automatic: false },
] as const;
export type CloseItemKey = (typeof CLOSE_ITEMS)[number]["key"];

export function isCloseItem(k: string): k is Exclude<CloseItemKey, "exceptions_cleared"> {
  return CLOSE_ITEMS.some((i) => i.key === k && !i.automatic);
}

/** Checklist state: manual items from the JSON, the exceptions item from the live count. */
export function closeChecklist(checklist: unknown, exceptionsLeft: number | null): { key: CloseItemKey; label: string; done: boolean; sub: string }[] {
  const c = typeof checklist === "object" && checklist !== null && !Array.isArray(checklist) ? (checklist as Record<string, unknown>) : {};
  return CLOSE_ITEMS.map((i) => {
    if (i.automatic) {
      const done = exceptionsLeft === 0;
      return {
        key: i.key,
        label: i.label,
        done,
        sub: exceptionsLeft === null ? "Could not count the exceptions" : done ? "Done" : `${exceptionsLeft} left · fix on the sync tab`,
      };
    }
    const done = c[i.key] === true;
    return { key: i.key, label: i.label, done, sub: done ? "Done" : "Mark done" };
  });
}

// ---------------------------------------------------------------------------
// Bars (campaign progress, giving by campaign, households by zone)
// ---------------------------------------------------------------------------

/** Width percentages for a bar block, relative to `max` (or the largest value). */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(1, Math.min(100, Math.round((value * 100) / max)));
}

// ---------------------------------------------------------------------------
// Allocation preview copy (prototype green panel, L587)
// ---------------------------------------------------------------------------

export type PreviewText = { text: string; tone: "ok" | "warn" | "muted" };

/**
 * Lines for the green Allocation preview. The money rule is unchanged: what
 * is not applied to a pledge stays UNAPPLIED on the payment (a general gift).
 * The prototype calls it "recorded as a donation"; that difference is an
 * owner decision, so the copy says what the system actually does.
 */
export function allocationPreviewText(input: {
  lines: { pledge_id: string; amount_cents: number; closes: boolean }[];
  unallocatedCents: number;
  pledges: { id: string; campaign: string | null; source: string; pledged_at: string }[];
  mode: "auto" | "choose" | "none";
  hasOpenPledges: boolean;
  currency: string;
  timeZone: string;
}): PreviewText[] {
  const { currency, timeZone } = input;
  if (input.mode === "none") return [{ text: "Not applied to any pledge — recorded as an unapplied general gift", tone: "muted" }];
  if (!input.hasOpenPledges) return [{ text: "No open pledges; the full amount stays unapplied as a general gift", tone: "muted" }];
  const byId = new Map(input.pledges.map((p) => [p.id, p]));
  const out: PreviewText[] = input.lines.map((l) => {
    const p = byId.get(l.pledge_id);
    const name = p ? (p.campaign ?? p.source.replace(/_/g, " ")) : "Pledge";
    const when = p ? monthYear(p.pledged_at, timeZone) : "";
    return {
      text: `${name}${when ? ` · ${when}` : ""} → ${formatCents(l.amount_cents, currency)}${l.closes ? " · closes" : " · stays open (partial)"}`,
      tone: "ok",
    };
  });
  if (input.unallocatedCents > 0 && out.length > 0) {
    out.push({ text: `Remaining ${formatCents(input.unallocatedCents, currency)} stays unapplied as a general gift`, tone: "warn" });
  }
  return out;
}

/** The prototype's success toast, honest about the QuickBooks queue. */
export function paymentRecordedToast(appliedCount: number, qboQueued: boolean | null): string {
  const qbo = qboQueued === true ? "QuickBooks sales receipt queued" : qboQueued === false ? "not yet in the QuickBooks queue" : "queued for QuickBooks automatically";
  return `Payment recorded · ${appliedCount} pledge${appliedCount === 1 ? "" : "s"} updated · ${qbo}`;
}

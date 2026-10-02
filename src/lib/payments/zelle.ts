// Zelle reports (payments plan PR 3, migrations 0582–0583): members say "I sent a Zelle"; nothing
// is credited until the treasurer matches the bank line. Pure helpers shared by the portal and its
// tests: no server-only or Next imports. The database is the rule; reportProblem mirrors
// app.report_payment's messages so a form can say them before sending.

import { addDays } from "@/lib/dates";
import { formatCents } from "@/lib/money";

export type ReportStatus = "reported" | "matched" | "unmatched" | "rejected" | "withdrawn";

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  reported: "Waiting for the bank",
  unmatched: "Not seen at the bank",
  matched: "Matched",
  rejected: "Not accepted",
  withdrawn: "Withdrawn",
};

/** SQLSTATE of the double-count guard in app.confirm_bank_match (G6). */
export const DUPLICATE_SQLSTATE = "CCDUP";

/** The report window (centers.rules.payments.zelle.report_window_days): 3 to 30 days, 10 when absent. */
export const DEFAULT_WINDOW_DAYS = 10;
export const MIN_WINDOW_DAYS = 3;
export const MAX_WINDOW_DAYS = 30;
/** How far back a member may report (app.report_payment). */
export const REPORT_MAX_AGE_DAYS = 60;
/** Bulk confirm limit (app.confirm_exact_zelle_matches). */
export const MAX_BULK_PAIRS = 200;

/** As app.payment_reports_prepare: upper case, letters and digits only; null when nothing is left. */
export function normalizeConfirmation(value: string | null | undefined): string | null {
  const v = String(value ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  return v || null;
}

/** As app.zelle_report_window_days: the organization's rule, clamped to 3..30, else 10. */
export function zelleWindowDays(rules: unknown): number {
  const raw = (rules as { payments?: { zelle?: { report_window_days?: unknown } } } | null | undefined)?.payments?.zelle?.report_window_days;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d{1,4}\s*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return DEFAULT_WINDOW_DAYS;
  return Math.min(MAX_WINDOW_DAYS, Math.max(MIN_WINDOW_DAYS, n));
}

export type ReportInput = {
  method?: string | null;
  amountCents: number | null;
  /** YYYY-MM-DD */
  sentOn: string | null | undefined;
  /** Today in the organization's time zone, YYYY-MM-DD. */
  today: string;
  confirmation?: string | null;
  senderName?: string | null;
  note?: string | null;
  pledgeIds?: readonly string[] | null;
  /** Whether the organization accepts Zelle (center_payment_methods). Unknown: not checked. */
  zelleAccepted?: boolean;
  shortName?: string;
};

/** The first thing app.report_payment would refuse, in the same words; null when the report may be sent. */
export function reportProblem(input: ReportInput): string | null {
  if (String(input.method ?? "zelle").trim().toLowerCase() !== "zelle") {
    return "Only a Zelle can be reported here; other gifts are recorded when they arrive.";
  }
  if (input.zelleAccepted === false) return `Zelle is not one of the ways ${input.shortName ?? "this organization"} takes gifts.`;
  const amount = input.amountCents;
  if (amount === null || !Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000) {
    return "Enter the amount you sent, from $0.01 to $1,000,000.";
  }
  const sent = input.sentOn ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sent)) return "Enter the date you sent the Zelle.";
  if (sent > input.today) return "The date you sent the Zelle cannot be after today.";
  if (sent < addDays(input.today, -REPORT_MAX_AGE_DAYS)) {
    return "Report a Zelle you sent in the last 60 days. For an older one, contact the treasurer.";
  }
  const conf = String(input.confirmation ?? "").trim();
  if (conf) {
    const n = normalizeConfirmation(conf) ?? "";
    if (conf.length > 60 || n.length < 6 || n.length > 40) {
      return "That does not look like a Zelle confirmation number. Leave it blank if you do not have it.";
    }
  }
  if (String(input.senderName ?? "").trim().length > 120) return "The name your bank shows can be at most 120 characters.";
  if (String(input.note ?? "").trim().length > 500) return "The note can be at most 500 characters.";
  if (new Set(input.pledgeIds ?? []).size > 20) return "Choose at most 20 pledges.";
  return null;
}

// ── The treasurer's queue (app.payment_report_queue) ─────────────────────────
export type QueueHousehold = {
  household_id: string;
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  members: string | null;
  primary_member: string | null;
  primary_org_member_id: string | null;
  zone: string | null;
  city: string | null;
  last_gift_on: string | null;
  open_pledge_cents: number | null;
};

export type ExactPair = {
  report_id: string;
  bank_transaction_id: string;
  amount_cents: number;
  sent_on: string;
  posted_on: string;
  confirmation: string | null;
  payer_name: string | null;
  household: QueueHousehold | null;
};

export type LineCandidate = {
  bank_transaction_id: string;
  posted_on: string;
  amount_cents: number;
  description: string;
  payer_name: string | null;
  reference: string | null;
  exact: boolean;
  score: number;
};

export type RecordedZelle = { kind: "hand_recorded" | "bank" | "report"; id: string; receipt_number: string | null; date: string; amount_cents: number };

export type QueueReport = {
  id: string;
  status: ReportStatus;
  is_test: boolean;
  amount_cents: number;
  sent_on: string;
  due_on: string;
  confirmation: string | null;
  sender_name: string | null;
  note: string | null;
  reported_by_name: string;
  created_at: string;
  household: QueueHousehold | null;
  pledges: { id: string; pledge_number: string | null; open_cents: number }[];
  candidates: LineCandidate[];
  hand_recorded: RecordedZelle[];
  bank_recorded: RecordedZelle[];
};

export type ReportQueue = {
  window_days: number;
  bank_account_id: string | null;
  counts: { reported: number; unmatched: number; exact: number };
  exact: ExactPair[];
  reports: QueueReport[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const STATUSES = new Set<string>(Object.keys(REPORT_STATUS_LABEL));

function parseHousehold(v: unknown): QueueHousehold | null {
  if (!isObj(v) || !str(v.household_id)) return null;
  return {
    household_id: str(v.household_id)!,
    household_name: str(v.household_name),
    household_number: str(v.household_number),
    org_household_id: str(v.org_household_id),
    members: str(v.members),
    primary_member: str(v.primary_member),
    primary_org_member_id: str(v.primary_org_member_id),
    zone: str(v.zone),
    city: str(v.city),
    last_gift_on: str(v.last_gift_on),
    open_pledge_cents: num(v.open_pledge_cents),
  };
}

function parseRecorded(v: unknown): RecordedZelle | null {
  if (!isObj(v) || !str(v.id)) return null;
  const kind = v.kind === "hand_recorded" || v.kind === "bank" || v.kind === "report" ? v.kind : null;
  const amount = num(v.amount_cents);
  if (!kind || amount === null) return null;
  return { kind, id: str(v.id)!, receipt_number: str(v.receipt_number), date: str(v.date) ?? "", amount_cents: amount };
}

export function parseExactPair(v: unknown): ExactPair | null {
  if (!isObj(v)) return null;
  const report = str(v.report_id);
  const txn = str(v.bank_transaction_id);
  const amount = num(v.amount_cents);
  if (!report || !txn || amount === null) return null;
  return {
    report_id: report,
    bank_transaction_id: txn,
    amount_cents: amount,
    sent_on: str(v.sent_on) ?? "",
    posted_on: str(v.posted_on) ?? "",
    confirmation: str(v.confirmation),
    payer_name: str(v.payer_name),
    household: parseHousehold(v.household),
  };
}

function parseCandidate(v: unknown): LineCandidate | null {
  if (!isObj(v)) return null;
  const id = str(v.bank_transaction_id);
  const amount = num(v.amount_cents);
  if (!id || amount === null) return null;
  return {
    bank_transaction_id: id,
    posted_on: str(v.posted_on) ?? "",
    amount_cents: amount,
    description: str(v.description) ?? "",
    payer_name: str(v.payer_name),
    reference: str(v.reference),
    exact: v.exact === true,
    score: num(v.score) ?? 0,
  };
}

function parseQueueReport(v: unknown): QueueReport | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const amount = num(v.amount_cents);
  const status = str(v.status);
  if (!id || amount === null || !status || !STATUSES.has(status)) return null;
  return {
    id,
    status: status as ReportStatus,
    is_test: v.is_test === true,
    amount_cents: amount,
    sent_on: str(v.sent_on) ?? "",
    due_on: str(v.due_on) ?? "",
    confirmation: str(v.confirmation),
    sender_name: str(v.sender_name),
    note: str(v.note),
    reported_by_name: str(v.reported_by_name) ?? "a member",
    created_at: str(v.created_at) ?? "",
    household: parseHousehold(v.household),
    pledges: arr(v.pledges).flatMap((p) => {
      if (!isObj(p) || !str(p.id)) return [];
      return [{ id: str(p.id)!, pledge_number: str(p.pledge_number), open_cents: num(p.open_cents) ?? 0 }];
    }),
    candidates: arr(v.candidates).flatMap((c) => parseCandidate(c) ?? []),
    hand_recorded: arr(v.hand_recorded).flatMap((r) => parseRecorded(r) ?? []),
    bank_recorded: arr(v.bank_recorded).flatMap((r) => parseRecorded(r) ?? []),
  };
}

/** app.payment_report_queue's answer, or null when it is not in the expected shape. */
export function parseReportQueue(data: unknown): ReportQueue | null {
  if (!isObj(data) || !Array.isArray(data.reports) || !Array.isArray(data.exact)) return null;
  const counts = isObj(data.counts) ? data.counts : {};
  return {
    window_days: num(data.window_days) ?? DEFAULT_WINDOW_DAYS,
    bank_account_id: str(data.bank_account_id),
    counts: { reported: num(counts.reported) ?? 0, unmatched: num(counts.unmatched) ?? 0, exact: num(counts.exact) ?? 0 },
    exact: data.exact.flatMap((e) => parseExactPair(e) ?? []),
    reports: data.reports.flatMap((r) => parseQueueReport(r) ?? []),
  };
}

/** The queue's sections, as the panel shows them. */
export function queueSections(queue: ReportQueue): {
  exact: ExactPair[];
  waiting: QueueReport[];
  unmatched: QueueReport[];
  recorded: QueueReport[];
} {
  const inExact = new Set(queue.exact.map((e) => e.report_id));
  const recorded = queue.reports.filter((r) => !inExact.has(r.id) && (r.hand_recorded.length > 0 || r.bank_recorded.length > 0));
  const isRecorded = new Set(recorded.map((r) => r.id));
  return {
    exact: queue.exact,
    waiting: queue.reports.filter((r) => r.status === "reported" && !inExact.has(r.id) && !isRecorded.has(r.id)),
    unmatched: queue.reports.filter((r) => r.status === "unmatched" && !inExact.has(r.id) && !isRecorded.has(r.id)),
    recorded,
  };
}

/** app.possible_duplicate_zelle rows. */
export function parsePossibleDuplicates(data: unknown): RecordedZelle[] {
  return arr(data).flatMap((r) => parseRecorded(r) ?? []);
}

/** The non-blocking warning on the record-payment form; null when nothing may duplicate it. */
export function duplicateWarning(rows: readonly RecordedZelle[], currency: string, formatDay: (d: string) => string): string | null {
  if (rows.length === 0) return null;
  const parts = rows.map((r) => {
    const amount = formatCents(r.amount_cents, currency);
    if (r.kind === "report") return `a member reported a Zelle of ${amount} sent on ${formatDay(r.date)} (it is matched when the bank line arrives)`;
    const receipt = r.receipt_number ? ` (receipt ${r.receipt_number})` : "";
    return r.kind === "bank"
      ? `a Zelle of ${amount} from the bank statement on ${formatDay(r.date)}${receipt}`
      : `a Zelle of ${amount} recorded by hand on ${formatDay(r.date)}${receipt}`;
  });
  return `This may already be recorded: ${parts.join("; ")}. Recording it again counts the gift twice.`;
}

/** The double-count guard's refusal (SQLSTATE CCDUP): its message and the hand-recorded payment ids. */
export function parseDuplicateError(error: unknown): { message: string; paymentIds: string[] } | null {
  if (!isObj(error)) return null;
  if (error.code !== DUPLICATE_SQLSTATE) return null;
  const ids = String(error.details ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s));
  return { message: String(error.message ?? "").trim(), paymentIds: ids };
}

export type ExactConfirmOutcome = {
  confirmed: { report_id: string; payment_id: string; receipt_number: string | null }[];
  skipped: { report_id: string | null; reason: string }[];
};

/** app.confirm_exact_zelle_matches's answer, or null when it is not in the expected shape. */
export function parseExactConfirm(data: unknown): ExactConfirmOutcome | null {
  if (!isObj(data) || !Array.isArray(data.confirmed) || !Array.isArray(data.skipped)) return null;
  return {
    confirmed: data.confirmed.flatMap((c) =>
      isObj(c) && str(c.report_id) && str(c.payment_id)
        ? [{ report_id: str(c.report_id)!, payment_id: str(c.payment_id)!, receipt_number: str(c.receipt_number) }]
        : [],
    ),
    skipped: data.skipped.flatMap((s) => (isObj(s) ? [{ report_id: str(s.report_id), reason: str(s.reason) ?? "not confirmed" }] : [])),
  };
}

/** How sure a line candidate is, in words (the scores of app.suggest_bank_matches' report source). */
export function candidateLabel(score: number, exact: boolean): string {
  if (exact) return "Exact: confirmation number, amount and date";
  if (score >= 0.99) return "Same confirmation number";
  if (score >= 0.93) return "Same amount, date and sender name";
  return "Same amount and date";
}

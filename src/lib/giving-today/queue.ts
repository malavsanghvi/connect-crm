// Giving › Today: the work queue (docs/GIVING_REDESIGN.md sections 4, 5, 6 and slice 1). Pure: no React, no database. The loader
// (src/lib/data/giving-today.ts) reads what is waiting through the existing readers and Home's task list; this file turns it into
// rows, in the plan's order (approvals, bank, pledges, counts, books), and decides which rows the person can act on.
//
// Owner decision 7: the queue holds only what the person can act on; whatever someone else must do is a plain count
// ("2 waiting for the second approver"), never a hidden row and never an empty table. Every button names the amount and the
// family; a family is never shown by name alone (the number, the organization's household id, the primary adult, the city).
// No child's name appears: the line uses the primary adult only, never the member list (section 7).

import type { CardLabels } from "@/components/household-card";
import { formatDate } from "@/lib/dates";
import { thanksTaskCopy } from "@/lib/care/thanks";
import { weakSignsLine, type CareTodayIn, type WeakSign } from "@/lib/care/watch";
import { weekTaskCopy } from "@/lib/care/week";
import { MATCH_WHAT } from "@/lib/giving-counts/model";
import type { Part } from "@/lib/giving-workspace/view";
import { formatCents } from "@/lib/money";
import type { GivingTaskDetail, HomeTask } from "@/lib/tasks";

export type GroupKey = "approvals" | "bank" | "pledges" | "counts" | "books" | "care";
export const GROUP_ORDER: readonly GroupKey[] = ["approvals", "bank", "pledges", "counts", "books", "care"];

/** A family as Today shows it: enough to tell two families with the same name apart. */
export type Family = { id: string; name: string; number: string | null; orgId: string | null; primary: string | null; city: string | null };

type CardLike = {
  household_id: string;
  household_name: string | null;
  household_number: string | null;
  org_household_id: string | null;
  primary_member?: string | null;
  primary_adult?: string | null;
  city: string | null;
};

export function familyFrom(c: CardLike): Family {
  return {
    id: c.household_id,
    name: c.household_name ?? "Unnamed household",
    number: c.household_number,
    orgId: c.org_household_id,
    primary: c.primary_member ?? c.primary_adult ?? null,
    city: c.city,
  };
}

/** "Chidi & María Okafor Household 0212": the name with its number, for a button. */
export function familyRef(f: Family | null): string {
  if (!f) return "the household";
  return f.number ? `${f.name} ${f.number}` : f.name;
}

/** The household card line: number, the organization's own id, the primary adult, the city. */
export function familyLine(f: Family, labels: CardLabels): string {
  return [
    f.number ? `No. ${f.number}` : "No household number",
    `${labels.orgHouseholdLabel} ${f.orgId ?? "—"}`,
    f.primary ? `Primary: ${f.primary}` : "No primary adult on file",
    f.city ?? "No city",
  ].join(" · ");
}

// ---------------------------------------------------------------------------- What the loader hands in

export type ExactPairIn = {
  reportId: string;
  bankTransactionId: string;
  amountCents: number;
  sentOn: string;
  postedOn: string;
  confirmation: string | null;
  payerName: string | null;
  family: Family | null;
};

export type SuggestionIn = { family: Family; reason: string; ambiguous: boolean; reportId: string | null };

export type GiftLineIn = {
  id: string;
  postedOn: string;
  amountCents: number;
  description: string;
  payerName: string | null;
  originatorKind: string | null;
  suggestions: SuggestionIn[];
  suggestionError: string | null;
};

export type DepositCandidateIn = {
  paymentId: string;
  receipt: string | null;
  method: string;
  amountCents: number;
  receivedOn: string;
  checkNumber: string | null;
  /** The family's card when the person may read the payment; otherwise the name the bank screen shows, with the receipt. */
  family: Family | null;
  householdName: string | null;
};

export type DepositLineIn = { id: string; postedOn: string; amountCents: number; description: string; candidates: DepositCandidateIn[]; exact: boolean; error: string | null };

export type BankTotals = { lines: number; deposits: number; zelleUnseen: number };

/** `problems`: a part of the bank queue that could not be read (the rest still shows). */
export type BankIn = { totals: BankTotals; exact: ExactPairIn[] | null; gifts: GiftLineIn[]; deposits: DepositLineIn[]; problems: string[] };

export type BehindIn = {
  householdsBehind: number;
  totalOpenCents: number;
  showing: { family: Family; pledges: number; openCents: number; oldestDays: number }[];
};

export type ApplyIn = { paymentId: string; receipt: string | null; receivedOn: string; amountCents: number; unappliedCents: number; method: string; family: Family };
/** The oldest payments to apply, and how many more wait beyond them. */
export type ApplyListIn = { list: ApplyIn[]; more: number };

export type CountIn = { id: string; countedOn: string; totalCents: number | null; bags: string[]; counters: string[] };

export type CloseIn = {
  month: string;
  label: string;
  locked: boolean;
  done: string[];
  blockers: { item: string; why: string; key: string | null }[];
  /** Checks the data proved, with what was checked (shown on the ticked line). */
  proven?: { item: string; why: string }[];
};

/** QuickBooks customers with a suggested household (src/lib/data/books-donors.ts). */
export type DonorMatchIn = { matchId: string; qboName: string; how: string; family: Family };
export type DonorMatchesIn = { canApprove: boolean; customers: number; several: number; shown: DonorMatchIn[]; more: number };

/** Year-end statements waiting for review (src/lib/giving-statements/review.ts statementSeason). */
export type StatementsDueIn = { year: number; households: number; needFix: number; sentence: string };

export type TodayInput = {
  /** Home's task list, the Giving sources only (GIVING_TASK_SOURCES), and the sources that could not be read. */
  tasks: HomeTask[];
  taskFailures: { source: string; tag: string; message: string }[];
  families: Record<string, Family>;
  /** null: not shown to this person (no access, module off). */
  bank: Part<BankIn> | null;
  behind: Part<BehindIn> | null;
  apply: Part<ApplyListIn> | null;
  counts: Part<CountIn[]> | null;
  close: Part<CloseIn> | null;
  /** Last year's statements, January to March only (slice 8); left out, or null, the rest of the year and for whoever cannot see them. */
  statements?: Part<StatementsDueIn> | null;
  /** QuickBooks donor matches (Books); left out when the accounting module is off or the person cannot see them. */
  donors?: Part<DonorMatchesIn> | null;
  /** DonorDelight (module `care`): left out, or null, for whoever holds no care key. */
  care?: Part<CareTodayIn> | null;
};

/** What the person may do (UI convenience: the database refuses the rest anyway). */
export type TodayCan = {
  approve: boolean;
  manage: boolean;
  bankConfirm: boolean;
  allocate: boolean;
  countRecord: boolean;
  closeManage: boolean;
  /** Match a count to its bank deposit line (giving.record_offline or giving.manage, Bank reconciliation on; slice 5). */
  countMatch?: boolean;
};

export type TodayContext = {
  can: TodayCan;
  currency: string;
  locale: string;
  timeZone: string;
  today: string;
  labels: CardLabels;
  /** The kind's word for the counts tile ("Cash counts", "Offering counts", "Collection counts", "Bhandar counts"). */
  countsWord: string;
  /** The Zelle plugin's name. */
  zelleWord: string;
  /** PayPal is connected by its Business email only: an approved PayPal refund is made in PayPal and recorded by hand. */
  paypalEmailOnly?: boolean;
  /** Which groups this person sees at all (a tile per group, even when nothing waits). */
  visible: Record<Exclude<GroupKey, "care">, boolean> & { care?: boolean };
  /** The kind's word for DonorDelight ("Donor care", "Member care"); "Care" when left out. */
  careWord?: string;
};

// ---------------------------------------------------------------------------- What the page draws

/** `ambiguous`: several families could be this payer, so the person ticks that they checked the details before confirming. */
export type SuggestionView = { family: Family; reason: string; reportId: string | null; label: string; ambiguous: boolean };
export type DepositCandidateView = DepositCandidateIn & { amount: string; line: string };
export type BehindView = { family: Family; open: string; line: string };
export type CloseItemView = { text: string; why: string | null; done: boolean; key: string | null };
export type ZellePairView = { reportId: string; bankTransactionId: string; amountCents: number; family: Family | null; line: string };

export type Act =
  | { kind: "approve"; table: "payments" | "pledges"; id: string; label: string; what: string; done: string }
  | { kind: "flagged"; id: string; stage: "first" | "second"; label: string; what: string }
  | { kind: "credit"; id: string; label: string; what: string; done: string }
  | { kind: "complete_write_off"; id: string; label: string; what: string }
  | { kind: "record_refund"; id: string; amountCents: number; label: string; what: string; familyRef: string }
  | { kind: "zelle_exact"; pairs: ZellePairView[] }
  | { kind: "gift"; txnId: string; amountCents: number; best: SuggestionView | null; others: SuggestionView[]; learnPayer: boolean; payerName: string | null }
  | { kind: "deposit"; txnId: string; amountCents: number; candidates: DepositCandidateView[]; exact: boolean; label: string }
  | { kind: "behind"; households: BehindView[] }
  /** `button`: the trigger's words ("Record the deposit" when left out); `secondary`: a ghost button next to Match its deposit. */
  | { kind: "count_deposit"; id: string; totalCents: number | null; label: string; what: string; button?: string; secondary?: boolean }
  /** Offering counts (slice 5): match a count to the bank line of exactly its amount; a treasurer undoes a wrong match. */
  | { kind: "count_match"; id: string; totalCents: number; countedOn: string; label: string; what: string }
  | { kind: "count_unmatch"; id: string; totalCents: number; label: string; what: string }
  | { kind: "apply"; paymentId: string; householdId: string; label: string; what: string }
  | { kind: "close"; month: string; items: CloseItemView[]; canMark: boolean }
  | { kind: "qbo_match"; matchId: string; qboName: string; label: string }
  | { kind: "link"; href: string; label: string; primary?: boolean }
  /** Record payment for this family: the sheet in place (slice 2), `href` (the Record payment screen) where no sheet can open. */
  | { kind: "record_payment"; householdId: string; href: string; label: string }
  // Pledges and Payments (slice 3): the same sheets, one pledge or one payment at a time.
  | { kind: "request_write_off"; id: string; openCents: number; reference: string; label: string }
  | { kind: "withdraw_write_off"; id: string; reference: string; label: string }
  /** Every pledge has a due date (0775): a treasurer moves an open pledge's, with a reason. `pledgedOn` is the earliest it may be. */
  /** Edit or delete one pledge (0782, giving.manage): the Edit pledge sheet in place, with the database's own locks. */
  | { kind: "edit_pledge"; id: string; reference: string; label: string }
  /** Print the pledge as an invoice-style PDF (0791): giving.view or giving.manage. */
  | { kind: "print_pledge"; id: string; reference: string; label: string }
  /** Email the pledge, with its PDF attached, to the primary member or any address typed (0792): giving.manage. */
  | { kind: "email_pledge"; id: string; reference: string; label: string }
  | { kind: "change_due"; id: string; reference: string; dueOn: string | null; pledgedOn: string; label: string }
  | { kind: "request_refund"; id: string; refundableCents: number; reference: string; label: string }
  | { kind: "provider_refund"; id: string; amountCents: number; provider: "stripe" | "paypal"; reference: string; label: string; what: string }
  | { kind: "paypal_refund"; id: string; amountCents: number; reason: string | null; reference: string; label: string; what: string }
  | {
      kind: "grant_match";
      txnId: string;
      amountCents: number;
      reference: string;
      /** Who sent it, as the bank wrote it (a fund sponsor or an employer, never the family). */
      source: string;
      grant: "daf" | "matching_gift" | "payroll_giving";
      postedOn: string;
      memo: string;
      label: string;
    };

export type RowTone = "blue" | "sun" | "green" | "indigo" | "plain";
export type RowIcon = "approve" | "refund" | "bank" | "deposit" | "pledge" | "count" | "book" | "info" | "care";

export type QueueRow = {
  id: string;
  group: GroupKey;
  tone: RowTone;
  icon: RowIcon;
  title: string;
  lines: string[];
  family: Family | null;
  since: string | null;
  acts: Act[];
  /** How many waiting things the row stands for. */
  count: number;
  /** A count of what someone else acts on: it is not in the tile numbers. */
  info?: boolean;
};

export type Problem = { group: GroupKey; message: string };
export type Tile = { key: GroupKey | "all"; label: string; count: number };
export type TodayQueue = { rows: QueueRow[]; problems: Problem[]; tiles: Tile[]; total: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const APPROVAL_SOURCES = new Set(["refund", "payee", "writeoff", "credit"]);
const ONLINE_PROVIDER: Record<string, string> = { stripe: "Stripe", paypal: "PayPal" };
const GRANT_WORD: Record<string, string> = { daf: "Donor-advised fund grant", matching_gift: "Matching gift", payroll_giving: "Payroll giving" };

/** May this person act on this Giving task, or is it someone else's to do? */
export function canActOn(d: GivingTaskDetail, can: TodayCan): boolean {
  switch (d.kind) {
    case "refund":
    case "write_off":
      return d.stage === "second" ? can.approve && !d.mine : can.manage;
    case "flagged_refund":
      return d.stage === "first" ? can.manage : can.approve && !d.mine;
    case "credit":
      return can.manage;
    case "payee":
      return can.approve;
    default:
      return can.bankConfirm;
  }
}

function money(cents: number | null | undefined, ctx: Pick<TodayContext, "currency" | "locale">): string {
  return formatCents(cents ?? 0, ctx.currency, ctx.locale);
}

function since(value: string | null, ctx: TodayContext, word = "Waiting since"): string | null {
  return value ? `${word} ${formatDate(value, ctx.timeZone)}` : null;
}

function daysAgo(date: string, ctx: Pick<TodayContext, "today">): number {
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${ctx.today}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.round((b - a) / 86_400_000)) : 0;
}

function openFamily(f: Family | null): Act[] {
  return f ? [{ kind: "link", href: `/households/${f.id}`, label: "Open family" }] : [];
}

// ---------------------------------------------------------------------------- Refunds, shared with Payments

const PROVIDER_NAME: Record<"stripe" | "paypal", string> = { stripe: "Stripe", paypal: "PayPal" };

/**
 * The act that records a refund two people approved, the same on Today and in Payments: by hand for an offline or bank payment;
 * through Stripe or PayPal for an online one (the database asks for a fresh code); by hand after refunding in PayPal when PayPal is
 * connected by email only. null for a provider Weaver cannot refund from here.
 */
export function recordRefundAct(
  r: { id: string; provider: string | null; amountCents: number; reference: string; reason: string | null },
  fam: string,
  money: string,
  paypalEmailOnly: boolean,
): Act | null {
  if (r.provider === "offline" || r.provider === "bank") {
    return {
      kind: "record_refund",
      id: r.id,
      amountCents: r.amountCents,
      label: `Record ${money} refund for ${fam}`,
      what: `Records the refund on ${r.reference}. This cannot be undone here. A mistake is fixed with a refund that a second person approves.`,
      familyRef: fam,
    };
  }
  if (r.provider === "paypal" && paypalEmailOnly) {
    return {
      kind: "paypal_refund",
      id: r.id,
      amountCents: r.amountCents,
      reason: r.reason,
      reference: r.reference,
      label: `Record ${money} PayPal refund for ${fam}`,
      what: "This PayPal account is connected by email only, so Weaver cannot refund through it. Refund it in PayPal first, then record it here with PayPal's transaction id. This cannot be undone here.",
    };
  }
  if (r.provider === "stripe" || r.provider === "paypal") {
    const name = PROVIDER_NAME[r.provider];
    return {
      kind: "provider_refund",
      id: r.id,
      amountCents: r.amountCents,
      provider: r.provider,
      reference: r.reference,
      label: `Refund ${money} to ${fam} through ${name}`,
      what: `${name} sends the money back to the card or account that paid. The refund shows on ${r.reference} once ${name} accepts it. This cannot be undone here.`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------- Approvals

function approvalRow(t: HomeTask, d: GivingTaskDetail, ctx: TodayContext, input: TodayInput): QueueRow {
  const family = d.householdId ? (input.families[d.householdId] ?? null) : null;
  const fam = familyRef(family);
  const amt = money(d.amountCents, ctx);
  const asked = d.askedBy ?? "a colleague";
  const reason = d.reason ? `Reason: “${d.reason}”` : "No reason was written down. Ask the person who requested it.";
  const base = { id: t.id, group: "approvals" as const, family, since: since(d.since, ctx), count: 1 };
  const ref = d.reference ?? (d.kind === "write_off" ? "the pledge" : "the payment");
  if (d.kind === "refund" && d.stage === "second") {
    return {
      ...base,
      tone: "sun",
      icon: "refund",
      title: `Refund of ${amt} waiting for a second approver`,
      lines: [`Receipt ${ref} · asked by ${asked}`, reason],
      acts: [
        {
          kind: "approve",
          table: "payments",
          id: d.id,
          label: `Approve ${amt} refund for ${fam}`,
          what: `You are the second approver. ${asked} then records the refund on ${ref}. This cannot be undone here.`,
          done: `Done: second approval recorded for the ${amt} refund on ${ref} (${fam}).`,
        },
        ...openFamily(family),
      ],
    };
  }
  if (d.kind === "write_off" && d.stage === "second") {
    return {
      ...base,
      tone: "sun",
      icon: "approve",
      title: `Write-off of ${amt} waiting for a second approver`,
      lines: [`Pledge ${ref} · asked by ${asked}`, reason],
      acts: [
        {
          kind: "approve",
          table: "pledges",
          id: d.id,
          label: `Approve ${amt} write-off for ${fam}`,
          what: `You are the second approver. A treasurer then completes the write-off, and ${ref} stops counting as owed. This cannot be undone here.`,
          done: `Done: second approval recorded for the ${amt} write-off of ${ref} (${fam}).`,
        },
        ...openFamily(family),
      ],
    };
  }
  if (d.kind === "flagged_refund") {
    const provider = ONLINE_PROVIDER[d.provider ?? ""] ?? "the card provider";
    const first = d.stage === "first";
    return {
      ...base,
      tone: "sun",
      icon: "refund",
      title: `Refund of ${amt} made in ${provider} on receipt ${ref}`,
      lines: [
        first ? "Weaver did not record it. Nothing changes on the payment until two different people approve it." : `Approved first by ${asked}. A second, different person approves it.`,
      ],
      acts: [
        {
          kind: "flagged",
          id: d.id,
          stage: first ? "first" : "second",
          label: first ? `Approve ${amt} card refund for ${fam} (first approval)` : `Approve ${amt} card refund for ${fam} as second person`,
          what: first
            ? "Your approval and reason are kept in the audit log. A different person with approval rights approves it second; only then is the refund recorded on the payment."
            : "The refund is recorded on the payment from now on. This cannot be undone here.",
        },
        ...openFamily(family),
      ],
    };
  }
  if (d.kind === "refund") {
    const online = d.provider !== "offline" && d.provider !== "bank";
    // Recorded in place for every provider Weaver can refund (slice 3); any other provider is refunded on its own screen.
    const act = recordRefundAct({ id: d.id, provider: d.provider, amountCents: d.amountCents ?? 0, reference: ref, reason: d.reason }, fam, amt, ctx.paypalEmailOnly ?? false);
    return {
      ...base,
      tone: "green",
      icon: "refund",
      title: `Ready to record: refund of ${amt}`,
      lines: [
        `Receipt ${ref} · approved by two people (${asked} asked)`,
        ...(online ? ["Card and online payments are refunded through the payment provider."] : []),
      ],
      acts: act
        ? [act, ...openFamily(family)]
        : [{ kind: "link", href: `/giving/payments?view=refunds&q=${encodeURIComponent(d.reference ?? "")}`, label: "Refund in Payments", primary: true }, ...openFamily(family)],
    };
  }
  if (d.kind === "write_off") {
    return {
      ...base,
      tone: "green",
      icon: "approve",
      title: `Ready to complete: write off ${amt}`,
      lines: [`Pledge ${ref} · approved by two people (${asked} asked)`],
      acts: [
        {
          kind: "complete_write_off",
          id: d.id,
          label: `Write off ${amt} for ${fam}`,
          what: `${ref} stops counting as owed, and the write-off goes to the books. This cannot be undone here.`,
        },
        ...openFamily(family),
      ],
    };
  }
  if (d.kind === "credit") {
    return {
      ...base,
      tone: "indigo",
      icon: "pledge",
      title: `Credit of ${amt} to handle`,
      lines: ["The family cancelled a paid RSVP pledge and asked to keep the money as credit. Apply it to their open pledges or as they ask, then mark it handled."],
      acts: [
        {
          kind: "credit",
          id: d.id,
          label: `Mark ${amt} credit for ${fam} handled`,
          what: "Only confirm once you have applied it as the family asked.",
          done: `Done: the ${amt} credit for ${fam} is marked handled.`,
        },
        { kind: "link", href: family ? `/households/${family.id}?tab=pledges` : "/giving/pledges", label: "Open family" },
      ],
    };
  }
  // A change to where gifts go: decided on Settings › Payments, with its own checks.
  return {
    ...base,
    tone: "sun",
    icon: "approve",
    title: t.title,
    lines: [t.meta],
    acts: t.links.map((l) => ({ kind: "link" as const, href: l.href, label: l.label, primary: true })),
  };
}

function shortItem(d: GivingTaskDetail, ctx: TodayContext): string {
  const amt = money(d.amountCents, ctx);
  const ref = d.reference ? ` (${d.reference})` : "";
  if (d.kind === "write_off") return `Write-off of ${amt}${ref}`;
  if (d.kind === "flagged_refund") return `Card refund of ${amt}${ref}`;
  if (d.kind === "credit") return `Credit of ${amt}`;
  if (d.kind === "payee") return `Change to ${d.reference ?? "a payment way"}`;
  return `Refund of ${amt}${ref}`;
}

function approvalRows(input: TodayInput, ctx: TodayContext): QueueRow[] {
  const rows: QueueRow[] = [];
  const second: GivingTaskDetail[] = [];
  const first: GivingTaskDetail[] = [];
  const finish: GivingTaskDetail[] = [];
  for (const t of input.tasks) {
    const d = t.giving;
    if (!d || !APPROVAL_SOURCES.has(t.source)) continue;
    if (canActOn(d, ctx.can)) rows.push(approvalRow(t, d, ctx, input));
    else if (d.stage === "first") first.push(d);
    else if (d.stage === "second") second.push(d);
    else finish.push(d);
  }
  if (second.length > 0) {
    const mine = second.filter((d) => d.mine).length;
    rows.push({
      id: "approvals:second",
      group: "approvals",
      tone: "plain",
      icon: "info",
      title: `${second.length} waiting for the second approver`,
      lines: [
        second.map((d) => shortItem(d, ctx)).join(" · "),
        mine > 0
          ? `You asked for ${mine === second.length ? (mine === 1 ? "it" : "them") : `${mine} of them`}, so a different person with approval rights approves ${mine === 1 ? "it" : "them"}.`
          : "Only a different person with approval rights can approve them.",
      ],
      family: null,
      since: null,
      acts: [],
      count: second.length,
      info: true,
    });
  }
  if (first.length > 0) {
    rows.push({
      id: "approvals:first",
      group: "approvals",
      tone: "plain",
      icon: "info",
      title: `${plural(first.length, "card refund")} waiting for a treasurer's first approval`,
      lines: [first.map((d) => shortItem(d, ctx)).join(" · ")],
      family: null,
      since: null,
      acts: [],
      count: first.length,
      info: true,
    });
  }
  if (finish.length > 0) {
    rows.push({
      id: "approvals:finish",
      group: "approvals",
      tone: "plain",
      icon: "info",
      title: `${finish.length} approved, waiting for the treasurer to finish`,
      lines: [finish.map((d) => shortItem(d, ctx)).join(" · ")],
      family: null,
      since: null,
      acts: [],
      count: finish.length,
      info: true,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------- Bank

/** Home's bank counts, read from the same tasks Home shows ("12 bank lines to match", "2 Zelle reports not seen at the bank"). */
export function bankTotalsFromTasks(tasks: readonly HomeTask[]): BankTotals | null {
  const lines = tasks.find((t) => t.giving?.kind === "bank_lines")?.giving;
  const unseen = tasks.find((t) => t.giving?.kind === "zelle_unseen")?.giving;
  const hasSource = tasks.some((t) => t.source === "deposits");
  if (!hasSource && !lines && !unseen) return null;
  return { lines: lines?.count ?? 0, deposits: lines?.deposits ?? 0, zelleUnseen: unseen?.count ?? 0 };
}

function suggestionView(s: SuggestionIn, amountCents: number, ctx: Pick<TodayContext, "currency" | "locale">): SuggestionView {
  return { family: s.family, reason: s.reason, reportId: s.reportId, label: `Confirm ${money(amountCents, ctx)} for ${familyRef(s.family)}`, ambiguous: s.ambiguous };
}

/** What a bank row needs from its page: Today's queue and the Bank tab draw the same rows (docs/GIVING_REDESIGN.md slice 4). */
export type BankRowContext = Pick<TodayContext, "currency" | "locale" | "timeZone" | "today" | "zelleWord">;
/** `inBank`: the row is on the Bank tab itself, so it never links to the Bank tab. */
export type BankRowOptions = { inBank?: boolean };

/** One row for every Zelle report that matches a bank line exactly, each pair listed and ticked; null when there are none. */
export function zelleExactRow(exact: readonly ExactPairIn[], ctx: BankRowContext): QueueRow | null {
  if (exact.length === 0) return null;
  return {
    id: "bank:zelle-exact",
    group: "bank",
    tone: "blue",
    icon: "bank",
    title: `${plural(exact.length, `${ctx.zelleWord} report matches`, `${ctx.zelleWord} reports match`)} a bank line exactly`,
    lines: ["Same confirmation number, amount and dates, one report to one bank line. Each pair is checked again when you confirm."],
    family: null,
    since: null,
    acts: [
      {
        kind: "zelle_exact",
        pairs: exact.map((p) => ({
          reportId: p.reportId,
          bankTransactionId: p.bankTransactionId,
          amountCents: p.amountCents,
          family: p.family,
          line: [
            p.confirmation ? `Confirmation ${p.confirmation}` : "No confirmation number",
            `sent ${formatDate(p.sentOn, ctx.timeZone)}`,
            `bank line ${formatDate(p.postedOn, ctx.timeZone)}${p.payerName ? ` from ${p.payerName}` : ""}`,
          ].join(" · "),
        })),
      },
    ],
    count: exact.length,
  };
}

/** A gift line (Zelle, ACH, a fund grant): one click on a clear suggestion, otherwise the family is chosen or found in the sheet. */
export function giftRow(g: GiftLineIn, ctx: BankRowContext): QueueRow {
  const amt = money(g.amountCents, ctx);
  const kindWord = g.originatorKind ? GRANT_WORD[g.originatorKind] : undefined;
  const best = g.suggestions[0] && !g.suggestions[0].ambiguous ? g.suggestions[0] : null;
  const others = g.suggestions.filter((s) => s !== best).map((s) => suggestionView(s, g.amountCents, ctx));
  const noun = kindWord ?? "Bank gift";
  const lines = [g.description];
  if (g.suggestionError) lines.push(g.suggestionError);
  else if (best) lines.push(best.reason);
  else lines.push(g.suggestions.length > 0 ? "More than one family could be this payer. Choose the right one." : "No family matched this payer name. Find the family.");
  return {
    id: `bank:gift:${g.id}`,
    group: "bank",
    tone: best ? "blue" : "indigo",
    icon: "bank",
    title: best ? `${noun} ${amt}: best match found` : `${noun} ${amt}: choose the family`,
    lines,
    family: best ? best.family : null,
    since: `Posted ${formatDate(g.postedOn, ctx.timeZone)} · ${plural(daysAgo(g.postedOn, ctx), "day")} waiting`,
    acts: [
      {
        kind: "gift",
        txnId: g.id,
        amountCents: g.amountCents,
        best: best ? suggestionView(best, g.amountCents, ctx) : null,
        others,
        // A fund or platform is not the family: its name is never learned as theirs (as on the Bank screen).
        learnPayer: g.originatorKind === null,
        payerName: g.payerName,
      },
    ],
    count: 1,
  };
}

/** A check-and-cash deposit: the recorded payments that add up are ticked in the sheet, confirmed with the amount on the button. */
export function depositRow(dl: DepositLineIn, ctx: BankRowContext, opts: BankRowOptions = {}): QueueRow {
  const amt = money(dl.amountCents, ctx);
  const n = dl.candidates.length;
  return {
    id: `bank:deposit:${dl.id}`,
    group: "bank",
    tone: "blue",
    icon: "deposit",
    title: dl.exact && n > 0 ? `Deposit ${amt}: ${plural(n, "recorded payment")} add up exactly` : `Deposit ${amt}: choose the payments in it`,
    lines: [dl.description, ...(dl.error ? [dl.error] : n === 0 ? ["No undeposited checks or cash recorded in the 3 weeks before this deposit."] : [])],
    family: null,
    since: `Posted ${formatDate(dl.postedOn, ctx.timeZone)} · ${plural(daysAgo(dl.postedOn, ctx), "day")} waiting`,
    acts:
      n > 0 && !dl.error
        ? [
            {
              kind: "deposit",
              txnId: dl.id,
              amountCents: dl.amountCents,
              exact: dl.exact,
              label: `Review deposit of ${amt}`,
              candidates: dl.candidates.map((c) => ({
                ...c,
                amount: money(c.amountCents, ctx),
                line: [
                  c.receipt ? `Receipt ${c.receipt}` : "No receipt number",
                  c.method,
                  c.checkNumber ? `check ${c.checkNumber}` : null,
                  `received ${formatDate(c.receivedOn, ctx.timeZone)}`,
                ]
                  .filter(Boolean)
                  .join(" · "),
              })),
            },
          ]
        : opts.inBank
          ? []
          : [{ kind: "link", href: "/giving/payments/bank?view=deposits", label: "Open deposits in Bank" }],
    count: 1,
  };
}

function bankRows(bank: BankIn, ctx: TodayContext): QueueRow[] {
  const { totals } = bank;
  const rows: QueueRow[] = [];
  if (!ctx.can.bankConfirm) {
    const n = totals.lines + totals.zelleUnseen;
    if (n === 0) return rows;
    return [
      {
        id: "bank:count",
        group: "bank",
        tone: "plain",
        icon: "info",
        title: `${plural(totals.lines, "bank line")} to match`,
        lines: [
          ...(totals.zelleUnseen > 0 ? [`${plural(totals.zelleUnseen, `${ctx.zelleWord} report`)} not seen at the bank.`] : []),
          "Matching bank lines needs the giving.record_offline or giving.manage permission.",
        ],
        family: null,
        since: null,
        acts: [{ kind: "link", href: "/giving/payments/bank", label: "Open Bank" }],
        count: n,
        info: true,
      },
    ];
  }
  const exact = bank.exact ?? [];
  const exactRow = zelleExactRow(exact, ctx);
  if (exactRow) rows.push(exactRow);
  for (const g of bank.gifts) rows.push(giftRow(g, ctx));
  for (const dl of bank.deposits) rows.push(depositRow(dl, ctx));
  const shown = exact.length + bank.gifts.length + bank.deposits.length;
  const more = Math.max(0, totals.lines - shown);
  if (more > 0) {
    rows.push({
      id: "bank:more",
      group: "bank",
      tone: "plain",
      icon: "bank",
      title: `${plural(more, "more bank line")} to match`,
      lines: ["The oldest are listed above; the rest wait on the Bank screen."],
      family: null,
      since: null,
      acts: [{ kind: "link", href: "/giving/payments/bank", label: "Open Bank" }],
      count: more,
    });
  }
  if (totals.zelleUnseen > 0) {
    rows.push({
      id: "bank:zelle-unseen",
      group: "bank",
      tone: "sun",
      icon: "bank",
      title: `${plural(totals.zelleUnseen, `${ctx.zelleWord} report`)} not seen at the bank`,
      lines: ["Reported by members, past the window with no matching bank line. The member was told to check the confirmation number."],
      family: null,
      since: null,
      acts: [{ kind: "link", href: "/giving/payments/bank?view=zelle", label: `Open ${ctx.zelleWord} reports` }],
      count: totals.zelleUnseen,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------- Pledges and payments

function behindRows(b: BehindIn, ctx: TodayContext): QueueRow[] {
  if (b.householdsBehind === 0) return [];
  const title = `${plural(b.householdsBehind, "household is", "households are")} behind on pledges`;
  if (!ctx.can.manage) {
    return [
      {
        id: "pledges:behind",
        group: "pledges",
        tone: "plain",
        icon: "info",
        title,
        lines: [`${money(b.totalOpenCents, ctx)} still open. A treasurer (giving.manage) follows them up and asks for write-offs.`],
        family: null,
        since: null,
        acts: [{ kind: "link", href: "/giving/pledges", label: "Open Pledges" }],
        count: b.householdsBehind,
        info: true,
      },
    ];
  }
  return [
    {
      id: "pledges:behind",
      group: "pledges",
      tone: "sun",
      icon: "pledge",
      title,
      lines: [
        `${money(b.totalOpenCents, ctx)} still open, the largest first${b.showing.length < b.householdsBehind ? ` (the first ${b.showing.length} here)` : ""}.`,
        "A write-off needs a reason, and a different person approves it.",
      ],
      family: null,
      since: null,
      acts: [
        {
          kind: "behind",
          households: b.showing.map((h) => ({
            family: h.family,
            open: money(h.openCents, ctx),
            line: `${plural(h.pledges, "pledge")} behind · the oldest ${plural(h.oldestDays, "day")} late`,
          })),
        },
        { kind: "link", href: "/giving/pledges", label: "Open Pledges" },
      ],
      count: b.householdsBehind,
    },
  ];
}

function applyRows({ list, more }: ApplyListIn, ctx: TodayContext): QueueRow[] {
  if (list.length === 0) return [];
  if (!ctx.can.allocate) {
    return [
      {
        id: "pledges:apply",
        group: "pledges",
        tone: "plain",
        icon: "info",
        title: `${plural(list.length + more, "payment")} recorded but not applied to a pledge`,
        lines: ["A treasurer (giving.manage) applies them to the family's open pledges."],
        family: null,
        since: null,
        acts: [],
        count: list.length + more,
        info: true,
      },
    ];
  }
  const rows: QueueRow[] = list.map((p) => {
    const amt = money(p.unappliedCents, ctx);
    return {
      id: `pledges:apply:${p.paymentId}`,
      group: "pledges" as const,
      tone: "indigo" as const,
      icon: "pledge" as const,
      title: `Recorded but not applied: ${amt}`,
      lines: [`Receipt ${p.receipt ?? "pending"} · ${p.method} · ${money(p.amountCents, ctx)} in all`, "The family has an open pledge."],
      family: p.family,
      since: since(p.receivedOn, ctx, "Received"),
      acts: [
        {
          kind: "apply" as const,
          paymentId: p.paymentId,
          householdId: p.family.id,
          label: `Apply ${amt} to the open pledges of ${familyRef(p.family)}`,
          what: "Applies it to the family's oldest open pledge first; whatever is left stays recorded but not applied. It moves no money.",
        },
        ...openFamily(p.family),
      ],
      count: 1,
    };
  });
  if (more > 0) {
    rows.push({
      id: "pledges:apply-more",
      group: "pledges",
      tone: "plain",
      icon: "pledge",
      title: `${plural(more, "more payment")} recorded but not applied`,
      lines: ["The oldest are listed above; the rest are on the Payments screen."],
      family: null,
      since: null,
      acts: [{ kind: "link", href: "/giving/payments", label: "Open Payments" }],
      count: more,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------- Counts and books

function countRows(list: CountIn[], ctx: TodayContext): QueueRow[] {
  if (list.length === 0) return [];
  if (!ctx.can.countRecord) {
    return [
      {
        id: "counts:waiting",
        group: "counts",
        tone: "plain",
        icon: "info",
        title: `${plural(list.length, "count")} without a recorded deposit`,
        lines: ["A counter (giving.record_offline) records the deposit."],
        family: null,
        since: null,
        acts: [],
        count: list.length,
        info: true,
      },
    ];
  }
  return list.map((c) => {
    const date = formatDate(c.countedOn, ctx.timeZone);
    return {
      id: `counts:${c.id}`,
      group: "counts" as const,
      tone: "indigo" as const,
      icon: "count" as const,
      title: `Count of ${date}: deposit not recorded yet`,
      lines: [
        `${c.totalCents === null ? "No total yet" : `Counted ${money(c.totalCents, ctx)}`} · ${c.bags.length > 0 ? `bags ${c.bags.join(", ")}` : "no bag numbers"}`,
        c.counters.length > 0 ? `Counted by ${c.counters.join(" and ")}` : "No counters recorded",
      ],
      family: null,
      since: since(c.countedOn, ctx, "Counted"),
      acts: countActs(c, date, ctx),
      count: 1,
    };
  });
}

/**
 * A count waiting for its deposit (slice 5): with Bank reconciliation on, the counter picks the bank line of exactly the counted
 * amount; the slip reference ("Mark deposited") stays for a deposit that holds more than one count.
 */
function countActs(c: CountIn, date: string, ctx: TodayContext): Act[] {
  const mark: Act = {
    kind: "count_deposit",
    id: c.id,
    totalCents: c.totalCents,
    label: `Record the deposit for the ${date} count`,
    what: "Enter the deposit slip or reference, and the counted total if it is not saved yet.",
  };
  if (!ctx.can.countMatch || c.totalCents === null) return [mark];
  return [
    {
      kind: "count_match",
      id: c.id,
      totalCents: c.totalCents,
      countedOn: c.countedOn,
      label: `Match the ${date} count to its deposit`,
      what: MATCH_WHAT,
    },
    { ...mark, button: "Mark deposited", secondary: true },
  ];
}

function closeRows(c: CloseIn, ctx: TodayContext): QueueRow[] {
  if (c.locked || c.blockers.length === 0) return [];
  const total = c.done.length + c.blockers.length;
  const items: CloseItemView[] = [
    ...c.done.map((t) => ({ text: t, why: c.proven?.find((p) => p.item === t)?.why ?? null, done: true, key: null })),
    // The checklist's own hint for a manual item is "Mark done": the button says it already.
    ...c.blockers.map((b) => ({ text: b.item, why: b.why === "Mark done" ? null : b.why, done: false, key: b.key })),
  ];
  return [
    {
      id: "books:close",
      group: "books",
      tone: "plain",
      icon: "book",
      title: `${c.label} close: ${c.done.length} of ${plural(total, "check")}`,
      lines: [ctx.can.closeManage ? "Mark the checks that are yours once they are done; locking the month stays on Month-end close." : "A person with accounting.close marks these and locks the month."],
      family: null,
      since: null,
      acts: [{ kind: "close", month: c.month, items, canMark: ctx.can.closeManage }, { kind: "link", href: "/accounting/close", label: "Open month-end close" }],
      count: c.blockers.length,
      info: !ctx.can.closeManage,
    },
  ];
}

function bookTaskRows(tasks: HomeTask[]): QueueRow[] {
  return tasks
    .filter((t) => t.source === "quickbooks" || t.source === "mapping")
    .map((t) => ({
      id: t.id,
      group: "books" as const,
      tone: "sun" as const,
      icon: "book" as const,
      title: t.title,
      lines: [t.meta],
      family: null,
      since: null,
      acts: t.links.map((l) => ({ kind: "link" as const, href: l.href, label: l.label, primary: true })),
      count: 1,
    }));
}

/**
 * Payment proofs to verify (Approvals) and payments paid but not on the bank (Bank): one row each, a count that opens its own
 * screen. Home reads the same tasks, so the two cannot disagree about the number.
 */
function proofTaskRows(tasks: HomeTask[], source: "proofs" | "proofs_expiring" | "unbanked"): QueueRow[] {
  return tasks
    .filter((t) => t.source === source)
    .map((t) => ({
      id: t.id,
      group: source === "unbanked" ? ("bank" as const) : ("approvals" as const),
      tone: source === "unbanked" ? ("blue" as const) : ("sun" as const),
      icon: source === "unbanked" ? ("deposit" as const) : ("approve" as const),
      title: t.title,
      lines: [t.meta],
      family: null,
      since: null,
      acts: t.links.map((l) => ({ kind: "link" as const, href: l.href, label: source === "proofs" ? "Open confirmations" : source === "proofs_expiring" ? "Open storage settings" : "Open the list", primary: true })),
      count: t.giving?.count ?? 1,
    }));
}

/** "Year-end statements for 2026": Review and send opens the review sheet (section 2: three clicks; the send stays off). */
function statementRows(s: StatementsDueIn): QueueRow[] {
  if (s.households === 0) return [];
  return [
    {
      id: `statements:${s.year}`,
      group: "books",
      tone: "indigo",
      icon: "book",
      title: `Year-end statements for ${s.year}`,
      lines: [
        `${plural(s.households, "household")} gave in ${s.year}: ${s.sentence}.`,
        "Review them now; sending stays off until the statements service is connected.",
      ],
      family: null,
      since: null,
      acts: [{ kind: "link", href: `/giving/statements?year=${s.year}&review=1`, label: "Review and send", primary: true }],
      count: 1,
    },
  ];
}

function donorRows(d: DonorMatchesIn): QueueRow[] {
  if (d.customers === 0) return [];
  const books = { kind: "link" as const, href: "/accounting/close#donor-matching", label: "Review in Books" };
  if (!d.canApprove) {
    return [
      {
        id: "books:qbo-matches",
        group: "books",
        tone: "plain",
        icon: "info",
        title: `${plural(d.customers, "QuickBooks customer")} ${d.customers === 1 ? "has" : "have"} a suggested household`,
        lines: ["A person with accounting.manage approves them, each next to its household card."],
        family: null,
        since: null,
        acts: [books],
        count: d.customers,
        info: true,
      },
    ];
  }
  const rows: QueueRow[] = d.shown.map((m) => ({
    id: `books:qbo:${m.matchId}`,
    group: "books" as const,
    tone: "sun" as const,
    icon: "book" as const,
    title: `QuickBooks customer “${m.qboName}” looks like the ${familyRef(m.family)}`,
    lines: [`${m.how}. Approving links them and brings the customer's QuickBooks history in to the household; no money moves.`],
    family: m.family,
    since: null,
    acts: [
      { kind: "qbo_match" as const, matchId: m.matchId, qboName: m.qboName, label: `Approve: “${m.qboName}” is the ${familyRef(m.family)}` },
      { kind: "link" as const, href: "/accounting/qbo/matching", label: "Pick another or reject" },
    ],
    count: 1,
  }));
  const rest = d.customers - d.shown.length;
  if (rest > 0) {
    const several = d.several > 0 ? ` ${plural(d.several, "customer")} ${d.several === 1 ? "has" : "have"} more than one possible household.` : "";
    rows.push({
      id: "books:qbo-more",
      group: "books",
      tone: "plain",
      icon: "book",
      title: `${plural(rest, "more QuickBooks customer", "more QuickBooks customers")} with a suggested household`,
      lines: [`Each is approved next to its household card in Donor matching.${several}`],
      family: null,
      since: null,
      acts: [{ kind: "link", href: "/accounting/qbo/matching", label: "Open donor matching", primary: true }],
      count: rest,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------- DonorDelight

/** Signs shown one by one; the rest are one "more" row pointing at DonorDelight. */
export const CARE_SIGN_ROWS = 5;

function careFamily(h: WeakSign["household"]): Family {
  return { id: h.id, name: h.name, number: h.number, orgId: h.orgHouseholdId, primary: h.primaryMember, city: h.city };
}

/**
 * The Care group (DonorDelight): gifts waiting for a thank-you, then the households that are Cooling or At risk with every reason. A family is
 * shown by its household card, never by name alone, and only adults appear. Nothing here asks anyone for money: each row opens the Care card.
 */
export function careRows(c: CareTodayIn): QueueRow[] {
  const rows: QueueRow[] = [];
  const week = weekTaskCopy(c.week ?? null);
  if (week && c.week) {
    rows.push({
      id: "care:week",
      group: "care",
      tone: "blue",
      icon: "care",
      title: week.title,
      lines: [week.meta],
      family: null,
      since: null,
      acts: [{ kind: "link", href: "/care/week", label: "Open your week", primary: true }],
      count: c.week.tasks,
    });
  }
  const thanks = thanksTaskCopy(c.thanks);
  if (thanks && c.thanks) {
    rows.push({
      id: "care:thanks",
      group: "care",
      tone: "sun",
      icon: "care",
      title: thanks.title,
      lines: [thanks.meta],
      family: null,
      since: null,
      acts: [{ kind: "link", href: "/care/thanks", label: "Open the thank-yous", primary: true }],
      count: c.thanks.open,
    });
  }
  for (const s of c.signs.slice(0, CARE_SIGN_ROWS)) {
    rows.push({
      id: `care:sign:${s.household.id}`,
      group: "care",
      tone: s.level === "at_risk" ? "sun" : "plain",
      icon: "care",
      title: s.label,
      lines: [...s.reasons.slice(0, 3), s.owner ? `Relationship owner: ${s.owner}` : "Needs a relationship owner"],
      family: careFamily(s.household),
      since: null,
      acts: [{ kind: "link", href: `/households/${s.household.id}`, label: "Open the Care card", primary: true }],
      count: 1,
    });
  }
  const rest = c.signs.length - CARE_SIGN_ROWS;
  if (rest > 0 || (c.more && c.signs.length > 0)) {
    rows.push({
      id: "care:signs-more",
      group: "care",
      tone: "plain",
      icon: "care",
      title: rest > 0 ? `${plural(rest, "more household")} to look at` : "More households may be cooling",
      lines: [`${weakSignsLine(c.signs.length)}. The longest quiet are shown first; every household and its sign is in the DonorDelight list.`],
      family: null,
      since: null,
      acts: [{ kind: "link", href: "/care", label: "Open the list", primary: true }],
      count: Math.max(rest, 0),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------- The queue

const SOURCE_GROUP: Record<string, GroupKey> = {
  refund: "approvals",
  payee: "approvals",
  writeoff: "approvals",
  credit: "approvals",
  deposits: "bank",
  proofs: "approvals",
  proofs_expiring: "approvals",
  unbanked: "bank",
  quickbooks: "books",
  mapping: "books",
};

function partRows<T>(part: Part<T> | null, group: GroupKey, problems: Problem[], rows: (d: T) => QueueRow[]): QueueRow[] {
  if (!part || part.state === "no_access" || part.state === "off") return [];
  if (part.state === "error") {
    problems.push({ group, message: part.error });
    return [];
  }
  return rows(part.data);
}

export function groupLabel(g: GroupKey, ctx: Pick<TodayContext, "countsWord" | "careWord">): string {
  return { approvals: "Approvals", bank: "Bank", pledges: "Pledges", counts: ctx.countsWord, books: "Books", care: ctx.careWord ?? "Care" }[g];
}

/** The rows in the plan's order, the problems next to their group, and the tiles with what each holds for this person. */
export function buildQueue(input: TodayInput, ctx: TodayContext): TodayQueue {
  const problems: Problem[] = input.taskFailures
    .filter((f) => SOURCE_GROUP[f.source])
    .map((f) => ({ group: SOURCE_GROUP[f.source], message: `Could not load the ${f.tag.toLowerCase()} tasks: ${f.message.replace(/\.$/, "")}.` }));
  const rows: QueueRow[] = [
    ...approvalRows(input, ctx),
    ...proofTaskRows(input.tasks, "proofs"),
    ...proofTaskRows(input.tasks, "proofs_expiring"),
    ...partRows(input.bank, "bank", problems, (b) => {
      for (const m of b.problems) problems.push({ group: "bank", message: m });
      return bankRows(b, ctx);
    }),
    ...proofTaskRows(input.tasks, "unbanked"),
    ...partRows(input.behind, "pledges", problems, (b) => behindRows(b, ctx)),
    ...partRows(input.apply, "pledges", problems, (a) => applyRows(a, ctx)),
    ...partRows(input.counts, "counts", problems, (c) => countRows(c, ctx)),
    ...partRows(input.close, "books", problems, (c) => closeRows(c, ctx)),
    ...partRows(input.statements ?? null, "books", problems, statementRows),
    ...partRows(input.donors ?? null, "books", problems, donorRows),
    ...bookTaskRows(input.tasks),
    ...partRows(input.care ?? null, "care", problems, careRows),
  ];
  problems.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const tiles = queueTiles(rows, ctx, new Set());
  return { rows, problems, tiles, total: tiles[0].count };
}

/** Tile numbers: what the person can act on, by group; a row marked done no longer counts. */
export function queueTiles(rows: readonly QueueRow[], ctx: Pick<TodayContext, "countsWord" | "visible" | "careWord">, done: ReadonlySet<string>): Tile[] {
  const n = (g: GroupKey | "all") => rows.filter((r) => !r.info && !done.has(r.id) && (g === "all" || r.group === g)).reduce((a, r) => a + r.count, 0);
  const groups = GROUP_ORDER.filter((g) => ctx.visible[g] || rows.some((r) => r.group === g));
  return [{ key: "all", label: "Everything", count: n("all") }, ...groups.map((g) => ({ key: g, label: groupLabel(g, ctx), count: n(g) }))];
}

/** Every waiting thing a group's rows stand for, counts included (the check that Home and Today agree). */
export function groupTotal(rows: readonly QueueRow[], g: GroupKey): number {
  return rows.filter((r) => r.group === g).reduce((a, r) => a + r.count, 0);
}

export function isGroupKey(v: unknown): v is GroupKey {
  return typeof v === "string" && (GROUP_ORDER as readonly string[]).includes(v);
}

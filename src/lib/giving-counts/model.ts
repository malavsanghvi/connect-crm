// Giving › the counts tab (docs/GIVING_REDESIGN.md slice 5, backlog B93; owner decisions 2026-10-13). Pure: the loader
// (src/lib/data/giving-counts.ts), the dev preview, Today and the tests build the same rows from here.
//
// A count is the cash and checks from the offering box, counted by two adults from different households. It has no donor: the
// people it names are its counters, never a family's giving. Its deposit is matched by PICKING the bank line of exactly the
// counted amount when Bank reconciliation is on (app.link_count_to_bank_deposit, 0744), or marked deposited with the slip
// reference as before. Words come from the kind (countsWord); nothing here names a community.

import { addDays, daysBetween, formatDate } from "@/lib/dates";
import { countersProblem, monthDay } from "@/lib/giving";
import type { ListsCommon } from "@/lib/giving-lists/model";
import type { Chip, ListRow, Tone } from "@/lib/giving-lists/types";
import type { Act, Family } from "@/lib/giving-today/queue";
import { formatCents } from "@/lib/money";

/** What the person may do here (UI convenience: the database refuses the rest anyway). */
export type CountCan = {
  /** Start a count: giving.record_offline (counting_sessions write). */
  record: boolean;
  /** Match a count to its bank line: giving.record_offline or giving.manage, with Bank reconciliation on. */
  match: boolean;
  /** Undo a match: giving.manage, with Bank reconciliation on. */
  unmatch: boolean;
};

/** The bank line a count was matched to, as far as the person may read it (null: matched, the line not readable). */
export type LinkedLine = { id: string; postedOn: string; amountCents: number; account: string | null };

export type CountIn = {
  id: string;
  countedOn: string;
  /** 0 is how a count is saved before its total is known. */
  totalCents: number;
  bags: string[];
  /** The counters' names (adults; never a family's giving). */
  counters: string[];
  event: string | null;
  depositRef: string | null;
  paymentId: string | null;
  /** counting_sessions.bank_transaction_id is set. */
  matched: boolean;
  line: LinkedLine | null;
};

export type CountRowContext = { currency: string; locale: string; timeZone: string; today: string; can: CountCan; bankOn: boolean };

export type CountView = "all" | "waiting" | "deposited";

export function countViewFromParam(value: string | undefined): CountView {
  return value === "waiting" || value === "deposited" ? value : "all";
}

export function countChips(active: CountView, counts: Partial<Record<CountView, number | null>>, hrefFor: (v: CountView) => string): Chip[] {
  const views: { key: CountView; label: string }[] = [
    { key: "all", label: "All counts" },
    { key: "waiting", label: "Waiting for the deposit" },
    { key: "deposited", label: "Deposited" },
  ];
  return views.map((v) => ({ key: v.key, label: v.label, href: hrefFor(v.key), count: counts[v.key] ?? null, on: v.key === active }));
}

/** Deposited: matched to its bank line, marked with a slip reference, or posted as a payment (0003's payment_id). */
export function isDeposited(c: Pick<CountIn, "matched" | "depositRef" | "paymentId">): boolean {
  return c.matched || c.depositRef !== null || c.paymentId !== null;
}

export function countStatus(c: Pick<CountIn, "matched" | "depositRef" | "paymentId" | "totalCents" | "countedOn">, today: string): { label: string; tone: Tone } {
  if (c.matched) return { label: "Matched to the bank", tone: "ok" };
  if (c.depositRef || c.paymentId) return { label: "Deposited", tone: "ok" };
  if (c.totalCents > 0) return { label: "Counted · waiting for the deposit", tone: "warn" };
  if (c.countedOn > today) return { label: "Planned", tone: "info" };
  return { label: "Not counted yet", tone: "warn" };
}

export function countersLine(names: readonly string[]): string {
  return names.length > 0 ? `Counted by ${names.join(" and ")}` : "No counters recorded";
}

/** "Bank deposit of Oct 7, 2026 · $412.50 · Operating ••1530". */
export function linkedLine(line: LinkedLine | null, ctx: Pick<CountRowContext, "currency" | "locale" | "timeZone">): string {
  if (!line) return "Matched to a bank deposit";
  return [`Bank deposit of ${formatDate(line.postedOn, ctx.timeZone)}`, formatCents(line.amountCents, ctx.currency, ctx.locale), line.account].filter(Boolean).join(" · ");
}

export const MATCH_WHAT = "Pick the bank deposit of exactly the counted amount. The bank line is marked matched; nothing is posted to the books.";
export const MATCH_UNDO = "This cannot be undone here. A treasurer can undo a wrong match, with a reason that is kept in the audit trail.";

/** One count as a row of the counts tab: the buttons its state asks for on the row, the rest in its menu. */
export function countRow(c: CountIn, ctx: CountRowContext): ListRow {
  const money = (n: number) => formatCents(n, ctx.currency, ctx.locale);
  const reference = c.bags.length > 0 ? `Bags ${c.bags.join(", ")}` : `Count ${c.id.slice(0, 4).toUpperCase()}`;
  const date = formatDate(c.countedOn, ctx.timeZone);
  const deposited = isDeposited(c);
  const lines = [
    countersLine(c.counters),
    ...(c.event ? [`At ${c.event}`] : []),
    ...(c.matched ? [linkedLine(c.line, ctx)] : []),
    ...(c.depositRef ? [`Deposit slip ${c.depositRef}`] : []),
  ];
  const canMatch = ctx.can.match && ctx.bankOn && !c.matched && c.totalCents > 0;
  const match: Act[] = canMatch
    ? [{ kind: "count_match", id: c.id, totalCents: c.totalCents, countedOn: c.countedOn, label: `Match the ${date} count to its deposit`, what: MATCH_WHAT }]
    : [];
  const mark: Act[] =
    ctx.can.record && !deposited
      ? [
          {
            kind: "count_deposit",
            id: c.id,
            totalCents: c.totalCents > 0 ? c.totalCents : null,
            label: `Mark the ${date} count deposited`,
            what: "Write the deposit slip number once the bags are at the bank, and the counted total if it is not saved yet.",
            button: "Mark deposited",
          },
        ]
      : [];
  const unmatch: Act[] =
    c.matched && ctx.can.unmatch && ctx.bankOn
      ? [{ kind: "count_unmatch", id: c.id, totalCents: c.totalCents, label: `Undo the deposit match of the ${date} count`, what: "The count goes back to waiting for its deposit." }]
      : [];
  // With Bank reconciliation on, picking the line is the way; the slip reference stays in the menu for a mixed deposit.
  const primary = canMatch ? match : mark;
  const menu = canMatch ? [...mark, ...unmatch] : unmatch;
  return {
    id: c.id,
    reference,
    family: null,
    title: `${reference} · ${c.totalCents > 0 ? money(c.totalCents) : "not counted yet"}`,
    lines,
    amount: c.totalCents > 0 ? money(c.totalCents) : "—",
    amountNote: null,
    date: monthDay(c.countedOn),
    status: countStatus(c, ctx.today),
    note: null,
    found: null,
    primary,
    menu,
    history: null,
  };
}

// ---------------------------------------------------------------------------- Counters

/** A person who may count: an adult with a login in the community, with their household card when they have a household. */
export type CounterChoice = { userId: string; name: string; householdId: string | null; family: Family | null };

/** The counters to fill in: the last count's, while they can still count, at most three. */
export function lastCounters(last: readonly string[] | null, options: readonly CounterChoice[]): string[] {
  if (!last) return [];
  const can = new Set(options.map((o) => o.userId));
  return [...new Set(last)].filter((u) => can.has(u)).slice(0, 3);
}

/** The check the sheet shows while counters are picked: the database refuses the same (0016's trigger). */
export function counterCheck(picked: readonly CounterChoice[]): { problem: string | null; differentHouseholds: boolean | null } {
  if (picked.length < 2) return { problem: "Choose at least two counters.", differentHouseholds: null };
  const problem = countersProblem(picked.map((p) => ({ userId: p.userId, householdId: p.householdId })));
  return { problem, differentHouseholds: problem === null };
}

// ---------------------------------------------------------------------------- Picking the deposit line

/** How far from the counting day a deposit line is looked for. */
export const DEPOSIT_WINDOW = { before: 3, after: 45 } as const;

export function depositWindow(countedOn: string): { from: string; to: string } {
  return { from: addDays(countedOn, -DEPOSIT_WINDOW.before), to: addDays(countedOn, DEPOSIT_WINDOW.after) };
}

export type BankLineIn = {
  id: string;
  postedOn: string;
  amountCents: number;
  description: string;
  account: string | null;
  status: string;
  /** Already matched to another count. */
  taken: boolean;
};

export type DepositChoice = { id: string; postedOn: string; amountCents: number; description: string; account: string | null; label: string; days: number };

/**
 * The lines a count can be matched to: money in, of EXACTLY the counted amount (owner, 2026-10-13), not matched to anything
 * yet, nearest the counting day first.
 */
export function depositChoices(
  count: { countedOn: string; totalCents: number },
  lines: readonly BankLineIn[],
  ctx: Pick<CountRowContext, "currency" | "locale" | "timeZone">,
): DepositChoice[] {
  if (count.totalCents <= 0) return [];
  return lines
    .filter((l) => l.amountCents === count.totalCents && (l.status === "unmatched" || l.status === "suggested") && !l.taken)
    .map((l) => ({
      id: l.id,
      postedOn: l.postedOn,
      amountCents: l.amountCents,
      description: l.description,
      account: l.account,
      days: daysBetween(count.countedOn, l.postedOn),
      label: [formatDate(l.postedOn, ctx.timeZone), formatCents(l.amountCents, ctx.currency, ctx.locale), l.account].filter(Boolean).join(" · "),
    }))
    .sort((a, b) => Math.abs(a.days) - Math.abs(b.days) || a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id));
}

/** The line chosen when the sheet opens: only when exactly one line fits. Two or more, the person picks. */
export function preselectDeposit(choices: readonly DepositChoice[]): string | null {
  return choices.length === 1 ? choices[0].id : null;
}

export function noDepositText(count: { countedOn: string; totalCents: number }, ctx: Pick<CountRowContext, "currency" | "locale" | "timeZone">): string {
  return `No bank line of exactly ${formatCents(count.totalCents, ctx.currency, ctx.locale)} near ${formatDate(count.countedOn, ctx.timeZone)} is waiting. Import the statement on the Bank tab, or use Mark deposited for a deposit that holds more than this count.`;
}

/** The button that matches: it names the amount and the deposit (section 5.1). */
export function matchButton(choice: DepositChoice | null, ctx: Pick<CountRowContext, "currency" | "locale" | "timeZone">): string {
  if (!choice) return "Pick the deposit first";
  return `Match ${formatCents(choice.amountCents, ctx.currency, ctx.locale)} to the ${formatDate(choice.postedOn, ctx.timeZone)} deposit`;
}

// ---------------------------------------------------------------------------- On the Bank tab

/** A count as the Bank tab's Deposits view shows it next to the line it was matched to (read-only). */
export type LinkedCount = { id: string; countedOn: string; totalCents: number; bags: string[]; label: string };

/** "Count of Oct 5, 2026 · $412.50 · bags 118, 119". */
export function linkedCountLabel(
  c: { countedOn: string; totalCents: number; bags: readonly string[] },
  ctx: Pick<CountRowContext, "currency" | "locale" | "timeZone">,
): string {
  return [`Count of ${formatDate(c.countedOn, ctx.timeZone)}`, formatCents(c.totalCents, ctx.currency, ctx.locale), c.bags.length > 0 ? `bags ${c.bags.join(", ")}` : null]
    .filter(Boolean)
    .join(" · ");
}

// ---------------------------------------------------------------------------- The page

export type CountsModel = ListsCommon & {
  view: CountView;
  chips: Chip[];
  can: CountCan;
  bankOn: boolean;
  countsWord: string;
  /** "3 counts waiting for the deposit · $1,240.00". */
  summary: string | null;
};

export function countsSummary(waiting: number | null, waitingCents: number | null, ctx: Pick<CountRowContext, "currency" | "locale">): string | null {
  if (waiting === null) return null;
  if (waiting === 0) return "Every count is deposited.";
  const word = waiting === 1 ? "1 count" : `${waiting.toLocaleString("en-US")} counts`;
  return `${word} waiting for the deposit${waitingCents ? ` · ${formatCents(waitingCents, ctx.currency, ctx.locale)}` : ""}`;
}


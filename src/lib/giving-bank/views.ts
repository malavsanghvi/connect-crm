// Giving › Bank in the New look (docs/GIVING_REDESIGN.md section 4, slice 4). Pure: no React, no database. Five views:
//   To match (Zelle exact matches, then gift lines with their suggested family) · Deposits (the checks and cash that add up are
//   ticked) · Zelle (the exact matches, then the rest report by report) · Card payouts (the provider's side and the bank's side in
//   one row with the difference; only with the Accounting module, which owns payouts) · History (matched, ignored, money out).
// The To match, Deposits and Zelle rows are Today's own rows (giftRow, depositRow, zelleExactRow), so they look and act the same.
//
// Card payouts: the row pairs a provider payout with its bank line by date, one to one, and says so ("Paired by date"). Slice 9
// (0747): the treasurer confirms the pair with "Explain and accept" (a typed reason when the amounts differ); the bank line then
// names the payout (payout_id), the row says "Paired" with the reason, and it can be undone until the month is locked.

import type { CardLabels } from "@/components/household-card";
import { formatDate } from "@/lib/dates";
import type { ExportOffer, ListBody } from "@/lib/giving-lists/model";
import type { Chip } from "@/lib/giving-lists/types";
import {
  depositRow,
  familyRef,
  giftRow,
  zelleExactRow,
  type BankRowContext,
  type DepositLineIn,
  type ExactPairIn,
  type Family,
  type GiftLineIn,
  type QueueRow,
} from "@/lib/giving-today/queue";
import type { GivingTab } from "@/lib/giving-today/tabs";
import { acceptLabel, differenceSentence, reasonLabel } from "@/lib/giving-payouts/explain";
import type { UnbankedModel } from "@/lib/data/giving-reconcile";
import { formatCents } from "@/lib/money";
import type { ReportQueue } from "@/lib/payments/zelle";

export const BANK_PAGE_SIZE = 20;
/** A provider payout and a bank line are paired when the bank line is posted within this many days of the payout's arrival. */
export const PAYOUT_WINDOW_DAYS = 3;
/** Card payouts look back this far (the bank keeps a payout line as "payout" for good: it is never matched to a family). */
export const PAYOUT_LOOKBACK_DAYS = 90;

// reconcile: the preview of the whole statement (0868); unbanked: payments counted as paid that no bank line has banked.
export type BankViewKey = "match" | "reconcile" | "deposits" | "zelle" | "payouts" | "unbanked" | "history";
export type HistoryKey = "matched" | "ignored" | "out";

/** Which views exist for this community: Zelle with the Zelle payment method, Card payouts with the Accounting module. */
export type BankViewsOn = { zelle: boolean; payouts: boolean };

export function bankViewKeys(on: BankViewsOn): BankViewKey[] {
  return ["match", "reconcile", "deposits", ...(on.zelle ? (["zelle"] as const) : []), ...(on.payouts ? (["payouts"] as const) : []), "unbanked", "history"];
}

const HISTORY_ALIASES: Record<string, HistoryKey> = { matched: "matched", ignored: "ignored", out: "out", debits: "out" };

/**
 * The view an address asks for. The classic screen's names still land in the right place (gifts → To match, debits, matched and
 * ignored → History), and a view that is not shown here (Zelle without Zelle, payouts without Accounting) falls back to To match.
 */
export function bankViewFromParam(view: string | undefined, show: string | undefined, on: BankViewsOn): { view: BankViewKey; history: HistoryKey } {
  const keys = bankViewKeys(on);
  const historyAlias = view ? HISTORY_ALIASES[view] : undefined;
  if (historyAlias) return { view: "history", history: historyAlias };
  const history = (show && HISTORY_ALIASES[show]) || "matched";
  if (view === "gifts") return { view: "match", history };
  const v = keys.find((k) => k === view);
  return { view: v ?? "match", history };
}

export function bankViewLabel(key: BankViewKey, zelleWord: string): string {
  return { match: "To match", reconcile: "Reconcile", deposits: "Deposits", zelle: zelleWord, payouts: "Card payouts", unbanked: "Unbanked", history: "History" }[key];
}

export function bankViewChips(
  on: BankViewsOn,
  counts: Partial<Record<BankViewKey, number | null>>,
  active: BankViewKey,
  zelleWord: string,
  hrefFor: (view: BankViewKey) => string,
): Chip[] {
  return bankViewKeys(on).map((k) => ({ key: k, label: bankViewLabel(k, zelleWord), href: hrefFor(k), count: counts[k] ?? null, on: k === active }));
}

export function historyChips(counts: Partial<Record<HistoryKey, number | null>>, active: HistoryKey, hrefFor: (h: HistoryKey) => string): Chip[] {
  const items: { key: HistoryKey; label: string }[] = [
    { key: "matched", label: "Matched" },
    { key: "ignored", label: "Ignored" },
    { key: "out", label: "Money out" },
  ];
  return items.map((i) => ({ key: i.key, label: i.label, href: hrefFor(i.key), count: counts[i.key] ?? null, on: i.key === active }));
}

// ---------------------------------------------------------------------------- Rows that act (Today's rows)

/** What the Bank tab needs to draw its rows. */
export type BankViewContext = BankRowContext & { labels: CardLabels };

/** A row the Bank tab draws, with the bank line it stands for (for Set aside), or null for the Zelle exact-match row. */
export type BankRow = { row: QueueRow; line: { id: string; amount: string } | null };

function lineOf(id: string, amountCents: number, ctx: Pick<BankRowContext, "currency" | "locale">): BankRow["line"] {
  return { id, amount: formatCents(amountCents, ctx.currency, ctx.locale) };
}

/**
 * The To match rows: the Zelle exact-match row first (the same pairs as the Zelle view, so confirming them is two clicks from
 * Giving), then each gift line that is not one of those pairs. Without the right to confirm, the lines are listed without buttons.
 */
export function matchRows(gifts: readonly GiftLineIn[], exact: readonly ExactPairIn[] | null, ctx: BankRowContext, canConfirm: boolean): BankRow[] {
  const inExact = new Set((exact ?? []).map((p) => p.bankTransactionId));
  const exactRow = canConfirm && exact ? zelleExactRow(exact, ctx) : null;
  const rows: BankRow[] = [
    ...(exactRow ? [{ row: exactRow, line: null }] : []),
    ...gifts.filter((g) => !canConfirm || !inExact.has(g.id)).map((g) => ({ row: giftRow(g, ctx), line: lineOf(g.id, g.amountCents, ctx) })),
  ];
  return canConfirm ? rows : rows.map(readOnly);
}

export function depositRows(deposits: readonly DepositLineIn[], ctx: BankRowContext, canConfirm: boolean): BankRow[] {
  const rows = deposits.map((d) => ({ row: depositRow(d, ctx, { inBank: true }), line: lineOf(d.id, d.amountCents, ctx) }));
  return canConfirm ? rows : rows.map(readOnly);
}

/** The Zelle view's own row: every exact pair, ticked, each one untickable; the rest of the reports are listed under it. */
export function zelleRows(exact: readonly ExactPairIn[] | null, ctx: BankRowContext, canConfirm: boolean): BankRow[] {
  if (!canConfirm || !exact) return [];
  const row = zelleExactRow(exact, ctx);
  return row ? [{ row, line: null }] : [];
}

function readOnly(r: BankRow): BankRow {
  return { row: { ...r.row, acts: [], tone: "plain", info: true }, line: r.line };
}

// ---------------------------------------------------------------------------- Card payouts

export type ProviderPayoutIn = {
  id: string;
  provider: string;
  ref: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  arrivesOn: string | null;
  /** Paired with its bank line in the database (0747), and the reason given for a difference. */
  matched?: boolean;
  differenceCode?: string | null;
  differenceNote?: string | null;
};
export type BankPayoutLineIn = { id: string; postedOn: string; amountCents: number; description: string; payoutId: string | null };
export type PayoutPair = {
  provider: ProviderPayoutIn | null;
  bank: BankPayoutLineIn | null;
  /** linked: the bank line names the payout; date: paired by arrival date (not confirmed); none: one side only. */
  how: "linked" | "date" | "none";
  /** The bank amount minus the provider's net, when both sides are there. */
  differenceCents: number | null;
};

function dayNumber(date: string): number {
  const n = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(n) ? Math.round(n / 86_400_000) : Number.NaN;
}

/**
 * Pair each bank payout line with a provider payout, one to one: first the ones the bank line names (payout_id), then by date (the
 * line posted within PAYOUT_WINDOW_DAYS of the payout's arrival), the closest amount first, then the closest day. What is left
 * stays alone. Newest first.
 */
export function pairPayouts(providers: readonly ProviderPayoutIn[], lines: readonly BankPayoutLineIn[], windowDays = PAYOUT_WINDOW_DAYS): PayoutPair[] {
  const pairs: PayoutPair[] = [];
  const usedProvider = new Set<string>();
  const usedLine = new Set<string>();
  const byId = new Map(providers.map((p) => [p.id, p]));
  for (const l of lines) {
    const p = l.payoutId ? byId.get(l.payoutId) : undefined;
    if (p && !usedProvider.has(p.id)) {
      usedProvider.add(p.id);
      usedLine.add(l.id);
      pairs.push({ provider: p, bank: l, how: "linked", differenceCents: l.amountCents - p.netCents });
    }
  }
  const candidates: { p: ProviderPayoutIn; l: BankPayoutLineIn; amount: number; days: number }[] = [];
  for (const l of lines) {
    if (usedLine.has(l.id)) continue;
    for (const p of providers) {
      if (usedProvider.has(p.id) || !p.arrivesOn) continue;
      const days = Math.abs(dayNumber(l.postedOn) - dayNumber(p.arrivesOn));
      if (Number.isFinite(days) && days <= windowDays) candidates.push({ p, l, amount: Math.abs(l.amountCents - p.netCents), days });
    }
  }
  candidates.sort((a, b) => a.amount - b.amount || a.days - b.days || a.l.postedOn.localeCompare(b.l.postedOn) || a.l.id.localeCompare(b.l.id) || a.p.id.localeCompare(b.p.id));
  for (const c of candidates) {
    if (usedProvider.has(c.p.id) || usedLine.has(c.l.id)) continue;
    usedProvider.add(c.p.id);
    usedLine.add(c.l.id);
    pairs.push({ provider: c.p, bank: c.l, how: "date", differenceCents: c.l.amountCents - c.p.netCents });
  }
  for (const l of lines) if (!usedLine.has(l.id)) pairs.push({ provider: null, bank: l, how: "none", differenceCents: null });
  for (const p of providers) if (!usedProvider.has(p.id)) pairs.push({ provider: p, bank: null, how: "none", differenceCents: null });
  const when = (x: PayoutPair) => x.bank?.postedOn ?? x.provider?.arrivesOn ?? "";
  return pairs.sort((a, b) => when(b).localeCompare(when(a)) || (a.bank?.id ?? a.provider?.id ?? "").localeCompare(b.bank?.id ?? b.provider?.id ?? ""));
}

const PROVIDER_NAME: Record<string, string> = { stripe: "Stripe", paypal: "PayPal", square: "Square" };

export function providerName(provider: string): string {
  return PROVIDER_NAME[provider] ?? (provider ? provider[0].toUpperCase() + provider.slice(1) : "The provider");
}

export type PayoutRowView = {
  id: string;
  provider: { title: string; date: string; gross: string; fees: string; net: string } | null;
  bank: { title: string; date: string; amount: string } | null;
  difference: { text: string; tone: "ok" | "warn" | "muted" };
  how: string;
  /** Needs a look: a difference, or one side missing past its window. */
  attention: boolean;
  /** Both sides are there, paired by date only: "Explain and accept" confirms the pair (slice 9). */
  explain: {
    payoutId: string;
    bankLineId: string;
    differenceCents: number;
    /** "The bank received $2.00 less than the payout." */
    sentence: string;
    /** "Accept the $2.00 difference", or "Pair them: the amounts agree". */
    button: string;
  } | null;
  /** Paired in the database: the reason for a difference, and the undo (until the month is locked). */
  paired: { payoutId: string; reason: string | null; note: string | null } | null;
};

export function payoutRowView(pair: PayoutPair, ctx: Pick<BankRowContext, "currency" | "locale" | "timeZone" | "today">): PayoutRowView {
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const p = pair.provider;
  const b = pair.bank;
  let difference: PayoutRowView["difference"];
  let attention = false;
  const accepted = pair.how === "linked" && p?.matched === true;
  if (p && b) {
    const d = pair.differenceCents ?? 0;
    attention = d !== 0 && !accepted;
    difference =
      d === 0
        ? { text: "No difference", tone: "ok" }
        : accepted
          ? { text: `${money(Math.abs(d))} ${d > 0 ? "more" : "less"} at the bank, explained`, tone: "ok" }
          : { text: d > 0 ? `${money(d)} more at the bank than the payout` : `${money(-d)} less at the bank than the payout`, tone: "warn" };
  } else if (p) {
    const late = p.arrivesOn ? dayNumber(ctx.today) - dayNumber(p.arrivesOn) > PAYOUT_WINDOW_DAYS : false;
    attention = late;
    difference = late ? { text: "Not seen at the bank", tone: "warn" } : { text: "Not at the bank yet", tone: "muted" };
  } else {
    attention = true;
    difference = { text: "No payout from the provider found for this bank line", tone: "warn" };
  }
  const how =
    pair.how === "linked"
      ? accepted
        ? "Paired with this bank line."
        : "The bank line names this payout."
      : pair.how === "date"
        ? `Paired by date: the bank line is within ${PAYOUT_WINDOW_DAYS} days of the payout. Not confirmed.`
        : p
          ? `No bank line within ${PAYOUT_WINDOW_DAYS} days of the payout's arrival.`
          : `No provider payout within ${PAYOUT_WINDOW_DAYS} days of this bank line.`;
  return {
    id: b?.id ?? p?.id ?? "",
    provider: p
      ? {
          title: `${providerName(p.provider)} payout ${p.ref}`,
          date: p.arrivesOn ? `Arrives ${formatDate(p.arrivesOn, ctx.timeZone)}` : "No arrival date",
          gross: money(p.grossCents),
          fees: money(p.feeCents),
          net: money(p.netCents),
        }
      : null,
    bank: b ? { title: b.description, date: `Posted ${formatDate(b.postedOn, ctx.timeZone)}`, amount: money(b.amountCents) } : null,
    difference,
    how,
    attention,
    explain:
      p && b && pair.how === "date" && !p.matched
        ? {
            payoutId: p.id,
            bankLineId: b.id,
            differenceCents: pair.differenceCents ?? 0,
            sentence: differenceSentence(pair.differenceCents ?? 0, money),
            button: acceptLabel(pair.differenceCents ?? 0, money),
          }
        : null,
    paired: p && accepted ? { payoutId: p.id, reason: reasonLabel(p.differenceCode), note: p.differenceNote ?? null } : null,
  };
}

// ---------------------------------------------------------------------------- History

export type HistoryLineIn = {
  id: string;
  postedOn: string;
  amountCents: number;
  description: string;
  status: string;
  family: Family | null;
  receipt: string | null;
  /** Who matched or ignored it, and when. */
  by: string | null;
  at: string | null;
  notes: string | null;
  isDeposit: boolean;
  /** The line attached an offline payment that was recorded before it (so "Undo match" can put it back). */
  undoable?: boolean;
  /** The count this deposit was matched to (Offering counts, slice 5): "Count of Oct 5, 2026 · $412.50 · bags 118, 119". */
  count?: string | null;
};

export type HistoryRowView = {
  id: string;
  date: string;
  description: string;
  amount: string;
  negative: boolean;
  family: Family | null;
  what: string;
  /** restore: an ignored line goes back to the lines to match; ignore: money out is set aside once checked. */
  act: "restore" | "ignore" | null;
  /** "Undo match…" (giving.manage): the line attached a payment recorded before it. */
  undo?: boolean;
};

export function historyRowView(l: HistoryLineIn, key: HistoryKey, ctx: Pick<BankRowContext, "currency" | "locale" | "timeZone">, canIgnore: boolean, canUndo = false): HistoryRowView {
  const when = l.at ? ` on ${formatDate(l.at, ctx.timeZone)}` : "";
  const by = l.by ? ` by ${l.by}` : "";
  let what: string;
  if (key === "matched") {
    what = l.family
      ? `Matched to ${familyRef(l.family)}${l.receipt ? `, receipt ${l.receipt}` : ""}${by}${when}`
      : l.count
        ? `Matched to the ${l.count[0].toLowerCase()}${l.count.slice(1)}${by}${when}`
        : l.isDeposit
        ? `Deposit matched to the payments recorded for it${by}${when}`
        : `Matched${l.receipt ? ` to receipt ${l.receipt}` : ""}${by}${when}`;
  } else if (key === "ignored") {
    what = `Ignored${by}${when}${l.notes ? `: ${l.notes}` : ""}`;
  } else {
    what = "Money out is never matched to a family. Ignore it once you have checked it.";
  }
  return {
    id: l.id,
    date: formatDate(l.postedOn, ctx.timeZone),
    description: l.description,
    amount: formatCents(l.amountCents, ctx.currency, ctx.locale),
    negative: l.amountCents < 0,
    family: key === "matched" ? l.family : null,
    what,
    act: !canIgnore ? null : key === "ignored" ? "restore" : key === "out" ? "ignore" : null,
    ...(canUndo && key === "matched" && l.undoable === true ? { undo: true } : {}),
  };
}

// ---------------------------------------------------------------------------- The page

export type LearnedView = { id: string; value: string; family: Family | null; times: number; last: string | null };
export type BankAccountView = { id: string; name: string; last4: string | null; active: boolean; statementFormat: string };
export type BankCan = {
  confirm: boolean;
  ignore: boolean;
  import: boolean;
  configureZelle: boolean;
  /** Pair a card payout with its bank line, or undo it (giving.manage; slice 9). */
  pairPayouts?: boolean;
  /** Undo a bank match, with a reason (giving.manage; 0868). */
  undoMatch?: boolean;
};
export type BankBody = Exclude<ListBody, { state: "ok" }> | { state: "ok" } | { state: "no_account"; canAdd: boolean };

export type BankModel = {
  title: string;
  tabs: GivingTab[];
  currency: string;
  locale: string;
  timeZone: string;
  today: string;
  labels: CardLabels;
  zelleWord: string;
  view: BankViewKey;
  views: Chip[];
  history: HistoryKey;
  historyChips: Chip[];
  body: BankBody;
  accounts: { id: string; label: string; href: string; on: boolean }[];
  account: BankAccountView | null;
  /** All accounts, for the Zelle settings. */
  zelleAccounts: { id: string; name: string; last4: string | null; active: boolean }[];
  rows: BankRow[];
  /** The Reconcile view: the preview is read in the browser (a server action), so the page only says which account. */
  reconcile?: { accountId: string | null } | null;
  /** The Unbanked view: payments counted as paid that no bank line has banked, past or inside their window. */
  unbanked?: UnbankedModel | null;
  zelle: ReportQueue | null;
  payouts: PayoutRowView[];
  historyRows: HistoryRowView[];
  learned: { state: "ok"; rows: LearnedView[] } | { state: "error"; error: string };
  pager: { label: string; prev: string | null; next: string | null } | null;
  problems: string[];
  note: string | null;
  empty: string;
  can: BankCan;
  /** Export this view's bank lines (slice 9); null where the view has none (Zelle lists reports, not bank lines). */
  exportOffer?: ExportOffer | null;
};

export function bankPager(page: number, total: number, hrefFor: (n: number) => string, size = BANK_PAGE_SIZE): BankModel["pager"] {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size && page <= 1) return null;
  const from = Math.min(total, (page - 1) * size + 1);
  const to = Math.min(total, page * size);
  return {
    label: `${from.toLocaleString("en-US")} to ${to.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
    prev: page > 1 ? hrefFor(page - 1) : null,
    next: page < pages ? hrefFor(page + 1) : null,
  };
}

export function emptyText(view: BankViewKey, history: HistoryKey): string {
  if (view === "match") return "Every gift line is matched or set aside.";
  if (view === "reconcile") return "Every incoming line is matched or set aside.";
  if (view === "unbanked") return "Every verified payment is on the bank.";
  if (view === "deposits") return "No deposits waiting.";
  if (view === "zelle") return "No exact matches right now.";
  if (view === "payouts") return `No card payouts in the last ${PAYOUT_LOOKBACK_DAYS} days.`;
  return history === "matched" ? "Nothing matched yet." : history === "ignored" ? "No ignored lines." : "No money out waiting to be checked.";
}

/** Shown to someone who may look at the bank lines but not match them (giving.view). */
export const READ_ONLY_NOTE = "You can see the bank lines. Matching them needs giving.record_offline or giving.manage.";

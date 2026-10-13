// Giving's exports for the treasurer (docs/GIVING_REDESIGN.md slice 9, section 10 decision 5). Pure: the route
// (src/app/(app)/giving/export/route.ts) reads the rows with the list's own filters and hands them here.
//
// The file: one watermark line naming the community, who exported it, when, the list and its filter and the number of rows; then
// the header; then one line per row. Amounts are integer cents written as plain decimals ("1234.56") with the currency in its own
// column. A family is always its household number, its community household ID and the adults' household name (the household card,
// adults only: a child's name is never in a Giving file). Free text (notes, reasons) is never exported.
//
// The audit entry (app.record_giving_export, 0747) gets counts and filter words only: which chips are on (their values are fixed
// words) and whether a search was used, never the search's text (it can be a name) and never the file.

import { PLEDGE_STATUS_LABEL } from "@/lib/labels";
import { centsAsDecimal } from "@/lib/money";

export const GIVING_EXPORT_LISTS = ["payments", "pledges"] as const;
export type GivingExportList = (typeof GIVING_EXPORT_LISTS)[number];

export function exportListFromParam(value: string | null | undefined): GivingExportList | null {
  return GIVING_EXPORT_LISTS.find((l) => l === value) ?? null;
}

/** A file holds at most this many rows; a longer list is narrowed with a chip or a year first. */
export const MAX_EXPORT_ROWS = 50_000;

/** A household as a file names it (adultHouseholdCards: the name never carries a child's first name). */
export type ExportHousehold = { number: string | null; orgId: string | null; name: string | null };

const PAYMENT_STATUS_WORD: Record<string, string> = {
  authorized: "Authorized",
  captured: "Received",
  pending_clearing: "Clearing",
  settled: "Settled",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
  failed: "Failed",
  voided: "Voided",
};

function words(value: string): string {
  const w = value.replace(/_/g, " ");
  return w ? w[0].toUpperCase() + w.slice(1) : w;
}

function household(h: ExportHousehold | undefined): [string, string, string] {
  return [h?.number ?? "", h?.orgId ?? "", h?.name ?? ""];
}

// ---------------------------------------------------------------------------------------------------------------------------- Payments

export type PaymentExportRow = {
  receipt: string | null;
  receivedOn: string;
  householdId: string;
  method: string;
  checkNumber: string | null;
  /** "Recorded by hand", "From the bank", "Online (Stripe)". */
  source: string;
  status: string;
  amountCents: number;
  refundedCents: number;
  /** The pledges it was applied to: "P-2026-0012 (Building fund)". */
  appliedTo: string[];
  openingBalance: boolean;
};

export function paymentExportHeader(householdIdLabel: string): string[] {
  return [
    "Receipt number",
    "Received on",
    "Household number",
    householdIdLabel,
    "Household",
    "Method",
    "Check number",
    "Source",
    "Status",
    "Amount",
    "Refunded",
    "Net",
    "Currency",
    "Applied to",
    "Opening balance",
  ];
}

export function paymentExportLines(
  rows: readonly PaymentExportRow[],
  households: ReadonlyMap<string, ExportHousehold>,
  o: { currency: string; methodWord: (method: string) => string },
): string[][] {
  return rows.map((r) => [
    r.receipt ?? "",
    r.receivedOn,
    ...household(households.get(r.householdId)),
    o.methodWord(r.method),
    r.checkNumber ?? "",
    r.source,
    PAYMENT_STATUS_WORD[r.status] ?? words(r.status),
    centsAsDecimal(r.amountCents),
    centsAsDecimal(r.refundedCents),
    centsAsDecimal(r.amountCents - r.refundedCents),
    o.currency,
    r.appliedTo.join("; "),
    r.openingBalance ? "Yes" : "",
  ]);
}

// ----------------------------------------------------------------------------------------------------------------------------- Pledges

export type PledgeExportRow = {
  number: string | null;
  pledgedOn: string;
  dueOn: string | null;
  householdId: string;
  campaign: string | null;
  status: string;
  amountCents: number;
  paidCents: number;
  /** A write-off was asked for and waits for its second person. */
  writeOffWaiting: boolean;
};

export function pledgeExportHeader(householdIdLabel: string): string[] {
  return [
    "Pledge number",
    "Pledged on",
    "Due on",
    "Household number",
    householdIdLabel,
    "Household",
    "Campaign",
    "Status",
    "Amount",
    "Paid",
    "Open",
    "Currency",
    "Write-off waiting for approval",
  ];
}

const OPEN = new Set(["open", "partially_paid"]);

export function pledgeExportLines(rows: readonly PledgeExportRow[], households: ReadonlyMap<string, ExportHousehold>, o: { currency: string }): string[][] {
  return rows.map((r) => [
    r.number ?? "",
    r.pledgedOn.slice(0, 10),
    r.dueOn ?? "",
    ...household(households.get(r.householdId)),
    r.campaign ?? "",
    PLEDGE_STATUS_LABEL[r.status] ?? words(r.status),
    centsAsDecimal(r.amountCents),
    centsAsDecimal(r.paidCents),
    centsAsDecimal(OPEN.has(r.status) ? Math.max(0, r.amountCents - r.paidCents) : 0),
    o.currency,
    r.writeOffWaiting ? "Yes" : "",
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------- The filter, said

/** What the list shows, in words: the chips that are on, the year and the search. Empty means the whole list. */
export type ExportFilter = {
  /** Fixed words of the chips that are on, keyed as the address keys them (view, method, source, year, status, age). */
  chips: Record<string, { value: string; label: string }>;
  /** The search as typed, or null. In the file's watermark; never in the audit entry. */
  search: string | null;
};

export function filterSentence(filter: ExportFilter, whole: string): string {
  const parts = Object.values(filter.chips).map((c) => c.label);
  if (filter.search) parts.push(`matching “${filter.search}”`);
  return parts.length > 0 ? parts.join(", ") : whole;
}

/** The audit entry's detail: the number of rows, the chips' fixed values, the year, and whether a search was used. */
export function auditDetail(filter: ExportFilter, rows: number): { rows: number; chips: Record<string, string>; searched: boolean } {
  const chips: Record<string, string> = {};
  for (const [k, c] of Object.entries(filter.chips)) chips[k] = c.value;
  return { rows, chips, searched: filter.search !== null };
}

export const LIST_WORDS: Record<GivingExportList, { one: string; many: string; whole: string }> = {
  payments: { one: "payment", many: "payments", whole: "every payment" },
  pledges: { one: "pledge", many: "pledges", whole: "every pledge" },
};

export function rowsWord(list: GivingExportList, n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? LIST_WORDS[list].one : LIST_WORDS[list].many}`;
}

/** The first line of the file. */
export function watermarkLine(w: {
  community: string;
  who: string;
  email: string | null;
  at: string;
  list: GivingExportList;
  filter: ExportFilter;
  rows: number;
}): string {
  const by = w.email ? `${w.who} (${w.email})` : w.who;
  const list = LIST_WORDS[w.list].many;
  return (
    `Exported from ${w.community} by ${by} on ${w.at}. ${list[0].toUpperCase()}${list.slice(1)}: ${filterSentence(w.filter, LIST_WORDS[w.list].whole)}. ` +
    `${rowsWord(w.list, w.rows)}. Confidential: for ${w.community}'s records only; this export is recorded in the audit log.`
  );
}

/** "payments-2026-check-2026-10-13.csv". */
export function exportFileName(list: GivingExportList, filter: ExportFilter, day: string): string {
  const bits = [list, ...Object.values(filter.chips).map((c) => c.value)]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${bits || list}-${day}.csv`;
}

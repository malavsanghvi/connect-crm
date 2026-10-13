// What Giving › Statements draws in the New look (docs/GIVING_REDESIGN.md slice 8), and its addresses. Pure: the route, the dev
// preview and the tests build the same model.

import type { CardLabels } from "@/components/household-card";
import type { ReceiptPreviewLine } from "@/lib/giving";
import type { Family } from "@/lib/giving-today/queue";
import type { GivingTab } from "@/lib/giving-today/tabs";

import type { ReceiptCopyIn } from "./receipt-copy";
import type { ReviewFilter, ReviewRowView, ReviewSummary } from "./review";

/** The year-end review card: rows, "switched off" (never an empty page), "no access" (never an empty table) or an error. */
export type ReviewPart =
  | { state: "ok"; rows: ReviewRowView[]; summary: ReviewSummary }
  | { state: "off" }
  | { state: "no_access" }
  | { state: "error"; message: string };

export type ReceiptCopyView = {
  copy: ReceiptCopyIn;
  family: Family;
  lines: ReceiptPreviewLine[];
  /** Null when the copy may be printed; otherwise why printing is off (the templates are not approved). */
  printBlocked: string | null;
};

export type ReceiptPart =
  | { state: "none" }
  | { state: "ok"; view: ReceiptCopyView }
  | { state: "not_found"; message: string }
  | { state: "refused"; message: string }
  | { state: "no_access" }
  | { state: "error"; message: string };

export const REVIEW_PAGE_SIZE = 50;

export type StatementsModel = {
  /** The workspace's name for Giving (the kind's word). */
  title: string;
  tabs: GivingTab[];
  communityName: string;
  today: string;
  timeZone: string;
  labels: CardLabels;
  /** "/giving/statements", or the dev preview's own address. */
  base: string;
  year: number;
  years: number[];
  /** False while the year is still running: its figures are "so far". */
  yearOver: boolean;
  review: ReviewPart;
  filter: ReviewFilter;
  page: number;
  /** The review sheet opens on arrival (Today's "Review and send"). */
  openReview: boolean;
  /** The receipt number as typed (?receipt=). */
  receiptQuery: string;
  receipt: ReceiptPart;
  /** Where a printable copy lives: `${printBase}/${paymentId}`; null in the dev preview. */
  printBase: string | null;
};

export type StatementsQuery = { year?: number; show?: ReviewFilter; page?: number; review?: boolean; receipt?: string | null };

/** The page's address with the given state (the year is always kept; the rest only when set). */
export function statementsHref(base: string, q: StatementsQuery): string {
  const sp = new URLSearchParams();
  if (q.year) sp.set("year", String(q.year));
  if (q.show && q.show !== "all") sp.set("show", q.show);
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  if (q.review) sp.set("review", "1");
  if (q.receipt) sp.set("receipt", q.receipt);
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

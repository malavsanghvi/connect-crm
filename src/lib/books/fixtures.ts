// Invented data for the Books dev preview and tests: a neutral community club, no real names, no children. Pure.

import type { BooksViewProps, QuickBooksGlance } from "@/components/books/books-page";
import { closeItems, closeWarnings, type CloseProofs } from "@/lib/books/close";
import type { DonorMatchesIn } from "@/lib/data/books-donors";
import { TODAY_FAMILIES } from "@/lib/giving-today/fixtures";

export type BooksSample = "waiting" | "clear" | "no_access";

const MONTH = "2026-10-01";
const LABEL = "October 2026";
const FORMAT = { monthLabel: LABEL, currency: "USD", locale: "en-US" };

export const BOOKS_PROOFS: Record<BooksSample, CloseProofs> = {
  // Card payouts arrived (nothing marks them matched yet) and a refund request waits: two checks stay a person's.
  waiting: {
    exceptions: { ok: true, value: 0 },
    refundRequests: { ok: true, value: 1 },
    flaggedRefunds: 1,
    payouts: { ok: true, value: { arrived: 3, matched: 0, netCents: 412_550 } },
    bankPayouts: { ok: true, value: { lines: 3, cents: 412_550 } },
    warnings: { proofsWaiting: { ok: true, value: 2 }, unbanked: { ok: true, value: 5 } },
  },
  // A cash-and-check month: nothing waits, no card payout arrived.
  clear: {
    exceptions: { ok: true, value: 0 },
    refundRequests: { ok: true, value: 0 },
    flaggedRefunds: 0,
    payouts: { ok: true, value: { arrived: 0, matched: 0, netCents: 0 } },
    bankPayouts: null,
  },
  // A month-end closer who cannot see payments, postings or payouts.
  no_access: {
    exceptions: { ok: false, why: "no_access" },
    refundRequests: { ok: false, why: "no_access" },
    flaggedRefunds: 0,
    payouts: { ok: false, why: "no_access" },
    bankPayouts: null,
  },
};

const DONORS: DonorMatchesIn = {
  canApprove: true,
  customers: 7,
  several: 1,
  shown: [
    { matchId: "11111111-1111-4111-8111-111111111111", qboCustomerId: "58", qboName: "T. Adeyemi", how: "Email · 97%", householdId: TODAY_FAMILIES.adeyemi.id, confidence: 0.97, family: TODAY_FAMILIES.adeyemi },
    { matchId: "22222222-2222-4222-8222-222222222222", qboCustomerId: "61", qboName: "Lindqvist, Grace", how: "Name + address · 91%", householdId: TODAY_FAMILIES.lindqvist.id, confidence: 0.91, family: TODAY_FAMILIES.lindqvist },
  ],
  more: 4,
};

const QBO: QuickBooksGlance = {
  connection: { connected: true, name: "Lakeside Community Club" },
  ledger: { failed: 0, waiting: 2, lastPostedAt: "2026-10-12T11:10:00Z" },
};

export function sampleBooks(sample: BooksSample, checklist: Record<string, boolean> = {}): BooksViewProps {
  const items = closeItems(checklist, BOOKS_PROOFS[sample], FORMAT);
  return {
    state: { month: MONTH, label: LABEL, periodError: null, period: { status: "closing", checklist, closed_by: null, closed_at: null }, locked: false, items, warnings: closeWarnings(BOOKS_PROOFS[sample].warnings) },
    months: ["2026-10-01", "2026-09-01", "2026-08-01"].map((m, i) => ({ key: m, label: ["October 2026", "September 2026", "August 2026"][i], href: `?month=${m.slice(0, 7)}` })),
    closerName: null,
    labels: { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" },
    timeZone: "America/Chicago",
    canClose: sample !== "no_access",
    qbo: sample === "no_access" ? null : QBO,
    donors: sample === "no_access" ? null : { state: "ok", data: sample === "clear" ? { ...DONORS, customers: 0, several: 0, shown: [], more: 0 } : DONORS },
  };
}

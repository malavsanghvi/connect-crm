// Invented data for Giving › Statements (New look): the dev preview (/dev/giving-statements) and the tests draw from it. A neutral
// community club, no faith words; a family with a child shows that the child never appears.

import { communityFormat } from "@/lib/community-format";
import { givingTabs } from "@/lib/giving-today/tabs";
import { NEUTRAL_KIND, type KindProfile } from "@/lib/kind";

import type { ReceiptPart, ReviewPart, StatementsModel } from "./model";
import { receiptCopyLines, printBlockedReason, receiptFamily, type ReceiptCopyIn } from "./receipt-copy";
import { parseFilter, reviewRowView, reviewSummary, statementYears, yearIsOver, type ReviewRowIn } from "./review";

export const STATEMENTS_COMMUNITY = "Lakeside Community Club";
export const STATEMENTS_TODAY = "2027-01-12";
const LABELS = { orgMemberLabel: "member", orgHouseholdLabel: "Club household ID" };

const adult = (name: string, o: { primary?: boolean; email?: boolean; app?: boolean } = {}) => ({
  name,
  primary: o.primary ?? false,
  email: o.email ?? false,
  app: o.app ?? false,
});

const row = (id: string, name: string, number: string, o: Partial<ReviewRowIn>): ReviewRowIn => ({
  householdId: id,
  name,
  number,
  orgId: `LCC-${number}`,
  city: "Lakeside",
  adults: [],
  giftCount: 1,
  givenCents: 10000,
  refundedCents: 0,
  refundedCount: 0,
  openingCount: 0,
  openingCents: 0,
  mailOptIn: false,
  addressComplete: false,
  ...o,
});

/** Seven households of the year 2026: email, post, the app only, no way to reach, only a child, an incomplete address, refunds. */
export function sampleReviewRows(): ReviewRowIn[] {
  return [
    row("h-1", "Okafor household", "0212", {
      adults: [adult("Chidi Okafor", { primary: true, email: true, app: true }), adult("María Okafor", { email: true })],
      giftCount: 12,
      givenCents: 240000,
      refundedCents: 5000,
      openingCount: 1,
      openingCents: 50000,
    }),
    row("h-2", "Lindqvist household", "0213", { adults: [adult("Erik Lindqvist", { primary: true })], mailOptIn: true, addressComplete: true, givenCents: 52000 }),
    row("h-3", "Haddad household", "0214", { adults: [adult("Samira Haddad", { primary: true, app: true })], givenCents: 18000, giftCount: 3 }),
    row("h-4", "Nguyen household", "0215", { adults: [adult("Linh Nguyen", { primary: true })], givenCents: 7500 }),
    row("h-5", "Household 0216", "0216", { adults: [], givenCents: 2000 }),
    row("h-6", "Brennan household", "0217", { adults: [adult("Aoife Brennan", { primary: true, email: true })], mailOptIn: true, addressComplete: false, givenCents: 30000 }),
    row("h-7", "Kowalski household", "0218", { adults: [adult("Piotr Kowalski", { primary: true, email: true })], givenCents: 0, refundedCents: 4000, refundedCount: 1 }),
  ];
}

export function sampleReceiptCopy(o: Partial<ReceiptCopyIn> = {}): ReceiptCopyIn {
  return {
    paymentId: "00000000-0000-4000-8000-00000000c0b1",
    householdId: "h-1",
    household: { name: "Okafor household", number: "0212", orgId: "LCC-0212", city: "Lakeside" },
    receiptNumber: "R-2026-0395",
    receivedOn: "2026-03-14",
    method: "check",
    status: "settled",
    amountCents: 25000,
    refundedCents: 0,
    receiptName: "Chidi Okafor",
    receiptNameHidden: false,
    jointReceipt: false,
    payerIsAdult: true,
    adults: ["Chidi Okafor", "María Okafor"],
    appliedTo: ["Community garden"],
    templates: { ok: true, detail: "Approved by the treasurer, Ana Ruiz, on March 2, 2026." },
    ...o,
  };
}

export type StatementsSample = "ok" | "off" | "no_access" | "error" | "empty";

export function sampleStatementsModel(
  opts: { sample?: StatementsSample; show?: string; receipt?: boolean; templatesApproved?: boolean; openReview?: boolean; kind?: KindProfile; currency?: string } = {},
): StatementsModel {
  const kind = opts.kind ?? NEUTRAL_KIND;
  const fmt = communityFormat({ currency: opts.currency ?? "USD", country: "US" });
  const ctx = { permissions: ["giving.view", "giving.manage", "giving.record_offline", "giving.approve"], isPlatformAdmin: false, modulesOff: ["bolis"], kind };
  const year = 2026;
  const rows = sampleReviewRows().map((r) => reviewRowView(r, fmt));
  const sample = opts.sample ?? "ok";
  const review: ReviewPart =
    sample === "off"
      ? { state: "off" }
      : sample === "no_access"
        ? { state: "no_access" }
        : sample === "error"
          ? { state: "error", message: "Could not read the 2026 year-end review — the database could not be reached — check the connection and try again." }
          : sample === "empty"
            ? { state: "ok", rows: [], summary: reviewSummary([], fmt) }
            : { state: "ok", rows, summary: reviewSummary(rows, fmt) };
  let receipt: ReceiptPart = { state: "none" };
  if (opts.receipt) {
    const copy = sampleReceiptCopy(opts.templatesApproved === false ? { templates: { ok: false, detail: "The treasurer has not approved the templates yet." } } : {});
    const lines = receiptCopyLines(copy, {
      centerName: STATEMENTS_COMMUNITY,
      centerAddress: "1 Lake Road, Lakeside",
      signedBy: "Ana Ruiz, Treasurer",
      note: "Thank you for supporting the club.",
      fmt,
      timeZone: "America/Chicago",
      today: STATEMENTS_TODAY,
      orgKind: kind,
    });
    receipt = { state: "ok", view: { copy, family: receiptFamily(copy), lines, printBlocked: printBlockedReason(copy) } };
  }
  return {
    title: "Giving",
    tabs: givingTabs(ctx),
    communityName: STATEMENTS_COMMUNITY,
    today: STATEMENTS_TODAY,
    timeZone: "America/Chicago",
    labels: LABELS,
    base: "/dev/giving-statements",
    year,
    years: statementYears(STATEMENTS_TODAY),
    yearOver: yearIsOver(year, STATEMENTS_TODAY),
    review,
    filter: parseFilter(opts.show),
    page: 1,
    openReview: opts.openReview ?? false,
    receiptQuery: opts.receipt ? "R-2026-0395" : "",
    receipt,
    printBase: null,
  };
}

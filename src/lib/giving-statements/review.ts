// Giving › Statements, the year-end review (docs/GIVING_REDESIGN.md section 4 "Statements", slice 8). Pure: the page, the dev
// preview, Today's row and the tests read the same rules.
//
// The rows come from app.year_end_review (0746): one per household that gave in the CALENDAR year (January to December, the same
// year as app.year_end_statement and the member app), with year_end_statement's totals to the cent, and the household's ADULTS
// only (a statement is addressed to adults; a child is never listed and a child's email never counts). Nothing here sends
// anything: the statements service that generates and sends statements is not connected, and the Send button says so.

import { moneyIn, type CommunityFormat } from "@/lib/community-format";
import type { Family } from "@/lib/giving-today/queue";

export type ReviewAdult = { name: string; primary: boolean; email: boolean; app: boolean };

export type ReviewRowIn = {
  householdId: string;
  name: string;
  number: string | null;
  orgId: string | null;
  city: string | null;
  adults: ReviewAdult[];
  giftCount: number;
  givenCents: number;
  refundedCents: number;
  refundedCount: number;
  openingCount: number;
  openingCents: number;
  mailOptIn: boolean;
  addressComplete: boolean;
};

/** How the statement would reach the household: by post when they asked for paper, else email, else the member app only. */
export type Delivery = "email" | "post" | "app" | "none";

export type ProblemKey = "no_adult" | "no_way" | "address_incomplete" | "nothing_given";
export type Problem = { key: ProblemKey; text: string };
export type NoteKey = "opening_balance" | "refunds";
export type ReviewNote = { key: NoteKey; text: string };

export type ReviewRowView = ReviewRowIn & {
  family: Family;
  delivery: Delivery;
  /** Shown before sending; the "Needs a fix" filter lists every row with one. */
  problems: Problem[];
  notes: ReviewNote[];
  total: string;
  addressedTo: string;
};

export type ReviewFilter = "all" | "fix" | "email" | "post" | "app";
export const REVIEW_FILTERS: readonly ReviewFilter[] = ["all", "fix", "email", "post", "app"];

export type ReviewSummary = {
  households: number;
  totalCents: number;
  total: string;
  /** Households with something to state, by how it would reach them; "none" are the ones that need a fix first. */
  counts: Record<Delivery, number>;
  /** Households whose refunds cancel the year's gifts: nothing to state, so no statement. */
  nothingToState: number;
  /** Rows the "Needs a fix" filter lists. */
  needFix: number;
  sentence: string;
};

const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function parseAdults(v: unknown): ReviewAdult[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const o = a as Record<string, unknown>;
    const name = text(o.name);
    return name ? [{ name, primary: o.primary === true, email: o.email === true, app: o.app === true }] : [];
  });
}

/** app.year_end_review's rows, read defensively (a row without a household id is dropped). */
export function parseReviewRows(data: unknown): ReviewRowIn[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((r) => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const householdId = text(o.household_id);
    if (!householdId) return [];
    return [
      {
        householdId,
        name: text(o.household_name) ?? "Unnamed household",
        number: text(o.household_number),
        orgId: text(o.org_household_id),
        city: text(o.city),
        adults: parseAdults(o.adults),
        giftCount: int(o.gift_count),
        givenCents: int(o.given_cents),
        refundedCents: int(o.refunded_cents),
        refundedCount: int(o.refunded_count),
        openingCount: int(o.opening_balance_count),
        openingCents: int(o.opening_balance_cents),
        mailOptIn: o.mail_opt_in === true,
        addressComplete: o.address_complete === true,
      },
    ];
  });
}

export function deliveryFor(r: Pick<ReviewRowIn, "adults" | "mailOptIn" | "addressComplete">): Delivery {
  if (r.adults.length === 0) return "none";
  if (r.mailOptIn && r.addressComplete) return "post";
  if (r.adults.some((a) => a.email)) return "email";
  if (r.adults.some((a) => a.app)) return "app";
  return "none";
}

export function problemsFor(r: ReviewRowIn): Problem[] {
  const out: Problem[] = [];
  if (r.givenCents <= 0) out.push({ key: "nothing_given", text: "Refunds cancel this year's gifts, so there is nothing to state." });
  if (r.adults.length === 0) {
    out.push({ key: "no_adult", text: "No adult on file to address the statement to. Add an adult to the household." });
  } else if (deliveryFor(r) === "none") {
    out.push({ key: "no_way", text: "No email, postal address or app account for any adult. Add an email or a postal address." });
  }
  if (r.mailOptIn && !r.addressComplete) {
    out.push({ key: "address_incomplete", text: "Asked for statements by post, but the address is incomplete (street, city and postal code)." });
  }
  return out;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function notesFor(r: ReviewRowIn, fmt: CommunityFormat): ReviewNote[] {
  const out: ReviewNote[] = [];
  if (r.openingCount > 0) {
    out.push({
      key: "opening_balance",
      text: `${plural(r.openingCount, "opening-balance line", "opening-balance lines")} (${moneyIn(r.openingCents, fmt)}) left out: what was paid before the imported history begins.`,
    });
  }
  if (r.refundedCents > 0) {
    out.push({ key: "refunds", text: `Refunds of ${moneyIn(r.refundedCents, fmt)} are taken off the total.` });
  }
  return out;
}

/** "Mira Member and Dev Member": the adults the statement is addressed to; never a child. */
export function addressedTo(adults: readonly ReviewAdult[]): string {
  const names = adults.map((a) => a.name);
  if (names.length === 0) return "No adult on file";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The household card for a review row: the primary adult (or the first adult), never a child. */
export function reviewFamily(r: ReviewRowIn): Family {
  const primary = r.adults.find((a) => a.primary) ?? r.adults[0] ?? null;
  return { id: r.householdId, name: r.name, number: r.number, orgId: r.orgId, primary: primary?.name ?? null, city: r.city };
}

export function reviewRowView(r: ReviewRowIn, fmt: CommunityFormat): ReviewRowView {
  return {
    ...r,
    family: reviewFamily(r),
    delivery: deliveryFor(r),
    problems: problemsFor(r),
    notes: notesFor(r, fmt),
    total: moneyIn(r.givenCents, fmt),
    addressedTo: addressedTo(r.adults),
  };
}

export function matchesFilter(r: ReviewRowView, f: ReviewFilter): boolean {
  if (f === "all") return true;
  if (f === "fix") return r.problems.length > 0;
  return r.givenCents > 0 && r.delivery === f;
}

export function parseFilter(v: string | null | undefined): ReviewFilter {
  return REVIEW_FILTERS.find((f) => f === v) ?? "all";
}

/** "71 by email, 12 by post, 19 in the app only, 3 need a fix" (parts with none are left out). */
export function countsSentence(counts: Record<Delivery, number>, nothingToState = 0): string {
  const parts = [
    counts.email ? `${counts.email.toLocaleString("en-US")} by email` : null,
    counts.post ? `${counts.post.toLocaleString("en-US")} by post` : null,
    counts.app ? `${counts.app.toLocaleString("en-US")} in the app only` : null,
    counts.none ? `${counts.none.toLocaleString("en-US")} ${counts.none === 1 ? "needs" : "need"} a fix` : null,
    nothingToState ? `${nothingToState.toLocaleString("en-US")} with nothing to state` : null,
  ].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(", ") : "No household gave this year";
}

export function reviewSummary(rows: readonly ReviewRowView[], fmt: CommunityFormat): ReviewSummary {
  const counts: Record<Delivery, number> = { email: 0, post: 0, app: 0, none: 0 };
  let totalCents = 0;
  let nothingToState = 0;
  for (const r of rows) {
    totalCents += r.givenCents;
    if (r.givenCents <= 0) nothingToState += 1;
    else counts[r.delivery] += 1;
  }
  return {
    households: rows.length,
    totalCents,
    total: moneyIn(totalCents, fmt),
    counts,
    nothingToState,
    needFix: rows.filter((r) => r.problems.length > 0).length,
    sentence: countsSentence(counts, nothingToState),
  };
}

/** The year the review opens on: last year from January to March (statement season), this year (so far) afterwards. */
export function defaultStatementYear(today: string): number {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month <= 3 ? year - 1 : year;
}

/** This year and the seven before it, newest first. */
export function statementYears(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return Array.from({ length: 8 }, (_, i) => year - i);
}

/** A year asked for in the address, or the default; never a future year, never before 1990. */
export function chosenStatementYear(raw: string | null | undefined, today: string): number {
  const year = Number(today.slice(0, 4));
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1990 && n <= year ? n : defaultStatementYear(today);
}

/** True once December 31 of the year has passed in the community's time zone. */
export function yearIsOver(year: number, today: string): boolean {
  return today > `${year}-12-31`;
}

/** Today's row (January to March only): last year's statements are due. */
export function statementSeason(today: string): number | null {
  const month = Number(today.slice(5, 7));
  return month >= 1 && month <= 3 ? Number(today.slice(0, 4)) - 1 : null;
}

/** The words of the delivery pill on a row. */
export const DELIVERY_LABEL: Record<Delivery, string> = { email: "By email", post: "By post", app: "In the app only", none: "Needs a fix" };

/** What the Send button in the review sheet says, and why it is off (decision 8: never a fake success). */
export const SEND_COMING_NEXT = "Coming next: the statements service is not connected yet.";

export function sendLabel(counts: Record<Delivery, number>): string {
  const parts = [
    counts.email ? plural(counts.email, "email", "emails") : null,
    counts.post ? plural(counts.post, "letter", "letters") : null,
  ].filter(Boolean);
  return parts.length ? `Send ${parts.join(" and ")}` : "Send statements";
}

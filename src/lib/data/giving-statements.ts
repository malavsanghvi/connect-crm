import "server-only";

// Giving › Statements in the New look (docs/GIVING_REDESIGN.md slice 8): the year-end review (app.year_end_review, 0746) and a
// copy of one receipt (app.receipt_copy, 0746). Reads only. Every failure is said in plain English next to the card it belongs
// to, with the technical detail logged; a refusal for permissions is "You don't have access", a module that is off says so.

import { ageOfMajority } from "@/lib/age-of-majority";
import { identifierRules, isPlainObject } from "@/lib/center-rules";
import { communityFormat, type CommunityFormat } from "@/lib/community-format";
import { todayInTz } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { LIST_WORDS, filterSentence } from "@/lib/giving-export/csv";
import { yearEndExportFilter } from "@/lib/giving-export/filters";
import { exportHref, exportOffer } from "@/lib/giving-lists/model";
import { REVIEW_PAGE_SIZE, type ReceiptPart, type ReviewPart, type StatementsModel } from "@/lib/giving-statements/model";
import { cleanReceiptNumber, parseReceiptCopy, printBlockedReason, receiptCopyLines, receiptFamily } from "@/lib/giving-statements/receipt-copy";
import {
  chosenStatementYear,
  matchesFilter,
  parseFilter,
  parseReviewRows,
  reviewRowView,
  reviewSummary,
  statementYears,
  yearIsOver,
} from "@/lib/giving-statements/review";
import type { StatementsDueIn } from "@/lib/giving-today/queue";
import { givingTabs } from "@/lib/giving-today/tabs";
import type { Part } from "@/lib/giving-workspace/view";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { pageParam, param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";
import { workspaceLabel } from "@/lib/workspaces";

type DbError = { code?: string; message?: string } | null;

const isDenied = (e: DbError) => e?.code === "42501";
const isSwitchedOff = (e: DbError) => /switched off|not part of a|has not enabled/i.test(e?.message ?? "");

/** The format, the age of majority and the time zone every read below needs. */
export function statementsFormat(session: CrmSession): { fmt: CommunityFormat; majority: number } {
  return { fmt: communityFormat(session.center), majority: ageOfMajority(session.center) };
}

export async function loadYearEndReview(session: CrmSession, year: number): Promise<ReviewPart> {
  if (!isModuleEnabled(session, "giving_statements")) return { state: "off" };
  if (!canAccess(session, "statements")) return { state: "no_access" };
  const { fmt, majority } = statementsFormat(session);
  const res = await session.db.rpc("year_end_review", { p_center: session.center.id, p_year: year, p_majority: majority });
  if (res.error) {
    if (isDenied(res.error) && isSwitchedOff(res.error)) return { state: "off" };
    if (isDenied(res.error)) return { state: "no_access" };
    return { state: "error", message: failure(`Could not read the ${year} year-end review`, res.error).error };
  }
  const rows = parseReviewRows(res.data).map((r) => reviewRowView(r, fmt));
  return { state: "ok", rows, summary: reviewSummary(rows, fmt) };
}

/** The donation-receipt template's signer and note, and the community's address (Setup › Branding). */
async function receiptWording(session: CrmSession): Promise<{ signedBy: string; note: string; address: string | null } | { error: string }> {
  const t = await session.db
    .from("receipt_templates")
    .select("signed_by, personal_note")
    .eq("center_id", session.center.id)
    .eq("kind", "donation_receipt")
    .maybeSingle();
  if (t.error) return { error: failure("Could not read the receipt template", t.error).error };
  const branding = isPlainObject(session.center.branding) ? session.center.branding : {};
  return {
    signedBy: t.data?.signed_by ?? "",
    note: t.data?.personal_note ?? "",
    address: typeof branding.address === "string" && branding.address.trim() ? branding.address.trim() : null,
  };
}

/** A copy of the receipt for one payment (by id). */
export async function loadReceiptCopy(session: CrmSession, paymentId: string, today: string): Promise<ReceiptPart> {
  if (!canAccess(session, "statements")) return { state: "no_access" };
  const { fmt, majority } = statementsFormat(session);
  const res = await session.db.rpc("receipt_copy", { p_payment: paymentId, p_majority: majority });
  if (res.error) {
    if (isDenied(res.error) && !isSwitchedOff(res.error)) return { state: "no_access" };
    if (res.error.code === "P0001" && res.error.message) return { state: "refused", message: res.error.message };
    return { state: "error", message: failure("Could not read the receipt", res.error).error };
  }
  const copy = parseReceiptCopy(res.data);
  if (!copy) return { state: "error", message: failure("Could not read the receipt", "receipt_copy returned an unexpected shape").error };
  const wording = await receiptWording(session);
  if ("error" in wording) return { state: "error", message: wording.error };
  const lines = receiptCopyLines(copy, {
    centerName: session.center.name,
    centerAddress: wording.address,
    signedBy: wording.signedBy,
    note: wording.note,
    fmt,
    timeZone: session.center.time_zone,
    today,
    orgKind: session.kind,
  });
  return { state: "ok", view: { copy, family: receiptFamily(copy), lines, printBlocked: printBlockedReason(copy) } };
}

/** A copy of the receipt with this number, as it is written on the receipt. */
export async function findReceiptCopy(session: CrmSession, rawNumber: string | null, today: string): Promise<ReceiptPart> {
  const number = cleanReceiptNumber(rawNumber);
  if (!number) return { state: "none" };
  if (!canAccess(session, "statements")) return { state: "no_access" };
  const found = await session.db
    .from("payments")
    .select("id")
    .eq("center_id", session.center.id)
    .eq("receipt_number", number)
    .maybeSingle();
  if (found.error) {
    if (isDenied(found.error)) return { state: "no_access" };
    return { state: "error", message: failure(`Could not look up receipt ${number}`, found.error).error };
  }
  if (!found.data) return { state: "not_found", message: `No payment has receipt number ${number}. Check the number as it is written on the receipt.` };
  return loadReceiptCopy(session, found.data.id, today);
}

/** Everything the New look's Statements tab draws, from the address (?year, ?show, ?page, ?review, ?receipt). */
export async function loadStatements(session: CrmSession, sp: RawSearchParams): Promise<StatementsModel> {
  const today = todayInTz(session.center.time_zone);
  const year = chosenStatementYear(param(sp, "year"), today);
  const receiptQuery = (param(sp, "receipt") ?? "").trim();
  const [review, receipt] = await Promise.all([loadYearEndReview(session, year), findReceiptCopy(session, receiptQuery, today)]);
  const rules = identifierRules(session.center.rules);
  const page = pageParam(sp);
  const rowsTotal = review.state === "ok" ? review.rows.length : 0;
  const filter = parseFilter(param(sp, "show"));
  return {
    title: workspaceLabel("giving", session.kind),
    tabs: givingTabs(session),
    communityName: session.center.name,
    today,
    timeZone: session.center.time_zone,
    labels: { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel },
    base: "/giving/statements",
    year,
    years: statementYears(today),
    yearOver: yearIsOver(year, today),
    review,
    filter,
    page: Math.min(page, Math.max(1, Math.ceil(rowsTotal / REVIEW_PAGE_SIZE))),
    openReview: param(sp, "review") === "1",
    receiptQuery,
    receipt,
    printBase: "/giving/statements/receipt",
    exportOffer:
      review.state === "ok" && review.rows.length > 0
        ? exportOffer(
            session,
            "year_end_totals",
            exportHref("year_end_totals", { year: String(year), show: filter === "all" ? undefined : filter }),
            review.rows.filter((r) => matchesFilter(r, filter)).length,
            filterSentence(yearEndExportFilter(year, filter), LIST_WORDS.year_end_totals.whole),
            param(sp, "export") === "1",
          )
        : null,
  };
}

/** Today's row: how many households gave last year and how many need a fix before their statement can go. */
export async function loadStatementsDue(session: CrmSession, year: number): Promise<Part<StatementsDueIn>> {
  const review = await loadYearEndReview(session, year);
  if (review.state === "off" || review.state === "no_access") return review;
  if (review.state === "error") return { state: "error", error: review.message };
  const s = review.summary;
  return { state: "ok", data: { year, households: s.households, needFix: s.needFix, sentence: s.sentence } };
}

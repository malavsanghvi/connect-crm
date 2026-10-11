// One door to the Reports summary functions (migration 0672), used by the Reports page and by the Reports commands, so a screen
// and Niva read the same numbers from the same place. Each read answers { ok, value } or { ok: false, error }: a failure of the
// database, or an answer in a shape nobody expected, is an error to show, never zeros. The functions are called through an
// untyped signature (the generated types name them only after the next type refresh); the answers are checked by parse.ts.

import type { DbErrorLike } from "@/lib/errors";
import { untypedRpc } from "@/lib/payments/rpc";
import type { AppSupabase } from "@/lib/supabase/server";

import * as P from "./parse";

export type Section<T> = { ok: true; value: T } | { ok: false; error: DbErrorLike };

async function call<T>(db: AppSupabase, fn: string, args: Record<string, unknown>, parse: (raw: unknown) => T | null): Promise<Section<T>> {
  const res = await untypedRpc(db)(fn, args);
  if (res.error) return { ok: false, error: res.error };
  const value = parse(res.data);
  if (value === null) return { ok: false, error: { message: `${fn} answered in a form this code does not understand`, code: "REPORT_SHAPE" } };
  return { ok: true, value };
}

export type PaymentsGroup = "method" | "month" | "year" | "fund" | "campaign" | "none";

export const reportReads = {
  peopleOverview: (db: AppSupabase, center: string, year: number, today: string) =>
    call(db, "reports_people_overview", { p_center: center, p_year: year, p_today: today }, P.parsePeopleOverview),
  membershipMatrix: (db: AppSupabase, center: string) => call(db, "reports_membership_matrix", { p_center: center }, P.parseMembershipMatrix),
  membershipChanges: (db: AppSupabase, center: string, from: string, to: string, today: string) =>
    call(db, "reports_membership_changes", { p_center: center, p_from: from, p_to: to, p_today: today }, P.parseMembershipChanges),
  payments: (db: AppSupabase, center: string, from: string, to: string, group: PaymentsGroup) =>
    call(db, "reports_payments_summary", { p_center: center, p_from: from, p_to: to, p_group: group }, P.parsePaymentsSummary),
  pledges: (db: AppSupabase, center: string, from: string, to: string) =>
    call(db, "reports_pledges_summary", { p_center: center, p_from: from, p_to: to }, P.parsePledgesSummary),
  attendance: (db: AppSupabase, center: string, from: string, to: string, top = 10) =>
    call(db, "reports_attendance", { p_center: center, p_from: from, p_to: to, p_top: top }, P.parseAttendance),
  storeSales: (db: AppSupabase, center: string, from: string, to: string, top = 10) =>
    call(db, "reports_store_sales", { p_center: center, p_from: from, p_to: to, p_top: top }, P.parseStoreSales),
  periodFigures: (db: AppSupabase, center: string, from: string, to: string) =>
    call(db, "reports_period_figures", { p_center: center, p_from: from, p_to: to }, P.parsePeriodFigures),
  platformWaiting: (db: AppSupabase, limit = 50) => call(db, "platform_waiting", { p_limit: limit }, P.parsePlatformWaiting),
  /** The summary of one community, or null when there is no such community. */
  communitySummary: async (db: AppSupabase, center: string): Promise<Section<P.CommunitySummary | null>> => {
    const res = await untypedRpc(db)("platform_community_summary", { p_center: center });
    if (res.error) return { ok: false, error: res.error };
    if (res.data === null) return { ok: true, value: null };
    const value = P.parseCommunitySummary(res.data);
    if (value === null) return { ok: false, error: { message: "platform_community_summary answered in a form this code does not understand", code: "REPORT_SHAPE" } };
    return { ok: true, value };
  },
} as const;


// The month the community's financial year starts in (Setup › Organization profile, org_profiles.fiscal_year_start_month, migration
// 0180). The Reports page and the Reports commands read it so "this year" and "last year" are the community's own years, not the
// calendar's. When it cannot be read the calendar year is used AND the person is told, never silently.

import { failure } from "@/lib/errors";
import type { AppSupabase } from "@/lib/supabase/server";

import { fiscalStartMonth } from "./periods";

export type FiscalStart = {
  /** 1 to 12. */
  month: number;
  /** Plain English when the month could not be read (the figures then follow the calendar year); null otherwise. */
  problem: string | null;
};

export const FISCAL_NOT_READ = "Could not read when your financial year starts, so these figures follow the calendar year";

export async function loadFiscalStart(db: AppSupabase, centerId: string): Promise<FiscalStart> {
  try {
    const res = await db.from("org_profiles").select("fiscal_year_start_month").eq("center_id", centerId).maybeSingle();
    if (res.error) {
      failure(FISCAL_NOT_READ, res.error);
      return { month: 1, problem: `${FISCAL_NOT_READ}.` };
    }
    return { month: fiscalStartMonth(res.data?.fiscal_year_start_month), problem: null };
  } catch (error) {
    failure(FISCAL_NOT_READ, error);
    return { month: 1, problem: `${FISCAL_NOT_READ}.` };
  }
}

// The Reports commands (B90 phase 4): ask questions of your data. Every one is read-only and answers from the database's own
// sums (migration 0672: security invoker functions with a date range), so a number Niva says is the number the Reports page shows.
// Niva never writes SQL; it can only call these. Exports of report tables stay screen actions. The one thing that changes
// anything (publishing a figure on the public dashboard) is "only you".

import type { AnyCommand } from "../../types";

import { eventAttendance } from "./attendance";
import { campaignProgress } from "./campaign-progress";
import { compareMonthsCommand } from "./compare-months";
import { givingTotals } from "./giving-totals";
import { membershipCounts } from "./membership";
import { reportsOverview } from "./overview";
import { publishKpi } from "./publish-kpi";
import { storeSales } from "./store-sales";

/** In the order a person would ask: how are we doing, then the detail, then the comparison. */
export const REPORTS_COMMANDS: readonly AnyCommand[] = [
  // read
  reportsOverview,
  givingTotals,
  campaignProgress,
  membershipCounts,
  eventAttendance,
  storeSales,
  compareMonthsCommand,
  // only you
  publishKpi,
];

// What the Reports summary functions (migration 0672) answer for the small community of supabase/tests/128_reports_reads_test.sql, written out
// as that test checks it. The DB test holds these numbers against the database; the tests here hold the page and the commands against the
// same numbers, so a figure the page shows and a figure Niva says are the figure the database added up.

export const CAMPAIGN_A = "12800000-0000-4000-8000-000000000601";
export const CAMPAIGN_B = "12800000-0000-4000-8000-000000000602";
export const FUND_FOOD = "12800000-0000-4000-8000-000000000502";

export const PEOPLE_2026 = {
  year: 2026,
  as_of: "2026-10-10",
  households: 4,
  new_in_year: 3,
  households_on_app: 2,
  zones: [
    { zone: "North", households: 2 },
    { zone: "No zone", households: 1 },
    { zone: "South", households: 1 },
  ],
  renewals_due: 1,
};

export const MATRIX = {
  cells: [
    { tier: "community", status: "lapsed", memberships: 1 },
    { tier: "community", status: "pending", memberships: 1 },
    { tier: "life", status: "active", memberships: 1 },
    { tier: "yearly", status: "active", memberships: 2 },
    { tier: "yearly", status: "ended", memberships: 1 },
  ],
  active_households: [
    { tier: "life", households: 1 },
    { tier: "yearly", households: 2 },
  ],
  applications: [
    { status: "awaiting_center", applications: 2 },
    { status: "withdrawn", applications: 1 },
  ],
};

export const CHANGES = {
  from: "2026-06-01",
  to: "2026-10-10",
  started: [
    { tier: "life", memberships: 1 },
    { tier: "yearly", memberships: 1 },
  ],
  started_total: 2,
  ended: [
    { status: "ended", memberships: 1 },
    { status: "lapsed", memberships: 1 },
  ],
  ended_total: 2,
  applications: [{ status: "awaiting_center", applications: 2 }],
  applications_total: 2,
  active_now: 3,
  renewals_due_60_days: 1,
};

const g = (key: string, label: string, payments: number, received: number, refunded: number | null) => ({
  key,
  label,
  payments,
  received_cents: received,
  refunded_cents: refunded,
  net_cents: refunded === null ? null : received - refunded,
});

export const PAY_2026_BY_METHOD = {
  from: "2026-01-01",
  to: "2026-12-31",
  group: "method",
  totals: { payments: 5, received_cents: 102700, refunded_cents: 1000, net_cents: 101700 },
  groups: [g("other", "other", 1, 77700, 0), g("check", "check", 1, 10000, 0), g("cash", "cash", 1, 7000, 0), g("zelle", "zelle", 1, 5000, 0), g("ach", "ach", 1, 3000, 1000)],
};

export const PAY_2026_BY_MONTH = {
  ...PAY_2026_BY_METHOD,
  group: "month",
  groups: [g("2026-01", "2026-01", 1, 77700, 0), g("2026-03", "2026-03", 1, 10000, 0), g("2026-06", "2026-06", 1, 5000, 0), g("2026-09", "2026-09", 1, 3000, 1000), g("2026-10", "2026-10", 1, 7000, 0)],
};

export const PAY_2026_BY_FUND = {
  ...PAY_2026_BY_METHOD,
  group: "fund",
  groups: [g("unallocated", "Not applied to a pledge", 2, 84700, null), g(FUND_FOOD, "G128 Food", 2, 15000, null), g("none", "No fund", 1, 3000, null)],
};

export const PAY_2026_BY_CAMPAIGN = {
  ...PAY_2026_BY_METHOD,
  group: "campaign",
  groups: [g("unallocated", "Not applied to a pledge", 2, 84700, null), g(CAMPAIGN_A, "G128 Paryushan", 2, 15000, null), g(CAMPAIGN_B, "G128 Diwali", 1, 3000, null)],
};

/** January 1 to October 10, 2025, no grouping asked for. */
export const PAY_2025_TO_DATE = {
  from: "2025-01-01",
  to: "2025-10-10",
  group: "none",
  totals: { payments: 1, received_cents: 4000, refunded_cents: 0, net_cents: 4000 },
  groups: [],
};

export const PLEDGES_2026 = {
  from: "2026-01-01",
  to: "2026-12-31",
  totals: { pledges: 4, pledged_cents: 84000, paid_cents: 20000, written_off_cents: 6000 },
  campaigns: [
    { campaign_id: CAMPAIGN_A, campaign: "G128 Paryushan", pledges: 2, pledged_cents: 58000, paid_cents: 17000, written_off_cents: 6000 },
    { campaign_id: CAMPAIGN_B, campaign: "G128 Diwali", pledges: 1, pledged_cents: 20000, paid_cents: 3000, written_off_cents: 0 },
    { campaign_id: null, campaign: null, pledges: 1, pledged_cents: 6000, paid_cents: 0, written_off_cents: 0 },
  ],
  open_now: { pledges: 4, open_cents: 62000 },
};

export const ATTENDANCE_2026 = {
  from: "2026-01-01",
  to: "2026-12-31",
  check_ins: 4,
  events: 1,
  top_events: [{ event_id: "12800000-0000-4000-8000-000000000901", name: "G128 Diwali dinner", starts_at: "2026-09-20T23:00:00+00:00", check_ins: 4 }],
  by_month: [
    { month: "2026-01", check_ins: 1 },
    { month: "2026-09", check_ins: 3 },
  ],
};

export const ATTENDANCE_2025_TO_DATE = { from: "2025-01-01", to: "2025-10-10", check_ins: 1, events: 1, top_events: [], by_month: [{ month: "2025-09", check_ins: 1 }] };

export const SHOP_2026 = {
  from: "2026-01-01",
  to: "2026-10-10",
  orders: 3,
  sales_cents: 4500,
  by_month: [
    { month: "2026-09", orders: 2, sales_cents: 3500 },
    { month: "2026-10", orders: 1, sales_cents: 1000 },
  ],
  top_items: [
    { item: "G128 Kaju katli", units: 3, sales_cents: 3000 },
    { item: "G128 Chakli", units: 6, sales_cents: 1500 },
  ],
};

export const FIGURES_SEP = {
  from: "2026-09-01",
  to: "2026-09-30",
  giving: { payments: 1, received_cents: 3000, refunded_cents: 1000, net_cents: 2000 },
  new_households: 0,
  memberships_started: 0,
  applications_received: 1,
  check_ins: 3,
  store: { orders: 2, sales_cents: 3500 },
};

export const FIGURES_OCT_TO_DATE = {
  from: "2026-10-01",
  to: "2026-10-10",
  giving: { payments: 1, received_cents: 7000, refunded_cents: 0, net_cents: 7000 },
  new_households: 0,
  memberships_started: 0,
  applications_received: 0,
  check_ins: 0,
  store: { orders: 1, sales_cents: 1000 },
};

/** September 1 to 10, the same days of last month as October 1 to 10 (the invented fixture has payments only on September 15 and 30-day totals above). */
export const FIGURES_SEP_SAME_DAYS = {
  from: "2026-09-01",
  to: "2026-09-10",
  giving: { payments: 0, received_cents: 0, refunded_cents: 0, net_cents: 0 },
  new_households: 0,
  memberships_started: 0,
  applications_received: 0,
  check_ins: 0,
  store: { orders: 0, sales_cents: 0 },
};

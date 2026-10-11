// The Reports page as it was before migration 0672: it read the rows (up to 50,000 of each, 1,000 at a time) and added them up in page
// code. This is that arithmetic, kept as the reference the new figures are held against (legacy-parity.test.ts). Only the arithmetic is
// kept; the paging and the screens are not.

export type LegacyRows = {
  memberships: { tier: string; status: string; household_id: string }[];
  applications: { status: string }[];
  /** Pledges made in the year, cancelled ones already left out (the query did that). */
  pledges: { campaign_id: string | null; amount_cents: number; paid_cents: number; status: string }[];
  /** Payments received in the year, failed, voided and authorized ones already left out. */
  payments: { method: string; amount_cents: number; refunded_cents: number }[];
  prevPayments: { amount_cents: number; refunded_cents: number }[];
  openPledges: { amount_cents: number; paid_cents: number }[];
  households: { id: string; zone_id: string | null; created_at: string }[];
  zoneNames: Record<string, string>;
  /** center_users.person_id */
  links: { person_id: string }[];
  /** household_members with left_at null */
  members: { person_id: string; household_id: string }[];
  campaigns: Record<string, string>;
  yearFrom: string;
  yearTo: string;
};

export function legacyFigures(rows: LegacyRows) {
  const matrix = new Map<string, number>();
  const activeHouseholds = new Map<string, Set<string>>();
  for (const m of rows.memberships) {
    matrix.set(`${m.tier}|${m.status}`, (matrix.get(`${m.tier}|${m.status}`) ?? 0) + 1);
    if (m.status === "active") {
      const set = activeHouseholds.get(m.tier) ?? new Set<string>();
      set.add(m.household_id);
      activeHouseholds.set(m.tier, set);
    }
  }
  const appCounts = new Map<string, number>();
  for (const a of rows.applications) appCounts.set(a.status, (appCounts.get(a.status) ?? 0) + 1);

  const byCampaign = new Map<string, { pledged: number; paid: number; writtenOff: number; count: number }>();
  for (const p of rows.pledges) {
    const key = p.campaign_id ?? "none";
    const t = byCampaign.get(key) ?? { pledged: 0, paid: 0, writtenOff: 0, count: 0 };
    t.pledged += p.amount_cents;
    t.paid += p.paid_cents;
    if (p.status === "written_off") t.writtenOff += p.amount_cents - p.paid_cents;
    t.count += 1;
    byCampaign.set(key, t);
  }
  const campaignRows = [...byCampaign.entries()].sort((a, b) => b[1].pledged - a[1].pledged);
  const byMethod = new Map<string, { amount: number; count: number }>();
  for (const p of rows.payments) {
    const t = byMethod.get(p.method) ?? { amount: 0, count: 0 };
    t.amount += p.amount_cents - p.refunded_cents;
    t.count += 1;
    byMethod.set(p.method, t);
  }
  const hhRows = rows.households;
  const newThisYear = hhRows.filter((h) => h.created_at >= rows.yearFrom && h.created_at < rows.yearTo).length;
  const linked = new Set(rows.links.map((l) => l.person_id));
  const onApp = new Set(rows.members.filter((m) => linked.has(m.person_id)).map((m) => m.household_id));
  const hhIds = new Set(hhRows.map((h) => h.id));
  const onAppPct = hhRows.length ? Math.round((100 * [...onApp].filter((id) => hhIds.has(id)).length) / hhRows.length) : null;
  const givenYtd = rows.payments.reduce((sum, p) => sum + p.amount_cents - p.refunded_cents, 0);
  const givenPrev = rows.prevPayments.reduce((sum, p) => sum + p.amount_cents - p.refunded_cents, 0);
  const openCents = rows.openPledges.reduce((sum, p) => sum + p.amount_cents - p.paid_cents, 0);
  const byZone = new Map<string, number>();
  for (const h of hhRows) {
    const k = h.zone_id ? (rows.zoneNames[h.zone_id] ?? "Other") : "No zone";
    byZone.set(k, (byZone.get(k) ?? 0) + 1);
  }
  const zoneRows = [...byZone.entries()].sort((a, b) => b[1] - a[1]);
  return { matrix, activeHouseholds, appCounts, campaignRows, byMethod, newThisYear, onAppPct, households: hhRows.length, givenYtd, givenPrev, openCents, zoneRows };
}

/** The community of supabase/tests/128_reports_reads_test.sql as the old page would have read it for 2026. */
export const FIXTURE_2026: LegacyRows = {
  memberships: [
    { tier: "yearly", status: "active", household_id: "h1" },
    { tier: "yearly", status: "active", household_id: "h2" },
    { tier: "life", status: "active", household_id: "h3" },
    { tier: "community", status: "lapsed", household_id: "h4" },
    { tier: "community", status: "pending", household_id: "h1" },
    { tier: "yearly", status: "ended", household_id: "h2" },
  ],
  applications: [{ status: "awaiting_center" }, { status: "awaiting_center" }, { status: "withdrawn" }],
  pledges: [
    { campaign_id: "A", amount_cents: 50000, paid_cents: 15000, status: "partially_paid" },
    { campaign_id: "B", amount_cents: 20000, paid_cents: 3000, status: "partially_paid" },
    { campaign_id: null, amount_cents: 6000, paid_cents: 0, status: "open" },
    { campaign_id: "A", amount_cents: 8000, paid_cents: 2000, status: "written_off" },
  ],
  payments: [
    { method: "check", amount_cents: 10000, refunded_cents: 0 },
    { method: "zelle", amount_cents: 5000, refunded_cents: 0 },
    { method: "ach", amount_cents: 3000, refunded_cents: 1000 },
    { method: "cash", amount_cents: 7000, refunded_cents: 0 },
    { method: "other", amount_cents: 77700, refunded_cents: 0 },
  ],
  prevPayments: [{ amount_cents: 4000, refunded_cents: 0 }],
  openPledges: [
    { amount_cents: 50000, paid_cents: 15000 },
    { amount_cents: 20000, paid_cents: 3000 },
    { amount_cents: 6000, paid_cents: 0 },
    { amount_cents: 4000, paid_cents: 0 },
  ],
  households: [
    { id: "h1", zone_id: "z1", created_at: "2026-02-01T12:00:00Z" },
    { id: "h2", zone_id: "z1", created_at: "2025-11-01T12:00:00Z" },
    { id: "h3", zone_id: null, created_at: "2026-06-15T12:00:00Z" },
    { id: "h4", zone_id: "z2", created_at: "2026-03-03T12:00:00Z" },
  ],
  zoneNames: { z1: "North", z2: "South" },
  links: [{ person_id: "p1" }, { person_id: "p3" }, { person_id: "p4" }, { person_id: "po" }, { person_id: "pv" }],
  members: [
    { person_id: "p1", household_id: "h1" },
    { person_id: "p2", household_id: "h1" },
    { person_id: "p4", household_id: "h3" },
    { person_id: "p5", household_id: "h4" },
  ],
  campaigns: { A: "G128 Paryushan", B: "G128 Diwali" },
  yearFrom: "2026-01-01T06:00:00Z",
  yearTo: "2027-01-01T06:00:00Z",
};

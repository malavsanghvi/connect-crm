// DEV ONLY. Invented giving for a neutral community (a church with members from several cultures), for the preview of "Giving at a
// glance". Nothing here is real; money is integer cents. The household has two adults and a child: the child is in the data (a gift
// and a pledge are recorded under them) so the preview proves they are never named or listed.

import type { GlancePayment, GlancePledge, GlanceRecurring, GlanceRows } from "@/lib/giving-glance/summary";

export const PREVIEW_TODAY = "2026-10-12";
export const PREVIEW_COMMUNITY = "Riverside Community Church";
export const PREVIEW_CURRENCY = "USD";
export const PREVIEW_TZ = "America/Chicago";

export const HOUSEHOLD = "hh-okafor-silva";
export const AMARA = "person-amara";
export const MATEO = "person-mateo";
export const CHILD = "person-child";

export const ADULTS = [
  { id: AMARA, name: "Amara Okafor" },
  { id: MATEO, name: "Mateo Silva" },
];
export const CARD_LINE = "Household H-1042 · Amara Okafor, Mateo Silva · Springfield · Last gift Oct 5, 2026 · Open pledges $2,280.00";

const pledge = (id: string, o: Partial<GlancePledge>): GlancePledge => ({
  id,
  household_id: HOUSEHOLD,
  person_id: null,
  amount_cents: 0,
  paid_cents: 0,
  status: "open",
  pledged_on: "2026-01-01",
  due_on: null,
  ...o,
});
const payment = (id: string, received_on: string, amount_cents: number, o: Partial<GlancePayment> = {}): GlancePayment => ({
  id,
  household_id: HOUSEHOLD,
  person_id: null,
  amount_cents,
  refunded_cents: 0,
  status: "settled",
  received_on,
  is_opening_balance: false,
  allocations: [],
  ...o,
});

const month = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

function rows(): GlanceRows {
  const pledges: GlancePledge[] = [
    pledge("p24-1", { person_id: AMARA, amount_cents: 240_000, paid_cents: 240_000, status: "paid", pledged_on: "2024-02-10" }),
    pledge("p25-1", { person_id: AMARA, amount_cents: 360_000, paid_cents: 360_000, status: "paid", pledged_on: "2025-01-15" }),
    pledge("p25-2", { person_id: MATEO, amount_cents: 60_000, paid_cents: 60_000, status: "paid", pledged_on: "2025-04-03" }),
    pledge("p25-3", { amount_cents: 40_000, paid_cents: 0, pledged_on: "2025-11-20", due_on: "2025-12-24" }),
    pledge("p26-1", { person_id: AMARA, amount_cents: 360_000, paid_cents: 300_000, status: "partially_paid", pledged_on: "2026-01-12", due_on: "2026-12-31" }),
    pledge("p26-2", { person_id: MATEO, amount_cents: 120_000, paid_cents: 30_000, status: "partially_paid", pledged_on: "2026-02-20", due_on: "2026-08-01" }),
    pledge("p26-3", { amount_cents: 50_000, paid_cents: 12_000, status: "partially_paid", pledged_on: "2026-08-15" }),
    pledge("p26-4", { person_id: MATEO, amount_cents: 150_000, paid_cents: 150_000, status: "paid", pledged_on: "2026-03-30" }),
    pledge("p26-5", { person_id: CHILD, amount_cents: 10_000, paid_cents: 10_000, status: "paid", pledged_on: "2026-05-02" }),
    pledge("p26-6", { amount_cents: 20_000, paid_cents: 0, status: "cancelled", pledged_on: "2026-06-01" }),
  ];
  // Which pledge belongs to which campaign or fund (the loader does this from the database; the preview writes it down).
  const cause: Record<string, string | null> = {
    "p24-1": "Building fund",
    "p25-1": "Building fund",
    "p25-2": "Youth camp",
    "p25-3": "Christmas appeal",
    "p26-1": "Building fund",
    "p26-2": "Food pantry",
    "p26-3": "Missions",
    "p26-4": "Organ restoration",
    "p26-5": null,
  };
  const alloc = (pledgeId: string, cents: number) => [{ cause: cause[pledgeId] ?? null, cents }];

  const payments: GlancePayment[] = [
    payment("opening", "2024-01-01", 500_000, { is_opening_balance: true }),
    payment("g24-1", "2024-03-01", 80_000, { person_id: AMARA, allocations: alloc("p24-1", 80_000) }),
    payment("g24-2", "2024-06-01", 80_000, { person_id: AMARA, allocations: alloc("p24-1", 80_000) }),
    payment("g24-3", "2024-09-01", 80_000, { person_id: AMARA, allocations: alloc("p24-1", 80_000) }),
    payment("g24-4", "2024-12-15", 12_500),
  ];
  for (let m = 1; m <= 12; m++) payments.push(payment(`g25-${m}`, `${month(2025, m)}-05`, 30_000, { person_id: AMARA, allocations: alloc("p25-1", 30_000) }));
  payments.push(payment("g25-youth", "2025-04-20", 60_000, { person_id: MATEO, allocations: alloc("p25-2", 60_000) }));
  payments.push(payment("g25-loose", "2025-06-10", 15_000));
  for (let m = 1; m <= 10; m++) payments.push(payment(`g26-${m}`, `${month(2026, m)}-05`, 30_000, { person_id: AMARA, allocations: alloc("p26-1", 30_000) }));
  payments.push(payment("g26-pantry", "2026-03-15", 30_000, { person_id: MATEO, allocations: alloc("p26-2", 30_000) }));
  payments.push(payment("g26-organ", "2026-04-10", 150_000, { person_id: MATEO, allocations: alloc("p26-4", 150_000) }));
  payments.push(payment("g26-refund", "2026-05-01", 10_000, { status: "partially_refunded", refunded_cents: 4_000 }));
  payments.push(payment("g26-child", "2026-06-05", 5_000, { person_id: CHILD }));
  payments.push(payment("g26-missions", "2026-09-02", 12_000, { allocations: alloc("p26-3", 12_000) }));
  payments.push(payment("g26-failed", "2026-09-20", 99_900, { status: "failed" }));

  const recurring: GlanceRecurring[] = [{ id: "r1", household_id: HOUSEHOLD, person_id: AMARA, amount_cents: 30_000, frequency: "monthly", status: "active" }];
  return { pledges, payments, recurring };
}

export const FIXTURE_ROWS: GlanceRows = rows();
export const EMPTY_ROWS: GlanceRows = { pledges: [], payments: [], recurring: [] };

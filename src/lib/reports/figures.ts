// What the Reports page shows, worked out from what the database added up (parse.ts). Pure: the page passes in what it read and draws
// what comes back, and the tests hold these numbers against the figures the page used to work out itself from thousands of rows
// (tests/reports/legacy-parity.test.ts).

import { cellCount, onAppPercent, outstandingCents, type MembershipMatrix, type PaymentsSummary, type PeopleOverview, type PledgesSummary } from "./parse";

export type CampaignLine = {
  campaignId: string | null;
  campaign: string | null;
  pledges: number;
  pledgedCents: number;
  paidCents: number;
  writtenOffCents: number;
  outstandingCents: number;
};

export type MethodLine = { method: string; payments: number; netCents: number };

export type PageFigures = {
  households: number | null;
  newInYear: number | null;
  onAppPct: number | null;
  renewalsDue: number | null;
  zones: { zone: string; households: number }[];
  /** Pledges made in the year by campaign, the largest first. */
  campaigns: CampaignLine[];
  /** Money received in the year by method (net of refunds), the largest first. */
  methods: MethodLine[];
  givenYtd: number;
  givenPrev: number;
  openPledgesCents: number | null;
  /** Memberships for a tier and a status. */
  membershipCell: (tier: string, status: string) => number;
  activeHouseholds: (tier: string) => number;
  applicationCounts: Record<string, number>;
};

export function pageFigures(parts: {
  people: PeopleOverview | null;
  matrix: MembershipMatrix | null;
  payments: PaymentsSummary | null;
  prevPayments: PaymentsSummary | null;
  pledges: PledgesSummary | null;
}): PageFigures {
  const { people, matrix, payments, prevPayments, pledges } = parts;
  return {
    households: people ? people.households : null,
    newInYear: people ? people.newInYear : null,
    onAppPct: people ? onAppPercent(people) : null,
    renewalsDue: people ? people.renewalsDue : null,
    zones: people ? people.zones : [],
    campaigns: (pledges?.campaigns ?? []).map((c) => ({ ...c, outstandingCents: outstandingCents(c) })),
    methods: (payments?.groups ?? []).map((g) => ({ method: g.key, payments: g.payments, netCents: g.netCents ?? g.receivedCents })),
    givenYtd: payments?.totals.netCents ?? 0,
    givenPrev: prevPayments?.totals.netCents ?? 0,
    openPledgesCents: pledges ? pledges.openNow.openCents : null,
    membershipCell: (tier, status) => (matrix ? cellCount(matrix, tier, status) : 0),
    activeHouseholds: (tier) => matrix?.activeHouseholds[tier] ?? 0,
    applicationCounts: matrix?.applications ?? {},
  };
}

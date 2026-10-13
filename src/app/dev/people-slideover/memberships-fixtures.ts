// DEV ONLY. Invented memberships for the neutral community of the dev previews (Riverside Community), for the Memberships section of
// the person slide-over. Nothing here is real. Today is the preview's 2026-10-12; money is in dollars because the community is.

import type { FamilyModel } from "@/lib/people-v2/family-model";
import { householdLine, detailHousehold, part, type Part } from "@/lib/people-v2/slideover";
import { liveOf, type AssignContext, type MembershipRow, type MembershipTypeOption, type MembershipsData } from "@/lib/people-v2/memberships";
import type { PanelStart } from "@/components/people-v2/slideover/memberships-section";

export const PREVIEW_TODAY = "2026-10-12";

export const TYPES: MembershipTypeOption[] = [
  { id: "t-friend", name: "Friend", tier: "community", feeCents: 0, feeLabel: null, periodMonths: null },
  { id: "t-annual", name: "Annual member", tier: "yearly", feeCents: 5000, feeLabel: "$50.00", periodMonths: 12 },
  { id: "t-student", name: "Student", tier: "yearly", feeCents: 0, feeLabel: null, periodMonths: 12 },
  { id: "t-life", name: "Lifetime member", tier: "life", feeCents: 50000, feeLabel: "$500.00", periodMonths: null },
];

type Draft = Omit<MembershipRow, "household" | "householdId">;

const ROWS: Record<string, Draft[]> = {
  "hh-hassan": [
    {
      id: "m1",
      tier: "yearly",
      typeName: "Annual member",
      status: "active",
      startsOn: "2026-04-01",
      endsOn: "2027-03-31",
      notes: "Assigned by staff: Paid at the office desk",
      holder: { id: "p-samira", name: "Samira Hassan" },
      hasFeePledge: true,
      fixedTerm: true,
    },
    { id: "m0", tier: "community", typeName: "Friend", status: "ended", startsOn: "2022-04-01", endsOn: "2026-03-31", notes: null, holder: { id: "p-samira", name: "Samira Hassan" }, hasFeePledge: false, fixedTerm: false },
  ],
  "hh-adeyemi": [
    {
      id: "m3",
      tier: "yearly",
      typeName: "Annual member",
      status: "active",
      startsOn: "2025-04-01",
      endsOn: "2026-03-31",
      notes: "Imported from the old member list",
      holder: { id: "p-tunde", name: "Tunde Adeyemi" },
      hasFeePledge: false,
      fixedTerm: true,
    },
    { id: "m2", tier: "community", typeName: "Friend", status: "ended", startsOn: "2021-02-01", endsOn: "2025-03-31", notes: null, holder: null, hasFeePledge: false, fixedTerm: false },
  ],
  "hh-tanaka": [
    { id: "m4", tier: "life", typeName: "Lifetime member", status: "active", startsOn: "2024-06-15", endsOn: null, notes: "Assigned by staff: 生涯会員の会費を窓口で受領", holder: { id: "p-misaki", name: "田中 美咲" }, hasFeePledge: true, fixedTerm: false },
  ],
  "hh-valdes": [],
};

export type MembershipsFixtureOptions = {
  /** Holds both people.approve and people.manage. */
  canChange: boolean;
  /** Pledges & donations is on. */
  givingOn?: boolean;
  /** "no-access" for a role that cannot read memberships; "error" for a read that failed. */
  state?: "ok" | "no-access" | "error";
};

export function membershipsFixture(model: FamilyModel, personId: string, o: MembershipsFixtureOptions): Part<MembershipsData> {
  if (o.state === "no-access") return part.noAccess();
  if (o.state === "error") return part.error("Could not load the memberships: the database could not be reached — check the connection and try again.");
  const line = householdLine(detailHousehold(model));
  const rows: MembershipRow[] = (ROWS[model.id] ?? []).map((d) => ({ ...d, householdId: model.id, household: line }));
  const holders = model.adults.filter((a) => !a.deceased).map((a) => ({ id: a.id, name: a.name }));
  const live = liveOf(rows, model.id, PREVIEW_TODAY);
  const assign: AssignContext | null = o.canChange
    ? {
        householdId: model.id,
        household: line,
        types: TYPES,
        holders,
        defaultHolderId: holders.find((h) => h.id === personId)?.id ?? model.adults.find((a) => a.isPrimary)?.id ?? holders[0]?.id ?? null,
        givingOn: o.givingOn ?? true,
        live: live ? { id: live.id, tier: live.tier, typeName: live.typeName, endsOn: live.endsOn } : null,
      }
    : null;
  return part.ok({ rows, truncated: false, today: PREVIEW_TODAY, canChange: o.canChange, assign });
}

/** The states the preview can open straight away (?ms=...), so each can be looked at and screenshotted. */
export const MS_STATES = [
  "list",
  "edit",
  "edit-problem",
  "edit-error",
  "tier",
  "tier-confirm",
  "tier-error",
  "assign",
  "assign-fee",
  "assign-nofee",
  "assign-confirm",
  "assign-confirm-life",
  "assign-confirm-nogiving",
  "assign-problem",
  "assign-error",
] as const;
export type MsState = (typeof MS_STATES)[number];

/** Which panel each state opens, and in what condition. */
export function panelFor(state: MsState, rows: readonly MembershipRow[]): PanelStart | undefined {
  const live = rows.find((r) => r.status === "active");
  const first = live ?? rows[0];
  switch (state) {
    case "list":
      return undefined;
    case "edit":
      return first ? { kind: "edit", id: first.id, start: { draft: { startsOn: "2026-03-20", reason: "Corrected from the paper form" } } } : undefined;
    case "edit-problem":
      return first ? { kind: "edit", id: first.id, start: { draft: { endsOn: "2026-10-01", reason: "" }, problem: { field: "endsOn", error: "An active membership cannot be given an end date in the past. To end it today, choose today as the end date: it counts until the end of today. To move the family to a different tier, use Change tier" } } } : undefined;
    case "edit-error":
      return first ? { kind: "edit", id: first.id, start: { draft: { notes: "Paid by cheque 4417", reason: "Added the cheque number" }, failure: "Could not save the membership — the database could not be reached — check the connection and try again." } } : undefined;
    case "tier":
      return { kind: "tier", start: { draft: { tier: "life", reason: "Paid the life fee at the office" } } };
    case "tier-confirm":
      return { kind: "tier", start: { draft: { tier: "life", reason: "Paid the life fee at the office" }, step: "confirm" } };
    case "tier-error":
      return { kind: "tier", start: { draft: { tier: "life", reason: "Paid the life fee at the office" }, step: "confirm", failure: "Could not change the membership tier — No life membership type is set up for this center. Nothing was changed." } };
    case "assign":
      return { kind: "assign" };
    case "assign-fee":
      return { kind: "assign", start: { draft: { typeId: "t-annual", reason: "Paid at the office desk", recordFee: true } } };
    case "assign-nofee":
      return { kind: "assign", start: { draft: { typeId: "t-student", reason: "Student rate, no fee" } } };
    case "assign-confirm":
      return { kind: "assign", start: { draft: { typeId: "t-annual", reason: "Paid at the office desk", recordFee: true }, step: "confirm" } };
    case "assign-confirm-life":
      return { kind: "assign", start: { draft: { typeId: "t-life", reason: "Life fee paid by cheque 1031", recordFee: true }, step: "confirm" } };
    case "assign-confirm-nogiving":
      return { kind: "assign", start: { draft: { typeId: "t-annual", reason: "Paid at the office desk", recordFee: true }, step: "confirm" } };
    case "assign-problem":
      return { kind: "assign", start: { draft: { typeId: "", reason: "" }, problem: { field: "typeId", error: "Choose a membership type" } } };
    case "assign-error":
      return { kind: "assign", start: { draft: { typeId: "t-life", reason: "Life fee paid by cheque 1031", recordFee: true }, step: "confirm", failure: "Could not assign the membership — This family already has an active Yearly membership (since Apr 1, 2026). To move it to a different tier, use Change tier." } };
  }
}

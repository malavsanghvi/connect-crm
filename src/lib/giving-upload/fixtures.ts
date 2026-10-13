// Invented data for the dev preview of the Giving uploads (/dev/giving-upload) and its tests: two communities, a temple in dollars
// (month first) and a food bank in pounds (day first, not faith-based). Households carry several kinds of ID; one bank payer name is
// shared by two households; one household has a child (never named). Nothing here is real.

import type { Family } from "@/lib/giving-today/queue";

import type { HouseholdHit } from "./households";
import { readPledgeLines, type PledgeLookups, type ReadPledges } from "./pledges";
import { conventionsFor, type Conventions, type EarlierUpload, type UploadTable } from "./sheet";

export type UploadCommunity = "temple" | "foodbank";

export const UPLOAD_TODAY = "2026-10-13";

const fam = (id: string, name: string, number: string, primary: string, city: string): Family => ({ id, name, number, orgId: null, primary, city });

const ADEYEMI = fam("9d000000-0000-4000-8000-000000000001", "Adeyemi", "0127", "Tunde Adeyemi", "Houston");
const OKAFOR = fam("9d000000-0000-4000-8000-000000000002", "Okafor", "0388", "Ngozi Okafor", "Sugar Land");
const OKAFOR2 = fam("9d000000-0000-4000-8000-000000000003", "Okafor", "0390", "Chidi Okafor", "Katy");
const LIN = fam("9d000000-0000-4000-8000-000000000004", "Lin household", "0441", "Mei Lin", "Houston");
const HADDAD = fam("9d000000-0000-4000-8000-000000000005", "Haddad household", "H-0021", "Noor Haddad", "Leeds");
const MORGAN = fam("9d000000-0000-4000-8000-000000000006", "Morgan", "H-0022", "Rhys Morgan", "Bradford");

const hit = (input: string, matchKind: string, family: Family, personId: string | null = null): HouseholdHit => ({
  input,
  matchKind,
  householdId: family.id,
  personId,
  family,
});

export function uploadConventions(c: UploadCommunity): Conventions {
  return c === "foodbank" ? conventionsFor({ currency: "GBP", locale: "en-GB" }) : conventionsFor({ currency: "USD", locale: "en-US" });
}

export function sampleLookups(c: UploadCommunity): PledgeLookups {
  const base = {
    today: UPLOAD_TODAY,
    dueDays: c === "foodbank" ? 14 : 30,
    labels: c === "foodbank" ? { orgMemberLabel: "Supporter ID", orgHouseholdLabel: "Supporter household" } : { orgMemberLabel: "Member ID", orgHouseholdLabel: "Household ID" },
    household: "household",
  };
  if (c === "foodbank") {
    return {
      ...base,
      currency: "GBP",
      locale: "en-GB",
      hits: [hit("H-0021", "connect_household", HADDAD), hit("S-77", "org_member", MORGAN, "9e000000-0000-4000-8000-000000000021"), hit("Morgan", "name", MORGAN)],
      targets: [
        { kind: "fund", id: "9f000000-0000-4000-8000-000000000011", name: "Meals" },
        { kind: "campaign", id: "9f000000-0000-4000-8000-000000000012", name: "Winter appeal" },
      ],
      adults: {
        [HADDAD.id]: [{ id: "9e000000-0000-4000-8000-000000000020", name: "Noor Haddad" }],
        [MORGAN.id]: [{ id: "9e000000-0000-4000-8000-000000000021", name: "Rhys Morgan" }],
      },
      existing: [],
    };
  }
  return {
    ...base,
    currency: "USD",
    locale: "en-US",
    hits: [
      hit("0127", "connect_household", ADEYEMI),
      hit("M-0417", "connect_member", OKAFOR, "9e000000-0000-4000-8000-000000000002"),
      hit("NEON-55", "crm", LIN),
      hit("QB-1187", "accounting", OKAFOR),
      hit("OKAFOR N", "bank_payer", OKAFOR),
      hit("OKAFOR N", "bank_payer", OKAFOR2),
      hit("Okafor", "name", OKAFOR),
      hit("Okafor", "name", OKAFOR2),
      hit("M-0999", "connect_member", ADEYEMI, "9e000000-0000-4000-8000-000000000099"),
    ],
    targets: [
      { kind: "fund", id: "9f000000-0000-4000-8000-000000000001", name: "Building fund" },
      { kind: "campaign", id: "9f000000-0000-4000-8000-000000000002", name: "New hall" },
      { kind: "opportunity", id: "9f000000-0000-4000-8000-000000000003", name: "Name a classroom" },
    ],
    adults: {
      [ADEYEMI.id]: [
        { id: "9e000000-0000-4000-8000-000000000001", name: "Tunde Adeyemi" },
        { id: "9e000000-0000-4000-8000-000000000011", name: "Bola Adeyemi" },
      ],
      [OKAFOR.id]: [{ id: "9e000000-0000-4000-8000-000000000002", name: "Ngozi Okafor" }],
      [OKAFOR2.id]: [{ id: "9e000000-0000-4000-8000-000000000003", name: "Chidi Okafor" }],
      [LIN.id]: [{ id: "9e000000-0000-4000-8000-000000000004", name: "Mei Lin" }],
    },
    existing: [
      {
        number: "PL-0455",
        householdId: OKAFOR.id,
        amountCents: 80_000,
        campaignId: "9f000000-0000-4000-8000-000000000002",
        fundId: "9f000000-0000-4000-8000-000000000001",
        opportunityId: null,
        pledgedOn: "2026-10-01",
      },
    ],
  };
}

/** A sample file: ready rows, a name to pick, a shared payer name, a repeat, a child named as the pledger, an unknown fund. */
export function sampleTable(c: UploadCommunity): UploadTable {
  const headers = ["Household ID", "Name (to check)", "Amount", "For", "Pledged on", "Due on", "Pledged by", "Dedication", "Note"];
  const rows =
    c === "foodbank"
      ? [
          ["H-0021", "Haddad", "£80", "Meals", "01/10/2026", "", "Noor", "", "Card 1"],
          ["Morgan", "", "£25.50", "Winter appeal", "", "", "", "", ""],
          ["S-77", "", "40", "", "", "31/12/2026", "", "", ""],
        ]
      : [
          ["0127", "Adeyemi", "$500.00", "Building fund", "10/01/2026", "12/31/2026", "Bola", "", "Card 14"],
          ["NEON-55", "", "1,250.50", "", "", "", "", "In memory of Ba", ""],
          ["Okafor", "", "100", "New hall", "", "", "", "", "Phone"],
          ["OKAFOR N", "", "150", "", "", "", "", "", ""],
          ["M-0417", "", "800", "New hall", "10/01/2026", "", "", "", ""],
          ["0127", "", "75", "", "", "", "Kavi", "", ""],
          ["QB-1187", "Patel", "60", "Roof appeal", "", "", "", "", ""],
        ];
  return { fileName: c === "foodbank" ? "spring-pledges.csv" : "dinner-pledge-cards.csv", source: "csv", headers, rows: rows.map((cells, i) => ({ line: i + 2, cells })) };
}

export function sampleRead(c: UploadCommunity): ReadPledges {
  return readPledgeLines(sampleTable(c), uploadConventions(c), UPLOAD_TODAY, { household: "household" });
}

export function sampleEarlier(c: UploadCommunity): EarlierUpload[] {
  return [
    {
      id: "9a000000-0000-4000-8000-000000000001",
      fileName: c === "foodbank" ? "autumn.csv" : "gala-cards.xlsx",
      reason: "Pledge cards",
      rowCount: 12,
      totalCents: 340_000,
      createdAt: "2026-10-05T18:30:00Z",
      cancelledAt: null,
      cancelReason: null,
      cancellable: true,
      note: null,
    },
    {
      id: "9a000000-0000-4000-8000-000000000002",
      fileName: "september.csv",
      reason: "Pledges from the event",
      rowCount: 30,
      totalCents: 910_000,
      createdAt: "2026-09-20T15:00:00Z",
      cancelledAt: null,
      cancelReason: null,
      cancellable: false,
      note: "4 of its pledges have money applied or another status, so each pledge is handled on its own.",
    },
  ];
}

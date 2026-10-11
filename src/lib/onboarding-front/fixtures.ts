// Invented sample data for the front door: the heading rows of the exports the recogniser knows (used by its tests) and a
// whole screen for a made-up neutral community (the dev preview, src/app/dev/onboarding-start). No real organization,
// person or amount. Pure.

import { personTemplateHeader } from "@/lib/onboarding/people";

import { buildFrontDoor, type FrontInput, type FrontModel } from "./front-door";
import { recogniseFile, type DroppedFile, type RecogniseContext, type SourceKey } from "./recognise";
import { recogniseContext } from "./signatures";

/** Heading rows as each system writes them (column names only; no values). */
export const SAMPLE_HEADERS: Readonly<Record<SourceKey, readonly string[]>> = {
  neon: ["Account ID", "First Name", "Last Name", "Email 1", "Phone 1 Full Number (F)", "Address Line 1", "City", "State/Province", "Zip Code", "Account Type", "Household ID"],
  quickbooks: ["Customer", "Phone Numbers", "Email", "Full Name", "Billing Address", "Shipping Address", "Open Balance"],
  zeffy: ["Payment Date (America/New_York)", "First Name", "Last Name", "Email", "Total Amount", "Payment Method", "Campaign Title", "Address", "City", "Postal Code", "Country"],
  paypal: ["Date", "Time", "TimeZone", "Name", "Type", "Status", "Currency", "Gross", "Fee", "Net", "From Email Address", "To Email Address", "Transaction ID", "Balance"],
  google_contacts: ["First Name", "Middle Name", "Last Name", "Phonetic First Name", "Nickname", "E-mail 1 - Label", "E-mail 1 - Value", "Phone 1 - Label", "Phone 1 - Value", "Labels"],
  bank: ["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"],
};

/** A spreadsheet someone keeps themselves: one tab per year, one row per gift. */
export const SAMPLE_OWN_SPREADSHEET = ["Date", "Donor", "Amount", "Fund", "Paid by", "Check #", "Notes"];

export const SAMPLE_COMMUNITY = "Riverside Neighbours Association";
export const SAMPLE_PEOPLE_LABEL = "Members & households";

export function sampleContext(): RecogniseContext {
  return recogniseContext(SAMPLE_PEOPLE_LABEL.toLowerCase(), true);
}

/** The four files of the board, for a neutral community: an export, a workbook of its own, a filled template and a photo. */
export function sampleFiles(ctx: RecogniseContext = sampleContext()): DroppedFile[] {
  const MB = 1024 * 1024;
  const list = [
    { name: "neon_accounts_export.csv", facts: { type: "text/csv", size: 214_000, headers: SAMPLE_HEADERS.neon, rows: 1240, sheets: 1 } },
    { name: "Giving_2019-2025.xlsx", facts: { type: "", size: 688_000, headers: SAMPLE_OWN_SPREADSHEET, rows: 4812, sheets: 7 } },
    { name: "members-template-filled.xlsx", facts: { type: "", size: 41_000, headers: personTemplateHeader(), rows: 214, sheets: 2 } },
    { name: "directory-2019-page-14.jpg", facts: { type: "image/jpeg", size: Math.round(2.4 * MB), headers: null, rows: null, sheets: null } },
  ];
  return list.map((f, i) => ({ id: `sample-${i + 1}`, name: f.name, rec: recogniseFile({ name: f.name, ...f.facts }, ctx) }));
}

export type SampleVariant = "full" | "empty";

export function sampleInput(variant: SampleVariant = "full"): FrontInput {
  const full = variant === "full";
  return {
    communityName: SAMPLE_COMMUNITY,
    kindLabel: "Community organization",
    peopleLabel: SAMPLE_PEOPLE_LABEL,
    giving: { label: "Dues & donations", on: true },
    otherModules: [
      { label: "Events & RSVP", on: true },
      { label: "Store", on: false },
    ],
    imports: full
      ? {
          ok: true,
          list: [
            { entity: "households", entityLabel: "Households", rows: 318, loaded: true },
            { entity: "people", entityLabel: "People", rows: 742, loaded: true },
          ],
        }
      : { ok: true, list: [] },
    qbo: full ? { state: "connected", name: "Riverside Neighbours (QuickBooks Online)", expiring: false } : { state: "not_connected" },
  };
}

export function sampleModel(variant: SampleVariant = "full"): FrontModel {
  return buildFrontDoor(sampleInput(variant));
}

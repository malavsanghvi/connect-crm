import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Record pledge sheet (slice 7) drawn once on the server (the repo has no browser test environment): nothing is called, only drawn.
vi.mock("react-dom", async (orig) => ({ ...((await orig()) as object), createPortal: (node: unknown) => node }));
vi.stubGlobal("document", { body: {} });
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/giving/actions", () => ({ openPledgesAction: vi.fn(), findHouseholdsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/actions", () => ({ applyPaymentAction: vi.fn(), possibleDuplicateZelleAction: vi.fn(), recordOfflinePaymentAction: vi.fn() }));
vi.mock("@/app/(app)/giving/sheet-actions", () => ({ sheetHouseholdAction: vi.fn(), familyGivingAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/record-pledge-actions", () => ({ pledgeSheetOptionsAction: vi.fn(), recordPledgeAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/edit-pledge-actions", () => ({ pledgeEditSheetAction: vi.fn(), editPledgeAction: vi.fn(), deletePledgeAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/email-pledge-actions", () => ({ pledgeEmailSheetAction: vi.fn(), emailPledgeAction: vi.fn(), pledgeEmailStatusAction: vi.fn() }));

import { RecordPledgeSheet } from "@/components/giving-actions/record-pledge-sheet";
import { PLEDGE_NO_UNDO, PLEDGE_REASONS, type RecordPledgeRequest } from "@/lib/giving-actions/record-pledge";
import type { GivingSheetContext } from "@/lib/giving-actions/record-sheet";

const ctx: GivingSheetContext = {
  currency: "USD",
  locale: "en-US",
  timeZone: "America/Chicago",
  today: "2026-10-13",
  labels: { orgMemberLabel: "Club member ID", orgHouseholdLabel: "Club household ID" },
  canRecord: true,
  canAllocate: true,
  bankOn: true,
  canOpenFamily: true,
  canRecordPledge: true,
};
const patel = { id: "h1", name: "Patel", number: "0127", orgId: "LCC-H-1127", primary: "Asha Patel", city: "Riverside" };
const patel2 = { id: "h2", name: "Patel", number: "0412", orgId: "LCC-H-1412", primary: "Meera Patel", city: "Lakeside" };
const card = "No. 0127 · Club household ID LCC-H-1127 · Primary: Asha Patel · Riverside";
const building = { kind: "fund" as const, id: "9d000000-0000-4000-8000-000000000001", name: "Building fund" };

const draw = (request: RecordPledgeRequest) => renderToStaticMarkup(createElement(RecordPledgeSheet, { ctx, request, onClose: () => {} }));

describe("Record pledge sheet", () => {
  const filled = draw({ household: patel, prefill: { amount: "500.00", designation: building } });

  it("shows the household card at the top and a button that names the amount and the family", () => {
    expect(filled).toContain("Record a pledge");
    expect(filled).toContain(card);
    expect(filled).toContain("Record a $500.00 pledge for the Patel household 0127");
    expect(filled.indexOf(card)).toBeLessThan(filled.indexOf("Pledge amount ($)"));
  });

  it("is filled in from what was typed (the amount and the fund), says so, and that no money moves", () => {
    expect(filled).toContain('value="500.00"');
    expect(filled).toContain(`value="fund:${building.id}"`);
    expect(filled).toContain("Building fund");
    expect(filled).toContain("Filled in from what you typed");
    expect(filled).toContain(PLEDGE_NO_UNDO.replace(/'/g, "&#x27;"));
  });

  it("needs a reason before the button works, offers the usual ones, and says it shows in History", () => {
    expect(filled).toMatch(/<button[^>]*data-confirm[^>]*disabled/);
    for (const r of PLEDGE_REASONS) expect(filled).toContain(r);
    expect(filled).toContain("Shows in the family&#x27;s History.");
  });

  it("offers only the household's adults as the person who pledged, or the household", () => {
    expect(filled).toContain("Who pledged");
    expect(filled).toContain("The household (no one named)");
    expect(filled).toContain("Adults of this household only.");
  });

  it("has no form, so Enter never submits it; every button is at least 44 pixels high", () => {
    expect(filled).not.toContain("<form");
    expect(filled).toContain("min-h-[44px]");
  });

  it("when two families match, shows each household card to choose from and records nothing until one is chosen", () => {
    const two = draw({ candidates: [patel, patel2], prefill: { amount: "500.00" } });
    expect(two).toContain("Which family? Check the household card.");
    expect(two).toContain(card);
    expect(two).toContain("No. 0412 · Club household ID LCC-H-1412 · Primary: Meera Patel · Lakeside");
    expect(two).toContain("Choose the family first");
    expect(two).not.toContain("Who pledged");
  });
});

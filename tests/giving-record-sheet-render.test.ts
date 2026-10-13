import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Record payment sheet drawn once on the server (the repo has no browser test environment): nothing is called, only drawn.
vi.mock("react-dom", async (orig) => ({ ...((await orig()) as object), createPortal: (node: unknown) => node }));
// The sheet is drawn into document.body (a portal, drawn in place here): only the body needs to exist.
vi.stubGlobal("document", { body: {} });
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/giving/actions", () => ({ openPledgesAction: vi.fn(), findHouseholdsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/actions", () => ({ applyPaymentAction: vi.fn(), possibleDuplicateZelleAction: vi.fn(), recordOfflinePaymentAction: vi.fn() }));
vi.mock("@/app/(app)/giving/sheet-actions", () => ({ sheetHouseholdAction: vi.fn(), familyGivingAction: vi.fn() }));

import { RecordPaymentSheet } from "@/components/giving-actions/record-payment-sheet";
import { NO_UNDO } from "@/components/giving-actions/sheet";
import type { GivingSheetContext, RecordPaymentRequest } from "@/lib/giving-actions/record-sheet";

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
};
const patel = { id: "h1", name: "Patel", number: "0127", orgId: "LCC-H-1127", primary: "Asha Patel", city: "Riverside" };
const patel2 = { id: "h2", name: "Patel", number: "0412", orgId: "LCC-H-1412", primary: "Meera Patel", city: "Lakeside" };
const card = "No. 0127 · Club household ID LCC-H-1127 · Primary: Asha Patel · Riverside";

const draw = (request: RecordPaymentRequest, over: Partial<GivingSheetContext> = {}) =>
  renderToStaticMarkup(createElement(RecordPaymentSheet, { ctx: { ...ctx, ...over }, request, onClose: () => {} }));

describe("Record payment sheet", () => {
  const filled = draw({ household: patel, prefill: { amount: "200.00", method: "check", reference: "4417" } });

  it("shows the household card at the top and a button that names the amount, the method and the family", () => {
    expect(filled).toContain(card);
    expect(filled).toContain("Record $200.00 check for the Patel household 0127");
    expect(filled.indexOf(card)).toBeLessThan(filled.indexOf("Amount ($)"));
  });

  it("is filled in from what was typed, says so, and says there is no undo", () => {
    expect(filled).toContain('value="200.00"');
    expect(filled).toContain('inputMode="decimal"');
    expect(filled).toContain('value="4417"');
    expect(filled).toContain("Filled in from what you typed");
    expect(filled).toContain(NO_UNDO);
  });

  it("has no form, so Enter never submits it; every button is at least 44 pixels high", () => {
    expect(filled).not.toContain("<form");
    expect(filled).toContain("min-h-[44px]");
  });

  it("tells a finance volunteer the payment is recorded but not applied", () => {
    const volunteer = draw({ household: patel, prefill: { amount: "50", method: "cash" } }, { canAllocate: false });
    expect(volunteer).toContain("Recorded but not applied: a treasurer can apply it to the family&#x27;s pledges.");
    expect(volunteer).toContain("Record $50.00 cash for the Patel household 0127");
  });

  it("when two families match, shows each household card to choose from, never a name alone, and records nothing until one is chosen", () => {
    const two = draw({ candidates: [patel, patel2], prefill: { amount: "200.00", method: "check" } });
    expect(two).toContain("Which family? Check the household card.");
    expect(two).toContain(card);
    expect(two).toContain("No. 0412 · Club household ID LCC-H-1412 · Primary: Meera Patel · Lakeside");
    expect(two).toContain("Choose the family first");
    expect(two).toMatch(/<button[^>]*data-confirm[^>]*disabled/);
    // Every "Patel" drawn is followed by its card line.
    const names = two.match(/>Patel</g) ?? [];
    const lines = two.match(/No\. 0(127|412) · Club household ID/g) ?? [];
    expect(names.length).toBe(lines.length);
  });

  it("opened with a household id only, reads the card before showing any name", () => {
    const byId = draw({ householdId: "h1" });
    expect(byId).toContain("Opening the family…");
    expect(byId).not.toContain("Patel");
  });
});

describe("Record payment buttons outside Giving", () => {
  it("open the sheet in place where the sheets are mounted, and are the ordinary link everywhere else", async () => {
    const { GivingSheetsProvider, RecordPaymentButton, FamilyGivingLink } = await import("@/components/giving-actions/provider");
    // Children go in as arguments (the lint rule); the components' own prop types require them, hence the loose helper.
    const el = (type: unknown, props: Record<string, unknown>, ...kids: ReactNode[]) => createElement(type as FunctionComponent, props, ...kids);
    const button = el(RecordPaymentButton, { householdId: "h1", href: "/giving/payments?household=h1" }, "Record payment");
    const family = el(FamilyGivingLink, { householdId: "h1" }, "Patel");
    expect(renderToStaticMarkup(button)).toBe('<a href="/giving/payments?household=h1">Record payment</a>');
    expect(renderToStaticMarkup(family)).toBe('<a href="/households/h1">Patel</a>');
    const inShell = renderToStaticMarkup(el(GivingSheetsProvider, { ctx }, button, family));
    expect(inShell).toContain('<button type="button">Record payment</button>');
    expect(inShell).toContain('<button type="button">Patel</button>');
    // Someone who cannot record (a second approver who only reads payments) keeps the link: no sheet would open for them.
    const reader = renderToStaticMarkup(el(GivingSheetsProvider, { ctx: { ...ctx, canRecord: false } }, button));
    expect(reader).toContain('<a href="/giving/payments?household=h1">Record payment</a>');
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// The page's conversation calls Server Actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/giving/actions", () => ({ findHouseholdsAction: vi.fn(), openPledgesAction: vi.fn() }));
vi.mock("@/app/(app)/giving/ask-actions", () => ({ draftPaymentAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/actions", () => ({
  applyPaymentAction: vi.fn(),
  possibleDuplicateZelleAction: vi.fn(),
  recordOfflinePaymentAction: vi.fn(),
}));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
// The shell's rail reads the address; outside Next there is none.
vi.mock("next/navigation", async (actual) => ({ ...(await actual<typeof import("next/navigation")>()), usePathname: () => "/dev/admin-giving" }));

// The route: the look cookie, the session and the loader are stand-ins.
const look = { value: "v2" as string | undefined };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => (look.value ? { value: look.value } : undefined) }) }));
const session = { permissions: ["giving.record_offline"] as string[], isPlatformAdmin: false, modulesOff: [] as string[] };
vi.mock("@/lib/session", () => ({ getSession: async () => session }));
vi.mock("@/lib/data/giving-workspace", async () => {
  const f = await import("@/lib/giving-workspace/fixtures");
  return { loadGivingWorkspace: async () => f.sampleModel(), RECORD_PAYMENT_COMMAND: "giving.record_payment" };
});

import GivingWorkspaceRoute from "@/app/(app)/giving/ask/page";
import { RecordPaymentForm } from "@/app/(app)/giving/payments/record-payment-form";
import AdminGivingPreview from "@/app/dev/admin-giving/page";
import { GivingPage } from "@/components/giving-workspace/giving-page";
import { SAMPLE_CARDS, SAMPLE_DRAFTS, sampleFlowState, sampleModel } from "@/lib/giving-workspace/fixtures";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const demo = { cards: SAMPLE_CARDS, drafts: SAMPLE_DRAFTS };

afterEach(() => {
  vi.unstubAllEnvs();
  look.value = "v2";
  session.permissions = ["giving.record_offline"];
});

describe("the Giving page (New look)", () => {
  it("draws the board: the heading, the views, the sentence, two household cards and the confirmation card", () => {
    const out = html(createElement(GivingPage, { model: sampleModel(), initial: sampleFlowState("first"), demo }));
    expect(out).toContain("Ask, review, confirm. The tables and reports are one tap away.");
    for (const v of ["Today", "Ask", "Payments", "Pledges", "Bank", "Books"]) expect(out).toContain(`>${v}</a>`);
    expect(out).toContain('aria-current="page"');
    expect(out).toContain("2 households match “Okafor”. I will not guess which one gave this. Which household is it?");
    // Never a name alone: numbers, the primary member, where they live and the last gift.
    expect(out).toContain("Chidi &amp; María Okafor Household");
    expect(out).toContain("LCC-H-2041");
    expect(out).toContain("Primary: Chidi Okafor (member 0417) · 4 members");
    expect(out).toContain("Money action · needs your confirmation");
    expect(out).toContain("Spring appeal 2026 (P-0193): $250.00 of $250.00 still open");
    expect(out).toContain("What a second person would check");
  });

  it("writes no money: the main button is a filled-in link to the existing Record payment screen, and says why", () => {
    const out = html(createElement(GivingPage, { model: sampleModel(), initial: sampleFlowState("first"), demo }));
    expect(out).toContain('href="/giving/payments?household=6f1d2c3b-4a5e-4f60-8a71-9b8c7d6e5f40&amp;amount=250&amp;paid_with=check&amp;received=2026-10-04&amp;ref=1043"');
    expect(out).toContain("Open in Record payment · $250.00");
    expect(out).toContain("Recording straight from this card is switched off for Lakeside Community Club");
    expect(out).toContain("You check it there and press Record. Nothing is saved before that.");
    expect(out).not.toContain("Record payment · $250.00</button>");
  });

  it("offers the confirm-level command's own card only where the community ticked it (Niva off here, so it says so)", () => {
    const out = html(createElement(GivingPage, { model: sampleModel({ recordByCard: true }), initial: sampleFlowState("first"), demo }));
    expect(out).toContain("Recording from this card needs Niva for admins switched on for Lakeside Community Club");
    expect(out).toContain("Open in Record payment");
  });

  it("asks whether it is the right household when it has no open pledge, in the person's words", () => {
    const out = html(createElement(GivingPage, { model: sampleModel(), initial: sampleFlowState("second", { evidenceOpen: true }), demo }));
    expect(out).toContain("You mentioned “Spring appeal pledge”, but this household has no open pledge");
    expect(out).toContain("No open pledge: a general gift");
    expect(out).toContain("<details open");
  });

  it("starts with an invitation and an example in the community's currency when nothing is asked yet", () => {
    const model = { ...sampleModel(), examples: { ask: "Record a ₹250 check from household 1042, received yesterday", change: "“make it ₹300”" } };
    const out = html(createElement(GivingPage, { model, demo }));
    expect(out).toContain("Tell me about a payment you received");
    expect(out).toContain("Try: “Record a ₹250 check from household 1042, received yesterday”");
    expect(out).not.toContain("Money action");
  });

  it("says so when the person may look but not record", () => {
    const out = html(createElement(GivingPage, { model: { ...sampleModel(), canRecord: false }, demo }));
    expect(out).toContain("recording payments needs the permission to record them");
    expect(out).toMatch(/<input[^>]*disabled=""/);
  });

  it("shows the side lists, the switched-off item and 'You don't have access' instead of an empty list", () => {
    const model = sampleModel();
    const out = html(createElement(GivingPage, { model: { ...model, close: { state: "no_access" }, waiting: { ...model.waiting, bank: { state: "error", error: "Could not read the bank lines — timeout." } } }, demo }));
    expect(out).toContain("$64,550.00");
    expect(out).toContain("$31,450.00 still open across 118 households");
    expect(out).toContain("You don&#x27;t have access to this area.");
    expect(out).toContain("Could not read the bank lines — timeout.");
    expect(out).toContain("2 Zelle reports waiting for the bank");
    expect(out).toContain("1 request waiting for a second approver");
    expect(out).toContain("Paid twice at the autumn fair");
    expect(out).toContain("What do I need to send for year-end statements?");
    expect(out).toContain("Coming next");
  });
});

describe("the /giving/ask route (the conversation, until slice 2 replaces it)", () => {
  it("in the classic look goes to the first Giving page the person can open (there was never a page here)", async () => {
    look.value = undefined;
    await expect(GivingWorkspaceRoute()).rejects.toMatchObject({ digest: expect.stringContaining("/giving/pledges") });
    session.permissions = [];
    await expect(GivingWorkspaceRoute()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("in the New look draws the page, or says 'You don't have access to this area'", async () => {
    expect(html(await GivingWorkspaceRoute())).toContain("Tell me about a payment you received");
    session.permissions = ["bolis.view"];
    expect(html(await GivingWorkspaceRoute())).toContain("You don&#x27;t have access to this area");
  });
});

describe("the dev preview", () => {
  const call = (sp: Record<string, string> = {}) => AdminGivingPreview({ searchParams: Promise.resolve(sp) });
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
  it("draws the page in the shell with invented data for a neutral club", async () => {
    const out = html(await call());
    expect(out).toContain("DEV PREVIEW · SAMPLE DATA");
    expect(out).toContain("Lakeside Community Club");
    expect(out).toContain("v2-rail");
    expect(html(await call({ state: "card" }))).toContain("You mentioned");
    expect(html(await call({ state: "empty" }))).toContain("Tell me about a payment you received");
  });
});

describe("the Record payment form opened from the Giving page", () => {
  const base = { labels: { orgMemberLabel: "Member ID", orgHouseholdLabel: "Household ID" }, timeZone: "UTC", currency: "USD", today: "2026-10-07", canAllocate: true };
  it("renders exactly as before when nothing is filled in", () => {
    const plain = html(createElement(RecordPaymentForm, base));
    expect(html(createElement(RecordPaymentForm, { ...base, initialValues: null }))).toBe(plain);
    expect(plain).not.toContain("Filled in from your request");
  });
  it("starts with the amount, the date and the reference filled in, and says to check them", () => {
    const out = html(createElement(RecordPaymentForm, { ...base, initialValues: { amount: "250", method: "check", receivedOn: "2026-10-04", reference: "1043" } }));
    expect(out).toContain("Filled in from your request on the Giving page. Check each detail, then press Record. Nothing is saved until you do.");
    expect(out).toContain('value="250"');
    expect(out).toContain('value="2026-10-04"');
    expect(out).toContain('value="1043"');
  });
});

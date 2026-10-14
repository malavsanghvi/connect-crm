import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Edit pledge sheet (0782) drawn once on the server (the repo has no browser test environment): nothing is called, so only the
// first thing it shows, while it opens the pledge, can be drawn. The rules and the sentences are tested in giving-edit-pledge.test.ts.
vi.mock("react-dom", async (orig) => ({ ...((await orig()) as object), createPortal: (node: unknown) => node }));
vi.stubGlobal("document", { body: {} });
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/giving/actions", () => ({ openPledgesAction: vi.fn(), findHouseholdsAction: vi.fn() }));
vi.mock("@/app/(app)/giving/payments/actions", () => ({ applyPaymentAction: vi.fn(), possibleDuplicateZelleAction: vi.fn(), recordOfflinePaymentAction: vi.fn() }));
vi.mock("@/app/(app)/giving/sheet-actions", () => ({ sheetHouseholdAction: vi.fn(), familyGivingAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/record-pledge-actions", () => ({ pledgeSheetOptionsAction: vi.fn(), recordPledgeAction: vi.fn() }));
vi.mock("@/app/(app)/giving/pledges/edit-pledge-actions", () => ({ pledgeEditSheetAction: vi.fn(() => new Promise(() => {})), editPledgeAction: vi.fn(), deletePledgeAction: vi.fn() }));

import { EditPledgeSheet } from "@/components/giving-actions/edit-pledge-sheet";
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
  canEditPledge: true,
};

describe("Edit pledge sheet", () => {
  const html = renderToStaticMarkup(createElement(EditPledgeSheet, { ctx, request: { pledgeId: "18200000-0000-4000-8000-000000000301" }, onClose: () => {} }));

  it("opens as a dialog that says it is opening the pledge, and offers no button to save yet", () => {
    expect(html).toContain("Edit pledge");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Opening the pledge…");
    expect(html).not.toContain("data-confirm");
    expect(html).not.toContain("Delete this pledge");
  });
});

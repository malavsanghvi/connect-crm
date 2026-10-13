import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Family page draws from a model; here nothing is called, only rendered.
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/people/saved-actions", () => ({ saveViewAction: vi.fn(), renameViewAction: vi.fn(), deleteViewAction: vi.fn(), setPinAction: vi.fn() }));
vi.mock("next/navigation", async (orig) => ({ ...((await orig()) as object), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));

import { familyFixture } from "@/app/dev/people-family/fixtures";
import { FamilyView } from "@/components/people-v2/family/family-view";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { familyChips } from "@/lib/people-v2/family-model";

const links: FamilyLinks = {
  people: "/people",
  payment: "/giving/payments?household=hh",
  addPerson: "/households/hh?hh=hh&mode=add",
  manageIds: "/households/hh?tab=identifiers",
  more: [{ key: "merge", label: "Merge with another family", href: "/people/merge?household=hh" }],
};

function page(key: Parameters<typeof familyFixture>[0], opts: { canEdit?: boolean; links?: FamilyLinks } = {}) {
  const model = familyFixture(key, { canEdit: opts.canEdit });
  return renderToStaticMarkup(
    createElement(FamilyView, {
      model,
      chips: familyChips(model, "America/Chicago"),
      links: opts.links ?? links,
      detailsTemplate: "/households/hh?person=__ID__",
      slots: { glance: createElement("div", { "data-testid": "glance" }, "Giving at a glance"), tabs: createElement("div", { "data-testid": "tabs" }, "tabs") },
    }),
  );
}

describe("the Family page", () => {
  it("shows the household with its card line, never a name alone, and each person as a card", () => {
    const html = page("hassan");
    expect(html).toContain("Hassan household");
    expect(html).toContain("No. 0301");
    expect(html).toContain("RCC-H-1102");
    expect(html).toContain("Samira &amp; Karim Hassan");
    expect(html).toContain("Riverside, North Riverside");
    expect(html.match(/data-testid="person-card"/g)).toHaveLength(2);
    // the panel and the tab row are the server's, in the places the plan gives them
    expect(html).toContain("Giving at a glance");
    expect(html).toContain('data-testid="tabs"');
  });

  it("makes every value a button that edits it, with the value in its name", () => {
    const html = page("hassan");
    expect(html).toContain('aria-label="Edit mobile: (713) 555-0136"');
    expect(html).toContain('aria-label="Edit email: samira.hassan@example.org"');
    expect(html).toContain('aria-label="Rename the household: Hassan household"');
    expect(html).toContain('aria-label="Edit the address: 14 Maple Court, Riverside, TX 77030"');
  });

  it("keeps children compact: no contact fields, 'contact via parents', staff only and never shown to Niva", () => {
    const html = page("hassan");
    expect(html).toContain("Children (2) · Staff only · Never shown to Niva");
    expect(html.match(/data-testid="child-row"/g)).toHaveLength(2);
    expect(html).toContain("Daughter · age 11 · contact via parents");
    // a child's row has no mobile or email to edit, and nothing that asks Niva about them
    const children = html.slice(html.indexOf('aria-label="Children"'), html.indexOf('aria-label="Children"') + 3000);
    expect(children).not.toMatch(/Mobile|Email|@example/);
    expect(html).not.toMatch(/Ask Niva/i);
  });

  it("draws names in any script, and lets the browser choose their direction", () => {
    const html = page("tanaka");
    expect(html).toContain("田中・Haddad の家");
    expect(html).toContain("田中 美咲");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("連絡は夜がよい。");
    expect(html).toContain("Arabic");
  });

  it("is plain text, with 'View only' and no editing or adding, for someone who may not edit people", () => {
    const html = page("hassan", { canEdit: false, links: { ...links, addPerson: null, more: [] } });
    expect(html).toContain("View only");
    expect(html).not.toContain('aria-label="Edit ');
    expect(html).not.toContain('aria-label="Rename the household');
    expect(html).not.toContain("Add a person");
    expect(html).not.toContain(">Add person<");
    expect(html).toContain("(713) 555-0136");
  });

  it("shows invitations where nothing is recorded, and has Record payment only with the permission", () => {
    const html = page("empty", { links: { ...links, payment: null } });
    expect(html).toContain("Add a mobile number");
    expect(html).toContain("Add an address");
    expect(html).toContain("No notes.");
    expect(html).not.toContain("Record payment");
    expect(page("hassan")).toContain("Record payment");
  });

  it("draws the pin star as a real toggle that shows its state, and no star when the page has no pin to show", () => {
    const off = page("hassan", { links: { ...links, pin: { householdId: "hh", pinned: false, loadError: null } } });
    expect(off).toMatch(/<button[^>]*aria-pressed="false"[^>]*aria-label="Pin Hassan household"/);
    expect(off).not.toContain("Coming next");
    const on = page("hassan", { links: { ...links, pin: { householdId: "hh", pinned: true, loadError: null } } });
    expect(on).toMatch(/<button[^>]*aria-pressed="true"[^>]*aria-label="Unpin Hassan household"/);
    expect(page("hassan")).not.toContain("aria-pressed");
  });

  it("says when the pin could not be read, and does not pretend it is pinned or not", () => {
    const html = page("hassan", { links: { ...links, pin: { householdId: "hh", pinned: null, loadError: "the database could not be reached" } } });
    expect(html).toContain("Could not check whether this family is pinned — the database could not be reached");
    expect(html).not.toContain("aria-pressed");
  });

  it("lists the household IDs as chips and says what finds the family", () => {
    const html = page("hassan");
    expect(html).toContain("Community household ID");
    expect(html).toContain("RCC-H-1102");
    expect(html).toContain("Accounting (QuickBooks) customer");
    expect(html).toContain("S HASSAN");
    expect(html).toContain("Manage IDs");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The three things a member gave about themselves, in the person slide-over's Profile section: click-to-edit with people.manage, plain
// text without it, no anniversary for a child, a sentence (never an empty row) when the role cannot read them. Only rendered here; the
// editing itself is the state machine tested in people-profile-details-core.test.ts.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/profile-details-actions", () => ({ saveProfileDetailsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { detailFixture, type Access } from "@/app/dev/people-slideover/fixtures";
import type { FamilyKey } from "@/app/dev/people-family/fixtures";
import { SlideOverBody } from "@/components/people-v2/slideover/person-slideover";
import { NO_ACCESS_TEXT, part, sectionPlan, type PersonDetailModel, type ProfileDetails } from "@/lib/people-v2/slideover";

const hrefs = { details: "/h?person=p", move: "/h?person=p&mode=move", merge: "/people/merge?person=p" };

function draw(detail: PersonDetailModel | null) {
  if (!detail) throw new Error("no such person in the fixture");
  const plan = sectionPlan({ isChild: detail.person.isChild, givingByPerson: true, givingOn: true, hasHistory: true });
  return renderToStaticMarkup(createElement(SlideOverBody, { detail, plan, slots: {}, closeHref: "/h", closeLabel: "Back", hrefs, mode: "panel", onClose: () => {} }));
}
const page = (family: FamilyKey, person: string, access: Access = "full") => draw(detailFixture(family, person, { access, standalone: false }));
const rows = (html: string) => [...html.matchAll(/data-testid="profile-row" data-group="([a-z]+)"/g)].map((m) => m[1]);

describe("the member's details in the Profile section, for someone who can change them", () => {
  it("shows the three rows of an adult as click-to-edit values with the value in their names", () => {
    const html = page("hassan", "p-samira");
    expect(rows(html)).toEqual(["anniversary", "dietary", "emergency"]);
    expect(html).toContain('aria-label="Edit anniversary: 06/20/2009"');
    expect(html).toContain('aria-label="Edit dietary needs: Vegetarian, Nut allergy"');
    expect(html).toContain('aria-label="Edit emergency contact: Layla Haddad (sister) · (713) 555-0100"');
    expect(html).toContain("Given by the member in the app");
  });

  it("says the details are private and that members can change them in the app too", () => {
    const html = page("hassan", "p-samira");
    expect(html).toContain("Dietary and emergency details are private");
    expect(html).toContain("Members can also change them in the app.");
    expect(html).not.toContain("Members change them in the app");
  });

  it("invites adding what is not there yet", () => {
    const html = page("hassan", "p-karim");
    expect(html).toContain("Add an anniversary");
    expect(html).toContain("Add dietary needs");
    expect(html).toContain("Add an emergency contact");
  });

  it("shows names and notes in other scripts as they are", () => {
    const html = page("tanaka", "p-misaki");
    expect(html).toContain("Halal, Other: エビ・カニにアレルギー");
    expect(html).toContain("田中 健 (brother) · +81398765432");
  });

  it("gives a child dietary needs and an emergency contact, and never an anniversary", () => {
    const html = page("hassan", "p-layla");
    expect(rows(html)).toEqual(["dietary", "emergency"]);
    expect(html).not.toContain("Anniversary");
    expect(html).not.toContain("anniversary");
    // A choice the community switched off still reads on the child who has it.
    expect(html).toContain('aria-label="Edit dietary needs: Dairy-free (no longer offered)"');
    expect(html).toContain("Add an emergency contact");
    expect(html).toContain("Staff only · never sent to Niva");
  });
});

describe("the member's details for someone who may only look", () => {
  it("keeps every value as plain text, with the 'View only' chip and no way to edit", () => {
    const html = page("hassan", "p-samira", "view");
    expect(html).toContain("View only");
    expect(rows(html)).toEqual([]);
    expect(html).toContain("Vegetarian, Nut allergy");
    expect(html).toContain("06/20/2009");
    expect(html).toContain("Layla Haddad (sister)");
    expect(html).not.toContain("Edit anniversary");
    expect(html).not.toContain("Edit dietary needs");
    expect(html).not.toContain("Edit emergency contact");
    expect(html).toContain("Members change them in the app.");
  });

  it("says 'You don't have access to this area' when the role cannot read them, not an empty row", () => {
    const html = page("hassan", "p-samira", "limited");
    expect(rows(html)).toEqual([]);
    // The line of the Given-in-the-app block itself (the markup writes the apostrophe as a character reference).
    const text = html.replaceAll("&#x27;", "'");
    expect(text).toContain("Given in the app");
    expect(text).toContain(NO_ACCESS_TEXT);
  });

  it("falls back to plain lines when the details came without what the editor needs", () => {
    const detail = detailFixture("hassan", "p-samira", { access: "full", standalone: false });
    if (!detail || detail.profileDetails.state !== "ok") throw new Error("fixture");
    const { edit: _edit, ...rest } = detail.profileDetails.data;
    void _edit;
    const html = draw({ ...detail, profileDetails: part.ok<ProfileDetails>(rest) });
    expect(rows(html)).toEqual([]);
    expect(html).toContain("Vegetarian, Nut allergy");
  });

  it("says in words when the details could not be read", () => {
    const detail = detailFixture("hassan", "p-samira", { access: "full", standalone: false });
    if (!detail) throw new Error("fixture");
    const html = draw({ ...detail, profileDetails: part.error("The database could not be reached.") });
    expect(rows(html)).toEqual([]);
    expect(html).toContain("Could not load what this member gave in the app");
  });
});

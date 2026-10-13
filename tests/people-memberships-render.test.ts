import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The Memberships section of the person slide-over, drawn from a model (nothing is called, only rendered): each row with its tier,
// status, dates, family card line, holder and note; the staff buttons only for a person who holds both permissions; each inline panel
// in each state; the one confirmation sentence; and the section's place in the slide-over.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { detailFixture } from "@/app/dev/people-slideover/fixtures";
import { familyFixture, type FamilyKey } from "@/app/dev/people-family/fixtures";
import { MS_STATES, membershipsFixture, panelFor, type MsState } from "@/app/dev/people-slideover/memberships-fixtures";
import type { MembershipActions } from "@/components/people-v2/slideover/membership-panels";
import { MembershipsSection } from "@/components/people-v2/slideover/memberships-section";
import { SlideOverBody } from "@/components/people-v2/slideover/person-slideover";
import { sectionPlan } from "@/lib/people-v2/slideover";

const actions: MembershipActions = {
  edit: vi.fn(async () => ({ ok: true as const, message: "" })),
  assign: vi.fn(async () => ({ ok: true as const, message: "", membershipId: "m", feeRecorded: true })),
  tier: vi.fn(async () => ({ ok: true as const, message: "" })),
};

function section(o: { family?: FamilyKey; person?: string; canChange?: boolean; state?: "ok" | "no-access" | "error"; givingOn?: boolean; ms?: MsState } = {}) {
  const family = o.family ?? "hassan";
  const model = familyFixture(family, { canEdit: true });
  const personId = o.person ?? model.adults[0].id;
  const data = membershipsFixture(model, personId, { canChange: o.canChange ?? true, givingOn: o.givingOn, state: o.state });
  const person = [...model.adults, ...model.children].find((p) => p.id === personId)!;
  const open = panelFor(o.ms ?? "list", data.state === "ok" ? data.data.rows : []);
  return renderToStaticMarkup(createElement(MembershipsSection, { data, person: { id: person.id, firstName: person.firstName }, timeZone: "America/Chicago", actions, open }));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the list", () => {
  it("shows each membership with its tier, status, dates, the family's card line, who holds it and its note", () => {
    const html = section();
    expect(html).toContain('data-testid="memberships-section"');
    expect(count(html, 'data-testid="membership-row"')).toBe(2);
    const t = text(html);
    expect(t).toContain("Yearly · Annual member");
    expect(t).toContain("Active");
    expect(t).toContain("Apr 1, 2026 – Mar 31, 2027");
    expect(t).toContain("Ended");
    expect(t).toContain("Apr 1, 2022 – Mar 31, 2026");
    expect(t).toContain("Held by Samira Hassan");
    expect(t).toContain("Note: Assigned by staff");
    expect(t).not.toContain("Paid at the office desk");
    // never a family by its name alone
    const lines = [...html.matchAll(/data-testid="membership-household"[^>]*>([^<]*)</g)].map((m) => m[1].replace(/&amp;/g, "&"));
    expect(lines).toEqual(["Hassan household · No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside, North Riverside", "Hassan household · No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside, North Riverside"]);
  });

  it("offers, to a person with both permissions, Edit dates and notes on every row and Change tier only on the family's live membership", () => {
    const html = section();
    expect(count(html, "Edit dates and notes")).toBe(2);
    expect(count(html, ">Change tier<")).toBe(1);
    // Assign is not offered while the family holds a live membership: the sentence points to Change tier
    expect(html).not.toContain("Assign a membership");
    expect(text(html)).toContain("This family already holds a Yearly membership, so another cannot be assigned. To give it a different tier, use Change tier on it.");
    expect(html).not.toContain('data-testid="memberships-readonly"');
  });

  it("offers Assign a membership when the family has no live membership, and calls an expired one Expired", () => {
    const html = section({ family: "adeyemi" });
    expect(html).toContain("Assign a membership");
    expect(text(html)).toContain("Expired");
    expect(text(html)).toContain("Held by Tunde Adeyemi");
    expect(text(html)).toContain("No holder named");
    expect(count(html, ">Change tier<")).toBe(0);
  });

  it("says there is nothing, in words, for a family with no memberships (and still offers Assign)", () => {
    const html = section({ family: "empty" });
    expect(text(html)).toContain("No memberships on record for Inés's family.");
    expect(html).toContain("Assign a membership");
  });

  it("is read-only for anyone without both permissions: no buttons, and a short line saying why", () => {
    const html = section({ canChange: false });
    expect(html).not.toContain("Edit dates and notes");
    expect(html).not.toContain(">Change tier<");
    expect(html).not.toContain("Assign a membership");
    expect(html).not.toContain("<button");
    expect(text(html)).toContain("You can see memberships here but not change them. Changing one needs both the manage and the approve permission for People.");
    expect(count(html, 'data-testid="membership-row"')).toBe(2);
  });

  it("says 'You don't have access to this area' when the role cannot read memberships, and a failed read in words", () => {
    expect(text(section({ state: "no-access" }))).toContain("You don't have access to this area");
    expect(section({ state: "no-access" })).not.toContain("membership-row");
    const failed = section({ state: "error" });
    expect(failed).toContain('role="alert"');
    expect(text(failed)).toContain("Could not load the memberships");
  });

  it("works for names in other scripts", () => {
    const html = section({ family: "tanaka", person: "p-misaki" });
    const t = text(html);
    expect(t).toContain("Held by 田中 美咲");
    expect(t).toContain("Life");
    expect(t).toContain("Jun 15, 2024 – no end date");
    expect(t).toContain("Note: 会費は窓口で受領しました");
    expect(t).toContain("田中・Haddad の家 · No. 0507");
  });
});

describe("edit dates and notes", () => {
  it("opens with what is on file, asks for a reason, and lists what will change", () => {
    const html = section({ ms: "edit" });
    const t = text(html);
    expect(html).toContain('data-testid="membership-edit"');
    for (const label of ["Starts on", "Ends on", "Note", "Reason (kept in the audit log only)"]) expect(t).toContain(label);
    // members can read a note: the line under it says where the reason goes
    expect(t).toContain("Members of this household can read this note. Put the reason in the Reason box below: it only goes in the audit log.");
    expect(html).toContain('value="2026-03-20"');
    expect(html).toContain('value="2027-03-31"');
    expect(html).toContain("Assigned by staff");
    expect(html).toContain('value="Corrected from the paper form"');
    expect(t).toContain("Start date: Apr 1, 2026 → Mar 20, 2026");
    expect(t).toContain("Save changes");
    expect(t).toContain("Cancel");
    // an active membership cannot start in the future: the picker stops at today
    expect(html).toContain('max="2026-10-12"');
  });

  it("says a mistake next to the field it is about", () => {
    const html = section({ ms: "edit-problem" });
    expect(html).toMatch(/role="alert"[^>]*>An active membership cannot be given an end date in the past/);
    expect(html).toContain('aria-invalid="true"');
  });

  it("says a failed save in words, next to what was done, with a retry", () => {
    const html = section({ ms: "edit-error" });
    expect(html).toContain('data-testid="membership-failure"');
    expect(text(html)).toContain("Could not save the membership — the database could not be reached");
    expect(text(html)).toContain("Try again");
    expect(text(html)).not.toContain("Save changes");
  });
});

describe("change tier", () => {
  it("offers the other tiers the community has and asks for a reason", () => {
    const html = section({ ms: "tier" });
    const t = text(html);
    expect(html).toContain('data-testid="membership-tier"');
    expect(t).toContain("Change tier · now Yearly");
    expect(t).toContain("Change to");
    expect(html).toContain('<option value="community">Community</option>');
    expect(html).toContain('<option value="life" selected="">Life</option>');
    expect(html).not.toContain('<option value="yearly"');
    expect(t).toContain("Review");
  });

  it("ends in one confirmation that says what it does, including that the Executive Committee is not asked", () => {
    const html = section({ ms: "tier-confirm" });
    const t = text(html);
    expect(html).toContain('aria-label="Confirm the tier change"');
    expect(t).toContain("Change Hassan household (No. 0301 · RCC-H-1102 · Samira & Karim Hassan · Riverside, North Riverside) from Yearly to Life.");
    expect(t).toContain("It is active at once and does not wait for the Executive Committee. No fee is recorded.");
    expect(t).toContain("Reason: Paid the life fee at the office");
    expect(t).toContain("Yes, change the tier");
  });

  it("says the existing tier change copies the reason into the membership's note, which members can read, so keep it factual", () => {
    const t = text(section({ ms: "tier-confirm" }));
    expect(t).toContain("The reason goes in the audit log. The tier change also copies it into the new membership's note, which members of this household can read, so keep it factual.");
  });

  it("says a refusal in words with a retry", () => {
    const t = text(section({ ms: "tier-error" }));
    expect(t).toContain("Could not change the membership tier — No life membership type is set up for this center. Nothing was changed.");
    expect(t).toContain("Try again");
  });
});

describe("assign a membership", () => {
  it("opens empty: a type to choose with its tier and fee in the community's currency, dates, the adults as holder, a reason", () => {
    const html = section({ family: "adeyemi", ms: "assign" });
    const t = text(html);
    expect(html).toContain('data-testid="membership-assign"');
    expect(t).toContain("It is active at once and does not wait for the Executive Committee.");
    expect(t).toContain("Adeyemi household (No. 0212 · RCC-H-1048 · Tunde & Fola Adeyemi · Riverside, South Riverside)");
    expect(t).toContain("Choose a type…");
    expect(t).toContain("Friend · Community · no fee");
    expect(t).toContain("Annual member · Yearly · $50.00");
    expect(t).toContain("Lifetime member · Life · $500.00");
    expect(html).toContain('value="2026-10-12"');
    expect(html).toContain('max="2026-10-12"');
    expect(t).toContain("Tunde Adeyemi");
    expect(t).toContain("Fola Adeyemi");
    expect(t).toContain("No holder named");
    expect(t).toContain("Adults of the family only.");
    expect(t).toContain("Review");
    // the holder defaults to the person the section was opened from
    expect(html).toMatch(/<option value="p-tunde" selected="">Tunde Adeyemi<\/option>/);
    // nothing about a fee until a type with a fee is chosen
    expect(t).not.toContain("as an open pledge");
  });

  it("offers the fee box only for a type that has a fee", () => {
    const withFee = text(section({ family: "adeyemi", ms: "assign-fee" }));
    expect(withFee).toContain("Record the $50.00 fee as an open pledge");
    expect(withFee).toContain("Leave empty to end on Oct 12, 2027.");
    const html = section({ family: "adeyemi", ms: "assign-fee" });
    expect(html).toMatch(/type="checkbox"[^>]*checked/);
    const free = text(section({ family: "adeyemi", ms: "assign-nofee" }));
    expect(free).not.toContain("open pledge");
  });

  it("says when Pledges & donations is off instead of offering the box", () => {
    const html = section({ family: "adeyemi", ms: "assign-fee", givingOn: false });
    expect(text(html)).toContain("Pledges & donations is switched off, so the $50.00 fee cannot be recorded.");
    expect(html).not.toContain('type="checkbox"');
  });

  it("says a mistake next to the field", () => {
    const html = section({ family: "adeyemi", ms: "assign-problem" });
    expect(html).toMatch(/role="alert"[^>]*>Choose a membership type/);
  });

  it("ends in ONE confirmation that says exactly what will happen, and that it does not wait for the Executive Committee", () => {
    const html = section({ family: "adeyemi", ms: "assign-confirm" });
    expect(html).toContain('aria-label="Confirm the new membership"');
    expect(text(html)).toContain(
      "Assign a Yearly membership (Annual member) to Adeyemi household (No. 0212 · RCC-H-1048 · Tunde & Fola Adeyemi · Riverside, South Riverside), held by Tunde Adeyemi, from Oct 12, 2026, until Oct 12, 2027. " +
        "It is active at once and does not wait for the Executive Committee. The $50.00 fee is recorded as an open pledge, due in 30 days.",
    );
    expect(text(html)).toContain("Reason: Paid at the office desk");
    expect(text(html)).toContain("Yes, assign it");
    expect(text(html)).toContain("Back");
    // the form is gone: one confirmation, not two
    expect(html).not.toContain('type="date"');
  });

  it("says the reason is kept in the audit log only, and that the note will be neutral, because members can read a note", () => {
    const t = text(section({ family: "adeyemi", ms: "assign-confirm" }));
    expect(t).toContain("Reason: Paid at the office desk");
    expect(t).toContain(`The reason is kept in the audit log only. The membership's note will say just "Assigned by staff", which members of this household can read.`);
  });

  it("says it for a Life membership", () => {
    const t = text(section({ family: "adeyemi", ms: "assign-confirm-life" }));
    expect(t).toContain("Assign a Life membership (Lifetime member) to Adeyemi household");
    expect(t).toContain("from Oct 12, 2026, for life. It is active at once and does not wait for the Executive Committee. The $500.00 fee is recorded as an open pledge, due in 30 days.");
  });

  it("says the fee is not recorded when Pledges & donations is off", () => {
    const t = text(section({ family: "adeyemi", ms: "assign-confirm-nogiving", givingOn: false }));
    expect(t).toContain("The $50.00 fee is not recorded, because Pledges & donations is switched off.");
  });

  it("says a refusal in words, next to what was done, with a retry", () => {
    const html = section({ family: "adeyemi", ms: "assign-error" });
    expect(html).toContain('data-testid="membership-failure"');
    expect(text(html)).toContain("Could not assign the membership — This family already has an active Yearly membership");
    expect(text(html)).toContain("Try again");
    expect(text(html)).not.toContain("Yes, assign it");
  });
});

describe("every state of the dev preview", () => {
  it("draws without throwing, for every state and every family", () => {
    for (const family of ["hassan", "adeyemi", "tanaka", "empty"] as const) {
      for (const ms of MS_STATES) expect(section({ family, ms }), `${family} ${ms}`).toContain("memberships-section");
    }
  });
});

describe("the section in the slide-over", () => {
  const body = (o: { plan?: ReturnType<typeof sectionPlan>; memberships?: ReturnType<typeof createElement> }) => {
    const detail = detailFixture("hassan", "p-samira", { access: "full", standalone: false });
    if (!detail) throw new Error("no such person");
    const plan = o.plan ?? sectionPlan({ isChild: false, givingByPerson: true, givingOn: true, hasHistory: true });
    return renderToStaticMarkup(
      createElement(SlideOverBody, {
        detail,
        plan,
        slots: { memberships: o.memberships },
        closeHref: "/h",
        closeLabel: "Hassan household",
        hrefs: { details: "/h", move: "/h", merge: "/m" },
        mode: "panel" as const,
        onClose: () => {},
      }),
    );
  };

  it("is called Memberships, and draws the slot in its place", () => {
    const model = familyFixture("hassan", { canEdit: true });
    const data = membershipsFixture(model, "p-samira", { canChange: true });
    const slot = createElement(MembershipsSection, { data, person: { id: "p-samira", firstName: "Samira" }, timeZone: "America/Chicago", actions });
    const html = body({ memberships: slot });
    const at = html.indexOf('data-section="memberships"');
    expect(at).toBeGreaterThan(0);
    expect(html.slice(at, at + 3000)).toContain('data-testid="memberships-section"');
    expect(html.slice(at, at + 600)).toContain("<span>Memberships</span>");
    expect(html).not.toContain("Memberships held");
  });

  it("is left out when the Membership module is off", () => {
    const html = body({ plan: sectionPlan({ isChild: false, givingByPerson: true, givingOn: true, hasHistory: true, membershipOn: false }) });
    expect(html).not.toContain('data-section="memberships"');
  });

  it("still draws the older read-only list where no section is passed in (the person's own page)", () => {
    const html = body({});
    expect(html).toContain('data-section="memberships"');
    expect(text(html)).toContain("Yearly");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Custom fields on the Family page and the slide-over are drawn from a payload the server reads; here nothing is called, only rendered.
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  },
}));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));

import PeopleFieldsPreview from "@/app/dev/people-fields/page";
import { fieldsFixture, type FieldsState } from "@/app/dev/people-fields/fixtures";
import { familyFixture } from "@/app/dev/people-family/fixtures";
import { CustomFieldsSection } from "@/components/people-v2/custom/custom-group";
import { FamilyView } from "@/components/people-v2/family/family-view";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { familyChips } from "@/lib/people-v2/family-model";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The page's words without its markup (a field's name is drawn in two pieces so its mark never stands alone). */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

const links: FamilyLinks = { people: "/people", payment: null, addPerson: null, manageIds: null, more: [] };

function page(state: FieldsState | "none", key: Parameters<typeof familyFixture>[0] = "hassan") {
  const model = familyFixture(key, { canEdit: state !== "view" });
  return renderToStaticMarkup(
    createElement(FamilyView, {
      model,
      chips: familyChips(model, "America/Chicago"),
      links,
      detailsTemplate: "/households/hh?person=__ID__",
      slots: { glance: null, tabs: null },
      custom: state === "none" ? undefined : fieldsFixture(state, model),
    }),
  );
}

const section = (state: FieldsState, personId = "p-samira", isChild = false) => {
  const model = familyFixture("hassan", { canEdit: state !== "view" });
  const p = [...model.adults, ...model.children].find((x) => x.id === personId)!;
  return renderToStaticMarkup(createElement(CustomFieldsSection, { payload: fieldsFixture(state, model), personId, firstName: p.firstName, isChild, path: "/households/hh" }));
};

describe("a Custom group on each adult's card", () => {
  it("shows the community's fields for people, in their order, with each value the way its type reads", () => {
    const html = page("default");
    expect(html.match(/data-testid="custom-group"/g)).toHaveLength(2);
    const first = html.slice(html.indexOf('aria-label="Custom fields of Samira"'), html.indexOf('aria-label="Custom fields of Karim"'));
    const order = ["shirt_size", "volunteer_skills", "anniversary", "newsletter", "dues_paid"].map((k) => first.indexOf(`data-field="${k}"`));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(first).toContain("Catering, first aid");
    expect(first).toContain("06/02/2012");
    expect(first).toContain("$25.00");
    expect(first).toContain(">Yes<");
  });

  it("makes every value a button that edits it, with the value in its name", () => {
    const html = page("default");
    expect(html).toContain('aria-label="Edit volunteer skills: Catering, first aid"');
    expect(html).toContain('aria-label="Edit shirt size: M"');
    expect(html).toContain('aria-label="Edit anniversary: 06/02/2012"');
  });

  it("invites a value into an empty one", () => {
    const html = page("default");
    const karim = html.slice(html.indexOf('aria-label="Custom fields of Karim"'));
    expect(karim).toContain('aria-label="Edit dues paid: nothing yet"');
  });

  it("marks who sees each field, from the definition: a lock for staff only, an eye and a list when members see it", () => {
    const html = page("default");
    expect(html).toContain('aria-label="Staff only"');
    expect(html).toContain('aria-label="Members can see this"');
    expect(html).toContain('aria-label="Members can see this (in the directory)"');
    expect(html).toContain('data-visibility="member_self"');
  });

  it("is under Language, before Open details", () => {
    const html = page("default");
    const card = html.slice(html.indexOf('aria-label="Samira Hassan"'));
    expect(card.indexOf("Language")).toBeLessThan(card.indexOf('data-testid="custom-group"'));
    expect(card.indexOf('data-testid="custom-group"')).toBeLessThan(card.indexOf("Open details"));
  });

  it("works with field labels and values in another script", () => {
    const html = page("default", "tanaka");
    expect(text(html)).toContain("ボランティアの技能");
    expect(html).toContain("料理, 応急手当");
    expect(html).toContain("大阪");
  });

  it("has no custom group when the page did not read the custom fields", () => {
    const html = page("none");
    expect(html).not.toContain('data-testid="custom-group"');
    expect(html).not.toContain("Custom details");
  });
});

describe("Custom details for the household", () => {
  it("is a card in the right column with the household's fields", () => {
    const html = page("default");
    const card = html.slice(html.indexOf('data-testid="custom-details"'));
    expect(card).toContain("Custom details");
    expect(text(card)).toContain("Hometown");
    expect(card).toContain("Beirut");
    expect(text(card)).toContain("Preferred contact time");
    expect(html.indexOf('aria-label="Address"')).toBeLessThan(html.indexOf('data-testid="custom-details"'));
  });
});

describe("Add a field and Ask an admin", () => {
  it("offers Add a field and Manage to someone who may manage fields", () => {
    const html = page("default");
    expect(html.match(/data-testid="add-field-link"/g)).toHaveLength(3);
    expect(html).toContain("Add a field");
    expect(html).not.toContain("Ask an admin");
    expect(html.match(/data-testid="manage-fields-link"/g)).toHaveLength(3);
  });

  it("says Ask an admin to everyone else who can see the fields, and offers no Manage", () => {
    for (const state of ["ask", "view"] as const) {
      const html = page(state);
      expect(html.match(/Ask an admin/g)).toHaveLength(3);
      expect(html).not.toContain(">Add a field<");
      expect(html).not.toContain('data-testid="manage-fields-link"');
    }
  });

  it("says there are no fields yet, with the link, when there are none", () => {
    const html = page("empty");
    expect(html.match(/No custom fields yet\./g)).toHaveLength(3);
    expect(html.match(/data-testid="add-field-link"/g)).toHaveLength(3);
    expect(html).not.toContain('data-testid="manage-fields-link"');
  });
});

describe("without people.manage", () => {
  it("shows plain text, no editing buttons on custom values, and the View only chip on the household card", () => {
    const html = page("view");
    expect(html).toContain("Catering, first aid");
    expect(html).not.toContain('aria-label="Edit volunteer skills');
    expect(html).not.toContain('aria-label="Edit hometown');
    const card = html.slice(html.indexOf('data-testid="custom-details"'));
    expect(card).toContain("View only");
  });
});

describe("a role that cannot read custom fields", () => {
  it("says 'You don't have access to this area' in each group, never an empty group, and shows no field", () => {
    const html = page("no-access");
    expect(html.match(/You don&#x27;t have access to this area/g)).toHaveLength(3);
    expect(text(html)).not.toContain("Shirt size");
    expect(html).not.toContain("No custom fields yet");
    expect(html).not.toContain('data-testid="add-field-link"');
  });

  it("says in words when the fields could not be read", () => {
    const html = page("error");
    expect(html.match(/Could not load the custom fields: the database did not answer\. Reload the page to try again\./g)).toHaveLength(3);
    expect(html).not.toContain("No custom fields yet");
  });
});

describe("children (D2)", () => {
  it("draws no custom values in a child's compact row on the Family page", () => {
    const html = page("default");
    const children = html.slice(html.indexOf('aria-label="Children"'), html.indexOf('aria-label="Children"') + 6000);
    expect(children).toContain('data-testid="child-row"');
    expect(children).not.toContain('data-testid="custom-row"');
    expect(text(children)).not.toContain("Shirt size");
  });

  it("shows a child's custom fields in the slide-over to staff, with the staff-only note, and no Niva anywhere", () => {
    const html = section("default", "p-layla", true);
    expect(text(html)).toContain("Shirt size");
    expect(html).toContain('data-testid="child-custom-note"');
    expect(html).toContain("Staff only · never sent to Niva");
    expect(html.replace("never sent to Niva", "")).not.toMatch(/niva/i);
    expect(section("default", "p-samira", false)).not.toContain('data-testid="child-custom-note"');
  });
});

describe("the slide-over section", () => {
  it("is open by default, named Custom fields, with the person's rows and Add a field", () => {
    const html = section("default");
    expect(html).toContain('data-section="custom_fields"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Custom fields");
    expect(text(html)).toContain("Volunteer skills");
    expect(html).toContain('data-testid="add-field-link"');
    expect(html).toContain('data-testid="manage-fields-link"');
  });

  it("says Ask an admin, or no access, or the failure, in words", () => {
    expect(section("ask")).toContain("Ask an admin");
    expect(section("no-access")).toContain("You don&#x27;t have access to this area");
    expect(section("error")).toContain("Could not load the custom fields");
  });
});

describe("the dev preview", () => {
  const call = (sp: Record<string, string> = {}) => PeopleFieldsPreview({ searchParams: Promise.resolve(sp) });

  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("draws outside production, for every state the screenshots use", async () => {
    const states: Record<string, string>[] = [
      {},
      { state: "empty" },
      { state: "view" },
      { state: "ask", do: "ask-copy" },
      { state: "no-access" },
      { state: "error" },
      { family: "tanaka" },
      { family: "empty" },
      { scenario: "conflict", do: "save" },
      { do: "add-save" },
      { do: "manage" },
      { view: "slideover" },
      { view: "slideover", person: "p-layla" },
    ];
    for (const sp of states) expect(await call(sp), JSON.stringify(sp)).toBeTruthy();
  });
});

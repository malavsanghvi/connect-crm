import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The slide-over draws from a model; here nothing is called, only rendered (the frame, which portals into the page, is not drawn).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { detailFixture, type Access } from "@/app/dev/people-slideover/fixtures";
import type { FamilyKey } from "@/app/dev/people-family/fixtures";
import { PersonSlideOver, SlideOverBody, type SlideOverSlots } from "@/components/people-v2/slideover/person-slideover";
import { sectionPlan } from "@/lib/people-v2/slideover";

const hrefs = { details: "/h?person=p", move: "/h?person=p&mode=move", merge: "/people/merge?person=p" };

function body(o: { family?: FamilyKey; person: string; access?: Access; standalone?: boolean; slots?: SlideOverSlots; mode?: "panel" | "page" }) {
  const detail = detailFixture(o.family ?? "hassan", o.person, { access: o.access ?? "full", standalone: o.standalone ?? false });
  if (!detail) throw new Error("no such person in the fixture");
  const plan = sectionPlan({ isChild: detail.person.isChild, givingByPerson: true, givingOn: true, hasHistory: true });
  const props = {
    detail,
    plan,
    slots: o.slots ?? { glance: createElement("div", { "data-testid": "glance" }, "Giving at a glance panel"), history: createElement("div", { "data-testid": "history" }, "history table") },
    closeHref: "/h",
    closeLabel: "Hassan household",
    hrefs,
    mode: o.mode ?? ("panel" as const),
  };
  return renderToStaticMarkup(createElement(SlideOverBody, { ...props, onClose: () => {} }));
}

const sectionOpen = (html: string, id: string) => {
  const at = html.indexOf(`data-section="${id}"`);
  if (at < 0) return null;
  return /aria-expanded="(true|false)"/.exec(html.slice(at))?.[1] === "true";
};

describe("the person slide-over", () => {
  it("shows who it is with the household card line (never a name alone) and opens Profile and Account and sign-in", () => {
    const html = body({ person: "p-samira" });
    expect(html).toContain("Samira Hassan");
    expect(html).toContain("Primary · age 41");
    const line = /data-testid="household-line"[^>]*>([^<]*)</.exec(html)?.[1] ?? "";
    expect(line).toBe("Hassan household · No. 0301 · RCC-H-1102 · Samira &amp; Karim Hassan · Riverside, North Riverside");
    expect(sectionOpen(html, "profile")).toBe(true);
    expect(sectionOpen(html, "account")).toBe(true);
    for (const id of ["roles", "privacy", "ids", "memberships", "giving", "history"]) expect(sectionOpen(html, id), id).toBe(false);
  });

  it("makes every editable value the Family page's click-to-edit, with the value in its name", () => {
    const html = body({ person: "p-samira" });
    expect(html).toContain('aria-label="Edit birth date: 04/14/1985"');
    expect(html).toContain('aria-label="Edit gender: Female"');
    expect(html).toContain('aria-label="Edit profession: Pharmacist"');
    expect(html).toContain('aria-label="Edit mobile: (713) 555-0136"');
    expect(html).toContain('aria-label="Edit email: samira.hassan@example.org"');
    expect(html).toContain('aria-label="Edit name of Samira Hassan: Samira Hassan"');
    // an empty value invites adding one
    expect(html).toContain("Add an employer");
  });

  it("reads the member's own details read-only, and says so", () => {
    const html = body({ person: "p-samira" });
    expect(html).toContain("Given by the member in the app");
    expect(html).toContain("Vegetarian, Nut allergy");
    expect(html).toContain("06/20/2009");
    expect(html).toContain("Layla Haddad (sister)");
    expect(html).toContain("Members change them in the app");
  });

  it("shows the printed sign-in code as coming next, in the account section and the menu", () => {
    const html = body({ person: "p-samira" });
    expect(html).toContain("Printed sign-in code");
    expect(html).toContain("Coming next");
  });

  it("has the privacy choices as switches that save at once, and the household's own choices as text", () => {
    const html = body({ person: "p-samira" });
    expect((html.match(/role="switch"/g) ?? []).length).toBe(3);
    expect(html).toContain("Listed with the household");
    expect(html).toContain("Opted in (household)");
  });

  it("has the More menu and Done in the footer", () => {
    const html = body({ person: "p-samira" });
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain(">Done<");
  });

  it("draws the glance (giving by person) and the history where the server passed them", () => {
    const html = body({ person: "p-samira" });
    expect(html).toContain('data-testid="glance"');
    expect(html).toContain('data-testid="history"');
  });

  it("keeps the places for Custom fields and Notes in the structure: nothing drawn until a slice passes a node, and then in position", () => {
    const empty = body({ person: "p-samira" });
    expect(empty).not.toMatch(/Custom fields|data-section="notes"/);
    const filled = body({
      person: "p-samira",
      slots: { customFields: createElement("div", { "data-slot": "cf" }, "CF"), notes: createElement("div", { "data-slot": "nt" }, "NT"), history: createElement("div", { "data-testid": "history" }, "h") },
    });
    const at = (s: string) => filled.indexOf(s);
    expect(at('data-section="profile"')).toBeLessThan(at('data-slot="cf"'));
    expect(at('data-slot="cf"')).toBeLessThan(at('data-section="account"'));
    expect(at('data-section="memberships"')).toBeLessThan(at('data-slot="nt"'));
    expect(at('data-slot="nt"')).toBeLessThan(at('data-section="history"'));
  });
});

describe("a child in the slide-over (D2)", () => {
  const html = body({ person: "p-layla" });

  it("has no mobile, email, profession or employer, and says contact is via parents", () => {
    const adult = body({ person: "p-samira" });
    for (const label of ["Mobile", "Email", "Profession", "Employer"]) {
      expect(adult, `an adult has ${label}`).toContain(`>${label}<`);
      expect(html, label).not.toContain(`>${label}<`);
    }
    expect(html).toContain("Via parents");
    expect(html).not.toMatch(/@example|\+1713|\(713\)/);
  });

  it("has the birth date inside the slide-over, editable, and age on the line", () => {
    expect(html).toContain('aria-label="Edit birth date: 07/21/2015"');
    expect(html).toContain("Daughter · age 11");
  });

  it("says staff only and never sent to Niva, and has no Ask Niva button", () => {
    expect(html).toContain("Staff only · never sent to Niva");
    expect(html).not.toMatch(/Ask Niva/i);
  });

  it("has no Giving section, no anniversary, no printed code, and a parent-managed account", () => {
    expect(sectionOpen(html, "giving")).toBeNull();
    expect(html).not.toContain("Anniversary");
    expect(html).toContain("Managed by parents until age 13");
    expect(html).not.toContain("Coming next");
  });

  it("shows photo consent but does not let staff change a child's privacy choices", () => {
    expect(html).toContain("Photo consent");
    expect(html).not.toContain('role="switch"');
    expect(html).toContain("A parent gives or withdraws consent for a child");
  });

  it("is the same for an adult: no Ask Niva button anywhere in the slide-over", () => {
    expect(body({ person: "p-samira" })).not.toMatch(/Ask Niva/i);
  });
});

describe("without people.manage (view only)", () => {
  const html = body({ person: "p-samira", access: "view" });

  it("is plain text with a View only chip: no pencil, no editing, no switches, no More menu", () => {
    expect(html).toContain("View only");
    expect(html).not.toContain('aria-label="Edit ');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).toContain("(713) 555-0136");
  });

  it("offers no Add ID and no Retire on the IDs", () => {
    expect(html).not.toContain("Add ID");
    expect(html).not.toContain('aria-label="Retire ');
  });
});

describe("a role that cannot read a section", () => {
  const html = body({ person: "p-samira", access: "limited" });

  it("says 'You don't have access to this area' in Roles, in what the member gave, and hides finance IDs with a note", () => {
    expect(html.split("You don&#x27;t have access to this area").length - 1).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("1187");
    expect(html).not.toContain("S HASSAN");
    expect(html).toContain("only visible with a giving permission");
  });

  it("still shows the member number and the organization's member ID", () => {
    expect(html).toContain("M-10482");
    expect(html).toContain("0482");
  });
});

describe("IDs", () => {
  it("shows every kind to a finance reader with the Retire and Add ID controls", () => {
    const html = body({ person: "p-samira" });
    for (const v of ["M-10482", "0482", "20417", "1187", "S HASSAN"]) expect(html, v).toContain(v);
    expect(html).toContain('aria-label="Retire Community member ID 0482"');
    expect(html).toContain("Add ID");
    expect(html).toContain("Retired (1)");
  });

  it("never offers Retire on the member number Weaver issued", () => {
    expect(body({ person: "p-samira" })).not.toContain('aria-label="Retire Member no.');
  });
});

describe("any community, any script", () => {
  const html = body({ family: "tanaka", person: "p-misaki" });

  it("draws a name in Japanese, a profession and an expertise headline in Japanese, and lets the browser choose the direction", () => {
    expect(html).toContain("田中 美咲");
    expect(html).toContain("薬剤師");
    expect(html).toContain("薬剤師。薬の相談に乗れます");
    expect(html).toContain('dir="auto"');
    expect(html).toContain("田中・Haddad の家");
  });

  it("uses the community's own words for IDs and has no tradition or faith wording", () => {
    const adults = body({ person: "p-samira" });
    expect(adults).toContain("Community member ID");
    expect(html + adults).not.toMatch(/jain|derasar|pathshala|gyan|temple|church|mosque|boli/i);
  });
});

describe("a person in no family (the person's own page)", () => {
  const detail = detailFixture("empty", "p-ines", { access: "full", standalone: true })!;
  const html = renderToStaticMarkup(
    createElement(PersonSlideOver, {
      detail,
      plan: sectionPlan({ isChild: false, givingByPerson: false, givingOn: false, hasHistory: true }),
      slots: { history: createElement("div", {}, "h") },
      closeHref: "/people",
      closeLabel: "People",
      hrefs,
      mode: "page",
    }),
  );

  it("draws the content on the page with a way back, says they are in no family and offers no relationship or Move", () => {
    expect(html).toContain('data-testid="person-details-page"');
    expect(html).toContain('href="/people"');
    expect(html).toContain("Not in a family yet");
    expect(html).not.toContain("Relationship");
    expect(html).not.toContain("Move to another family");
  });

  it("has no Done button (it is a page, not a panel)", () => {
    expect(html).not.toContain(">Done<");
  });
});

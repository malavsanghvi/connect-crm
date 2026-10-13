import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The five details of a person's record (the name they go by, interests, expertise areas, best time to call, daily learning goal) as
// the slide-over's Profile section and the Family page's person card draw them. Nothing is called, only rendered.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/app/(app)/households/[id]/inline-actions", () => ({ savePersonFieldsAction: vi.fn(), saveHouseholdFieldsAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/custom-actions", () => ({ saveCustomValueAction: vi.fn(), addCustomFieldAction: vi.fn(), setCustomFieldStatusAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/slideover-actions", () => ({ addPersonInlineAction: vi.fn() }));
vi.mock("@/app/(app)/identifiers/person-id-seam", () => ({ addPersonId: vi.fn(), retirePersonId: vi.fn() }));
vi.mock("@/app/(app)/people/deceased-actions", () => ({ markDeceasedAction: vi.fn(), undoDeceasedAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { detailFixture, type Access } from "@/app/dev/people-slideover/fixtures";
import { familyFixture, type FamilyKey } from "@/app/dev/people-family/fixtures";
import { ListRow } from "@/components/people-v2/family/list-row";
import { PersonCard, goesBy, type PersonCtx } from "@/components/people-v2/family/person-card";
import type { InlineEdit } from "@/components/people-v2/family/use-inline-edit";
import { SlideOverBody } from "@/components/people-v2/slideover/person-slideover";
import { initialEdit, PERSON_UNITS, type EditState } from "@/lib/people-v2/inline-edit";
import { sectionPlan, type PersonDetailModel } from "@/lib/people-v2/slideover";

const hrefs = { details: "/h?person=p", move: "/h?person=p&mode=move", merge: "/people/merge?person=p" };

function draw(detail: PersonDetailModel) {
  const plan = sectionPlan({ isChild: detail.person.isChild, givingByPerson: false, givingOn: false, hasHistory: false });
  return renderToStaticMarkup(
    createElement(SlideOverBody, { detail, plan, slots: {}, closeHref: "/h", closeLabel: "Hassan household", hrefs, mode: "panel" as const, onClose: () => {} }),
  );
}
function body(o: { family?: FamilyKey; person: string; access?: Access; change?: (d: PersonDetailModel) => PersonDetailModel }) {
  const detail = detailFixture(o.family ?? "hassan", o.person, { access: o.access ?? "full", standalone: false });
  if (!detail) throw new Error("no such person in the fixture");
  return draw(o.change ? o.change(detail) : detail);
}

describe("the Profile section: what else is on an adult's record", () => {
  it("shows interests and expertise areas as chips, when to call, how they like to be reached, and the daily goal, each click-to-edit", () => {
    const html = body({ person: "p-samira" });
    expect(html).toContain('data-testid="profile-preferences"');
    expect(html).toContain('aria-label="Edit interests: Community kitchen, Youth mentoring, Gardening"');
    expect(html).toContain('aria-label="Edit expertise areas: Pharmacy, Health"');
    expect(html).toContain('aria-label="Edit best call time: Evening"');
    expect(html).toContain('aria-label="Edit daily goal: 10 minutes a day"');
    expect(html).toContain('aria-label="Edit goes by:');
    expect((html.match(/data-testid="chips"/g) ?? []).length).toBe(2);
    // how they like to be reached is theirs to set, in the app: shown, not editable here
    expect(html).toContain("Reached by");
    expect(html).toContain("Phone call, Email");
    expect(html).toContain("The member chooses how they are reached in the app, and their opt-ins with it. It is not changed here.");
    expect(html).not.toContain('aria-label="Edit reached by');
  });

  it("says where expertise areas show, and what happens to a call time without phone calls", () => {
    const html = body({ family: "tanaka", person: "p-misaki" });
    expect(html).toContain("Shown in the directory only while the expertise listing (Privacy and directory) is on.");
    expect(html).toContain("They have not chosen phone calls in the app, so the app may clear this when they next save their profile.");
    expect(body({ person: "p-samira" })).not.toContain("They have not chosen phone calls");
  });

  it("draws a list in any script as it is", () => {
    const html = body({ family: "tanaka", person: "p-misaki" });
    expect(html).toContain('aria-label="Edit interests: 茶道, 俳句, Gardening"');
    expect(html).toContain('aria-label="Edit expertise areas: 薬学"');
    expect(html).toContain('aria-label="Edit daily goal: 5 minutes a day"');
    expect(html).toContain('dir="auto"');
  });

  it("invites adding each one that is empty, and says nothing was given for how they like to be reached", () => {
    const html = body({ person: "p-karim" });
    expect(html).toContain("Add interests");
    expect(html).toContain("Add expertise areas");
    expect(html).toContain("Add a call time");
    expect(html).toContain("Set a daily goal");
    expect(html).toContain("Add a name they go by");
    expect(html).toContain("Not given");
  });

  it("offers the daily goal only where the community uses learning, or when one is already on file", () => {
    const off = (value: string) => (d: PersonDetailModel): PersonDetailModel => ({
      ...d,
      preferences: d.preferences && { ...d.preferences, learningOn: false, values: { ...d.preferences.values, gyan_daily_minutes: value } },
    });
    expect(body({ person: "p-karim", change: off("") })).not.toContain("Daily goal");
    expect(body({ person: "p-samira", change: off("10") })).toContain('aria-label="Edit daily goal: 10 minutes a day"');
  });

  it("is plain text with the View only chip when the role cannot edit people", () => {
    const html = body({ person: "p-samira", access: "view" });
    expect(html).toContain("View only");
    expect(html).toContain("Community kitchen");
    expect(html).toContain("Evening");
    expect(html).not.toContain('aria-label="Edit interests');
    expect(html).not.toContain('aria-label="Edit best call time');
    expect(html).not.toContain('aria-label="Edit goes by');
  });

  it("gives a child a preferred name and nothing else of these: no interests, expertise, call time, reach choices or daily goal", () => {
    const html = body({ person: "p-layla" });
    expect(html).toContain('aria-label="Edit goes by');
    expect(html).not.toContain('data-testid="profile-preferences"');
    for (const w of ["Interests", "Expertise areas", "Best call time", "Reached by", "Daily goal"]) expect(html, w).not.toContain(w);
    expect(html).toContain("Staff only · never sent to Niva");
  });
});

describe("the person card on the Family page", () => {
  const ctx = (canEdit = true): PersonCtx => ({
    householdId: "hh",
    canEdit,
    check: familyFixture("adeyemi").check,
    detailsHref: (id) => `/households/hh?person=${id}`,
  });
  const card = (family: FamilyKey, id: string, canEdit = true) => {
    const model = familyFixture(family);
    const p = [...model.adults, ...model.children].find((x) => x.id === id)!;
    return renderToStaticMarkup(createElement(PersonCard, { person: p, ctx: ctx(canEdit), orgMemberLabel: "Community member ID" }));
  };

  it("calls someone by the name they go by, and says so in a small line", () => {
    const html = card("adeyemi", "p-folake");
    expect(html).toContain("Fola Adeyemi");
    expect(html).toMatch(/data-testid="goes-by"[^>]*>Goes by Fola</);
  });

  it("has no such line when they go by their first name, or by nothing else", () => {
    expect(card("adeyemi", "p-tunde")).not.toContain("goes-by");
    expect(goesBy({ values: { first_name: "Folake", preferred_name: "folake" } })).toBe("");
    expect(goesBy({ values: { first_name: "Folake", preferred_name: "" } })).toBe("");
    expect(goesBy({ values: { first_name: "Folake" } })).toBe("");
    expect(goesBy({ values: { first_name: "美咲", preferred_name: "ミサ" } })).toBe("ミサ");
  });
});

// A hand-made edit, to draw the list editor in each of its states without a browser.
function fakeEdit(over: Partial<EditState> & { editing?: boolean; busy?: boolean }): InlineEdit {
  const base = initialEdit(PERSON_UNITS.interests, { interests: '["chess","茶道"]' });
  const state = { ...base, ...over };
  const noop = () => {};
  return {
    state,
    shown: state.phase === "idle" ? state.committed : state.draft,
    editing: over.editing ?? (state.phase === "editing" || state.phase === "error"),
    busy: over.busy ?? state.phase === "saving",
    start: noop,
    change: noop,
    setReason: noop,
    cancel: noop,
    submit: noop,
    commit: noop,
    leave: noop,
    useTheirs: noop,
    keepMine: noop,
  } as unknown as InlineEdit;
}
const drawList = (edit: InlineEdit, editable = true) =>
  renderToStaticMarkup(createElement(ListRow, { label: "Interests", fieldKey: "interests", unit: PERSON_UNITS.interests, edit, editable, placeholder: "Add interests", wide: true }));

describe("the list editor", () => {
  it("shows the chips as a button that starts editing, with the list in its name", () => {
    const html = drawList(fakeEdit({}));
    expect(html).toContain('aria-label="Edit interests: chess, 茶道"');
    expect(html).toContain("茶道");
  });

  it("while editing: a chip for each item with a way to remove it, the input, and the keys in words", () => {
    const html = drawList(fakeEdit({ phase: "editing", draft: { interests: "chess\n茶道\nori" } }));
    expect(html).toContain('aria-label="Remove chess"');
    expect(html).toContain('aria-label="Remove 茶道"');
    expect(html).toContain('value="ori"');
    expect(html).toContain("A comma or Enter adds one · Enter on an empty line saves · Esc cancels");
    expect(html).toContain("Done");
  });

  it("shows a mistake under the field and keeps what was typed in it", () => {
    const html = drawList(fakeEdit({ phase: "editing", draft: { interests: "chess\nlongword" }, problem: "Each interest can be 50 characters at most" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Each interest can be 50 characters at most");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('value="longword"');
  });

  it("shows a failed save in words next to the list, with the retry, and what was typed stays", () => {
    const html = drawList(fakeEdit({ phase: "error", draft: { interests: "chess\n茶道\nart\n" }, message: "Could not save Sami's interests — the server did not accept it. Try again." }));
    expect(html).toContain("Could not save Sami&#x27;s interests — the server did not accept it. Try again.");
    expect(html).toContain("Try again");
    expect(html).toContain('aria-label="Remove art"');
  });

  it("says, while it saves, that it is saving, and never claims it saved", () => {
    const html = drawList(fakeEdit({ phase: "saving", draft: { interests: "chess\n茶道\nart\n" } }));
    expect(html).toContain("Saving…");
    expect(html).not.toContain("Saved");
  });

  it("shows the other person's list and the two ways out when someone else changed it first", () => {
    const edit = fakeEdit({
      phase: "conflict",
      draft: { interests: "chess\nart\n" },
      pending: { fields: { interests: '["chess","art"]' }, expect: { interests: '["chess"]' }, reason: null },
      conflict: { theirs: { interests: '["Hiking","Board games"]' }, who: "Ravi", at: null },
    });
    const html = drawList(edit);
    expect(html).toContain('data-testid="conflict"');
    expect(html).toContain("Ravi changed this a moment ago to Hiking, Board games. Your change was not saved.");
    expect(html).toContain("Use theirs");
    expect(html).toContain("Keep mine · chess, art");
  });

  it("is plain chips, with no pencil and no button, for someone who cannot edit", () => {
    const html = drawList(fakeEdit({}), false);
    expect(html).toContain("chess");
    expect(html).not.toContain("<button");
  });

  it("shows a dash for none when the viewer cannot edit, and an invitation when they can", () => {
    const none = fakeEdit({ committed: { interests: "" }, draft: { interests: "" } });
    expect(drawList(none, false)).toContain("—");
    expect(drawList(none, true)).toContain("Add interests");
  });
});

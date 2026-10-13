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
vi.mock("@/app/(app)/households/[id]/event-add-actions", () => ({ addToEventAction: vi.fn(), loadAddToEventAction: vi.fn() }));
vi.mock("@/app/(app)/households/[id]/profile-details-actions", () => ({ saveProfileDetailsAction: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { detailFixture, type Access } from "@/app/dev/people-slideover/fixtures";
import { familyFixture, type FamilyKey } from "@/app/dev/people-family/fixtures";
import { InterestsRow, ListRow } from "@/components/people-v2/family/list-row";
import { PersonCard, goesBy, type PersonCtx } from "@/components/people-v2/family/person-card";
import type { InlineEdit } from "@/components/people-v2/family/use-inline-edit";
import { SlideOverBody } from "@/components/people-v2/slideover/person-slideover";
import { initialEdit, PERSON_UNITS, type EditState, type EditUnit } from "@/lib/people-v2/inline-edit";
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
    expect(html).toContain('aria-label="Edit interests: Volunteering, Youth, Community kitchen"');
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
    expect(html).toContain("Shown in the directory only while their expertise listing is on.");
    expect(html).toContain("They have not chosen phone calls in the app, so the app may clear this when they next save their profile.");
    expect(body({ person: "p-samira" })).not.toContain("They have not chosen phone calls");
  });

  it("draws a list in any script as it is", () => {
    const html = body({ family: "tanaka", person: "p-misaki" });
    expect(html).toContain('aria-label="Edit interests: Events, Seniors, 茶道"');
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

// A hand-made edit, to draw the editors in each of their states without a browser.
function fakeEdit(unit: EditUnit, start: Record<string, string>, over: Partial<EditState> & { editing?: boolean; busy?: boolean }): InlineEdit {
  const base = initialEdit(unit, start);
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

const AREAS = PERSON_UNITS.expertiseAreas;
const areasEdit = (over: Partial<EditState> & { editing?: boolean; busy?: boolean }) => fakeEdit(AREAS, { expertise_tags: '["chess","茶道"]' }, over);
const drawList = (edit: InlineEdit, editable = true) =>
  renderToStaticMarkup(createElement(ListRow, { label: "Expertise areas", fieldKey: "expertise_tags", unit: AREAS, edit, editable, placeholder: "Add expertise areas", wide: true }));

describe("the expertise areas editor (free text chips)", () => {
  it("shows the chips as a button that starts editing, with the list in its name", () => {
    const html = drawList(areasEdit({}));
    expect(html).toContain('aria-label="Edit expertise areas: chess, 茶道"');
    expect(html).toContain("茶道");
  });

  it("while editing: a chip for each item with a way to remove it, the input, and the keys in words", () => {
    const html = drawList(areasEdit({ phase: "editing", draft: { expertise_tags: "chess\n茶道\nori" } }));
    expect(html).toContain('aria-label="Remove chess"');
    expect(html).toContain('aria-label="Remove 茶道"');
    expect(html).toContain('value="ori"');
    expect(html).toContain("A comma or Enter adds one · Enter on an empty line saves · Esc cancels");
    expect(html).toContain("Done");
  });

  it("shows a mistake under the field and keeps what was typed in it", () => {
    const html = drawList(areasEdit({ phase: "editing", draft: { expertise_tags: "chess\nlongword" }, problem: "Each expertise area can be 50 characters at most" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Each expertise area can be 50 characters at most");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('value="longword"');
  });

  it("shows a failed save in words next to the list, with the retry, and what was typed stays", () => {
    const html = drawList(areasEdit({ phase: "error", draft: { expertise_tags: "chess\n茶道\nart\n" }, message: "Could not save Sami's expertise areas — the server did not accept it. Try again." }));
    expect(html).toContain("Could not save Sami&#x27;s expertise areas — the server did not accept it. Try again.");
    expect(html).toContain("Try again");
    expect(html).toContain('aria-label="Remove art"');
  });

  it("says, while it saves, that it is saving, and never claims it saved", () => {
    const html = drawList(areasEdit({ phase: "saving", draft: { expertise_tags: "chess\n茶道\nart\n" } }));
    expect(html).toContain("Saving…");
    expect(html).not.toContain("Saved");
  });

  it("shows the other person's list and the two ways out when someone else changed it first", () => {
    const edit = areasEdit({
      phase: "conflict",
      draft: { expertise_tags: "chess\nart\n" },
      pending: { fields: { expertise_tags: '["chess","art"]' }, expect: { expertise_tags: '["chess"]' }, reason: null },
      conflict: { theirs: { expertise_tags: '["Hiking","Board games"]' }, who: "Ravi", at: null },
    });
    const html = drawList(edit);
    expect(html).toContain('data-testid="conflict"');
    expect(html).toContain("Ravi changed this a moment ago to Hiking, Board games. Your change was not saved.");
    expect(html).toContain("Use theirs");
    expect(html).toContain("Keep mine · chess, art");
  });

  it("is plain chips, with no pencil and no button, for someone who cannot edit", () => {
    const html = drawList(areasEdit({}), false);
    expect(html).toContain("chess");
    expect(html).not.toContain("<button");
  });

  it("shows a dash for none when the viewer cannot edit, and an invitation when they can", () => {
    const none = fakeEdit(AREAS, { expertise_tags: "" }, {});
    expect(drawList(none, false)).toContain("—");
    expect(drawList(none, true)).toContain("Add expertise areas");
  });
});

const INT = PERSON_UNITS.interests;
// One key chosen and an older value in another script, as imported data can be.
const intEdit = (over: Partial<EditState> & { editing?: boolean; busy?: boolean }, start = '["youth","茶道"]') => fakeEdit(INT, { interests: start }, over);
const drawInterests = (edit: InlineEdit, editable = true) =>
  renderToStaticMarkup(createElement(InterestsRow, { label: "Interests", fieldKey: "interests", unit: INT, edit, editable, placeholder: "Add interests", wide: true }));

describe("the interests editor (a fixed choice)", () => {
  it("shows the names of the keys chosen, then an older value as it was written, as a button that starts editing", () => {
    const html = drawInterests(intEdit({}, '["茶道","giving","events"]'));
    expect(html).toContain('aria-label="Edit interests: Events, Giving, 茶道"');
    expect(html).toContain('data-testid="chips"');
  });

  it("while editing: one toggle for each of the app's six, the chosen ones pressed, and no place to type", () => {
    const html = drawInterests(intEdit({ phase: "editing", draft: { interests: "youth\n茶道\n" } }));
    for (const k of ["events", "pathshala", "volunteering", "youth", "seniors", "giving"]) expect(html, k).toContain(`data-interest="${k}"`);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(5);
    expect(html).not.toContain("<input");
    expect(html).toContain('data-testid="interests-done"');
    expect(html).toContain("Choose from the list · Done saves · Esc cancels");
  });

  it("shows an older value as a chip that can be removed, with the reason it cannot be added again", () => {
    const html = drawInterests(intEdit({ phase: "editing", draft: { interests: "youth\n茶道\n" } }));
    expect(html).toContain('data-testid="legacy-interests"');
    expect(html).toContain('aria-label="Remove 茶道"');
    expect(html).toContain("You can remove it, but not add it back.");
  });

  it("has no such block when nothing older is on file", () => {
    const html = drawInterests(intEdit({ phase: "editing", draft: { interests: "youth\n" } }, '["youth"]'));
    expect(html).not.toContain("legacy-interests");
  });

  it("shows a refusal under the choices, in words", () => {
    const html = drawInterests(intEdit({ phase: "editing", draft: { interests: "youth\nchess\n" }, problem: 'Choose interests from the list: Events, Pathshala, Volunteering, Youth, Seniors and Giving ("chess" is not on it)' }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("is not on it");
  });

  it("shows a failed save in words with the retry, and the choices stay as they were set", () => {
    const html = drawInterests(intEdit({ phase: "error", draft: { interests: "youth\ngiving\n茶道\n" }, message: "Could not save Sami's interests — the server did not accept it. Try again." }));
    expect(html).toContain("Could not save Sami&#x27;s interests — the server did not accept it. Try again.");
    expect(html).toContain("Try again");
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(2);
  });

  it("says, while it saves, that it is saving", () => {
    const html = drawInterests(intEdit({ phase: "saving", draft: { interests: "youth\ngiving\n茶道\n" } }));
    expect(html).toContain("Saving…");
    expect(html).not.toContain("Saved");
  });

  it("shows the other person's choice by names, and the two ways out", () => {
    const edit = intEdit({
      phase: "conflict",
      draft: { interests: "youth\ngiving\n茶道\n" },
      pending: { fields: { interests: '["youth","giving","茶道"]' }, expect: { interests: '["youth","茶道"]' }, reason: null },
      conflict: { theirs: { interests: '["seniors","events"]' }, who: "Ravi", at: null },
    });
    const html = drawInterests(edit);
    expect(html).toContain("Ravi changed this a moment ago to Events, Seniors. Your change was not saved.");
    expect(html).toContain("Use theirs");
    expect(html).toContain("Keep mine · Youth, Giving, 茶道");
  });

  it("is plain chips, with no button, for someone who cannot edit", () => {
    const html = drawInterests(intEdit({}), false);
    expect(html).toContain("Youth");
    expect(html).toContain("茶道");
    expect(html).not.toContain("<button");
  });

  it("shows a dash for none when the viewer cannot edit, and an invitation when they can", () => {
    const none = fakeEdit(INT, { interests: "" }, {});
    expect(drawInterests(none, false)).toContain("—");
    expect(drawInterests(none, true)).toContain("Add interests");
  });
});

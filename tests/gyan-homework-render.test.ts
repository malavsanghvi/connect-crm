import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The drawer and the row buttons call server actions; here nothing is called, only rendered.
vi.mock("@/app/(app)/content/gyan-path/homework-actions", () => ({
  saveAssignmentAction: vi.fn(),
  setAssignmentStatusAction: vi.fn(),
}));
// ActionForm's step-up modal verifies a code through a server action.
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));

import { HomeworkCell } from "@/app/(app)/content/gyan-path/homework-cell";
import { HomeworkFields } from "@/app/(app)/content/gyan-path/homework-fields";
import { SubmissionParts } from "@/app/(app)/pathshala/homework/parts";
import { HouseholdCard, type HouseholdCardData } from "@/components/household-card";
import type { SignedFile } from "@/lib/gyan-homework/db";
import { parseAssignment, parseSubmission, type Assignment, type Submission } from "@/lib/gyan-homework/homework";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

/** A regex for one tag carrying every attribute, in any order (React 19 serializes `name` last on form controls). */
const tagWith = (tag: string, ...attrs: string[]) => new RegExp(`<${tag}${attrs.map((a) => `(?=[^>]*\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`).join("")}[^>]*>`);
const checkedInput = (type: string, name: string, value: string) => tagWith("input", `type="${type}"`, `name="${name}"`, `value="${value}"`, 'checked=""');

const LEVEL = "6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a61";
const CLASS = "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d";

const parsed = parseAssignment({
  id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
  center_id: "c",
  level_id: LEVEL,
  class_id: CLASS,
  title: "Navkar recording",
  instructions_md: "Say it **slowly**.",
  allowed_kinds: ["voice", "text"],
  max_files: 2,
  required_for_level: true,
  points: 15,
  due_rule: { kind: "on", date: "2026-11-01" },
  parent_check: "always",
  reviewer: "content",
  status: "published",
  sort_order: 1,
  created_by: null,
  created_at: null,
  updated_at: null,
});
if (!parsed.ok) throw new Error(parsed.error);
const assignment: Assignment = parsed.value;
const classes = [
  { id: CLASS, name: "Sunday 10 AM · Level 2" },
  { id: "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", name: "Sunday 11 AM · Level 3" },
];

describe("Content › Gyan Path › Homework drawer fields", () => {
  it("shows a saved homework as saved: its kinds, due date, parent check, reviewer and class", () => {
    const html = render(createElement(HomeworkFields, { levelId: LEVEL, levelName: "What is Samayik", assignment, classes, canChooseEveryone: true, shared: false, nextOrder: 2 }));
    expect(html).toContain('name="id" value="9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b"');
    expect(html).toContain('value="Navkar recording"');
    expect(html).toContain("Say it **slowly**.");
    // The database's limits are on the controls too (0587: instructions <= 4,000).
    expect(html).toMatch(tagWith("textarea", 'name="instructions_md"', 'maxLength="4000"'));
    expect(html).toContain("Up to 4,000 characters.");
    expect(html).toContain("0 to 1,000; paid once, when the reviewer accepts.");
    expect(html).toMatch(checkedInput("checkbox", "allowed_kinds", "voice"));
    expect(html).toMatch(checkedInput("checkbox", "allowed_kinds", "text"));
    expect(html).not.toMatch(checkedInput("checkbox", "allowed_kinds", "photo"));
    expect(html).toContain('<option value="on" selected="">On a date</option>');
    expect(html).toMatch(tagWith("input", 'type="date"', 'name="due_date"', 'value="2026-11-01"'));
    expect(html).not.toContain('name="due_days"');
    expect(html).toMatch(checkedInput("radio", "parent_check", "always"));
    expect(html).toMatch(checkedInput("radio", "reviewer", "content"));
    expect(html).toContain('<option value="">Everyone doing the level</option>');
    expect(html).toContain(`<option value="${CLASS}" selected="">Only Sunday 10 AM · Level 2</option>`);
    expect(html).toContain("The level stays incomplete until this homework is accepted");
    expect(html).toContain("This homework is published: changes reach learners as soon as they are saved.");
    expect(html).not.toContain("Homework is yours even though the lesson is shared");
    // A due date: the reminder can be set (0588); none is set on this one.
    expect(html).toContain("Remind (hours before it is due)");
    expect(html).toMatch(tagWith("input", 'name="remind_hours"', 'value=""', 'placeholder="No reminder"'));
    expect(html).toContain("1 to 720 hours (30 days). The reminder is sent that many hours before the end of the due day");
  });

  it("shows the reminder's hours when set, says exactly when and to whom it goes, and never promises a reminder that is not set (0588)", () => {
    const withReminder: Assignment = { ...assignment, remind_hours_before: 48 };
    const html = render(createElement(HomeworkFields, { levelId: LEVEL, levelName: "What is Samayik", assignment: withReminder, classes, canChooseEveryone: true, shared: false, nextOrder: 2 }));
    expect(html).toMatch(tagWith("input", 'name="remind_hours"', 'value="48"'));
    // The end of the due day; who is told; who the learners are; quiet hours (the whole reminder waits; no push after the
    // homework is due); hours set after publishing (owner decisions 2026-10-07).
    expect(html).toContain("that many hours before the end of the due day, by push and email, to each learner who has not handed it in yet");
    expect(html).toContain("for a learner under 18 to every adult of each household they are in");
    expect(html).toContain("For homework for everyone, the learners are the members who have completed a step of the level.");
    expect(html).toContain("quiet hours the whole reminder waits until they end; if they end only after the homework is due, the email goes at once and the push is not sent.");
    expect(html).toContain("Set or raised after the homework is published, it goes at once when its time has already passed.");
    expect(html).toContain("A reminder goes out only if you set one (it needs a due date), and only to the learners who have not handed in yet.");
    expect(html).not.toContain("reminded two days before");
    // No due date: no reminder field (a reminder needs a due date), and the hint says a reminder needs one.
    const none = render(createElement(HomeworkFields, { levelId: LEVEL, levelName: "L", classes, canChooseEveryone: true, shared: false, nextOrder: 1 }));
    expect(none).not.toContain('name="remind_hours"');
    expect(none).toContain("A reminder goes out only if you set one (it needs a due date)");
    expect(none).not.toContain("reminded two days before");
  });

  it("explains each parent-check and reviewer choice in one line", () => {
    const html = render(createElement(HomeworkFields, { levelId: LEVEL, levelName: "What is Samayik", classes, canChooseEveryone: true, shared: true, nextOrder: 1 }));
    expect(html).toContain("A learner under 18 handing in from their own login waits for a household adult");
    expect(html).toContain("Every hand-in waits for a household adult");
    expect(html).toContain("Goes straight to the reviewer");
    expect(html).toContain("The Teacher of the learner");
    expect(html).toContain("People with content.manage");
    // New homework: the plan's defaults (children, the class teacher, photo + voice + text, no due date, 10 points, 3 files).
    expect(html).toMatch(checkedInput("radio", "parent_check", "children"));
    expect(html).toMatch(checkedInput("radio", "reviewer", "teacher"));
    expect(html).toMatch(checkedInput("checkbox", "allowed_kinds", "photo"));
    expect(html).not.toMatch(checkedInput("checkbox", "allowed_kinds", "file"));
    expect(html).toContain('<option value="none" selected="">No due date</option>');
    expect(html).toMatch(tagWith("input", 'name="points"', 'value="10"'));
    expect(html).toMatch(tagWith("input", 'name="max_files"', 'value="3"'));
    expect(html).toContain("Homework is yours even though the lesson is shared");
  });

  it("lets a class teacher pick only their classes, never everyone", () => {
    const html = render(createElement(HomeworkFields, { levelId: LEVEL, levelName: "L", classes: [classes[0]], canChooseEveryone: false, shared: false, nextOrder: 1 }));
    expect(html).not.toContain("Everyone doing the level");
    expect(html).toContain("Only Sunday 10 AM · Level 2");
    expect(html).toContain("As a class teacher you add homework for the classes you teach.");
    const none = render(createElement(HomeworkFields, { levelId: LEVEL, levelName: "L", classes: [], canChooseEveryone: false, shared: false, nextOrder: 1 }));
    expect(none).toContain("none of this term&#x27;s classes is yours yet");
  });
});

describe("Content › Gyan Path › the Homework column of a level", () => {
  const level = { id: LEVEL, name: "What is Samayik" };
  it("lists each homework with its status chip, what it asks and the moves an editor may make", () => {
    const html = render(createElement(HomeworkCell, { level, goalName: "Learn Samayik", shared: true, assignments: [assignment], canAdd: true, classes, canChooseEveryone: true, ownClasses: [], timeZone: "America/Chicago" }));
    expect(html).toContain("Navkar recording");
    expect(html).toContain("Published");
    expect(html).toContain("15 points · Due Nov 1, 2026 · Only Sunday 10 AM · Level 2");
    expect(html).toContain("Answer by voice note or written answer · parent check: always · reviewed by the content team · required for the level");
    expect(html).toMatch(tagWith("button", 'name="status"', 'value="draft"'));
    expect(html).toMatch(tagWith("button", 'name="status"', 'value="archived"'));
    expect(html).not.toMatch(tagWith("button", 'name="status"', 'value="published"'));
    expect(html).toContain("Unpublish");
    expect(html).toContain("Archive");
    expect(html).toContain("Add homework");
    expect(html).toContain("Edit");
    // With a reminder (0588) the summary says so.
    const reminded = render(createElement(HomeworkCell, { level, goalName: "Learn Samayik", shared: true, assignments: [{ ...assignment, remind_hours_before: 48 }], canAdd: true, classes, canChooseEveryone: true, ownClasses: [], timeZone: "America/Chicago" }));
    expect(reminded).toContain("15 points · Due Nov 1, 2026 · Reminder 48 h before · Only Sunday 10 AM · Level 2");
  });

  it("shows a draft's Publish move, and nothing to change for readers", () => {
    const draft: Assignment = { ...assignment, status: "draft", class_id: null, due_rule: { kind: "days_after_start", days: 7 } };
    const html = render(createElement(HomeworkCell, { level, goalName: "G", shared: false, assignments: [draft], canAdd: true, classes, canChooseEveryone: true, ownClasses: [], timeZone: "America/Chicago" }));
    expect(html).toMatch(tagWith("button", 'name="status"', 'value="published"'));
    expect(html).toContain("7 days after the learner starts the level · Everyone doing the level");
    const reader = render(createElement(HomeworkCell, { level, goalName: "G", shared: false, assignments: [draft], canAdd: false, classes: [], canChooseEveryone: false, ownClasses: [], timeZone: "America/Chicago" }));
    expect(reader).toContain("Draft");
    expect(reader).not.toContain("Add homework");
    expect(reader).not.toContain('name="status"');
    expect(reader).not.toContain("read-only");
    const empty = render(createElement(HomeworkCell, { level, goalName: "G", shared: false, assignments: [], canAdd: false, classes: [], canChooseEveryone: false, ownClasses: [], timeZone: "America/Chicago" }));
    expect(empty).toContain("—");
  });

  it("a class teacher gets Edit and the moves for their own class's homework only; everyone's and another class's are read-only", () => {
    const otherClass = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
    const mine: Assignment = { ...assignment, id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Mine" };
    const everyone: Assignment = { ...assignment, id: "aaaaaaaa-0000-4000-8000-000000000002", title: "For everyone", class_id: null };
    const theirs: Assignment = { ...assignment, id: "aaaaaaaa-0000-4000-8000-000000000003", title: "Theirs", class_id: otherClass };
    const teacher = { level, goalName: "G", shared: false, canAdd: true, classes: [classes[0]], canChooseEveryone: false, ownClasses: [CLASS], timeZone: "America/Chicago" };
    const own = render(createElement(HomeworkCell, { ...teacher, assignments: [mine] }));
    expect(own).toContain(">Edit<");
    expect(own).toMatch(tagWith("button", 'name="status"', 'value="draft"'));
    expect(own).toMatch(tagWith("button", 'name="status"', 'value="archived"'));
    expect(own).not.toContain("read-only");
    for (const [a, reason] of [
      [everyone, "Set by the Pathshala office for everyone doing the level · read-only"],
      [theirs, "Set for another class · read-only"],
    ] as const) {
      const html = render(createElement(HomeworkCell, { ...teacher, assignments: [a] }));
      expect(html).toContain(a.title);
      expect(html).toContain(reason);
      expect(html).not.toContain(">Edit<");
      expect(html).not.toContain('name="status"');
      expect(html).not.toContain("Unpublish");
      expect(html).not.toContain("Archive");
      // Adding homework for their own class is still offered.
      expect(html).toContain("Add homework");
    }
    // A center-wide Teacher changes any class's homework, still not everyone's.
    const centerWide = render(createElement(HomeworkCell, { ...teacher, ownClasses: "any", assignments: [theirs, everyone] }));
    expect(centerWide).toContain("Set by the Pathshala office for everyone doing the level · read-only");
    expect(centerWide).not.toContain("Set for another class");
    expect(centerWide).toMatch(tagWith("button", 'name="status"', 'value="archived"'));
  });
});

describe("the household card for a homework reviewer", () => {
  const card: HouseholdCardData = {
    household_id: "h1",
    household_name: "Shah family",
    household_number: "JSH-H-2041",
    org_household_id: "0212",
    members: "Rahul, Mira, Aarav",
    primary_member: "Rahul Shah",
    zone: "Katy",
    city: "Houston",
    last_gift_on: "2026-09-01",
    open_pledge_cents: 125000,
  };
  const labels = { orgMemberLabel: "JSH ID", orgHouseholdLabel: "JSH household" };

  it("shows who the household is without any giving data (showGiving false); giving screens keep both", () => {
    const reviewer = render(createElement(HouseholdCard, { card, labels, timeZone: "America/Chicago", currency: "USD", showGiving: false }));
    expect(reviewer).toContain("Shah family");
    expect(reviewer).toContain("JSH-H-2041");
    expect(reviewer).toContain("Rahul, Mira, Aarav");
    expect(reviewer).toContain("Katy zone · Houston");
    expect(reviewer).not.toContain("Last gift");
    expect(reviewer).not.toContain("Open pledges");
    const giving = render(createElement(HouseholdCard, { card, labels, timeZone: "America/Chicago", currency: "USD" }));
    expect(giving).toContain("Last gift Sep 1, 2026");
    expect(giving).toContain("Open pledges $1,250.00");
    const noBalance = render(createElement(HouseholdCard, { card, labels, timeZone: "America/Chicago", currency: "USD", showBalance: false }));
    expect(noBalance).toContain("Last gift Sep 1, 2026");
    expect(noBalance).not.toContain("Open pledges");
  });
});

describe("Pathshala › Homework › the parts of an answer", () => {
  const sub = parseSubmission({
    id: "s1",
    status: "submitted",
    attempt: 1,
    text_answer: "Namo Arihantanam\nNamo Siddhanam",
    files: [
      { id: "f1", kind: "photo", storage_path: "c/p/s1/photo.jpg", mime_type: "image/jpeg", bytes: 2000000, sort_order: 1, deleted_at: null },
      { id: "f2", kind: "voice", storage_path: "c/p/s1/voice.m4a", mime_type: "audio/mp4", bytes: 120000, duration_seconds: 42, sort_order: 2, deleted_at: null },
      { id: "f3", kind: "file", storage_path: "c/p/s1/essay.pdf", mime_type: "application/pdf", bytes: 1258291, sort_order: 3, deleted_at: null },
      { id: "f4", kind: "photo", storage_path: null, mime_type: "image/jpeg", bytes: null, sort_order: 4, deleted_at: "2027-10-05T00:00:00Z" },
      { id: "f5", kind: "file", storage_path: "c/p/s1/missing.txt", mime_type: "text/plain", bytes: 10, sort_order: 5, deleted_at: null },
    ],
  });
  if (!sub.ok) throw new Error(sub.error);
  const submission: Submission = sub.value;
  const signed = new Map<string, SignedFile>([
    ["c/p/s1/photo.jpg", { url: "https://x/photo?token=1", problem: null }],
    ["c/p/s1/voice.m4a", { url: "https://x/voice?token=2", problem: null }],
    ["c/p/s1/essay.pdf", { url: "https://x/essay?token=3", problem: null }],
    ["c/p/s1/missing.txt", { url: null, problem: "Preview unavailable — the file was not found in storage." }],
  ]);

  it("renders a thumbnail that opens full size, a player, a download, the text, and says when a file is gone", () => {
    const html = render(createElement(SubmissionParts, { submission, signed, learner: "Aarav Shah" }));
    expect(html).toContain('<img src="https://x/photo?token=1" alt="Photo 1 from Aarav Shah"');
    expect(html).toContain("Open the original");
    expect(html).toContain('<audio controls="" preload="none" src="https://x/voice?token=2"');
    expect(html).toContain("Voice note (0:42)");
    // A new tab (a cross-origin signed URL ignores `download`; the URL itself was signed as an attachment), so a
    // half-typed note on the queue page is not lost.
    expect(html).toContain('<a href="https://x/essay?token=3" target="_blank" rel="noreferrer"');
    expect(html).not.toContain('download=""');
    expect(html).toContain("Download: PDF file (1.2 MB)");
    expect(html).toContain("Namo Arihantanam\nNamo Siddhanam");
    expect(html).toContain("Photo — the file was removed after the retention period");
    expect(html).toContain("Text file (10 B) — Preview unavailable — the file was not found in storage.");
    // Never the storage path.
    expect(html).not.toContain("c/p/s1/");
  });

  it("says when nothing was attached", () => {
    const html = render(createElement(SubmissionParts, { submission: { ...submission, files: [], text_answer: null }, signed, learner: "A" }));
    expect(html).toContain("Nothing was attached to this answer.");
  });

  it("says when the virus check holds a part back, could not finish, or removed it (0589)", () => {
    const checked = parseSubmission({
      id: "s2",
      status: "submitted",
      files: [
        { id: "g1", kind: "photo", storage_path: "c/p/s2/new.jpg", mime_type: "image/jpeg", bytes: 10, sort_order: 1, deleted_at: null, scan: "pending", scan_held: true },
        { id: "g2", kind: "file", storage_path: "c/p/s2/odd.pdf", mime_type: "application/pdf", bytes: 10, sort_order: 2, deleted_at: null, scan: "failed", scan_held: true },
        { id: "g3", kind: "voice", storage_path: null, mime_type: "audio/mp4", bytes: 10, sort_order: 3, deleted_at: "2026-10-07T00:00:00Z", scan: "infected", scan_held: false },
        { id: "g4", kind: "photo", storage_path: "c/p/s2/ok.jpg", mime_type: "image/jpeg", bytes: 10, sort_order: 4, deleted_at: null, scan: "pending", scan_held: false },
      ],
    });
    if (!checked.ok) throw new Error(checked.error);
    const html = render(createElement(SubmissionParts, {
      submission: checked.value,
      signed: new Map([["c/p/s2/ok.jpg", { url: "https://x/ok?token=4", problem: null }]]),
      learner: "Anya Shah",
    }));
    expect(html).toContain("Photo — Being checked for viruses — it opens here once the check is done.");
    expect(html).toContain("PDF file (10 B) — the virus check could not finish for this file; it opens here once a check passes.");
    expect(html).toContain("Voice note — removed: the virus check found a problem with the file. The family was told; the answer, note and points stay.");
    expect(html).not.toContain("removed after the retention period");
    // Monitor mode (or a file from before enforcement): pending but not held, it opens as usual.
    expect(html).toContain('<img src="https://x/ok?token=4"');
    expect(html).not.toContain("c/p/s2/");
  });
});

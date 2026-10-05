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
    const html = render(createElement(HomeworkCell, { level, goalName: "Learn Samayik", shared: true, assignments: [assignment], canEdit: true, classes, canChooseEveryone: true, timeZone: "America/Chicago" }));
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
  });

  it("shows a draft's Publish move, and nothing to change for readers", () => {
    const draft: Assignment = { ...assignment, status: "draft", class_id: null, due_rule: { kind: "days_after_start", days: 7 } };
    const html = render(createElement(HomeworkCell, { level, goalName: "G", shared: false, assignments: [draft], canEdit: true, classes, canChooseEveryone: true, timeZone: "America/Chicago" }));
    expect(html).toMatch(tagWith("button", 'name="status"', 'value="published"'));
    expect(html).toContain("7 days after the learner starts the level · Everyone doing the level");
    const reader = render(createElement(HomeworkCell, { level, goalName: "G", shared: false, assignments: [draft], canEdit: false, classes: [], canChooseEveryone: false, timeZone: "America/Chicago" }));
    expect(reader).toContain("Draft");
    expect(reader).not.toContain("Add homework");
    expect(reader).not.toContain('name="status"');
    const empty = render(createElement(HomeworkCell, { level, goalName: "G", shared: false, assignments: [], canEdit: false, classes: [], canChooseEveryone: false, timeZone: "America/Chicago" }));
    expect(empty).toContain("—");
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
    expect(html).toContain('<a href="https://x/essay?token=3" download=""');
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
});

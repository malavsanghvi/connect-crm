import { describe, expect, it } from "vitest";

import { homeworkAreas } from "@/lib/gyan-homework/access";
import {
  allowedKindsText,
  assignmentFromForm,
  assignmentStatusActions,
  assignmentStatusLabel,
  assignmentStatusTone,
  attemptText,
  audienceText,
  dueRuleFromJson,
  dueText,
  durationText,
  fileLabel,
  fileRemoved,
  fileSizeText,
  householdBriefText,
  INSTRUCTIONS_MAX,
  matchesQueueFilters,
  mayEditAssignment,
  parseAssignment,
  parseAssignmentList,
  parseHomeworkQueue,
  parseLearnerHousehold,
  parseSubmission,
  QUEUE_LIMIT,
  queueLevelOptions,
  queueLimitNote,
  readOnlyReason,
  statusChangeDoing,
  statusChangeMessage,
  submissionStatusLabel,
  submissionStatusTone,
  TITLE_MAX,
  type AssignmentFormInput,
  type QueueItem,
} from "@/lib/gyan-homework/homework";
import { moduleForPath } from "@/lib/modules";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { visibleNav, type ScopedContext } from "@/lib/permissions";

const LEVEL = "6f1d2c3b-4a5e-4f60-8b71-9c2d3e4f5a61";
const CLASS = "0a1b2c3d-4e5f-4a6b-8c7d-9e8f7a6b5c4d";
const ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

const form: AssignmentFormInput = {
  level_id: LEVEL,
  class_id: "",
  title: "Record yourself saying the Navkar Mantra",
  instructions_md: "Say it slowly, **once**.",
  allowed_kinds: ["voice", "text"],
  max_files: "3",
  points: "10",
  required_for_level: false,
  due_kind: "days_after_start",
  due_days: "7",
  due_date: "",
  parent_check: "children",
  reviewer: "teacher",
};

describe("the editor form, checked the way app.save_gyan_assignment checks it", () => {
  it("turns a good form into what the function takes (no id = insert)", () => {
    const r = assignmentFromForm(form);
    expect(r).toEqual({
      ok: true,
      value: {
        level_id: LEVEL,
        class_id: null,
        title: "Record yourself saying the Navkar Mantra",
        instructions_md: "Say it slowly, **once**.",
        allowed_kinds: ["voice", "text"],
        max_files: 3,
        required_for_level: false,
        points: 10,
        due_rule: { kind: "days_after_start", days: 7 },
        parent_check: "children",
        reviewer: "teacher",
        sort_order: 0,
      },
    });
  });

  it("keeps the id, the class and the date rule when given", () => {
    const r = assignmentFromForm({ ...form, id: ID, class_id: CLASS, due_kind: "on", due_date: "2026-11-01", sort_order: "4", points: "" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe(ID);
    expect(r.value.class_id).toBe(CLASS);
    expect(r.value.due_rule).toEqual({ kind: "on", date: "2026-11-01" });
    expect(r.value.sort_order).toBe(4);
    expect(r.value.points).toBe(0);
    expect(assignmentFromForm({ ...form, due_kind: "none", allowed_kinds: ["photo", "photo"] })).toMatchObject({ ok: true, value: { due_rule: { kind: "none" }, allowed_kinds: ["photo"] } });
  });

  it("says what is wrong in the database's words", () => {
    const bad = (patch: Partial<AssignmentFormInput>) => {
      const r = assignmentFromForm({ ...form, ...patch });
      return r.ok ? "ok" : r.error;
    };
    expect(bad({ level_id: "nope" })).toBe("choose the level first.");
    expect(bad({ id: "nope" })).toBe("the homework could not be identified. Reload the page and try again.");
    expect(bad({ class_id: "nope" })).toBe("choose the class, or leave the homework open to everyone doing the level.");
    expect(bad({ title: "  " })).toBe("give the homework a title.");
    expect(bad({ title: "x".repeat(TITLE_MAX + 1) })).toBe(`the title can be at most ${TITLE_MAX} characters (it has ${TITLE_MAX + 1}).`);
    // Characters are counted as the database counts them: an emoji is one.
    expect(bad({ title: "🪔".repeat(TITLE_MAX) })).toBe("ok");
    // The database's own ranges (0587): instructions <= 4,000, points 0-1,000, due days 1-365.
    expect(bad({ instructions_md: "x".repeat(INSTRUCTIONS_MAX + 1) })).toBe("the instructions can be at most 4,000 characters (they have 4,001).");
    expect(bad({ instructions_md: "x".repeat(INSTRUCTIONS_MAX) })).toBe("ok");
    expect(bad({ allowed_kinds: [] })).toBe("choose at least one way to answer: photo, file, voice note or written answer.");
    expect(bad({ allowed_kinds: ["video"] })).toBe('"video" is not a way to answer homework (photo, file, voice note or written answer).');
    expect(bad({ max_files: "0" })).toBe("the number of files allowed must be a whole number from 1 to 10.");
    expect(bad({ max_files: "11" })).toBe("the number of files allowed must be a whole number from 1 to 10.");
    expect(bad({ max_files: "two" })).toBe("the number of files allowed must be a whole number from 1 to 10.");
    expect(bad({ points: "-1" })).toBe("points must be a whole number from 0 to 1,000.");
    expect(bad({ points: "1.5" })).toBe("points must be a whole number from 0 to 1,000.");
    expect(bad({ points: "1001" })).toBe("points must be a whole number from 0 to 1,000.");
    expect(bad({ points: "1000" })).toBe("ok");
    expect(bad({ due_days: "0" })).toBe("say how many days after starting the level it is due: a whole number from 1 to 365.");
    expect(bad({ due_days: "366" })).toBe("say how many days after starting the level it is due: a whole number from 1 to 365.");
    expect(bad({ due_days: "365" })).toBe("ok");
    expect(bad({ due_kind: "on", due_date: "1 Nov" })).toBe("choose the due date.");
    expect(bad({ due_kind: "on", due_date: "2026-13-45" })).toBe("choose the due date.");
    expect(bad({ due_kind: "someday" })).toBe("choose when it is due: no due date, some days after the learner starts the level, or a date.");
    expect(bad({ parent_check: "sometimes" })).toBe("choose who checks first: never, children or always.");
    expect(bad({ reviewer: "principal" })).toBe("choose who reviews: the class teacher or the content team.");
    expect(bad({ sort_order: "first" })).toBe("the order must be a whole number.");
  });
});

describe("reading what the database sends", () => {
  const row = {
    id: ID,
    center_id: "c",
    level_id: LEVEL,
    class_id: null,
    title: "Navkar recording",
    instructions_md: "",
    allowed_kinds: ["voice", "bogus"],
    max_files: "3",
    required_for_level: true,
    points: 10,
    due_rule: { kind: "on", date: "2026-11-01" },
    parent_check: "children",
    reviewer: "teacher",
    status: "published",
    sort_order: 2,
    created_by: null,
    created_at: "2026-10-05T10:00:00Z",
    updated_at: null,
  };

  it("reads an assignment row defensively and refuses words it does not know", () => {
    const p = parseAssignment(row);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.allowed_kinds).toEqual(["voice"]);
    expect(p.value.max_files).toBe(3);
    expect(p.value.due_rule).toEqual({ kind: "on", date: "2026-11-01" });
    expect(parseAssignment({ ...row, status: "live" })).toEqual({ ok: false, error: '"live" is not draft, published or archived' });
    expect(parseAssignment({ ...row, parent_check: "maybe" }).ok).toBe(false);
    expect(parseAssignment({ ...row, reviewer: "principal" }).ok).toBe(false);
    expect(parseAssignment({ ...row, id: null }).ok).toBe(false);
    expect(parseAssignment("nonsense").ok).toBe(false);
    expect(parseAssignmentList([row, row]).ok).toBe(true);
    expect(parseAssignmentList([row, { ...row, status: "x" }]).ok).toBe(false);
    expect(parseAssignmentList({ items: [] }).ok).toBe(false);
  });

  it("reads due rules as stored, falling back to no due date", () => {
    expect(dueRuleFromJson({ kind: "none" })).toEqual({ kind: "none" });
    expect(dueRuleFromJson({ kind: "days_after_start", days: 7 })).toEqual({ kind: "days_after_start", days: 7 });
    expect(dueRuleFromJson({ kind: "days_after_start", days: "7" })).toEqual({ kind: "days_after_start", days: 7 });
    expect(dueRuleFromJson({ kind: "days_after_start", days: 0 })).toEqual({ kind: "none" });
    expect(dueRuleFromJson({ kind: "on", date: "2026-11-01" })).toEqual({ kind: "on", date: "2026-11-01" });
    expect(dueRuleFromJson({ kind: "on", date: "soon" })).toEqual({ kind: "none" });
    expect(dueRuleFromJson(null)).toEqual({ kind: "none" });
    expect(dueRuleFromJson({ kind: "whenever" })).toEqual({ kind: "none" });
  });

  const queue = {
    items: [
      {
        submission: {
          id: "s1",
          status: "submitted",
          attempt: 2,
          text_answer: "Namo Arihantanam",
          submitted_at: "2026-10-05T10:00:00Z",
          parent_note: "Checked by mom",
          review_note: null,
          decided_at: null,
          points_awarded: 0,
          late: true,
          files: [
            { id: "f2", kind: "voice", storage_path: "c/p/s1/v.m4a", mime_type: "audio/mp4", bytes: 120000, duration_seconds: 42, sort_order: 2, deleted_at: null },
            { id: "f1", kind: "photo", storage_path: null, mime_type: "image/jpeg", bytes: 2000000, duration_seconds: null, sort_order: 1, deleted_at: "2027-10-05T00:00:00Z" },
            { id: "f3", kind: "movie", storage_path: "x", sort_order: 3 },
          ],
        },
        assignment: { id: "a1", title: "Navkar recording", points: 10, class_id: null, level_name: "What is Samayik", goal_name: "Learn Samayik" },
        learner: {
          person_id: "p1",
          name: "Aarav Shah",
          is_child: true,
          household_id: "h1",
          household_card: { household_id: "h1", household_name: "Shah family", household_number: "JSH-H-2041", org_household_id: "0212", members: "Rahul, Mira, Aarav", primary_member: "Rahul Shah", zone: "Katy", city: "Houston", last_gift_on: null, open_pledge_cents: 0 },
        },
      },
    ],
  };

  it("reads the queue: files in order, unknown kinds dropped, the household card kept", () => {
    const p = parseHomeworkQueue(queue);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const [it0] = p.value;
    expect(it0.submission.files.map((f) => f.id)).toEqual(["f1", "f2"]);
    expect(it0.submission.late).toBe(true);
    expect(it0.submission.attempt).toBe(2);
    expect(it0.learner.is_child).toBe(true);
    expect(it0.learner.household_id).toBe("h1");
    expect(it0.learner.household?.kind).toBe("card");
    if (it0.learner.household?.kind !== "card") return;
    expect(it0.learner.household.card.household_number).toBe("JSH-H-2041");
    expect(it0.learner.household.card.primary_org_member_id).toBeUndefined();
    expect(it0.assignment.level_name).toBe("What is Samayik");
    expect(parseHomeworkQueue({ items: [{ submission: queue.items[0].submission, assignment: {}, learner: queue.items[0].learner }] })).toEqual({ ok: false, error: "submission s1 names no homework" });
    expect(parseHomeworkQueue({ items: [{ submission: queue.items[0].submission, assignment: queue.items[0].assignment, learner: { name: "x" } }] })).toEqual({ ok: false, error: "submission s1 names no learner" });
    expect(parseHomeworkQueue([]).ok).toBe(false);
    expect(parseHomeworkQueue({ items: [] })).toEqual({ ok: true, value: [] });
    expect(parseSubmission({ id: "s", status: "lost" }).ok).toBe(false);
    expect(parseSubmission({ id: "s", status: "accepted" })).toMatchObject({ ok: true, value: { files: [], attempt: 1, late: false, points_awarded: 0 } });
  });

  it("reads the learner's household in either shape: the full card, a brief card (two spellings), or nothing", () => {
    // app.household_card in full: people.view or giving.view holders.
    const full = parseLearnerHousehold(queue.items[0].learner.household_card);
    expect(full?.kind).toBe("card");
    if (full?.kind === "card") expect(full.card).toMatchObject({ household_id: "h1", members: "Rahul, Mira, Aarav", last_gift_on: null, open_pledge_cents: 0 });
    // Every detail null is still the full shape (the card shows "—"), as long as the keys are there.
    const blank = parseLearnerHousehold({ household_id: "h1", household_name: null, household_number: null, org_household_id: null, members: null, primary_member: null, zone: null, city: null, last_gift_on: null, open_pledge_cents: null });
    expect(blank?.kind).toBe("card");
    // The brief card a class teacher gets: household_card's own key names…
    expect(parseLearnerHousehold({ household_id: "h1", household_name: "Shah", household_number: "JSH-H-2041" })).toEqual({
      kind: "brief",
      household_id: "h1",
      household_name: "Shah",
      household_number: "JSH-H-2041",
    });
    // …or the earlier build's.
    expect(parseLearnerHousehold({ display_name: "Shah family", connect_number: "JSH-H-2041" })).toEqual({
      kind: "brief",
      household_id: null,
      household_name: "Shah family",
      household_number: "JSH-H-2041",
    });
    expect(parseLearnerHousehold({ household_id: "h1" })).toEqual({ kind: "brief", household_id: "h1", household_name: null, household_number: null });
    // Neither shape: the row warns.
    expect(parseLearnerHousehold(null)).toBeNull();
    expect(parseLearnerHousehold({})).toBeNull();
    expect(parseLearnerHousehold("h1")).toBeNull();
    expect(parseLearnerHousehold({ household_id: null, household_name: null, household_number: null })).toBeNull();
    // Through the queue parser.
    const brief = parseHomeworkQueue({ items: [{ ...queue.items[0], learner: { ...queue.items[0].learner, household_card: { household_id: "h1", household_name: "Shah", household_number: "JSH-H-2041" } } }] });
    expect(brief.ok && brief.value[0].learner.household?.kind).toBe("brief");
    const none = parseHomeworkQueue({ items: [{ ...queue.items[0], learner: { ...queue.items[0].learner, household_card: null } }] });
    expect(none.ok && none.value[0].learner.household).toBeNull();
    // The one line a brief card shows.
    expect(householdBriefText({ household_name: "Shah", household_number: "JSH-H-2041" })).toBe("Shah household · JSH-H-2041");
    expect(householdBriefText({ household_name: "Rahul & Mira Shah Household", household_number: "JSH-H-2041" })).toBe("Rahul & Mira Shah Household · JSH-H-2041");
    expect(householdBriefText({ household_name: "Shah family", household_number: null })).toBe("Shah family · no household number");
    expect(householdBriefText({ household_name: null, household_number: "JSH-H-2041" })).toBe("Unnamed household · JSH-H-2041");
  });

  it("says when the database's row limit was reached", () => {
    expect(queueLimitNote("waiting", 0)).toBeNull();
    expect(queueLimitNote("waiting", QUEUE_LIMIT - 1)).toBeNull();
    expect(queueLimitNote("waiting", QUEUE_LIMIT)).toBe("Showing the oldest 200 waiting — decide some of these to see the rest.");
    expect(queueLimitNote("decided", QUEUE_LIMIT)).toBe("Showing the newest 200 decided.");
  });

  it("filters the queue by class (the homework's class or the learner's placement) and by level name", () => {
    const p = parseHomeworkQueue(queue);
    if (!p.ok) throw new Error(p.error);
    const item: QueueItem = p.value[0];
    const placements = new Map([["p1", ["c1"]]]);
    expect(matchesQueueFilters(item, {}, placements)).toBe(true);
    expect(matchesQueueFilters(item, { classId: "c1" }, placements)).toBe(true);
    expect(matchesQueueFilters(item, { classId: "c2" }, placements)).toBe(false);
    expect(matchesQueueFilters({ ...item, assignment: { ...item.assignment, class_id: "c2" } }, { classId: "c2" }, new Map())).toBe(true);
    expect(matchesQueueFilters(item, { levelName: "What is Samayik" }, placements)).toBe(true);
    expect(matchesQueueFilters(item, { levelName: "Other" }, placements)).toBe(false);
    expect(queueLevelOptions([item, item, { ...item, assignment: { ...item.assignment, level_name: "Aarti", goal_name: null } }])).toEqual([
      { value: "Aarti", label: "Aarti" },
      { value: "What is Samayik", label: "Learn Samayik · What is Samayik" },
    ]);
  });
});

describe("words for the screens", () => {
  it("due, audience, kinds, points, attempts", () => {
    expect(dueText({ kind: "none" }, "America/Chicago")).toBe("No due date");
    expect(dueText({ kind: "days_after_start", days: 1 }, "America/Chicago")).toBe("1 day after the learner starts the level");
    expect(dueText({ kind: "days_after_start", days: 7 }, "America/Chicago")).toBe("7 days after the learner starts the level");
    expect(dueText({ kind: "on", date: "2026-11-01" }, "America/Chicago")).toBe("Due Nov 1, 2026");
    expect(audienceText(null)).toBe("Everyone doing the level");
    expect(audienceText("c1", "Sunday 10 AM · Level 2")).toBe("Only Sunday 10 AM · Level 2");
    expect(audienceText("c1")).toBe("Only one class");
    expect(allowedKindsText(["text", "photo", "voice"])).toBe("photo, voice note or written answer");
    expect(allowedKindsText(["file"])).toBe("file");
    expect(allowedKindsText([])).toBe("no way to answer");
    expect(attemptText(1)).toBe("First attempt");
    expect(attemptText(3)).toBe("Attempt 3");
  });

  it("statuses carry words, with a tone beside them", () => {
    expect(assignmentStatusLabel("draft")).toBe("Draft");
    expect(assignmentStatusLabel("published")).toBe("Published");
    expect(assignmentStatusLabel("archived")).toBe("Archived");
    expect(assignmentStatusTone("published")).toBe("success");
    expect(assignmentStatusTone("draft")).toBe("warning");
    expect(submissionStatusLabel("awaiting_parent")).toBe("Needs a parent's OK");
    expect(submissionStatusLabel("submitted")).toBe("With the teacher");
    expect(submissionStatusLabel("accepted")).toBe("Accepted");
    expect(submissionStatusLabel("needs_work")).toBe("Sent back");
    expect(submissionStatusLabel("draft")).toBe("Draft");
    expect(submissionStatusTone("accepted")).toBe("success");
    expect(submissionStatusTone("needs_work")).toBe("warning");
  });

  it("files are named by what they are, never by their storage path", () => {
    expect(fileLabel({ id: "f", kind: "voice", storage_path: "c/p/s/v.m4a", mime_type: "audio/mp4", bytes: 1000, duration_seconds: 42, sort_order: 1, deleted_at: null })).toBe("Voice note (0:42)");
    expect(fileLabel({ id: "f", kind: "voice", storage_path: "x", mime_type: null, bytes: null, duration_seconds: null, sort_order: 1, deleted_at: null })).toBe("Voice note");
    expect(fileLabel({ id: "f", kind: "file", storage_path: "x", mime_type: "application/pdf", bytes: 1258291, duration_seconds: null, sort_order: 1, deleted_at: null })).toBe("PDF file (1.2 MB)");
    expect(fileLabel({ id: "f", kind: "file", storage_path: "x", mime_type: "application/octet-stream", bytes: 640, duration_seconds: null, sort_order: 1, deleted_at: null })).toBe("File (640 B)");
    expect(fileLabel({ id: "f", kind: "photo", storage_path: "x", mime_type: "image/jpeg", bytes: null, duration_seconds: null, sort_order: 1, deleted_at: null })).toBe("Photo");
    expect(fileSizeText(2048)).toBe("2 KB");
    expect(fileSizeText(null)).toBeNull();
    expect(durationText(725)).toBe("12:05");
    expect(fileRemoved({ id: "f", kind: "photo", storage_path: null, mime_type: null, bytes: null, duration_seconds: null, sort_order: 1, deleted_at: null })).toBe(true);
    expect(fileRemoved({ id: "f", kind: "photo", storage_path: "x", mime_type: null, bytes: null, duration_seconds: null, sort_order: 1, deleted_at: "2027-01-01" })).toBe(true);
    expect(fileRemoved({ id: "f", kind: "photo", storage_path: "x", mime_type: null, bytes: null, duration_seconds: null, sort_order: 1, deleted_at: null })).toBe(false);
  });

  it("offers only the status moves the database allows, each with its warning", () => {
    expect(assignmentStatusActions("draft").map((a) => a.value)).toEqual(["published"]);
    expect(assignmentStatusActions("published").map((a) => a.value)).toEqual(["draft", "archived"]);
    expect(assignmentStatusActions("archived")).toEqual([]);
    expect(assignmentStatusActions("published")[0].confirm).toContain("only possible while nobody has handed anything in");
    expect(statusChangeDoing("published")).toBe("publish the homework");
    expect(statusChangeDoing("draft")).toBe("take the homework back to draft");
    expect(statusChangeMessage("Navkar", "published")).toBe('"Navkar" published — learners can see it now.');
    expect(statusChangeMessage("Navkar", "archived")).toBe('"Navkar" archived.');
    expect(statusChangeMessage("Navkar", "draft")).toBe('"Navkar" is a draft again.');
  });
});

describe("who may write and review homework (H2, H4)", () => {
  const classTeacher: ScopedContext = { permissions: [], isPlatformAdmin: false, grants: [{ role_key: "teacher", scope_kind: "class", scope_id: "c1" }] };
  const contentManager: ScopedContext = { permissions: ["content.manage"], isPlatformAdmin: false, grants: [] };
  const principal: ScopedContext = { permissions: ["pathshala.view", "pathshala.manage"], isPlatformAdmin: false, grants: [] };
  const centerTeacher: ScopedContext = { permissions: ["pathshala.teach"], isPlatformAdmin: false, grants: [{ role_key: "teacher", scope_kind: "center", scope_id: null }] };
  const contentViewer: ScopedContext = { permissions: ["content.view"], isPlatformAdmin: false, grants: [] };

  it("a class teacher writes homework for their own class only, and reviews", () => {
    expect(homeworkAreas.editAny(classTeacher)).toBe(true);
    expect(homeworkAreas.editAll(classTeacher)).toBe(false);
    expect(homeworkAreas.editFor(classTeacher, "c1")).toBe(true);
    expect(homeworkAreas.editFor(classTeacher, "c2")).toBe(false);
    expect(homeworkAreas.editFor(classTeacher, null)).toBe(false);
    expect(homeworkAreas.review(classTeacher)).toBe(true);
    expect(pathshalaAreas.homework(classTeacher)).toBe(true);
  });

  it("content managers and the principal write for everyone; a center-wide teacher for any class but not for everyone", () => {
    for (const c of [contentManager, principal]) {
      expect(homeworkAreas.editAll(c)).toBe(true);
      expect(homeworkAreas.editFor(c, null)).toBe(true);
      expect(homeworkAreas.editFor(c, "c9")).toBe(true);
      expect(homeworkAreas.review(c)).toBe(true);
    }
    expect(homeworkAreas.editAll(centerTeacher)).toBe(false);
    expect(homeworkAreas.editFor(centerTeacher, "c9")).toBe(true);
    expect(homeworkAreas.editFor(centerTeacher, null)).toBe(false);
    expect(homeworkAreas.review(centerTeacher)).toBe(true);
  });

  it("offers Edit and the status moves only where a save could succeed (app.gyan_homework_editor)", () => {
    const everyone = { class_id: null };
    const mine = { class_id: "c1" };
    const theirs = { class_id: "c2" };
    // content.manage / pathshala.manage: any homework.
    for (const a of [everyone, mine, theirs]) expect(mayEditAssignment(a, true, [])).toBe(true);
    // A class Teacher: their own classes' homework only; never everyone's.
    expect(mayEditAssignment(mine, false, ["c1"])).toBe(true);
    expect(mayEditAssignment(theirs, false, ["c1"])).toBe(false);
    expect(mayEditAssignment(everyone, false, ["c1"])).toBe(false);
    expect(mayEditAssignment(mine, false, [])).toBe(false);
    // A center-wide Teacher: any class's homework, still not everyone's.
    expect(mayEditAssignment(theirs, false, "any")).toBe(true);
    expect(mayEditAssignment(everyone, false, "any")).toBe(false);
    expect(readOnlyReason(everyone)).toBe("Set by the Pathshala office for everyone doing the level");
    expect(readOnlyReason(theirs)).toBe("Set for another class");
  });

  it("a content viewer sees lessons but writes and reviews nothing", () => {
    expect(homeworkAreas.editAny(contentViewer)).toBe(false);
    expect(homeworkAreas.review(contentViewer)).toBe(false);
    expect(pathshalaAreas.homework(contentViewer)).toBe(false);
  });

  it("Pathshala › Homework is a Gyan Path tab next to the sign-offs; a class teacher reaches Content › Gyan Path", () => {
    expect(moduleForPath("/pathshala/homework")).toBe("gyan_path");
    const nav = visibleNav(classTeacher);
    expect(nav.find((m) => m.key === "pathshala")?.tabs.map((t) => t.href)).toContain("/pathshala/homework");
    expect(nav.find((m) => m.key === "content")?.tabs.map((t) => t.href)).toEqual(["/content/gyan-path"]);
    expect(visibleNav({ ...classTeacher, modulesOff: ["gyan_path"] }).some((m) => m.key === "content")).toBe(false);
    expect(visibleNav(contentViewer).find((m) => m.key === "pathshala")).toBeUndefined();
    expect(visibleNav(contentManager).find((m) => m.key === "pathshala")?.tabs.map((t) => t.label)).toEqual(["Homework"]);
  });
});

// Learning assignments ("homework" to members and staff) with parent validation — docs/LEARNING_ASSIGNMENTS_PLAN.md,
// migration 0587. Pure: no server imports, so the Content › Gyan Path editor, the Pathshala › Homework queue and the
// tests share it. The database decides everything (app.save_gyan_assignment, app.set_gyan_assignment_status,
// app.gyan_homework_queue, app.review_gyan_submission); this file mirrors its vocabulary and its checks so a form can
// explain before it asks, and reads what the functions send back defensively.

import type { HouseholdCardData } from "@/components/household-card";
import { formatDate } from "@/lib/dates";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Vocabulary (the table's check constraints)
// ---------------------------------------------------------------------------
export const HOMEWORK_KINDS = ["photo", "file", "voice", "text"] as const;
export type HomeworkKind = (typeof HOMEWORK_KINDS)[number];

// TODO(plan PR 4): drop the "next APK release" hints once connect-mobile ships the camera and the file picker.
export const KIND_OPTIONS: readonly { value: HomeworkKind; label: string; hint: string }[] = [
  { value: "photo", label: "Photo", hint: "A picture chosen on the phone (the camera arrives with the next APK release)." },
  { value: "file", label: "File", hint: "PDF, Word, Excel, PowerPoint or plain text — needs the next APK release of the member app." },
  { value: "voice", label: "Voice note", hint: "Recorded in the app, like a recite step." },
  { value: "text", label: "Written answer", hint: "Up to 2,000 characters typed in the app." },
];

export const PARENT_CHECKS = ["never", "children", "always"] as const;
export type ParentCheck = (typeof PARENT_CHECKS)[number];

export const PARENT_CHECK_OPTIONS: readonly { value: ParentCheck; label: string; hint: string }[] = [
  { value: "never", label: "Never", hint: "Goes straight to the reviewer, whoever hands it in." },
  { value: "children", label: "Children", hint: "A learner under 18 handing in from their own login waits for a household adult's OK first. A parent handing in for a child skips this step." },
  { value: "always", label: "Always", hint: "Every hand-in waits for a household adult's OK first, adults included." },
];

export const REVIEWERS = ["teacher", "content"] as const;
export type Reviewer = (typeof REVIEWERS)[number];

export const REVIEWER_OPTIONS: readonly { value: Reviewer; label: string; hint: string }[] = [
  { value: "teacher", label: "The class teacher", hint: "The Teacher of the learner's class; otherwise anyone with pathshala.teach or pathshala.manage." },
  { value: "content", label: "The content team", hint: "People with content.manage, for lessons outside Pathshala. The Pathshala principal can always review." },
];

export const ASSIGNMENT_STATUSES = ["draft", "published", "archived"] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const SUBMISSION_STATUSES = ["draft", "awaiting_parent", "submitted", "accepted", "needs_work"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const DUE_KINDS = ["none", "days_after_start", "on"] as const;
export type DueKind = (typeof DUE_KINDS)[number];

/** The table's limits (gyan_assignments checks, app.save_gyan_assignment's sentences). */
export const TITLE_MAX = 120;
export const INSTRUCTIONS_MAX = 4000;
export const MAX_FILES_MIN = 1;
export const MAX_FILES_MAX = 10;
export const DEFAULT_MAX_FILES = 3;
export const DEFAULT_POINTS = 10;
export const POINTS_MAX = 1000;
/** A "days after the learner starts the level" due rule (app.gyan_due_rule_problem). */
export const DUE_DAYS_MIN = 1;
export const DUE_DAYS_MAX = 365;
/** The reminder (0588, gyan_assignments.remind_hours_before): hours before the end of the due day; empty = no reminder. */
export const REMIND_HOURS_MIN = 1;
export const REMIND_HOURS_MAX = 720;
/** app.save_gyan_assignment's sentences for the reminder (0588), with the form's lower-case start. */
export const REMIND_RANGE_ERROR = `the reminder must be a whole number of hours from ${REMIND_HOURS_MIN} to ${REMIND_HOURS_MAX} (30 days) before the homework is due, or empty for no reminder.`;
export const REMIND_NEEDS_DUE_ERROR = "a reminder needs a due date: choose when the homework is due, or leave the reminder empty.";
/** The review note's limit (gyan_submissions.review_note). */
export const REVIEW_NOTE_MAX = 1000;
/** app.gyan_homework_queue answers with at most this many rows (the oldest waiting, the newest decided). */
export const QUEUE_LIMIT = 200;

export function isHomeworkKind(v: unknown): v is HomeworkKind {
  return typeof v === "string" && (HOMEWORK_KINDS as readonly string[]).includes(v);
}
export function isParentCheck(v: unknown): v is ParentCheck {
  return typeof v === "string" && (PARENT_CHECKS as readonly string[]).includes(v);
}
export function isReviewer(v: unknown): v is Reviewer {
  return typeof v === "string" && (REVIEWERS as readonly string[]).includes(v);
}
export function isAssignmentStatus(v: unknown): v is AssignmentStatus {
  return typeof v === "string" && (ASSIGNMENT_STATUSES as readonly string[]).includes(v);
}
export function isSubmissionStatus(v: unknown): v is SubmissionStatus {
  return typeof v === "string" && (SUBMISSION_STATUSES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Shapes (what the functions send and take)
// ---------------------------------------------------------------------------
export type DueRule = { kind: "none" } | { kind: "days_after_start"; days: number } | { kind: "on"; date: string };

export type Assignment = {
  id: string;
  center_id: string;
  level_id: string;
  /** Homework for one class's students only; null = everyone doing the level. */
  class_id: string | null;
  title: string;
  instructions_md: string;
  allowed_kinds: HomeworkKind[];
  max_files: number;
  required_for_level: boolean;
  points: number;
  due_rule: DueRule;
  /** Remind the learners who have not handed in this many hours before the end of the due day (0588); null = no reminder. */
  remind_hours_before: number | null;
  /** When those hours were last set (a reminder whose time had already passed then is never sent). */
  remind_set_at: string | null;
  parent_check: ParentCheck;
  reviewer: Reviewer;
  status: AssignmentStatus;
  sort_order: number;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** What app.save_gyan_assignment(p_center, p_assignment) takes: the editable keys; no id = insert. Status moves through app.set_gyan_assignment_status. */
export type AssignmentInput = {
  id?: string;
  level_id: string;
  class_id: string | null;
  title: string;
  instructions_md: string;
  allowed_kinds: HomeworkKind[];
  max_files: number;
  required_for_level: boolean;
  points: number;
  due_rule: DueRule;
  /** null = no reminder; only with a due date. */
  remind_hours_before: number | null;
  parent_check: ParentCheck;
  reviewer: Reviewer;
  sort_order: number;
};

export type SubmissionFile = {
  id: string;
  kind: "photo" | "file" | "voice";
  /** Null once the retention job removed the file (the row, note and points stay). */
  storage_path: string | null;
  mime_type: string | null;
  bytes: number | null;
  duration_seconds: number | null;
  sort_order: number;
  deleted_at: string | null;
};

export type Submission = {
  id: string;
  status: SubmissionStatus;
  attempt: number;
  text_answer: string | null;
  submitted_at: string | null;
  parent_note: string | null;
  review_note: string | null;
  decided_at: string | null;
  points_awarded: number;
  late: boolean;
  files: SubmissionFile[];
};

export type QueueAssignment = {
  id: string;
  title: string;
  points: number;
  class_id: string | null;
  level_name: string | null;
  goal_name: string | null;
};

/**
 * The learner's household as the queue could send it: app.household_card in full (the caller holds people.view or
 * giving.view), or a brief card — household id, name and number — for a class teacher, who has no people
 * permission. Either way the queue never shows a learner by name alone.
 */
export type LearnerHousehold =
  | { kind: "card"; card: HouseholdCardData }
  | { kind: "brief"; household_id: string | null; household_name: string | null; household_number: string | null };

export type QueueLearner = {
  person_id: string;
  name: string;
  is_child: boolean;
  household_id: string | null;
  /** Null when the database sent neither shape: the row then says so. */
  household: LearnerHousehold | null;
};

export type QueueItem = { submission: Submission; assignment: QueueAssignment; learner: QueueLearner };

export type QueueView = "waiting" | "decided";
export type ReviewDecision = "accept" | "send_back";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Reading what the database sends (every field defensively)
// ---------------------------------------------------------------------------
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const bool = (v: unknown): boolean => v === true;

/** The due rule as stored (jsonb); anything unreadable counts as "no due date". */
export function dueRuleFromJson(v: unknown): DueRule {
  if (!isObj(v)) return { kind: "none" };
  if (v.kind === "days_after_start") {
    const days = num(v.days);
    return days !== null && days >= 1 ? { kind: "days_after_start", days: Math.floor(days) } : { kind: "none" };
  }
  if (v.kind === "on") {
    const date = str(v.date);
    return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { kind: "on", date } : { kind: "none" };
  }
  return { kind: "none" };
}

/** The reminder's hours as stored: a whole number from 1 to 720, else none (null). */
export function remindHoursFromJson(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n >= REMIND_HOURS_MIN && n <= REMIND_HOURS_MAX ? n : null;
}

export function parseAssignment(data: unknown): Parsed<Assignment> {
  if (!isObj(data)) return { ok: false, error: "the homework is not an object" };
  const id = str(data.id);
  const centerId = str(data.center_id);
  const levelId = str(data.level_id);
  const title = str(data.title);
  if (!id || !levelId || title === null) return { ok: false, error: "the homework has no id, level or title" };
  if (!isAssignmentStatus(data.status)) return { ok: false, error: `"${String(data.status)}" is not draft, published or archived` };
  if (!isParentCheck(data.parent_check)) return { ok: false, error: `"${String(data.parent_check)}" is not a parent check (never, children or always)` };
  if (!isReviewer(data.reviewer)) return { ok: false, error: `"${String(data.reviewer)}" is not a reviewer (teacher or content)` };
  const kinds = Array.isArray(data.allowed_kinds) ? data.allowed_kinds.filter(isHomeworkKind) : [];
  return {
    ok: true,
    value: {
      id,
      center_id: centerId ?? "",
      level_id: levelId,
      class_id: str(data.class_id),
      title,
      instructions_md: str(data.instructions_md) ?? "",
      allowed_kinds: kinds,
      max_files: num(data.max_files) ?? DEFAULT_MAX_FILES,
      required_for_level: bool(data.required_for_level),
      points: num(data.points) ?? 0,
      due_rule: dueRuleFromJson(data.due_rule),
      remind_hours_before: remindHoursFromJson(data.remind_hours_before),
      remind_set_at: str(data.remind_set_at),
      parent_check: data.parent_check,
      reviewer: data.reviewer,
      status: data.status,
      sort_order: num(data.sort_order) ?? 0,
      created_by: str(data.created_by),
      created_at: str(data.created_at),
      updated_at: str(data.updated_at),
    },
  };
}

export function parseAssignmentList(data: unknown): Parsed<Assignment[]> {
  if (!Array.isArray(data)) return { ok: false, error: "the homework list is not a list" };
  const out: Assignment[] = [];
  for (const row of data) {
    const p = parseAssignment(row);
    if (!p.ok) return p;
    out.push(p.value);
  }
  return { ok: true, value: out };
}

function parseFile(v: unknown): SubmissionFile | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const kind = v.kind;
  if (!id || (kind !== "photo" && kind !== "file" && kind !== "voice")) return null;
  return {
    id,
    kind,
    storage_path: str(v.storage_path),
    mime_type: str(v.mime_type),
    bytes: num(v.bytes),
    duration_seconds: num(v.duration_seconds),
    sort_order: num(v.sort_order) ?? 0,
    deleted_at: str(v.deleted_at),
  };
}

export function parseSubmission(data: unknown): Parsed<Submission> {
  if (!isObj(data)) return { ok: false, error: "the submission is not an object" };
  const id = str(data.id);
  if (!id) return { ok: false, error: "the submission has no id" };
  if (!isSubmissionStatus(data.status)) return { ok: false, error: `"${String(data.status)}" is not a submission status` };
  const files = Array.isArray(data.files) ? data.files.map(parseFile).filter((f): f is SubmissionFile => f !== null) : [];
  return {
    ok: true,
    value: {
      id,
      status: data.status,
      attempt: num(data.attempt) ?? 1,
      text_answer: str(data.text_answer),
      submitted_at: str(data.submitted_at),
      parent_note: str(data.parent_note),
      review_note: str(data.review_note),
      decided_at: str(data.decided_at),
      points_awarded: num(data.points_awarded) ?? 0,
      late: bool(data.late),
      files: files.sort((a, b) => a.sort_order - b.sort_order),
    },
  };
}

/** The keys that make app.household_card a disambiguation card; a brief card carries none of them. */
const CARD_DETAIL_KEYS = ["members", "primary_member", "org_household_id", "zone", "city"] as const;

/**
 * The household the queue embeds for a learner, in either shape: the full app.household_card (household_id and the
 * detail keys) → a card; household_id / household_name / household_number alone — or, from an earlier build of the
 * queue, display_name / connect_number — → a brief card. Null when neither shape is there (the row then says so).
 */
export function parseLearnerHousehold(v: unknown): LearnerHousehold | null {
  if (!isObj(v)) return null;
  const householdId = str(v.household_id);
  if (householdId && CARD_DETAIL_KEYS.some((k) => k in v)) {
    return {
      kind: "card",
      card: {
        household_id: householdId,
        household_name: str(v.household_name),
        household_number: str(v.household_number),
        org_household_id: str(v.org_household_id),
        members: str(v.members),
        primary_member: str(v.primary_member),
        primary_org_member_id: "primary_org_member_id" in v ? str(v.primary_org_member_id) : undefined,
        zone: str(v.zone),
        city: str(v.city),
        last_gift_on: str(v.last_gift_on),
        open_pledge_cents: num(v.open_pledge_cents),
      },
    };
  }
  const name = str(v.household_name) ?? str(v.display_name);
  const number = str(v.household_number) ?? str(v.connect_number);
  if (!householdId && name === null && number === null) return null;
  return { kind: "brief", household_id: householdId, household_name: name, household_number: number };
}

/** "Shah household · JSH-H-2041" — the one line a brief card can show (a name that already says "household" is kept as is). */
export function householdBriefText(brief: { household_name: string | null; household_number: string | null }): string {
  const raw = brief.household_name?.trim() ?? "";
  const name = !raw ? "Unnamed household" : /\b(household|family)$/i.test(raw) ? raw : `${raw} household`;
  return `${name} · ${brief.household_number ?? "no household number"}`;
}

export function parseHomeworkQueue(data: unknown): Parsed<QueueItem[]> {
  if (!isObj(data) || !Array.isArray(data.items)) return { ok: false, error: "the queue has no items list" };
  const out: QueueItem[] = [];
  for (const raw of data.items) {
    if (!isObj(raw)) return { ok: false, error: "a queue item is not an object" };
    const submission = parseSubmission(raw.submission);
    if (!submission.ok) return submission;
    const a = raw.assignment;
    const l = raw.learner;
    const assignmentId = isObj(a) ? str(a.id) : null;
    const personId = isObj(l) ? str(l.person_id) : null;
    if (!isObj(a) || !assignmentId) return { ok: false, error: `submission ${submission.value.id} names no homework` };
    if (!isObj(l) || !personId) return { ok: false, error: `submission ${submission.value.id} names no learner` };
    out.push({
      submission: submission.value,
      assignment: {
        id: assignmentId,
        title: str(a.title) ?? "Homework",
        points: num(a.points) ?? 0,
        class_id: str(a.class_id),
        level_name: str(a.level_name),
        goal_name: str(a.goal_name),
      },
      learner: {
        person_id: personId,
        name: str(l.name) ?? "Learner",
        is_child: bool(l.is_child),
        household_id: str(l.household_id),
        household: parseLearnerHousehold(l.household_card),
      },
    });
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// The editor form → what the database takes, checked in the database's words first
// ---------------------------------------------------------------------------
export type AssignmentFormInput = {
  id?: string;
  level_id: string;
  /** "" = everyone doing the level. */
  class_id: string;
  title: string;
  instructions_md: string;
  allowed_kinds: string[];
  max_files: string;
  points: string;
  required_for_level: boolean;
  due_kind: string;
  due_days: string;
  due_date: string;
  /** "Remind (hours before it is due)": "" (or absent: the field is shown only with a due date) = no reminder. */
  remind_hours?: string;
  parent_check: string;
  reviewer: string;
  sort_order?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WHOLE = /^-?\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Characters as the database counts them (char_length: an emoji is one). */
function chars(s: string): number {
  return [...s].length;
}

/**
 * Check the editor form the way app.save_gyan_assignment does, and say what is wrong in the same words, so the
 * person never waits for a round trip to learn that the title is too long. The database still checks everything.
 */
export function assignmentFromForm(input: AssignmentFormInput): Parsed<AssignmentInput> {
  const id = (input.id ?? "").trim();
  if (id && !UUID.test(id)) return { ok: false, error: "the homework could not be identified. Reload the page and try again." };
  if (!UUID.test(input.level_id)) return { ok: false, error: "choose the level first." };
  const classId = input.class_id.trim();
  if (classId && !UUID.test(classId)) return { ok: false, error: "choose the class, or leave the homework open to everyone doing the level." };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "give the homework a title." };
  if (chars(title) > TITLE_MAX) return { ok: false, error: `the title can be at most ${TITLE_MAX} characters (it has ${chars(title)}).` };
  const instructions = input.instructions_md.trim();
  if (chars(instructions) > INSTRUCTIONS_MAX) {
    return { ok: false, error: `the instructions can be at most ${INSTRUCTIONS_MAX.toLocaleString("en-US")} characters (they have ${chars(instructions).toLocaleString("en-US")}).` };
  }
  const kinds = [...new Set(input.allowed_kinds)];
  const bad = kinds.find((k) => !isHomeworkKind(k));
  if (bad !== undefined) return { ok: false, error: `"${bad}" is not a way to answer homework (photo, file, voice note or written answer).` };
  if (!kinds.length) return { ok: false, error: "choose at least one way to answer: photo, file, voice note or written answer." };
  const maxFiles = input.max_files.trim();
  if (!WHOLE.test(maxFiles) || Number(maxFiles) < MAX_FILES_MIN || Number(maxFiles) > MAX_FILES_MAX) {
    return { ok: false, error: `the number of files allowed must be a whole number from ${MAX_FILES_MIN} to ${MAX_FILES_MAX}.` };
  }
  const points = input.points.trim() || "0";
  if (!WHOLE.test(points) || Number(points) < 0 || Number(points) > POINTS_MAX) {
    return { ok: false, error: `points must be a whole number from 0 to ${POINTS_MAX.toLocaleString("en-US")}.` };
  }
  let due: DueRule;
  if (input.due_kind === "none" || input.due_kind === "") due = { kind: "none" };
  else if (input.due_kind === "days_after_start") {
    const days = input.due_days.trim();
    if (!WHOLE.test(days) || Number(days) < DUE_DAYS_MIN || Number(days) > DUE_DAYS_MAX) {
      return { ok: false, error: `say how many days after starting the level it is due: a whole number from ${DUE_DAYS_MIN} to ${DUE_DAYS_MAX}.` };
    }
    due = { kind: "days_after_start", days: Number(days) };
  } else if (input.due_kind === "on") {
    const date = input.due_date.trim();
    if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { ok: false, error: "choose the due date." };
    due = { kind: "on", date };
  } else return { ok: false, error: "choose when it is due: no due date, some days after the learner starts the level, or a date." };
  // The reminder (0588), checked in the database's order: the hours first, then that there is a due date.
  const remindRaw = (input.remind_hours ?? "").trim();
  let remind: number | null = null;
  if (remindRaw) {
    if (!WHOLE.test(remindRaw) || Number(remindRaw) < REMIND_HOURS_MIN || Number(remindRaw) > REMIND_HOURS_MAX) return { ok: false, error: REMIND_RANGE_ERROR };
    if (due.kind === "none") return { ok: false, error: REMIND_NEEDS_DUE_ERROR };
    remind = Number(remindRaw);
  }
  if (!isParentCheck(input.parent_check)) return { ok: false, error: "choose who checks first: never, children or always." };
  if (!isReviewer(input.reviewer)) return { ok: false, error: "choose who reviews: the class teacher or the content team." };
  const order = (input.sort_order ?? "").trim();
  if (order && !WHOLE.test(order)) return { ok: false, error: "the order must be a whole number." };
  return {
    ok: true,
    value: {
      ...(id ? { id } : {}),
      level_id: input.level_id,
      class_id: classId || null,
      title,
      instructions_md: instructions,
      allowed_kinds: kinds as HomeworkKind[],
      max_files: Number(maxFiles),
      required_for_level: input.required_for_level,
      points: Number(points),
      due_rule: due,
      remind_hours_before: remind,
      parent_check: input.parent_check,
      reviewer: input.reviewer,
      sort_order: order ? Number(order) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Words for the screens
// ---------------------------------------------------------------------------
export function assignmentStatusLabel(status: AssignmentStatus): string {
  return status === "published" ? "Published" : status === "archived" ? "Archived" : "Draft";
}

/** Badge tone (src/components/ui Badge): words always go with it, never colour alone. */
export function assignmentStatusTone(status: AssignmentStatus): "success" | "warning" | "neutral" {
  return status === "published" ? "success" : status === "archived" ? "neutral" : "warning";
}

/** The member app's words (plan §2.1): Hand in, Needs a parent's OK, With the teacher, Accepted, Sent back. */
export function submissionStatusLabel(status: SubmissionStatus): string {
  switch (status) {
    case "awaiting_parent":
      return "Needs a parent's OK";
    case "submitted":
      return "With the teacher";
    case "accepted":
      return "Accepted";
    case "needs_work":
      return "Sent back";
    default:
      return "Draft";
  }
}

export function submissionStatusTone(status: SubmissionStatus): "neutral" | "navy" | "success" | "warning" | "purple" {
  switch (status) {
    case "awaiting_parent":
      return "purple";
    case "submitted":
      return "navy";
    case "accepted":
      return "success";
    case "needs_work":
      return "warning";
    default:
      return "neutral";
  }
}

export function parentCheckLabel(v: ParentCheck): string {
  return PARENT_CHECK_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

export function reviewerLabel(v: Reviewer): string {
  return REVIEWER_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

/** "Photo, voice note or written answer" in the catalog's order. */
export function allowedKindsText(kinds: readonly HomeworkKind[]): string {
  const labels = KIND_OPTIONS.filter((o) => kinds.includes(o.value)).map((o) => o.label.toLowerCase());
  if (!labels.length) return "no way to answer";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

/** "No due date" · "7 days after the learner starts the level" · "Due Nov 1, 2026". */
export function dueText(rule: DueRule, timeZone: string): string {
  if (rule.kind === "days_after_start") return `${rule.days} day${rule.days === 1 ? "" : "s"} after the learner starts the level`;
  if (rule.kind === "on") return `Due ${formatDate(rule.date, timeZone)}`;
  return "No due date";
}

/**
 * "Reminder 48 h before" (0588): the learners who have not handed in are reminded that many hours before the end of
 * the due day. Null when there is no reminder (or no due date, which a reminder needs).
 */
export function reminderText(hours: number | null, rule?: DueRule): string | null {
  if (hours === null || rule?.kind === "none") return null;
  return `Reminder ${hours} h before`;
}

/** Who the homework is for. */
export function audienceText(classId: string | null, className?: string | null): string {
  if (!classId) return "Everyone doing the level";
  return className ? `Only ${className}` : "Only one class";
}

export function pointsText(points: number): string {
  return `${points} point${points === 1 ? "" : "s"}`;
}

export function attemptText(attempt: number): string {
  return attempt <= 1 ? "First attempt" : `Attempt ${attempt}`;
}

/** "1.2 MB" / "640 KB". */
export function fileSizeText(bytes: number | null): string | null {
  if (bytes === null || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "0:42" / "12:05". */
export function durationText(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const MIME_WORD: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
  "text/plain": "Text",
};

/** "Photo", "Voice note (0:42)", "PDF file (1.2 MB)" — never the storage path (it carries ids). */
export function fileLabel(file: SubmissionFile): string {
  if (file.kind === "photo") return "Photo";
  if (file.kind === "voice") {
    const d = durationText(file.duration_seconds);
    return d ? `Voice note (${d})` : "Voice note";
  }
  const word = file.mime_type ? MIME_WORD[file.mime_type] : undefined;
  const size = fileSizeText(file.bytes);
  return `${word ? `${word} file` : "File"}${size ? ` (${size})` : ""}`;
}

/** A file the retention job removed (plan H9, owner decision 2026-10-06: 180 days after upload; the row, note and points stay). */
export function fileRemoved(file: SubmissionFile): boolean {
  return file.deleted_at !== null || file.storage_path === null;
}

// ---------------------------------------------------------------------------
// Status moves the editor offers (draft → published → archived; published → draft only while no submission exists:
// the database refuses the rest in plain English)
// ---------------------------------------------------------------------------
export type StatusAction = { label: string; value: AssignmentStatus; variant: "ok" | "ghost" | "bad"; confirm?: string };

export function assignmentStatusActions(status: AssignmentStatus): StatusAction[] {
  if (status === "draft") {
    return [{ label: "Publish", value: "published", variant: "ok", confirm: "Publish this homework? Learners it applies to (and the parents of children) are told right away." }];
  }
  if (status === "published") {
    return [
      { label: "Unpublish", value: "draft", variant: "ghost", confirm: "Take this homework back to draft? That is only possible while nobody has handed anything in." },
      { label: "Archive", value: "archived", variant: "bad", confirm: "Archive this homework? It leaves the learners' lists; what was handed in stays on record." },
    ];
  }
  return [];
}

export function statusChangeDoing(status: AssignmentStatus): string {
  return status === "published" ? "publish the homework" : status === "archived" ? "archive the homework" : "take the homework back to draft";
}

export function statusChangeMessage(title: string, status: AssignmentStatus): string {
  if (status === "published") return `"${title}" published — learners can see it now.`;
  if (status === "archived") return `"${title}" archived.`;
  return `"${title}" is a draft again.`;
}

// ---------------------------------------------------------------------------
// Which homework this person may change (app.gyan_homework_editor, mirrored by homeworkAreas.editFor): RLS shows a
// class teacher every published homework, so the screen offers Edit and the status moves only where a save could
// succeed and marks the rest read-only. The database decides again on every write.
// ---------------------------------------------------------------------------
/** The classes whose homework the person may change: every class ("any": a center-wide Teacher), or the ids of their own. */
export type EditableClasses = "any" | readonly string[];

export function mayEditAssignment(a: Pick<Assignment, "class_id">, canChooseEveryone: boolean, ownClasses: EditableClasses): boolean {
  if (canChooseEveryone) return true;
  if (a.class_id === null) return false;
  return ownClasses === "any" || ownClasses.includes(a.class_id);
}

/** Why a row is read-only, for the person who cannot change it. */
export function readOnlyReason(a: Pick<Assignment, "class_id">): string {
  return a.class_id === null ? "Set by the Pathshala office for everyone doing the level" : "Set for another class";
}

// ---------------------------------------------------------------------------
// Queue filters (class and level), pure so the page and the tests agree
// ---------------------------------------------------------------------------
export type QueueFilters = { classId?: string | null; levelName?: string | null };

/**
 * A row matches a class when the homework is for that class, or the learner is placed in it (`learnerClasses`:
 * person id → class ids, from pathshala_enrollments); a level by the level's name (the queue carries no level id).
 */
export function matchesQueueFilters(item: QueueItem, filters: QueueFilters, learnerClasses: ReadonlyMap<string, readonly string[]>): boolean {
  if (filters.classId) {
    const inClass = item.assignment.class_id === filters.classId || (learnerClasses.get(item.learner.person_id) ?? []).includes(filters.classId);
    if (!inClass) return false;
  }
  if (filters.levelName && item.assignment.level_name !== filters.levelName) return false;
  return true;
}

/** When the database's limit was reached: which rows are on screen, and how to see the rest. Null below the limit. */
export function queueLimitNote(view: QueueView, count: number): string | null {
  if (count < QUEUE_LIMIT) return null;
  return view === "waiting"
    ? `Showing the oldest ${QUEUE_LIMIT} waiting — decide some of these to see the rest.`
    : `Showing the newest ${QUEUE_LIMIT} decided.`;
}

/** Distinct "Goal · Level" choices present in the queue, for the level filter. */
export function queueLevelOptions(items: readonly QueueItem[]): { value: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const it of items) {
    const name = it.assignment.level_name;
    if (!name || seen.has(name)) continue;
    seen.set(name, it.assignment.goal_name ? `${it.assignment.goal_name} · ${name}` : name);
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// Calls to the homework objects of migration 0587 (app.gyan_assignments, app.save_gyan_assignment,
// app.set_gyan_assignment_status, app.gyan_homework_queue, app.review_gyan_submission, bucket "homework"). The
// generated types (src/lib/database.types.ts) are regenerated from the database by CI and do not know them until
// that has run, so every call goes through ONE narrow cast here, the same way src/lib/access-db.ts does for the
// access-level RPCs. Nothing else in the portal names these objects. Delete the cast, and use db.from / db.rpc
// directly, once the generated types carry them.
//
// Every call is defensive: a database that has not had 0587 applied yet answers "does not exist" (PGRST202 /
// 42883 / 42P01 / PGRST205), and the caller then says so in plain English instead of showing an empty page.

import {
  parseAssignment,
  parseAssignmentList,
  parseHomeworkQueue,
  parseSubmission,
  type Assignment,
  type AssignmentInput,
  type AssignmentStatus,
  type QueueItem,
  type QueueView,
  type ReviewDecision,
  type Submission,
} from "@/lib/gyan-homework/homework";
import { isMissingObject, warnMissingOnce } from "@/lib/modules-db";
import type { AppSupabase } from "@/lib/supabase/server";

type RpcError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };
type Rows = PromiseLike<RpcResult> & {
  eq: (column: string, value: string) => Rows;
  in: (column: string, values: readonly string[]) => Rows;
  order: (column: string, opts?: { ascending?: boolean }) => Rows;
};
type HomeworkClient = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  from: (table: string) => { select: (columns: string) => Rows };
};

/** The same client, able to read gyan_assignments and call the homework RPCs by name (the client itself is unchanged). */
function homeworkDb(db: object): HomeworkClient {
  return db as unknown as HomeworkClient;
}

export const HOMEWORK_BUCKET = "homework";

const ASSIGNMENT_COLUMNS =
  "id, center_id, level_id, class_id, title, instructions_md, allowed_kinds, max_files, required_for_level, points, due_rule, parent_check, reviewer, status, sort_order, created_by, created_at, updated_at";

export type Loaded<T> =
  | { status: "ok"; value: T }
  /** The database does not have migration 0587 yet. */
  | { status: "missing" }
  /** The call failed (permission, network, …): the error is for the page's plain-English message. */
  | { status: "error"; error: unknown }
  /** The call worked but sent something this page cannot read. */
  | { status: "shape"; message: string };

export type Written<T> = { ok: true; value: T } | { ok: false; error: unknown };

function shapeError(what: string, problem: string): { message: string } {
  return { message: `${what} answered with something this screen cannot read (${problem}). Has the latest migration been applied?` };
}

/** The community's homework on these levels (RLS: editors see every row, everyone else published rows only), in order. */
export async function loadAssignments(db: object, centerId: string, levelIds: readonly string[]): Promise<Loaded<Assignment[]>> {
  if (!levelIds.length) return { status: "ok", value: [] };
  try {
    const { data, error } = await homeworkDb(db).from("gyan_assignments").select(ASSIGNMENT_COLUMNS).eq("center_id", centerId).in("level_id", levelIds).order("sort_order").order("title");
    if (error) {
      if (isMissingObject(error)) {
        warnMissingOnce("app.gyan_assignments", error);
        return { status: "missing" };
      }
      console.error("[gyan-homework] could not read gyan_assignments:", error);
      return { status: "error", error };
    }
    const parsed = parseAssignmentList(data);
    if (!parsed.ok) {
      console.error("[gyan-homework] gyan_assignments sent an unexpected shape:", data);
      return { status: "shape", message: parsed.error };
    }
    return { status: "ok", value: parsed.value };
  } catch (e) {
    console.error("[gyan-homework] reading gyan_assignments threw:", e);
    return { status: "error", error: e };
  }
}

/** app.save_gyan_assignment(center, assignment): insert (no id) or update; the database checks who may and every field. */
export async function saveAssignment(db: object, centerId: string, input: AssignmentInput): Promise<Written<Assignment>> {
  const { data, error } = await homeworkDb(db).rpc("save_gyan_assignment", { p_center: centerId, p_assignment: input });
  if (error) return { ok: false, error };
  const parsed = parseAssignment(data);
  if (!parsed.ok) {
    console.error("[gyan-homework] app.save_gyan_assignment sent an unexpected shape:", data);
    return { ok: false, error: shapeError("app.save_gyan_assignment", parsed.error) };
  }
  return { ok: true, value: parsed.value };
}

/** app.set_gyan_assignment_status: draft → published → archived; published → draft only while nobody has handed anything in. */
export async function setAssignmentStatus(db: object, assignmentId: string, status: AssignmentStatus): Promise<Written<Assignment>> {
  const { data, error } = await homeworkDb(db).rpc("set_gyan_assignment_status", { p_assignment: assignmentId, p_status: status });
  if (error) return { ok: false, error };
  const parsed = parseAssignment(data);
  if (!parsed.ok) {
    console.error("[gyan-homework] app.set_gyan_assignment_status sent an unexpected shape:", data);
    return { ok: false, error: shapeError("app.set_gyan_assignment_status", parsed.error) };
  }
  return { ok: true, value: parsed.value };
}

/** app.gyan_homework_queue(center, view): the reviewer's rows (with the teacher / decided), each with the learner's household card. */
export async function loadHomeworkQueue(db: object, centerId: string, view: QueueView): Promise<Loaded<QueueItem[]>> {
  try {
    const { data, error } = await homeworkDb(db).rpc("gyan_homework_queue", { p_center: centerId, p_view: view });
    if (error) {
      if (isMissingObject(error)) {
        warnMissingOnce("app.gyan_homework_queue", error);
        return { status: "missing" };
      }
      console.error("[gyan-homework] could not load app.gyan_homework_queue:", error);
      return { status: "error", error };
    }
    const parsed = parseHomeworkQueue(data);
    if (!parsed.ok) {
      console.error("[gyan-homework] app.gyan_homework_queue sent an unexpected shape:", data);
      return { status: "shape", message: parsed.error };
    }
    return { status: "ok", value: parsed.value };
  } catch (e) {
    console.error("[gyan-homework] app.gyan_homework_queue threw:", e);
    return { status: "error", error: e };
  }
}

/** app.review_gyan_submission: accept (points paid once) or send back with a note (required). */
export async function reviewSubmission(db: object, submissionId: string, decision: ReviewDecision, note: string | null): Promise<Written<Submission>> {
  const { data, error } = await homeworkDb(db).rpc("review_gyan_submission", { p_submission: submissionId, p_decision: decision, p_note: note });
  if (error) return { ok: false, error };
  const parsed = parseSubmission(data);
  if (!parsed.ok) {
    console.error("[gyan-homework] app.review_gyan_submission sent an unexpected shape:", data);
    return { ok: false, error: shapeError("app.review_gyan_submission", parsed.error) };
  }
  return { ok: true, value: parsed.value };
}

export type SignedFile = { url: string | null; problem: string | null };

/**
 * Short-lived signed URLs for the parts of the submissions on screen (private bucket "homework": the bucket's own
 * policy lets the reviewers of a submission read its files). A file that cannot be signed carries the reason instead.
 */
export async function signHomeworkFiles(db: Pick<AppSupabase, "storage">, paths: readonly string[], expiresIn = 600): Promise<Map<string, SignedFile>> {
  const out = new Map<string, SignedFile>();
  const unique = [...new Set(paths)];
  if (!unique.length) return out;
  const { data, error } = await db.storage.from(HOMEWORK_BUCKET).createSignedUrls(unique, expiresIn);
  if (error) {
    console.error(`[gyan-homework] could not sign file URLs in bucket "${HOMEWORK_BUCKET}":`, error);
    for (const p of unique) out.set(p, { url: null, problem: `Preview unavailable — ${error.message || "storage refused the request"}.` });
    return out;
  }
  unique.forEach((p, idx) => {
    const r = data?.[idx];
    if (r?.signedUrl) out.set(p, { url: r.signedUrl, problem: null });
    else {
      if (r?.error) console.error(`[gyan-homework] file ${p} could not be signed:`, r.error);
      out.set(p, { url: null, problem: `Preview unavailable — ${r?.error ?? "the file was not found in storage"}.` });
    }
  });
  return out;
}

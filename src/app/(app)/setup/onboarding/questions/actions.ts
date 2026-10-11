"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { todayInTz } from "@/lib/dates";
import type { AnswerCode } from "@/lib/onboarding/resolve/exceptions";
import { existingToRawRecords } from "@/lib/onboarding/resolve/from-import";
import {
  answerGroup,
  loadInbox,
  loadItemDetail,
  reopenGroup,
  resolveDbOf,
  resolveImportRun,
  setGroupStatus,
  type ResolveSummary,
} from "@/lib/onboarding/resolve/store";
import type { AnswerOutcome, InboxView, ItemDetail } from "@/lib/onboarding/resolve/views";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

import { loadExistingHouseholdsAction } from "../actions";

// The matching questions (Setup > Guided onboarding > Questions). Every action re-checks the session here (a convenience: the
// actions are reachable by direct POST); the database checks who may use the import run and is the enforcement. A failure comes
// back as one plain sentence that says what could not be done, and the screen shows it next to what the person did.
//
// PERSONAL DATA. The records are the uploaded rows. Nothing here logs one: the server module logs an error's code and message only.

export type QuestionsResult<T> = { ok: true; data: T } | { ok: false; error: string; denied?: boolean };

export type FindMatchesData = {
  summary: ResolveSummary;
  /** Said when households already in the records could not be used for comparing. */
  note: string | null;
};

const refused = (context: string, why: string): { ok: false; error: string } => ({ ok: false, error: `${context} — ${why}` });

function dbOf(session: { db: unknown }) {
  return resolveDbOf(session.db);
}

/** Looks for matches in an import run's rows and saves what it finds. Takes a while for a large file. */
export async function findMatchesAction(runId: string): Promise<QuestionsResult<FindMatchesData>> {
  return withActivity("onboarding.find_matches", () => findMatches(runId), { entityFrom: { kind: "import_run", id: runId } });
}

async function findMatches(runId: string): Promise<QuestionsResult<FindMatchesData>> {
  const context = "Could not look for matches";
  const a = await authorizeAction("dataImport", "look for matches");
  if (!a.ok) return a;
  if (!isUuid(runId)) return refused(context, "that import was not found.");
  const { session } = a;
  const db = dbOf(session);

  const got = await db.rpc("import_run_get", { p_run: runId });
  if (got.error) {
    console.error("[onboarding-resolve] could not read the import:", { code: got.error.code ?? null, message: String(got.error.message ?? "").slice(0, 300) });
    return refused(context, String(got.error.message ?? "").trim() || "the import could not be read.");
  }
  const run = (got.data ?? {}) as { entity?: string; file_name?: string | null; run_number?: number; status?: string };
  if (!run.entity) return refused(context, "that import was not found.");

  // Households already in the records are what new rows are compared with. They are optional: without access to households
  // the file is still checked, against itself, and the screen says so.
  let linkTargets: ReturnType<typeof existingToRawRecords> = [];
  let note: string | null = null;
  if (canAccess(session, "households")) {
    const existing = await loadExistingHouseholdsAction();
    if (existing.ok && existing.data) {
      linkTargets = existingToRawRecords(existing.data.households);
      if (existing.data.truncated) note = "You have more households than could be compared in one go, so only the first ones were used.";
    } else if (!existing.ok) {
      note = `The households you already have could not be used for comparing, so the file was checked against itself. ${existing.error}`;
    }
  } else {
    note = "You do not have access to the households you already have, so this file was only checked against itself.";
  }

  const result = await resolveImportRun(db, {
    runId,
    centerId: session.center.id,
    today: todayInTz(session.center.time_zone),
    entity: run.entity,
    source: run.file_name?.trim() || `Import ${run.run_number ?? ""}`.trim(),
    linkTargets,
  });
  if (!result.ok) return result;
  revalidatePath("/setup/onboarding/questions");
  return { ok: true, data: { summary: result.data, note } };
}

/** The inbox of a run. */
export async function loadInboxAction(runId: string): Promise<QuestionsResult<InboxView>> {
  const a = await authorizeAction("dataImport", "open the questions");
  if (!a.ok) return a;
  if (!isUuid(runId)) return refused("Could not open the questions", "that import was not found.");
  return loadInbox(dbOf(a.session), runId);
}

/** One item for its card. */
export async function loadItemAction(itemId: string): Promise<QuestionsResult<ItemDetail>> {
  const a = await authorizeAction("dataImport", "open this question");
  if (!a.ok) return a;
  if (!isUuid(itemId)) return refused("Could not open this question", "that question was not found.");
  return loadItemDetail(dbOf(a.session), itemId);
}

export type AnswerData = { outcome: AnswerOutcome; view: InboxView };
export type ViewData = { view: InboxView };

/** The inbox as it is now, after something was done (one round trip: the screen takes this as the truth). */
async function withFreshView<T extends object>(db: ReturnType<typeof dbOf>, runId: string, done: T): Promise<QuestionsResult<T & { view: InboxView }>> {
  const view = await loadInbox(db, runId);
  if (!view.ok) return { ok: false, error: `${view.error} (what you did was saved).` };
  return { ok: true, data: { ...done, view: view.data } };
}

export type AnswerInput = {
  runId: string;
  groupId: string;
  /** The item that was in front, so a slow click cannot answer another one. */
  itemId: string;
  answer: AnswerCode;
  /** "one": this item. "rest": this item and the other open ones of the question. */
  scope: "one" | "rest";
  /** With "rest": the number of other items the person was shown. The database refuses if it is not the number it would answer. */
  expectedOthers?: number;
};

/** A person's answer to the item in front; with scope "rest", the same answer for the other open items of the question. */
export async function answerQuestionAction(input: AnswerInput): Promise<QuestionsResult<AnswerData>> {
  return withActivity("onboarding.answer_question", () => answerQuestion(input), { entityFrom: { kind: "import_run", id: input.runId } });
}

async function answerQuestion(input: AnswerInput): Promise<QuestionsResult<AnswerData>> {
  const context = "Could not record your answer";
  const a = await authorizeAction("dataImport", "answer the question");
  if (!a.ok) return a;
  if (!isUuid(input.runId) || !isUuid(input.groupId) || !isUuid(input.itemId)) return refused(context, "this page lost track of the question. Reload the page.");
  if (input.scope !== "one" && input.scope !== "rest") return refused(context, "choose whether the answer is for this one or for the others too.");
  const db = dbOf(a.session);
  if (input.scope === "rest" && !(Number.isInteger(input.expectedOthers) && (input.expectedOthers as number) >= 0)) {
    return refused(context, "this page lost track of how many others the answer is for. Reload the page.");
  }
  const answered = await answerGroup(db, {
    groupId: input.groupId,
    itemId: input.itemId,
    answer: input.answer,
    applyToRest: input.scope === "rest",
    ...(input.scope === "rest" ? { expectedOthers: input.expectedOthers } : {}),
  });
  if (!answered.ok) return answered;
  revalidatePath("/setup/onboarding/questions");
  return withFreshView(db, input.runId, { outcome: answered.data });
}

export type DeferInput = { runId: string; groupId: string; status: "postponed" | "skipped" | "open" };

/** Put a question off until later, skip it, or bring it back. */
export async function deferQuestionAction(input: DeferInput): Promise<QuestionsResult<ViewData>> {
  return withActivity("onboarding.defer_question", () => deferQuestion(input), { entityFrom: { kind: "import_run", id: input.runId } });
}

async function deferQuestion(input: DeferInput): Promise<QuestionsResult<ViewData>> {
  const context = input.status === "open" ? "Could not open the question again" : "Could not put the question off";
  const a = await authorizeAction("dataImport", input.status === "open" ? "open the question again" : "put the question off");
  if (!a.ok) return a;
  if (!isUuid(input.runId) || !isUuid(input.groupId)) return refused(context, "this page lost track of the question. Reload the page.");
  if (input.status !== "postponed" && input.status !== "skipped" && input.status !== "open") return refused(context, "that is not something a question can be set to.");
  const db = dbOf(a.session);
  const done = await setGroupStatus(db, { groupId: input.groupId, status: input.status });
  if (!done.ok) return done;
  revalidatePath("/setup/onboarding/questions");
  return withFreshView(db, input.runId, {});
}

/** Take a question's answers back, and the remembered answers made from it. */
export async function reopenQuestionAction(input: { runId: string; groupId: string }): Promise<QuestionsResult<ViewData>> {
  return withActivity("onboarding.reopen_question", () => reopenQuestion(input), { entityFrom: { kind: "import_run", id: input.runId } });
}

async function reopenQuestion(input: { runId: string; groupId: string }): Promise<QuestionsResult<ViewData>> {
  const context = "Could not take the answers back";
  const a = await authorizeAction("dataImport", "take the answers back");
  if (!a.ok) return a;
  if (!isUuid(input.runId) || !isUuid(input.groupId)) return refused(context, "this page lost track of the question. Reload the page.");
  const db = dbOf(a.session);
  const done = await reopenGroup(db, input.groupId);
  if (!done.ok) return done;
  revalidatePath("/setup/onboarding/questions");
  return withFreshView(db, input.runId, {});
}


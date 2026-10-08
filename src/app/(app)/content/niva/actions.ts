"use server";

import { revalidatePath } from "next/cache";

import { expectedVersion, writeCenterRules } from "@/lib/data/center-rules-write";
import { failure, type ActionResult, type DbErrorLike } from "@/lib/errors";
import {
  NIVA_GROUP_RETRY_MAX,
  nivaAnswerFromKinds,
  nivaAiMode,
  nivaAnswerFromLine,
  parseNivaTestAsked,
  parseNivaTestResult,
  type NivaTestAsked,
  type NivaTestResult,
} from "@/lib/niva";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason, loadSession } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// app.niva_test_ask and app.niva_test_result are new in 0575: until the generated types include them,
// they are called through the untyped signature (as discover-actions.ts and lib/data/pathshala.ts do).
type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
const untypedRpc = (db: AppSupabase) => db.rpc.bind(db) as unknown as RpcCaller;

const UNEXPECTED_SHAPE = "the database answered in a shape this screen does not understand (has the latest migration been applied?).";

// B14: re-run Niva's answering job (app.niva_regenerate, 0530; since 0572 it never queues a
// second job for a question already on its way, and brings forward a paused question's retry).
// An answered question keeps its answer until the worker has a new one; an unanswered one is
// simply tried again ("Try again"), for example after a source was added or approved.

async function signedIn(doing: string) {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false as const, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false as const, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  return { ok: true as const, session: state.session };
}

const questions = (n: number) => `${n} question${n === 1 ? "" : "s"}`;

export async function regenerateNivaAnswerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const answered = String(fd.get("answered") ?? "") === "1";
  const doing = answered ? "regenerate Niva's answer" : "queue the question again";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("conversation_id") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — no question was given. Reload the page and try again.` };
  const { error } = await auth.session.db.rpc("niva_regenerate", { p_id: id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/niva");
  // 0579: with AI answers off, niva_regenerate tries the approved content there and then; nothing is queued.
  if (nivaAiMode(auth.session.center.rules) === "off") {
    return { ok: true, message: "Niva tried this question again against your approved content. The list now shows its answer, or why there still isn't one." };
  }
  return {
    ok: true,
    message: answered
      ? "Niva is answering this question again. The current answer stays until there is a new one; reload in a minute to see it."
      : "Niva will try this question again. Reload in a minute to see the answer, or why there still isn't one.",
  };
}

/** "Try again (N)" on one group of the same unanswered question: niva_regenerate for each, one by one. */
export async function retryNivaQuestionsAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "queue the question again";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const ids = [...new Set(String(fd.get("ids") ?? "").split(",").map((s) => s.trim()).filter(isUuid))].slice(0, NIVA_GROUP_RETRY_MAX);
  if (ids.length === 0) return { ok: false, error: `Could not ${doing} — no question was given. Reload the page and try again.` };
  let done = 0;
  for (const id of ids) {
    const { error } = await auth.session.db.rpc("niva_regenerate", { p_id: id });
    if (error) {
      if (done > 0) revalidatePath("/content/niva");
      return failure(done > 0 ? `Could not queue every question again (${done} of ${ids.length} were queued)` : `Could not ${doing}`, error);
    }
    done += 1;
  }
  revalidatePath("/content/niva");
  if (nivaAiMode(auth.session.center.rules) === "off") {
    return { ok: true, message: `${questions(done)} tried again against your approved content. The list now shows the answers, or why there still isn't one.` };
  }
  return {
    ok: true,
    message: `${questions(done)} will be tried again (any already on their way are left to finish). Reload in a minute to see Niva's answers.`,
  };
}

/** "Try all unanswered questions again": app.niva_retry_unanswered (0572), the last 30 days, 150 at a time. */
export async function retryAllUnansweredNivaAction(): Promise<ActionResult> {
  const doing = "try the unanswered questions again";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const limit = 150;
  const { data, error } = await auth.session.db.rpc("niva_retry_unanswered", { p_center: auth.session.center.id, p_since: "30 days", p_limit: limit });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/niva");
  const n = typeof data === "number" ? data : 0;
  if (n > 0 && nivaAiMode(auth.session.center.rules) === "off") {
    return {
      ok: true,
      message: `${questions(n)} tried again against your approved content. Those it can answer now show their answer; the rest still say why not.${n >= limit ? " Press it again for the rest." : ""}`,
    };
  }
  if (n === 0) {
    return { ok: true, message: "There was nothing to try again: every question from the last 30 days is answered or already on its way to Niva." };
  }
  return {
    ok: true,
    message: `${questions(n)} will be tried again, a couple of seconds apart. Reload in a few minutes to see the answers.${n >= limit ? " Press it again in five minutes for the rest." : ""}`,
  };
}

// G17 / G20: the staff test box (app.niva_test_ask, 0575; owner-approved 2026-10-01). Content staff
// ask without being members, optionally including sources waiting for approval; tests have their
// own daily allowance and never count toward the members' monthly question limit. The test box
// then asks getNivaTestResultAction every few seconds until Niva has an outcome.
export async function askNivaTestAction(_prev: ActionResult<NivaTestAsked> | null, fd: FormData): Promise<ActionResult<NivaTestAsked>> {
  const doing = "send the test question to Niva";
  const auth = await authorizeAction("contentDraft", doing);
  if (!auth.ok) return auth;
  const question = String(fd.get("question") ?? "").trim();
  if (!question) return { ok: false, error: `Could not ${doing} — type a question first.` };
  const includeInReview = String(fd.get("include_in_review") ?? "") === "1";
  const { data, error } = await untypedRpc(auth.session.db)("niva_test_ask", {
    p_center: auth.session.center.id,
    p_question: question,
    p_include_in_review: includeInReview,
  });
  if (error) return failure(`Could not ${doing}`, error);
  const asked = parseNivaTestAsked(data);
  if (!asked) {
    console.error("[content/niva] niva_test_ask returned an unexpected shape:", data);
    return { ok: false, error: `Could not ${doing} — ${UNEXPECTED_SHAPE}` };
  }
  return { ok: true, data: asked };
}

/** One staff test as it stands (app.niva_test_result): the test box calls this while it waits. Reads only; nothing is re-rendered. */
export async function getNivaTestResultAction(id: string): Promise<ActionResult<NivaTestResult>> {
  const doing = "check for Niva's answer";
  const auth = await authorizeAction("contentDraft", doing);
  if (!auth.ok) return auth;
  if (typeof id !== "string" || !isUuid(id)) return { ok: false, error: `Could not ${doing} — no test was given. Ask the question again.` };
  const { data, error } = await untypedRpc(auth.session.db)("niva_test_result", { p_id: id });
  if (error) return failure(`Could not ${doing}`, error);
  const result = parseNivaTestResult(data);
  if (!result) {
    console.error("[content/niva] niva_test_result returned an unexpected shape:", data);
    return { ok: false, error: `Could not ${doing} — ${UNEXPECTED_SHAPE}` };
  }
  return { ok: true, data: result };
}

// G6: what Niva also answers from (app.niva_set_answer_from, 0573; content.manage). Approved Niva
// sources are always on; the Guide's public sections and published FAQ items are optional.
export async function setNivaAnswerFromAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "change what Niva answers from";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const choice = { guide: String(fd.get("guide") ?? "") === "1", faq: String(fd.get("faq") ?? "") === "1" };
  const writer = await dbWithReason(auth.session, "Changed what Niva answers from on Content › Niva");
  const { data, error } = await writer.rpc("niva_set_answer_from", { p_center: auth.session.center.id, p_kinds: nivaAnswerFromKinds(choice) });
  if (error) return failure(`Could not ${doing}`, error);
  const stored = Array.isArray(data) ? data : [];
  revalidatePath("/content/niva");
  return {
    ok: true,
    message: `Saved. ${nivaAnswerFromLine({ guide: stored.includes("guide"), faq: stored.includes("faq") })} New questions use this straight away; answers given before stay until you regenerate them.`,
  };
}

// 0579 (owner decision 2026-10-02): whether Niva may ask Claude Haiku when the community's approved content has no
// answer. centers.rules.niva.ai, written through the shared rules writer: versioned (a page opened before someone
// else's save is told so) and, like every rule, changed with settings.manage (RLS on centers).
export async function setNivaAiAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const raw = String(fd.get("ai") ?? "");
  const on = raw === "haiku";
  const doing = on ? "turn AI answers on" : "turn AI answers off";
  if (raw !== "haiku" && raw !== "off") return { ok: false, error: "Could not save the AI answers setting — choose On or Off, then save again." };
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const expected = expectedVersion(fd.get("version"));
  if (expected === "invalid") return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };
  const r = await writeCenterRules(auth.session, { mode: "patch", rules: { niva: { ai: on ? "haiku" : "off" } } }, expected, "AI answers setting", (v) =>
    on
      ? `AI answers are on · rules version ${v}. Questions your approved content cannot answer now go to Claude Haiku (a small cost per question).`
      : `AI answers are off · rules version ${v}. Niva answers only from your approved content, at no AI cost; anything else is offered to the team.`,
  );
  if (r.ok) revalidatePath("/content/niva");
  return r;
}

// G13: take a source out of Niva for good (status 'retired'). It stays in the list under
// "Show retired"; editing it sends it back through approval.
export async function retireNivaSourceAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "retire the source";
  const auth = await authorizeAction("contentManage", doing);
  if (!auth.ok) return auth;
  const id = String(fd.get("id") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — no source was given. Reload the page and try again.` };
  const writer = await dbWithReason(auth.session, "Retired from Niva on Content › Niva");
  const { data, error } = await writer
    .from("content_items")
    .update({ status: "retired" })
    .eq("id", id)
    .eq("center_id", auth.session.center.id)
    .eq("kind", "niva_source")
    .neq("status", "retired")
    .select("id, title");
  if (error) return failure(`Could not ${doing}`, error);
  const row = data?.[0];
  if (!row) return { ok: false, error: `Could not ${doing} — it is already retired, or it is not one of this community's sources. Reload the page to see the current list.` };
  revalidatePath("/content", "layout");
  return {
    ok: true,
    message: `"${row.title}" retired: Niva no longer answers from it. Answers that already cite it stay until you press Regenerate on them.`,
  };
}

// B14: give Niva web pages to learn from (app.niva_import_pages, migration 0540). One job per
// page; the background service reads each page and saves its sections as DRAFT sources, which
// an administrator still approves before Niva may use them.
export async function importNivaPagesAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "import those web pages";
  const auth = await signedIn(doing);
  if (!auth.ok) return auth;
  // Addresses never contain spaces, so any whitespace or comma separates them.
  const urls = String(fd.get("urls") ?? "").split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return { ok: false, error: `Could not ${doing} — paste at least one web page address, one per line.` };
  const { data, error } = await auth.session.db.rpc("niva_import_pages", { p_center: auth.session.center.id, p_urls: urls });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/niva");
  const n = typeof data === "number" ? data : urls.length;
  return {
    ok: true,
    message: `${n} page${n === 1 ? "" : "s"} queued. They are read a few seconds apart; reload this page in a minute. The new sections appear under Sources as drafts, and any page that could not be read is listed under Recent imports with the reason.`,
  };
}

// B14: after reading the imported drafts, send them to the Approval queue in one step: every
// imported page's drafts, or (with source_url) one page's. Only IMPORTED drafts move (a draft
// someone wrote by hand and is still working on stays put), and only to "in review": publishing
// is still a separate approval by a content manager.
export async function submitImportedNivaDraftsAction(_prev?: ActionResult | null, fd?: FormData): Promise<ActionResult> {
  const sourceUrl = String(fd?.get("source_url") ?? "").trim();
  const doing = sourceUrl ? "send this page's drafts for approval" : "send the imported drafts for approval";
  const auth = await authorizeAction("contentDraft", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  let q = db.from("content_items").update({ status: "in_review" }).eq("center_id", center.id).eq("kind", "niva_source").eq("status", "draft").eq("metadata->>imported", "true");
  if (sourceUrl) q = q.eq("metadata->>source_url", sourceUrl);
  const { data, error } = await q.select("id");
  if (error) return failure(`Could not ${doing}`, error);
  const n = data?.length ?? 0;
  if (n === 0) {
    return {
      ok: false,
      error: `Could not ${doing} — there are no imported drafts ${sourceUrl ? "of this page " : ""}waiting. Reload the page to see the current list.`,
    };
  }
  revalidatePath("/content", "layout");
  return {
    ok: true,
    message: `${n} imported section${n === 1 ? "" : "s"} sent for approval. A content manager approves them in Content › Approval queue; Niva can answer from them once they are approved.`,
  };
}

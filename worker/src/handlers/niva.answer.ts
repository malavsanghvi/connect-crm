// niva.answer: answer a member's Niva question from this center's approved
// content (backlog B14). Enqueued by app.niva_ask (asking) and
// app.niva_regenerate (staff, after a source is edited/approved) — both in
// migration 0530_niva_answering.sql.
//
// Retrieval: app.niva_worker_search_sources ranks app.content_items where
// kind = 'niva_source' and status = 'published' (what the content/niva
// screen calls "Included"), for this center or the shared platform pack
// (center_id null). No other table is ever read here — in particular, NO
// individual member data (eligibility, RSVPs, payment status, another
// household's anything) reaches the prompt. That is what makes "only the
// asking member's own data, never another household's" hold structurally:
// the model is told plainly that it has no such access, rather than being
// trusted with real member rows and asked nicely to filter them.
//
// No matching source, or the model says it cannot answer confidently → the
// job finishes without writing an answer. app.niva_conversations.answer
// stays null, unanswered stays true, and the member sees the existing
// honest fallback (niva.pending in connect-mobile/src/i18n/en.ts) — this
// was already true and already tested; this handler does not touch it.
//
// Needs ANTHROPIC_API_KEY on the background service (Community Connect's
// own key — worker/src/config.ts already reserves it for "Niva, mapping
// suggestions"). Without it the job fails at once as "not configured" and
// the conversation is left exactly as if this handler did not run —
// degrading to the same honest fallback, never a fabricated answer.

import Anthropic from "@anthropic-ai/sdk";

import { providerStatus, type Env, type Readiness } from "../config";
import { NotConfiguredError, PermanentError } from "../errors";
import type { Job, JobContext } from "../types";

export const kind = "niva.answer";
export const MODEL = "claude-opus-5";

export function configured(env: Env): Readiness {
  return providerStatus(env, "anthropic");
}

export type Source = { id: string; title: string; body_md: string; rank: number };
export type Conversation = { id: string; center_id: string; user_id: string | null; question: string; unanswered: boolean };

const SYSTEM_PROMPT = [
  "You are Niva, the assistant for a Jain community's member app (Community Connect). You answer ONE member's question using ONLY the numbered sources given below — each one is content a staff member has written and approved for Niva to answer from.",
  "",
  "Rules, in order:",
  "1. Answer only from the sources given. Never use outside knowledge of Jain practice, this community, or anything else, even if you believe it is correct — an approved source is the only thing you may cite.",
  "2. Doctrinal or practice questions (what to do, what is permitted, the meaning or reasoning behind a practice): answer briefly from the sources, then say the member should speak with a Pathshala teacher for anything beyond what the sources cover.",
  "3. You have NO access to any individual member's personal data — no eligibility, no RSVP or registration status, no payment or membership status, nothing about any household. If the question asks about the member's own personal status or another household's, say plainly that you cannot look up personal account details and suggest they check their profile/My Events in the app or contact the office. Never guess or imply you checked.",
  "4. If the sources do not clearly answer the question, set can_answer to false. Do not partially answer, hedge into a guess, or answer a different question than the one asked. It is always better to say you are unsure than to be wrong.",
  "5. Keep the answer conversational and short (2-4 sentences unless the question genuinely needs a list).",
  "6. cited_source_ids must list only the numbered source ids you actually drew from, and only when can_answer is true.",
].join("\n");

export function userPrompt(question: string, sources: Source[]): string {
  const lines = [`Member's question: "${question}"`, "", "Approved sources:"];
  for (const s of sources) lines.push(`[${s.id}] ${s.title}\n${s.body_md}`);
  return lines.join("\n\n");
}

export function answerSchema(sourceIds: string[]) {
  return {
    type: "object",
    properties: {
      can_answer: { type: "boolean" },
      answer: { type: "string" },
      cited_source_ids: { type: "array", items: { type: "string", enum: sourceIds } },
    },
    required: ["can_answer", "answer", "cited_source_ids"],
    additionalProperties: false,
  } as const;
}

type Parsed = { can_answer: boolean; answer: string; cited_source_ids: string[] };

/** Keep only what the model actually offered; never trust free-form ids past this. */
export function cleanAnswer(raw: unknown, sources: Source[]): Parsed | null {
  const offered = new Set(sources.map((s) => s.id));
  const x = (raw ?? {}) as Record<string, unknown>;
  if (typeof x.can_answer !== "boolean" || typeof x.answer !== "string") return null;
  const cited = Array.isArray(x.cited_source_ids) ? x.cited_source_ids.filter((id): id is string => typeof id === "string" && offered.has(id)) : [];
  return { can_answer: x.can_answer, answer: x.answer.trim().slice(0, 4000), cited_source_ids: cited };
}

export async function run(job: Job, ctx: JobContext) {
  const ready = configured(ctx.env);
  if (!ready.configured) throw new NotConfiguredError(ready.reason);

  const conversationId = job.payload?.conversation_id;
  if (typeof conversationId !== "string") throw new PermanentError("niva.answer: payload needs conversation_id.");

  const rows = await ctx.db.query<{ r: Conversation | null }>("select app.niva_worker_get_conversation($1) as r", [conversationId]);
  const conversation = rows[0]?.r ?? null;
  if (!conversation) {
    ctx.log.info("niva.answer: conversation is gone (likely 30-day retention) — nothing to answer", { conversation_id: conversationId });
    return { answered: false, reason: "conversation_not_found" };
  }

  const srows = await ctx.db.query<{ r: Source[] | null }>("select app.niva_worker_search_sources($1, $2, 6) as r", [conversation.center_id, conversation.question]);
  const sources = srows[0]?.r ?? [];
  if (sources.length === 0) {
    ctx.log.info("niva.answer: no approved source matched this question", { conversation_id: conversationId });
    return { answered: false, reason: "no_matching_source" };
  }

  const client = new Anthropic({ apiKey: ctx.env.ANTHROPIC_API_KEY, baseURL: ctx.env.ANTHROPIC_BASE_URL || undefined, timeout: 60_000, maxRetries: 2 });
  const sourceIds = sources.map((s) => s.id);
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      output_config: { effort: "low", format: { type: "json_schema", schema: answerSchema(sourceIds) } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: userPrompt(conversation.question, sources) }],
    } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new NotConfiguredError("The Anthropic key on the background service was refused (ANTHROPIC_API_KEY).");
    }
    if (err instanceof Anthropic.BadRequestError) throw new PermanentError(`Niva's answering request was not accepted: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === "refusal") {
    ctx.log.info("niva.answer: the model declined to answer", { conversation_id: conversationId });
    return { answered: false, reason: "model_refused" };
  }
  if (response.stop_reason === "max_tokens") throw new PermanentError("Niva's answer was cut off before it finished; it will be retried.");

  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PermanentError("Niva's answer could not be read (invalid JSON from the model); it will be retried.");
  }
  const parsed = cleanAnswer(raw, sources);
  if (!parsed || !parsed.can_answer || !parsed.answer) {
    ctx.log.info("niva.answer: the model was not confident enough to answer", { conversation_id: conversationId });
    return { answered: false, reason: "model_unsure" };
  }

  const citedSources = sources.filter((s) => parsed.cited_source_ids.includes(s.id));
  // A confident answer with nothing it can point to is not trustworthy enough to show as sourced.
  const finalSources = citedSources.length > 0 ? citedSources : sources.slice(0, 1);
  const sourcesJson = finalSources.map((s) => ({ content_item_id: s.id, title: s.title }));

  await ctx.db.query("select app.niva_worker_store_answer($1, $2, $3::jsonb, $4)", [conversationId, parsed.answer, JSON.stringify(sourcesJson), response.model]);
  ctx.log.info("niva.answer: answered", { conversation_id: conversationId, sources: finalSources.length });
  return { answered: true, sources: finalSources.length, model: response.model };
}

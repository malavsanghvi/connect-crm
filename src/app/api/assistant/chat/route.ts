import { chatAllowedAt, type ChatMode } from "@/lib/ai-gate";
import { chat } from "@/lib/assistant/chat";
import { authorizeAssistant, databaseChatMode, fail, ndjson, readJson } from "@/lib/assistant/http";
import { assistantModelClient } from "@/lib/assistant/key";
import { onboardingRegistry } from "@/lib/assistant/onboarding";
import { cleanContext } from "@/lib/assistant/prompt";
import type { ChatRequest } from "@/lib/assistant/protocol";
import { assistantModel, CHAT_AI_OFF } from "@/lib/assistant/settings";
import { databaseConversationLog, databaseUsageMeter } from "@/lib/assistant/store";
import { createCommandContext } from "@/lib/commands/context";
import { defaultRegistry } from "@/lib/commands/registry";
import type { AppSupabase } from "@/lib/supabase/server";

// POST /api/assistant/chat { message, threadId?, context? }: one message to Niva, answered as a stream of events, one JSON object
// per line (ChatEvent in src/lib/assistant/protocol.ts). The model chooses commands from the list this person may use; they run
// as the signed-in person; a command that needs the person's OK only ever shows a card (POST /confirm does it). With no AI key
// the stream is a single plain-English error, so the interface can say so and keep the palette working.
//
// The chat is AI, so it needs iWeaver and Niva (0755; authorizeAssistant, app.assistant_chat_mode). Without iWeaver it answers
// only while the community is onboarding (app.centers.status, which only Weaver changes, 0756) and Niva itself is on, and only
// for a question asked on the onboarding pages: then the model is offered the onboarding commands only
// (src/lib/assistant/onboarding.ts), and the database counts the message as 'onboarding' (app.assistant_usage_check), which it
// allows only in that same mode. Before every later model call of the message the mode is read again (stillAllowed).
export const dynamic = "force-dynamic";
// A message can take a while (up to six actions, each followed by the model thinking).
export const maxDuration = 180;

const STOPPED_UNKNOWN = "Niva stopped because it could not check that it may still answer for your community. Nothing more was done. Try again.";
const STOPPED_OFF =
  "Niva stopped because iWeaver or Niva was switched off for your community while it was answering. The search box and the commands list still work.";

/**
 * Before each later model call: the mode the message started with must still hold (a chat that started "on" may not go on in
 * the onboarding mode, whose commands and pages are narrower).
 */
function stillAllowedFor(db: AppSupabase, centerId: string, started: ChatMode) {
  return async (): Promise<{ error: string; retryable: boolean } | null> => {
    const now = await databaseChatMode(db, centerId);
    if (now === null) return { error: STOPPED_UNKNOWN, retryable: true };
    if (now === "on" || (now === "onboarding" && started === "onboarding")) return null;
    return { error: now === "onboarding" ? CHAT_AI_OFF : STOPPED_OFF, retryable: false };
  };
}

export async function POST(req: Request) {
  const auth = await authorizeAssistant(req, { post: true, needsEnabled: true, needsChat: true });
  if (!auth.ok) return auth.response;
  const read = await readJson(req);
  if (!read.ok) return read.response;
  const { message, threadId, context } = read.body;
  const request: ChatRequest = {
    message: typeof message === "string" ? message : "",
    ...(typeof threadId === "string" ? { threadId } : {}),
    ...(context && typeof context === "object" && !Array.isArray(context) ? { context: context as ChatRequest["context"] } : {}),
  };
  const onboarding = auth.chat === "onboarding";
  if (!chatAllowedAt(auth.chat, cleanContext(request.context)?.path)) return fail(403, CHAT_AI_OFF);

  try {
    const ctx = await createCommandContext(auth.session, "assistant");
    const centerId = ctx.session.center.id;
    const events = chat(
      {
        ctx: onboarding ? { ...ctx, registry: onboardingRegistry(ctx.registry ?? defaultRegistry) } : ctx,
        model: await assistantModelClient(),
        modelId: assistantModel(),
        meter: databaseUsageMeter(ctx.session.db, centerId, onboarding ? "onboarding" : "chat"),
        log: databaseConversationLog(ctx.session.db, centerId),
        signal: req.signal,
        stillAllowed: stillAllowedFor(ctx.session.db, centerId, auth.chat),
      },
      request,
    );
    return ndjson(events);
  } catch (error) {
    console.error("[assistant] could not start the chat:", error);
    return fail(500, "Niva could not start. Nothing was changed. Try again.");
  }
}

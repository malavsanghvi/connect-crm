import { chat } from "@/lib/assistant/chat";
import { authorizeAssistant, fail, ndjson, readJson } from "@/lib/assistant/http";
import { assistantModelClient } from "@/lib/assistant/key";
import type { ChatRequest } from "@/lib/assistant/protocol";
import { assistantModel } from "@/lib/assistant/settings";
import { databaseConversationLog, databaseUsageMeter } from "@/lib/assistant/store";
import { createCommandContext } from "@/lib/commands/context";

// POST /api/assistant/chat { message, threadId?, context? }: one message to Niva, answered as a stream of events, one JSON object
// per line (ChatEvent in src/lib/assistant/protocol.ts). The model chooses commands from the list this person may use; they run
// as the signed-in person; a command that needs the person's OK only ever shows a card (POST /confirm does it). With no AI key
// the stream is a single plain-English error, so the interface can say so and keep the palette working.
export const dynamic = "force-dynamic";
// A message can take a while (up to six actions, each followed by the model thinking).
export const maxDuration = 180;

export async function POST(req: Request) {
  const auth = await authorizeAssistant(req, { post: true, needsEnabled: true });
  if (!auth.ok) return auth.response;
  const read = await readJson(req);
  if (!read.ok) return read.response;
  const { message, threadId, context } = read.body;
  const request: ChatRequest = {
    message: typeof message === "string" ? message : "",
    ...(typeof threadId === "string" ? { threadId } : {}),
    ...(context && typeof context === "object" && !Array.isArray(context) ? { context: context as ChatRequest["context"] } : {}),
  };

  try {
    const ctx = await createCommandContext(auth.session, "assistant");
    const centerId = ctx.session.center.id;
    const events = chat(
      {
        ctx,
        model: await assistantModelClient(),
        modelId: assistantModel(),
        meter: databaseUsageMeter(ctx.session.db, centerId),
        log: databaseConversationLog(ctx.session.db, centerId),
        signal: req.signal,
      },
      request,
    );
    return ndjson(events);
  } catch (error) {
    console.error("[assistant] could not start the chat:", error);
    return fail(500, "Niva could not start. Nothing was changed. Try again.");
  }
}

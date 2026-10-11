import { authorizeAssistant, fail, json, readJson } from "@/lib/assistant/http";
import { runResponse } from "@/lib/assistant/present";
import type { RunResponse } from "@/lib/assistant/protocol";
import { createCommandContext } from "@/lib/commands/context";
import { COMMAND_KEY, defaultRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";

// POST /api/assistant/run { key, input }: run ONE command by key, with no model: the ⌘K palette and the buttons. It goes through
// the same door as the chat (runCommand, as the signed-in person, with Niva's switches), so what comes back has been cleaned of
// secrets and of children, and a command that needs the person's OK comes back as a card to confirm, never as a done deed.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authorizeAssistant(req, { post: true, needsEnabled: true });
  if (!auth.ok) return auth.response;
  const read = await readJson(req);
  if (!read.ok) return read.response;
  const { key, input } = read.body;
  if (typeof key !== "string" || !COMMAND_KEY.test(key)) return fail(400, "Choose one of Niva's actions to run.");
  if (input !== undefined && (typeof input !== "object" || input === null || Array.isArray(input))) {
    return fail(400, "The details for this action must be a set of named values.");
  }

  try {
    const ctx = await createCommandContext(auth.session, "assistant");
    const result = await runCommand(ctx, key, input ?? {}, { via: "assistant" });
    const answer: RunResponse = runResponse(result, (ctx.registry ?? defaultRegistry).get(key), ctx.now?.());
    return json(200, answer);
  } catch (error) {
    console.error("[assistant] run failed unexpectedly:", error);
    return fail(500, "Something went wrong inside Niva. Nothing was changed. Try again.");
  }
}

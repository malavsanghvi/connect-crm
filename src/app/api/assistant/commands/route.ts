import { authorizeAssistant, json } from "@/lib/assistant/http";
import { communityHints } from "@/lib/assistant/community";
import { assistantApiKey } from "@/lib/assistant/key";
import { commandInfo } from "@/lib/assistant/present";
import type { CommandsResponse } from "@/lib/assistant/protocol";
import { databaseUsageMeter } from "@/lib/assistant/store";
import { ensureCatalog } from "@/lib/commands/catalog";
import { defaultRegistry } from "@/lib/commands/registry";

// GET /api/assistant/commands: the commands THIS person may use through Niva (their role, the modules their community has, and the
// community's own switches), for the ⌘K palette and the side panel. It works without an AI key: `aiReady` says whether the chat can
// answer. While Niva for admins is switched off for the community it answers `enabled: false` and an empty list.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeAssistant(req, { post: false, needsEnabled: false });
  if (!auth.ok) return auth.response;
  const { session, enabled } = auth;

  let aiReady = false;
  try {
    aiReady = !!(await assistantApiKey());
  } catch (error) {
    console.error("[assistant] could not look for the AI key:", error);
  }
  if (!enabled) {
    const off: CommandsResponse = { ok: true, enabled: false, aiReady, commands: [] };
    return json(200, off);
  }

  ensureCatalog();
  const commands = defaultRegistry.list(session, "assistant").map((c) => commandInfo(c, session.kind));
  const usage = await databaseUsageMeter(session.db, session.center.id).status();
  const community = await communityHints(session);
  const body: CommandsResponse = { ok: true, enabled: true, aiReady, commands, ...(usage ? { usage } : {}), community };
  return json(200, body);
}

import { authorizeAssistant, json } from "@/lib/assistant/http";
import { communityHints } from "@/lib/assistant/community";
import { assistantApiKey } from "@/lib/assistant/key";
import { commandInfo } from "@/lib/assistant/present";
import type { CommandsResponse } from "@/lib/assistant/protocol";
import { databaseUsageMeter } from "@/lib/assistant/store";
import { ensureCatalog } from "@/lib/commands/catalog";
import { defaultRegistry } from "@/lib/commands/registry";

// GET /api/assistant/commands: the commands THIS person may use through Niva (their role, the modules their community has, and the
// community's own switches), for the ⌘K palette and the side panel. It works without an AI key: `aiReady` says whether a key is
// there, and `chat` whether iWeaver lets the chat answer (0755; the commands work either way). While Niva for admins is switched
// off for the community it answers `enabled: false` and an empty list.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authorizeAssistant(req, { post: false, needsEnabled: false });
  if (!auth.ok) return auth.response;
  const { session, enabled, chat } = auth;

  let aiReady = false;
  try {
    aiReady = !!(await assistantApiKey());
  } catch (error) {
    console.error("[assistant] could not look for the AI key:", error);
  }
  if (!enabled) {
    const off: CommandsResponse = { ok: true, enabled: false, aiReady, chat: "off", commands: [] };
    return json(200, off);
  }

  ensureCatalog();
  const commands = defaultRegistry.list(session, "assistant").map((c) => commandInfo(c, session.kind));
  const usage = await databaseUsageMeter(session.db, session.center.id).status();
  const community = await communityHints(session);
  const body: CommandsResponse = { ok: true, enabled: true, aiReady, chat, commands, ...(usage ? { usage } : {}), community };
  return json(200, body);
}

import "server-only";

import { authorizeActionWhere, type CrmSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { ensureCatalog } from "./catalog";
import { databaseMinorNames } from "./child-filter";
import { createRpcProposalStore } from "./proposals";
import type { CommandContext, CommandVia } from "./types";

/**
 * A command context for a signed-in session. For `via: "assistant"` the session works with its own database client that records
 * its audit rows as client_app "assistant" (same person, same request id, same row-level security), so the audit log can say
 * "by Niva, for <person>". Until migration 0616 accepts that value the row simply has no app.
 */
export async function createCommandContext(session: CrmSession, via: CommandVia): Promise<CommandContext> {
  ensureCatalog();
  const own: CrmSession =
    via === "assistant"
      ? { ...session, clientApp: "assistant", db: await createSupabaseServerClient({ requestId: session.requestId, clientApp: "assistant" }) }
      : session;
  return { session: own, via, proposals: createRpcProposalStore(own.db), minors: databaseMinorNames };
}

/** For a Server Action or route: the signed-in person's command context, or the plain-English reason there is none. */
export async function authorizeCommandContext(via: CommandVia, doing: string): Promise<{ ok: true; ctx: CommandContext } | { ok: false; error: string }> {
  const auth = await authorizeActionWhere(() => true, doing, "a signed-in session");
  if (!auth.ok) return auth;
  return { ok: true, ctx: await createCommandContext(auth.session, via) };
}

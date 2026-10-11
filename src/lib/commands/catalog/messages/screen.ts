import "server-only";

import type { ActionResult } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

import { defaultRegistry } from "../../registry";
import { ensureCatalog } from "../index";
import { runCommandFromScreen } from "../events/bridge";

/**
 * A screen's answer exactly as the action always gave it: `{ ok: true, message }` or the failure as it is. The command also hands back
 * data (for the palette and Niva); a screen never had it, so it is left off here.
 */
export function plain(result: ActionResult<unknown>): ActionResult {
  return result.ok ? { ok: true, message: result.message } : result;
}

/**
 * Run a command for a person whose permission the screen has already checked its own way. The inbox is the case: a zone lead handles
 * their zone's inbox without holding comms.inbox, which a plain permission check on the command would refuse. The command still
 * checks the inbox rule itself, and row-level security decides what the person may touch.
 */
export async function runCommandAs(session: CrmSession, key: string, raw: unknown, doing: string): Promise<ActionResult<unknown>> {
  ensureCatalog();
  const cmd = defaultRegistry.get(key);
  if (!cmd) return { ok: false, error: `Could not ${doing} — Weaver does not have an action called "${key}".` };
  return runCommandFromScreen(cmd, session, raw);
}

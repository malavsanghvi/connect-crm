// How an Events Server Action runs a command. The screen's button is the person's own hands, so there is no proposal and no second
// confirmation here (the page already asked, in the browser): the action reads its form, then calls the command's own `execute`, the
// very code the ⌘K palette and Niva run after a confirmation. The answer is turned into an ActionResult with the same sentences the
// action has always given: a CommandError is shown as it is, a database error is logged and explained by failure().

import { failure, type ActionResult } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

import { createRpcProposalStore } from "../../proposals";
import { CommandDbError, CommandError, type AnyCommand, type CommandContext } from "../../types";

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** Run `command.execute` for a screen. `input` is what the action read from its form; the command checks it again. */
export async function runCommandFromScreen<O = unknown>(command: AnyCommand, session: CrmSession, input: unknown): Promise<ActionResult<O>> {
  if (!command.execute) return { ok: false, error: `Could not ${lowerFirst(command.title)} — it cannot be run from here.` };
  if (command.requiresOwnerSwitch) return { ok: false, error: `Could not ${lowerFirst(command.title)} — it moves money, so it only runs after it is confirmed on its card.` };
  const parsed = command.input.parse(input);
  if (!parsed.ok) return { ok: false, error: `Could not ${lowerFirst(command.title)} — ${lowerFirst(parsed.error)}` };
  const ctx: CommandContext = { session, via: "screen", proposals: createRpcProposalStore(session.db) };
  try {
    const result = await command.execute(ctx, parsed.value);
    if (!result.ok) return { ok: false, error: result.error, ...(result.stepUp ? { stepUp: true } : {}) };
    return { ok: true, message: result.message, data: result.data as O };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: error.message };
    if (error instanceof CommandDbError) return failure(`Could not ${error.doing}`, error.dbError);
    return failure(`Could not ${lowerFirst(command.title)}`, error);
  }
}

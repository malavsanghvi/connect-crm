// Guards shared by the three Giving commands that move money. The first door is runCommand (the owner's switch, the permission, a
// confirmation card); these are the second lock, inside execute, so that a money command cannot run by any other route: not
// straight from a screen, not from a test of the wrong kind, not for a household of another community.

import { assistantToolSetting } from "../enabled";
import { CommandError, type CommandContext } from "../types";

import { must } from "./db";

/**
 * A money command runs only for a confirmed proposal and only while an owner has switched it on for the community. Returns the
 * proposal's id (what keeps one confirmation from happening twice).
 */
export function requireConfirmedRun(ctx: CommandContext, key: string): string {
  if (assistantToolSetting(ctx.session.center.rules, key) !== true) {
    throw new CommandError(`This moves money and an owner has not switched it on for ${ctx.session.center.name} yet, so nothing was done. It can be done on the screen.`);
  }
  if (!ctx.proposalId) {
    throw new CommandError("This moves money, so it only runs after it is confirmed on its card. Nothing was done.");
  }
  return ctx.proposalId;
}

/** The household must belong to the community the person is working in, whoever they are (a platform admin included). */
export async function requireOwnHousehold(ctx: CommandContext, householdId: string): Promise<void> {
  const { db, center } = ctx.session;
  const row: { id: string; center_id: string } | null = must(await db.from("households").select("id, center_id").eq("id", householdId).maybeSingle(), "look up the household");
  if (!row) throw new CommandError("That household was not found, or you can't record payments for it.");
  if (row.center_id !== center.id) {
    throw new CommandError("That household belongs to a different community than the one you are working in, so nothing can be recorded for it from here.");
  }
}

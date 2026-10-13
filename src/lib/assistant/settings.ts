// Niva for admins: the community's switches and the few fixed sentences the routes share. Pure (no server imports), so the
// Platform › Centers card, the routes and the tests read the same thing.
//
// The switches live in the community's rules bag (centers.rules), like every other per-community setting:
//   assistant.enabled              true | false     Niva for admins is switched on for this community (default: off)
//   assistant.tools["events.x"]    true | false     one confirm-level command, for Niva (default: off; src/lib/commands/enabled.ts)
//
// Two parts since 0755 (iWeaver, docs/MARKETPLACE_PACKS.md section 2):
//   the commands   the ⌘K palette, the find box's command rows, results and confirmation cards: no model. They follow the
//                  community's switch only (nivaForAdminsOn) and keep working whether iWeaver is on or not.
//   the chat       the model: it needs iWeaver (`ai`) on as well, except on the onboarding pages while the community is
//                  onboarding (src/lib/ai-gate.ts, chatMode). 0740 had both follow the `niva` module; Niva now depends on
//                  iWeaver, and only the AI part moves there.

import { AI_OFF } from "@/lib/ai-gate";
import { assistantEnabled } from "@/lib/center-rules";

/** What every route answers (except /commands) while the community has not switched Niva for admins on. */
export const ASSISTANT_OFF = "Niva for admins is not switched on for your community.";

/** What /chat answers when no AI key is available. */
export const NO_AI_KEY =
  "Niva for admins needs the AI service to be set up (Platform › Setup). You can still use the search box and the commands list.";

/** What /chat answers while iWeaver is off for the community (0755): the commands still work. */
export const CHAT_AI_OFF = `${AI_OFF} Niva can't answer questions in words here, but the search box and the commands list still work.`;

/** What every route answers when the community's modules could not be read (app.my_modules failed): Niva stays off. */
export const ASSISTANT_MODULES_UNKNOWN = "Niva for admins could not check which modules your community has. Reload the page and try again.";

/** Is Niva for admins switched on for this community? (Defined with the other rules readers, src/lib/center-rules.ts.) */
export { assistantEnabled };

/**
 * Are Niva for admins' commands on for this community: its own switch (rules.assistant.enabled), read where it is used, and the
 * modules read (`modulesStatus` "ok"), because which commands a person sees depends on them: no guessing when app.my_modules
 * failed or is missing. No module is needed: the commands use no model (0755). The chat needs iWeaver too (ai-gate.ts).
 */
export function nivaForAdminsOn(
  rules: Parameters<typeof assistantEnabled>[0],
  modules: { modulesOff?: readonly string[]; modulesStatus?: string },
): boolean {
  return assistantEnabled(rules) && modules.modulesStatus === "ok";
}

/** The model Niva for admins uses unless ASSISTANT_MODEL says otherwise. */
export const DEFAULT_ASSISTANT_MODEL = "claude-sonnet-5-5";

export function assistantModel(env: Record<string, string | undefined> = process.env): string {
  return env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
}

/** The rules patch that sets the community switch and the given tool switches (merged into the rest of the rules). */
export function assistantRulesPatch(settings: { enabled: boolean; tools: Record<string, boolean> }): { assistant: { enabled: boolean; tools: Record<string, boolean> } } {
  return { assistant: { enabled: settings.enabled, tools: { ...settings.tools } } };
}

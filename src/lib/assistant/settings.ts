// Niva for admins: the community's switches and the few fixed sentences the routes share. Pure (no server imports), so the
// Platform › Centers card, the routes and the tests read the same thing.
//
// The switches live in the community's rules bag (centers.rules), like every other per-community setting:
//   assistant.enabled              true | false     Niva for admins is switched on for this community (default: off)
//   assistant.tools["events.x"]    true | false     one confirm-level command, for Niva (default: off; src/lib/commands/enabled.ts)

import { assistantEnabled } from "@/lib/center-rules";

/** What every route answers (except /commands) while the community has not switched Niva for admins on. */
export const ASSISTANT_OFF = "Niva for admins is not switched on for your community.";

/** What /chat answers when no AI key is available. */
export const NO_AI_KEY =
  "Niva for admins needs the AI service to be set up (Platform › Setup). You can still use the search box and the commands list.";

/** Is Niva for admins switched on for this community? (Defined with the other rules readers, src/lib/center-rules.ts.) */
export { assistantEnabled };

/** The model Niva for admins uses unless ASSISTANT_MODEL says otherwise. */
export const DEFAULT_ASSISTANT_MODEL = "claude-sonnet-5-5";

export function assistantModel(env: Record<string, string | undefined> = process.env): string {
  return env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL;
}

/** The rules patch that sets the community switch and the given tool switches (merged into the rest of the rules). */
export function assistantRulesPatch(settings: { enabled: boolean; tools: Record<string, boolean> }): { assistant: { enabled: boolean; tools: Record<string, boolean> } } {
  return { assistant: { enabled: settings.enabled, tools: { ...settings.tools } } };
}

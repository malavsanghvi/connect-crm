// What a command run becomes in the activity stream (MASTER_PLAN priority 5). Pure, no server imports.
//
// Every call to runCommand and confirmProposal ends in a CommandEvent (hooks.ts). This turns one into the event the recorder
// takes: a catalog key, how it went, how long it took and how it was started. It keeps NOTHING else: no input values (the
// CommandEvent only has the names of the fields, and not even those are kept), no proposal id, no error sentence, no person.
//
// The keys are registered in the allowlist by migration 0625: "assistant." + the command key with its dot written as an
// underscore (people.search -> assistant.people_search). The database drops any key it does not list, so a new command is
// recorded only once a migration registers it (tests/activity-commands.test.ts keeps the two in step).

import type { ActivityInput } from "@/lib/activity/record";

import type { CommandErrorCode, CommandEvent } from "./types";

const COMMAND_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** The activity key of a command, or null for a call that is not one (the "(confirm)" and "(reject)" placeholders). */
export function commandActivityKey(commandKey: string): string | null {
  if (!COMMAND_KEY.test(commandKey)) return null;
  return `assistant.${commandKey.replace(/\./g, "_")}`;
}

/** The closed list of error words the recorder keeps (src/lib/activity/event.ts ERROR_CODES). */
const ERROR_WORD: Record<CommandErrorCode, string> = {
  unknown_command: "not_found",
  no_access: "no_permission",
  module_off: "no_permission",
  switched_off: "no_permission",
  screen_only: "no_permission",
  only_you: "no_permission",
  wrong_community: "no_permission",
  invalid: "invalid_input",
  needs_step_up: "step_up_required",
  unsafe_result: "failed",
  proposal_failed: "failed",
  failed: "failed",
};

/**
 * The event to record for a command call, or null when there is nothing to record:
 *   ok, confirmed        -> ok (a confirmed proposal is the moment the action really happened)
 *   denied, invalid, failed, needs_step_up -> error, with a word from the closed list
 *   proposed, rejected   -> nothing (a proposal is not the action; its confirmation is recorded when it happens)
 */
export function commandEventToActivity(event: CommandEvent): ActivityInput | null {
  const key = commandActivityKey(event.key);
  if (!key) return null;
  const duration_ms = Number.isFinite(event.durationMs) && event.durationMs >= 0 ? Math.round(event.durationMs) : undefined;
  switch (event.outcome) {
    case "ok":
    case "confirmed":
      return { key, outcome: "ok", via: event.via, duration_ms };
    case "denied":
    case "invalid":
    case "failed":
    case "needs_step_up": {
      const fallback = event.outcome === "denied" ? "no_access" : event.outcome === "invalid" ? "invalid" : event.outcome === "needs_step_up" ? "needs_step_up" : "failed";
      const word = ERROR_WORD[event.code ?? fallback] ?? "failed";
      return { key, outcome: "error", error_code: word, via: event.via, duration_ms };
    }
    default:
      return null;
  }
}

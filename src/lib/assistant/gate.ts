// Whether Niva's interface shows at all, decided from the one GET /api/assistant/commands answer. Anything but a clear
// "enabled: true" means off: the page then works exactly as before.

import type { CommandsResponse } from "./protocol";

export type CommandsState = { status: "loading" } | { status: "off" } | { status: "on"; data: CommandsResponse };

export const COMMANDS_LOADING: CommandsState = { status: "loading" };

/** The answer (or null when the call failed or was refused) as what the interface does. */
export function commandsGate(data: CommandsResponse | null): CommandsState {
  return data && data.enabled === true ? { status: "on", data } : { status: "off" };
}

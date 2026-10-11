import type { AnyCommand, Command } from "./types";

/** Declare a command. The input type of `execute` and `preview` follows from `input` (an object schema from schema.ts). */
export function defineCommand<I, O>(command: Command<I, O>): AnyCommand {
  return command as AnyCommand;
}

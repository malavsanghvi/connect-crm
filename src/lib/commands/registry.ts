// The registry: every command, found by key, filtered for the signed-in person (permission, module, and for Niva the community's
// switch), and described as a tool list for the model.

import { commandAvailability, type AvailabilitySession } from "./enabled";
import type { JsonObjectSchema } from "./schema";
import { describe } from "./text";
import type { AnyCommand, CommandLevel, CommandVia } from "./types";

export const COMMAND_KEY = /^[a-z]+\.[a-z][a-z0-9_]*$/;

const LEVELS: readonly CommandLevel[] = ["read", "draft", "confirm", "only_you"];

/** What the model is told, per level, after the command's own description. */
const LEVEL_NOTE: Record<CommandLevel, string> = {
  read: "",
  draft: " Draft only: nothing is changed or sent.",
  confirm: " This asks the person to confirm first; nothing happens until they do.",
  only_you: " Niva cannot do this one: it tells the person where to do it themselves.",
};

export type ModelTool = { name: string; description: string; input_schema: JsonObjectSchema };

/** The name a model sees: model tool names cannot contain a dot. "events.set_field" becomes "events_set_field". */
export function toolName(commandKey: string): string {
  return commandKey.replace(".", "_");
}

/** The command key for a tool name a model used: the first underscore was the dot (areas never contain one). */
export function commandKeyFromToolName(name: string): string {
  return name.replace("_", ".");
}

export class CommandRegistry {
  private readonly commands = new Map<string, AnyCommand>();

  register(command: AnyCommand): void {
    const where = `command "${command.key}"`;
    if (!COMMAND_KEY.test(command.key)) throw new Error(`${where}: the key must look like area.verb, in lower case.`);
    if (this.commands.has(command.key)) throw new Error(`${where} is already registered.`);
    if (!LEVELS.includes(command.level)) throw new Error(`${where}: unknown level "${command.level}".`);
    if (!command.title.trim() || !describe(command.description).trim()) throw new Error(`${where}: it needs a title and a description.`);
    if (command.level === "only_you") {
      if (command.execute) throw new Error(`${where}: an only_you command never runs, so it has no execute.`);
      if (!command.pointTo) throw new Error(`${where}: an only_you command says where the person does it (pointTo).`);
    } else if (!command.execute) {
      throw new Error(`${where}: it needs an execute.`);
    }
    if (command.requiresOwnerSwitch && command.level !== "confirm") {
      throw new Error(`${where}: only a confirm command needs the owner's switch.`);
    }
    if (command.enabledByDefault && (command.level === "confirm" || command.level === "only_you")) {
      throw new Error(`${where}: a ${command.level} command cannot be on by default; the owner switches it on.`);
    }
    this.commands.set(command.key, command);
  }

  get(key: string): AnyCommand | undefined {
    return this.commands.get(key);
  }

  all(): AnyCommand[] {
    return [...this.commands.values()];
  }

  /** The commands this person may use through this door right now. */
  list(session: AvailabilitySession, via: CommandVia = "screen"): AnyCommand[] {
    return this.all().filter((c) => commandAvailability(c, session, via).ok);
  }

  /** The tool list for a model: only what this person may use and the community has switched on for Niva. */
  modelTools(session: AvailabilitySession): ModelTool[] {
    return this.list(session, "assistant").map((c) => ({
      name: toolName(c.key),
      description: `${describe(c.description, session.kind).trim()}${LEVEL_NOTE[c.level]}`,
      input_schema: c.input.json(),
    }));
  }
}

/** The shared registry the app uses (catalog/index.ts fills it). */
export const defaultRegistry = new CommandRegistry();

export const registerCommand = (command: AnyCommand): void => defaultRegistry.register(command);
export const getCommand = (key: string): AnyCommand | undefined => defaultRegistry.get(key);
export const listCommands = (session: AvailabilitySession, via: CommandVia = "screen"): AnyCommand[] => defaultRegistry.list(session, via);
export const modelTools = (session: AvailabilitySession): ModelTool[] => defaultRegistry.modelTools(session);

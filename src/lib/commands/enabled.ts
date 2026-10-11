// Who may use a command right now: the permission, the module, and (for the assistant) the community's own switch.

import type { Json } from "@/lib/database.types";
import { isModuleEnabled, moduleDef, moduleOffMessage, type ModuleContext } from "@/lib/modules";
import { canAccess, ACCESS, type PermissionContext } from "@/lib/permissions";

import type { AnyCommand, CommandErrorCode, CommandVia } from "./types";

/** The community setting that switches one command on or off for Niva: `assistant.tools.<key>` in the community's rules. */
export function toolSettingKey(commandKey: string): string {
  return `assistant.tools.${commandKey}`;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * The community's switch for a command: true or false when someone set it, null when nobody did. Read from the rules bag
 * (`centers.rules`, the same place as every other per-community setting) as `assistant.tools["people.search"]`; the nested
 * form `assistant.tools.people.search` is read too, so a settings screen can write either.
 */
export function assistantToolSetting(rules: Json | undefined, commandKey: string): boolean | null {
  const tools = obj(obj(obj(rules)?.assistant)?.tools);
  if (!tools) return null;
  const flat = tools[commandKey];
  if (typeof flat === "boolean") return flat;
  const [area, verb] = commandKey.split(".");
  const nested = obj(tools[area])?.[verb];
  return typeof nested === "boolean" ? nested : null;
}

/** Read, draft and only-you commands (which only point) are on unless switched off; confirm commands are OFF until the owner switches each one on. */
export function isCommandEnabled(command: Pick<AnyCommand, "key" | "level" | "enabledByDefault">, rules: Json | undefined): boolean {
  const set = assistantToolSetting(rules, command.key);
  if (set !== null) return set;
  return command.enabledByDefault ?? command.level !== "confirm";
}

export type AvailabilitySession = PermissionContext & ModuleContext & { center: { name: string; rules: Json } };

export type Availability = { ok: true } | { ok: false; code: Extract<CommandErrorCode, "no_access" | "module_off" | "switched_off" | "screen_only">; error: string };

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** Can this person use this command now, through this door? The reason is a sentence. */
export function commandAvailability(command: AnyCommand, session: AvailabilitySession, via: CommandVia): Availability {
  const doing = lowerFirst(command.title);
  if (command.platformOnly && !session.isPlatformAdmin) {
    return { ok: false, code: "no_access", error: `Could not ${doing} — only the Weaver team (platform admins) can do this.` };
  }
  if (!canAccess(session, command.permission)) {
    return { ok: false, code: "no_access", error: `Could not ${doing} — you don't have permission (needs ${ACCESS[command.permission].join(" or ")}).` };
  }
  if (command.module && !isModuleEnabled(session, command.module)) {
    return { ok: false, code: "module_off", error: moduleOffMessage(command.module, session.center.name, moduleDef(command.module).label) };
  }
  if (command.screenOnly && via !== "screen") {
    return { ok: false, code: "screen_only", error: `Niva does not ${doing}. That is done on the screen, by a person.` };
  }
  if (via === "assistant" && !isCommandEnabled(command, session.center.rules)) {
    return {
      ok: false,
      code: "switched_off",
      error: `Niva is not set up to ${doing} for ${session.center.name} yet. An owner can switch it on in Settings; until then it can be done on the screen.`,
    };
  }
  return { ok: true };
}

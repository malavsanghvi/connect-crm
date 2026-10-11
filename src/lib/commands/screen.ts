import "server-only";

import { failure, type ActionResult } from "@/lib/errors";
import { isModuleEnabled, moduleDef, moduleOffMessage } from "@/lib/modules";
import { authorizeAction } from "@/lib/session";

import { ensureCatalog } from "./catalog";
import { createCommandContext } from "./context";
import { defaultRegistry } from "./registry";
import { CommandDbError, CommandError } from "./types";

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * For a Server Action behind a screen's own button: run a command's `execute` as that person, and answer the screen the way the
 * action always did. ONE code path: the screen, the ⌘K palette and Niva all end in the same `execute`.
 *
 * What it does and does not do:
 *   - it checks the signed-in session and the command's permission with the sentence the action gave ("Could not <doing> — you
 *     don't have permission (needs …)"), and the module;
 *   - it checks the input against the command's schema (the screen's forms always send valid values);
 *   - it does NOT ask for a proposal: the screen has its own confirmation in the browser, exactly as before. The proposal is
 *     what makes a command safe for Niva, not for the person's own hands;
 *   - a problem the person can fix comes back as the command's sentence; a database failure is logged and explained by
 *     failure() with the same "Could not <step>" wording; a step-up request keeps `stepUp`.
 *
 * `doing` is the action's own wording for the permission and input messages ("save the profile").
 */
export async function runScreenCommand<O = undefined>(key: string, raw: unknown, doing: string): Promise<ActionResult<O>> {
  ensureCatalog();
  const cmd = defaultRegistry.get(key);
  if (!cmd || !cmd.execute) return { ok: false, error: `Could not ${doing} — Weaver does not have an action called "${key}".` };
  const auth = await authorizeAction(cmd.permission, doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  if (cmd.platformOnly && !session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only the Weaver team (platform admins) can do this.` };
  if (cmd.module && !isModuleEnabled(session, cmd.module)) {
    return { ok: false, error: moduleOffMessage(cmd.module, session.center.name, moduleDef(cmd.module).label) };
  }
  const parsed = cmd.input.parse(raw);
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${lowerFirst(parsed.error)}` };
  try {
    const ctx = await createCommandContext(session, "screen");
    const result = await cmd.execute(ctx, parsed.value);
    if (!result.ok) return { ok: false, error: result.error, ...(result.stepUp ? { stepUp: true } : {}) };
    return { ok: true, message: result.message, ...(result.data !== undefined ? { data: result.data as O } : {}) };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: error.message };
    if (error instanceof CommandDbError) return failure(`Could not ${error.doing}`, error.dbError);
    return failure(`Could not ${lowerFirst(cmd.title)}`, error);
  }
}

/**
 * The text fields of a form as the plain input a command takes: strings stay strings, and a field left blank is left out when
 * `blankAsMissing` names it (an optional id or choice that the form sends as ""). Everything else a form carries is ignored.
 */
export function formInput(fd: FormData, keys: readonly string[], blankAsMissing: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = fd.get(k);
    if (typeof v !== "string") continue;
    if (v === "" && blankAsMissing.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

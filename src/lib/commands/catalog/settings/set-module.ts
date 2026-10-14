// Switching a module (an area of Weaver) on or off for the community: pausing it, or switching it back on. It hides or shows whole
// screens in the portal and the member app, so it is confirm-level and OFF for Niva until the owner ticks it. The Modules screen's
// Server Action (setModuleEnabledAction) is a thin wrapper over this `execute`. The rules about what may be switched (a core module
// never; only a module Weaver has enabled, 0740) are the database's (app.set_module_enabled), which refuses with a plain sentence; the
// preview mirrors them from src/lib/modules.ts only to explain before asking, and says which modules go off with it or what it waits for.

import { MODULE_KEYS, buildModuleRowsFromStates, moduleDef, switchBlocker, switchWarning } from "@/lib/modules";
import { isMissingObject, modulesDb, warnMissingOnce } from "@/lib/modules-db";
import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { dbFail, lowerFirst } from "../people/shared";

const input = object({
  module: f.enum(`The module to switch, by key. One of: ${MODULE_KEYS.join(", ")}.`, MODULE_KEYS),
  enabled: f.boolean("true to switch it on, false to switch it off."),
  // The length is checked in `execute` with the Modules screen's own sentences.
  reason: f.string("Why, in a sentence. It is kept in the audit log, and it is required.", { min: 0, max: 2000 }),
});
type SetModuleInput = Infer<typeof input>;

const doingOf = (inp: Pick<SetModuleInput, "module" | "enabled">) => `${inp.enabled ? "switch on" : "switch off"} ${moduleDef(inp.module).label}`;

/** The screen's own rule about the reason: it has to be there, and short enough to read in the log. */
function checkReason(doing: string, reasonInput: string): string {
  const reason = String(reasonInput ?? "").trim();
  if (!reason) throw new CommandError(`Could not ${doing} — say why. The reason is kept in the audit log.`);
  if (reason.length > 500) throw new CommandError(`Could not ${doing} — keep the reason under 500 characters.`);
  return reason;
}

const NOT_YET = (doing: string) => `Could not ${doing} — module switches are not in the database yet (the latest database update has not been applied). Every module stays on until then.`;

export const setModule = defineCommand<SetModuleInput, undefined>({
  key: "settings.set_module",
  title: "Switch a module on or off",
  description:
    "Switch one area of Weaver (a module: Events, Giving, Bolis, the Store, Pathshala, Communications, Accounting, Niva, ...) on or off for this community, with a reason that is kept in the audit log. " +
    "A switched-off module disappears from the portal and the member app, and the database refuses its data until it is switched on again. A core module cannot be switched off, " +
    "and only a module Weaver has enabled for the community can be switched on. A module that needs another is off while that one is off (use settings.modules_state to see each state). " +
    "This asks the person to confirm; nothing changes until they do.",
  level: "confirm",
  permission: "centerSettings",
  // Off until the owner switches it on in the community's settings (assistant.tools.settings.set_module).
  enabledByDefault: false,
  input,
  async preview(ctx, inp): Promise<CommandPreview> {
    const doing = doingOf(inp);
    const reason = checkReason(doing, inp.reason);
    const { db, center } = ctx.session;
    const res = await db.rpc("module_states", { p_center: center.id });
    if (res.error) {
      if (isMissingObject(res.error)) throw new CommandError(NOT_YET(doing));
      throw new CommandDbError(res.error, "read the module switches");
    }
    const rows = buildModuleRowsFromStates(res.data ?? []);
    const row = rows.find((r) => r.key === inp.module);
    const label = moduleDef(inp.module).label;
    if (!row || row.availability === "not_available") throw new CommandError(`${label} is not offered to this kind of organization, so it cannot be switched.`);
    const blocker = switchBlocker(inp.module, inp.enabled, rows);
    if (blocker) throw new CommandError(blocker);
    const ownOn = !row.paused;
    const also = switchWarning(inp.module, inp.enabled, rows);
    return {
      summary: `${inp.enabled ? "Switch on" : "Switch off"} ${row.label}.`,
      lines: [
        { label: "Module", value: row.label },
        { label: "State", before: ownOn ? "On" : "Off", after: inp.enabled ? "On" : "Off" },
        { label: "Why", value: reason },
      ],
      warnings: [
        ...(ownOn === inp.enabled ? [`${row.label} is already ${inp.enabled ? "on" : "off"}, so nothing would change.`] : []),
        ...(inp.enabled ? [] : [`${row.label} disappears from the portal and the member app, and the database refuses its data until it is switched on again.`]),
        ...(also ? [also] : []),
      ],
    };
  },
  confirmText: (_input, preview) => `Yes, ${lowerFirst(preview.summary.replace(/\.$/, ""))}`,
  async execute(ctx: CommandContext, inp) {
    const doing = doingOf(inp);
    const label = moduleDef(inp.module).label;
    const reason = checkReason(doing, inp.reason);
    const db = modulesDb(await dbWithReason(ctx.session, reason));
    const { error } = await db.rpc("set_module_enabled", {
      p_center: ctx.session.center.id,
      p_module: inp.module,
      p_enabled: inp.enabled,
      p_reason: reason,
    });
    if (error) {
      if (isMissingObject(error)) {
        warnMissingOnce("app.set_module_enabled", error);
        console.error(`[settings/modules] ${doing}: app.set_module_enabled is missing:`, error);
        return { ok: false, error: NOT_YET(doing) };
      }
      return dbFail(`Could not ${doing}`, error);
    }
    revalidateAfterCommand(["/"]);
    return { ok: true, data: undefined, message: `${label} switched ${inp.enabled ? "on" : "off"} · audit logged` };
  },
});

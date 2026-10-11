import { userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { buildModuleRowsFromStates, switchBlocker } from "@/lib/modules";
import { isMissingObject } from "@/lib/modules-db";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";
import { CommandDbError, CommandError } from "../../types";

const input = object({});

export type ModulesStateData = {
  on: number;
  off: number;
  modules: {
    module: string;
    key: string;
    is_on: boolean;
    always_on: boolean;
    needs: string[];
    /** Why it cannot be switched right now (another module needs it, or it needs one that is off); null when it can. */
    cannot_switch_because: string | null;
    /** "Switched off Oct 3, 2026 by Priya Shah". */
    last_change: string | null;
    reason: string | null;
  }[];
  not_offered_to_this_kind_of_organization: string[];
};

/** Which areas (modules) of Weaver are switched on for this community. */
export const modulesState = defineCommand<Infer<typeof input>, ModulesStateData>({
  key: "settings.modules_state",
  title: "Look up which modules are switched on",
  description:
    "Say which areas of Weaver are switched on or off for this community (Events, Giving, Bolis, the Store, Pathshala, Communications, Accounting, Niva and so on), " +
    "which cannot be switched off (core areas, or ones another area needs), who changed each one last and why. A switched-off area disappears from the portal and the member app. " +
    "It changes nothing; switching a module is a change that is always asked about first.",
  level: "read",
  permission: "centerSettings",
  input,
  async execute(ctx) {
    const { db, center } = ctx.session;
    const res = await db.rpc("module_states", { p_center: center.id });
    if (res.error) {
      if (isMissingObject(res.error)) {
        throw new CommandError("Module switches arrive with the next database update, which has not been applied yet. Until then every module is on and none can be switched off.");
      }
      throw new CommandDbError(res.error, "read the module switches");
    }
    const rows = buildModuleRowsFromStates(res.data ?? []);
    const offered = rows.filter((r) => r.availability !== "not_available");
    const names = await userNames(db, center.id, offered.map((r) => r.changedBy));
    const label = (key: string) => rows.find((r) => r.key === key)?.label ?? key;
    const modules = offered.map((r) => ({
      module: r.label,
      key: r.key,
      is_on: r.enabled,
      always_on: r.core,
      needs: r.dependsOn.map(label),
      cannot_switch_because: r.core ? "It is a core area and is always on." : switchBlocker(r.key, !r.enabled, rows),
      last_change: r.changedAt ? `${r.enabled ? "Switched on" : "Switched off"} ${formatDate(r.changedAt, center.time_zone)}${r.changedBy ? ` by ${names.get(r.changedBy)?.name ?? "a former user"}` : ""}` : null,
      reason: r.reason,
    }));
    const off = modules.filter((m) => !m.is_on);
    return {
      ok: true,
      data: {
        on: modules.length - off.length,
        off: off.length,
        modules,
        not_offered_to_this_kind_of_organization: rows.filter((r) => r.availability === "not_available").map((r) => r.label),
      },
      message: off.length === 0 ? `All ${modules.length} modules are switched on.` : `${modules.length - off.length} of ${modules.length} modules are on. Off: ${off.map((m) => m.module).join(", ")}.`,
    };
  },
});

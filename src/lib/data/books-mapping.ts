// Books › Account mapping (migration 0779): what each fund, role, fund class and bank account posts to, what waits for a
// second person, and the history; plus the QuickBooks lists the choices come from. Read with the person's own access
// (app.account_mapping_overview checks it again; RLS on the pulled lists). Asking and confirming are the actions in
// src/app/(app)/accounting/qbo/mapping/actions.ts.

import { parseMappingOverview, type MappingOverview, type PulledChoice } from "@/lib/books/mapping";
import { failure } from "@/lib/errors";
import type { Part } from "@/lib/giving-workspace/view";
import { isModuleEnabled } from "@/lib/modules";
import { untypedRpc } from "@/lib/payments/rpc";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export type AccountMappingIn = {
  overview: MappingOverview;
  /** The connected company's chart (choices are checked again by the database). */
  accounts: PulledChoice[];
  classes: PulledChoice[];
  /** The pulled lists could not be read: the page says so next to the forms, which then offer nothing to choose. */
  listsError: string | null;
};

export async function loadAccountMapping(session: CrmSession): Promise<Part<AccountMappingIn>> {
  if (!isModuleEnabled(session, "accounting")) return { state: "off" };
  if (!canAccess(session, "qboMapping")) return { state: "no_access" };
  const { db, center } = session;
  const res = await untypedRpc(db)("account_mapping_overview", { p_center: center.id });
  if (res.error) return { state: "error", error: failure("Could not read the account mapping", res.error).error };
  const parsed = parseMappingOverview(res.data);
  if (!parsed.ok) return { state: "error", error: failure("Could not read the account mapping", { message: parsed.error }).error };
  const conn = parsed.value.connection;
  if (!conn) return { state: "ok", data: { overview: parsed.value, accounts: [], classes: [], listsError: null } };
  const [accountsRes, classesRes] = await Promise.all([
    db.from("qbo_accounts").select("qbo_id, name, fully_qualified_name, account_type, active").eq("connection_id", conn.id),
    db.from("qbo_classes").select("qbo_id, name, active").eq("connection_id", conn.id).order("name"),
  ]);
  const listsFailed = accountsRes.error ?? classesRes.error;
  return {
    state: "ok",
    data: {
      overview: parsed.value,
      accounts: (accountsRes.data ?? []) as PulledChoice[],
      classes: (classesRes.data ?? []) as PulledChoice[],
      listsError: listsFailed ? failure("Could not read the QuickBooks lists", listsFailed).error : null,
    },
  };
}


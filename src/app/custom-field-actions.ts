"use server";

import { revalidatePath } from "next/cache";

import { asDef, readCustomInput } from "@/lib/custom-fields";
import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { loadSession } from "@/lib/session";

/**
 * Set one custom value in place ("More details"). The database decides who may
 * (set_custom_value runs as the caller: the table's RLS and the module switch
 * apply, and members never change custom details) and checks the type; the
 * change is audited like any other edit of the record.
 */
export async function setCustomValueAction(input: { entity: string; recordId: string; key: string; value: string; path?: string }): Promise<ActionResult<{ display: unknown }>> {
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: "Could not save the detail — your session has expired. Sign in again." };
  const { db, center } = state.session;
  if (!isUuid(input.recordId)) return { ok: false, error: "Could not save the detail — that record was not found." };
  const def = await db
    .from("custom_field_definitions")
    .select("id, entity, key, label, type, choices, sensitivity, searchable, source, source_import_run, status, sort")
    .eq("center_id", center.id)
    .eq("entity", input.entity)
    .eq("key", input.key)
    .maybeSingle();
  if (def.error) return failure("Could not save the detail", def.error);
  if (!def.data) return { ok: false, error: "Could not save the detail — that custom field no longer exists." };
  const d = asDef(def.data as Record<string, unknown>);
  if (d.status === "archived") return { ok: false, error: `Could not save ${d.label} — the field is archived. Restore it in Settings › Custom fields first.` };
  const read = readCustomInput(d, String(input.value ?? ""));
  if (!read.ok) return { ok: false, error: `Could not save the detail — ${read.error}` };
  const { error } = await db.rpc("set_custom_value", {
    p_entity: input.entity,
    p_record: input.recordId,
    p_key: d.key,
    p_value: (read.value ?? null) as Json,
  });
  if (error) return failure(`Could not save ${d.label}`, error);
  if (input.path && input.path.startsWith("/")) revalidatePath(input.path);
  return { ok: true, message: read.value === null ? `${d.label} cleared.` : `${d.label} saved.`, data: { display: read.value } };
}

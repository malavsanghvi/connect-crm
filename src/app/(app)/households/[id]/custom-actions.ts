"use server";

import { setCustomValueAction } from "@/app/custom-field-actions";
import { defineCustomFieldAction, updateCustomFieldAction } from "@/app/(app)/settings/custom-fields/actions";
import { asDef, customInputValue } from "@/lib/custom-fields";
import { loadCustomFieldDefs, loadCustomValues } from "@/lib/data/custom-fields";
import { userNames } from "@/lib/data/lookups";
import { failure, type ActionResult } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { checkNewField, fieldKeyOf, newFieldFormData, sameCustom, statusFormData, type NewFieldInput } from "@/lib/people-v2/custom-fields";
import { friendlySaveError, type SaveKind, type Values } from "@/lib/people-v2/inline-edit";
import { isUuid } from "@/lib/search-params";
import { loadSession, type CrmSession } from "@/lib/session";

import type { InlineSave } from "./inline-actions";

// Custom fields on the Family page and the person slide-over. Nothing here is a new write path: a value is saved by the SAME action the
// classic "More details" card uses (setCustomValueAction: the table's own row level security decides who may, the database checks the
// type, the change is audited with the record), a field is added and archived by the SAME actions the Settings screen uses
// (defineCustomFieldAction and updateCustomFieldAction, which need settings.manage). What is added here is only the conflict check.
//
// The value action has no "expect" input, so the conflict check reads the current value first and compares it with the value the person
// saw: if someone else changed it in between, nothing is written and the screen offers "Use theirs" or "Keep mine". There is a small
// window between that read and the write (the plan accepts it: PEOPLE_NOTES_AND_FIELDS.md section 1.2, "Commands"). It changes no
// permission and no audit rule.

const ENTITIES = ["people", "households"] as const;
type Entity = (typeof ENTITIES)[number];

export type SaveCustomInput = {
  entity: Entity;
  recordId: string;
  /** The field's key (without the "cf:" the edit machinery adds). */
  key: string;
  /** The new value as typed text ("" clears it), and the value the person saw. */
  value: string;
  expect: string;
  /** How the thing is called in sentences: "Samira's Shirt size". */
  label: string;
  /** The page to refresh after the save, so an Undo and the page agree. */
  path?: string;
};

function shapeProblem(i: SaveCustomInput): string | null {
  if (!i || typeof i !== "object") return "the request was not understood";
  if (!(ENTITIES as readonly string[]).includes(i.entity)) return "that kind of record has no custom fields here";
  if (typeof i.key !== "string" || !/^[a-z][a-z0-9_]{0,62}$/.test(i.key)) return "that is not a custom field";
  if (typeof i.value !== "string" || i.value.length > 2000 || typeof i.expect !== "string" || i.expect.length > 2000) return "a value is too long";
  if (typeof i.label !== "string" || i.label.length > 200) return "the request was not understood";
  return null;
}

async function currentSession(): Promise<CrmSession | null> {
  const state = await loadSession();
  return state.status === "ok" ? state.session : null;
}

/** Who last changed this value and when, from the audit log (only for someone who may read it). Best effort: a failure is logged. */
async function lastChange(s: CrmSession, entity: Entity, recordId: string, key: string): Promise<{ who: string | null; at: string | null }> {
  if (!can(s, "audit.view")) return { who: null, at: null };
  try {
    const select = "occurred_at, actor_user_id, before, after";
    const [own, staff] = await Promise.all([
      s.db.from("audit_log").select(select).eq("center_id", s.center.id).eq("record_table", entity).eq("record_id", recordId).order("occurred_at", { ascending: false }).limit(10),
      s.db.from("audit_log").select(select).eq("center_id", s.center.id).eq("record_table", "custom_staff_values").filter("after->>record_key", "eq", recordId).order("occurred_at", { ascending: false }).limit(10),
    ]);
    if (own.error) throw own.error;
    if (staff.error) throw staff.error;
    const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    const valueOf = (v: unknown) => JSON.stringify(asObj(asObj(v).custom)[key] ?? null);
    const rows = [...(own.data ?? []), ...(staff.data ?? [])].sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    const row = rows.find((r) => valueOf(r.after) !== valueOf(r.before));
    if (!row) return { who: null, at: null };
    const names = await userNames(s.db, s.center.id, [row.actor_user_id]);
    const full = row.actor_user_id ? names.get(row.actor_user_id)?.name : undefined;
    return { who: full ? full.split(" ")[0] : null, at: row.occurred_at };
  } catch (error) {
    console.error("[custom fields] could not read who changed it; the conflict line says someone:", error);
    return { who: null, at: null };
  }
}

const fail = (error: string, kind: SaveKind = "other"): InlineSave => ({ ok: false, error, kind });

/**
 * Save one custom value. Reads the current value first (the conflict check), then writes through setCustomValueAction, which is what the
 * "More details" card calls: so the type check, the permission and the audit are the ones that already exist.
 */
export async function saveCustomValueAction(input: SaveCustomInput): Promise<InlineSave> {
  const label = typeof input?.label === "string" && input.label ? input.label.slice(0, 200) : "that detail";
  const bad = shapeProblem(input);
  if (bad) return fail(`Could not save ${label} — ${bad}.`);
  if (!isUuid(input.recordId)) return fail(`Could not save ${label} — that record was not found.`);
  const s = await currentSession();
  if (!s) return fail(`Could not save ${label} — your session has expired. Sign in again.`);

  const defs = await loadCustomFieldDefs(s.db, s.center.id, input.entity, true);
  if (defs.error) return { ...failure(`Could not save ${label}`, defs.error), kind: "other" };
  const def = defs.defs.find((d) => d.key === input.key);
  if (!def) return fail(`Could not save ${label} — that custom field no longer exists.`);
  if (def.status === "archived") return fail(`Could not save ${label} — the field is archived. Restore it first.`);

  const current = await loadCustomValues(s.db, input.entity, input.recordId);
  if (current.error) return { ...failure(`Could not save ${label}`, current.error), kind: "other" };
  const now = customInputValue(def, current.custom?.[def.key]);

  if (sameCustom(def, now, input.value)) return { ok: true, message: "No changes to save.", changed: false };
  if (!sameCustom(def, now, input.expect)) {
    const when = await lastChange(s, input.entity, input.recordId, def.key);
    return {
      ok: false,
      kind: "conflict",
      error: `Could not save — someone else changed this first (${def.label}). Nothing was saved: look at the new value and choose which to keep.`,
      conflict: { theirs: { [fieldKeyOf(def.key)]: now } as Values, who: when.who, at: when.at },
    };
  }

  const path = typeof input.path === "string" && input.path.startsWith("/") ? input.path : undefined;
  const res = await setCustomValueAction({ entity: input.entity, recordId: input.recordId, key: def.key, value: input.value, path });
  if (res.ok) return { ok: true, message: res.message ?? "Saved.", changed: true };
  const error = res.error.replace(/^Could not save the detail — /, `Could not save ${label} — `);
  const friendly = friendlySaveError(error, label);
  return { ok: false, error: friendly.message, kind: friendly.kind, ...(res.stepUp ? { stepUp: true } : {}) };
}

// ---------------------------------------------------------------------------
// Add, archive, restore (the Settings screen's own actions)
// ---------------------------------------------------------------------------
export type AddFieldCall = Omit<NewFieldInput, "choicesText"> & { choices: string[] };
export type AddFieldSave = { ok: true; message: string; /** The new field's id, so the toast can offer Undo (which archives it). Null when it could not be read back. */ id: string | null } | { ok: false; error: string; stepUp?: boolean };

/**
 * Add a field through defineCustomFieldAction, the Settings screen's action (it needs settings.manage and says so in words when the
 * person has not got it). The name is checked again here, and the new field's id is read back so the Undo can archive it.
 */
export async function addCustomFieldAction(input: AddFieldCall): Promise<AddFieldSave> {
  if (!input || typeof input !== "object" || !(ENTITIES as readonly string[]).includes(input.entity))
    return { ok: false, error: "Could not add the custom field — that kind of record has no custom fields here." };
  const s = await currentSession();
  if (!s) return { ok: false, error: "Could not add the custom field — your session has expired. Sign in again." };

  const existing = await loadCustomFieldDefs(s.db, s.center.id, input.entity, true);
  if (existing.error) return failure("Could not add the custom field", existing.error);
  const checked = checkNewField({ ...input, choicesText: (input.choices ?? []).join(", ") }, existing.defs.map((d) => ({ label: d.label, archived: d.status === "archived" })));
  if (!checked.ok) return { ok: false, error: `Could not add the custom field — ${checked.error[0].toLowerCase()}${checked.error.slice(1)}` };

  const res = await defineCustomFieldAction(null, newFieldFormData({ ...input, choicesText: "" }, checked.label, checked.choices));
  if (!res.ok) return res;

  let id: string | null = null;
  try {
    const read = await s.db
      .from("custom_field_definitions")
      .select("id, entity, key, label, type, choices, sensitivity, searchable, source, source_import_run, status, sort")
      .eq("center_id", s.center.id)
      .eq("entity", input.entity)
      .eq("label", checked.label)
      .order("sort", { ascending: false })
      .limit(1);
    if (read.error) throw read.error;
    id = read.data?.[0] ? asDef(read.data[0] as Record<string, unknown>).id : null;
  } catch (error) {
    console.error("[custom fields] the field was added but could not be read back, so Undo is not offered:", error);
  }
  return { ok: true, message: res.message ?? `${checked.label} added.`, id };
}

/** Archive a field (it keeps every value and takes no new ones) or restore it, through the Settings screen's own save action. */
export async function setCustomFieldStatusAction(input: { id: string; status: "active" | "archived" }): Promise<ActionResult> {
  if (!input || !isUuid(input.id) || (input.status !== "active" && input.status !== "archived")) return { ok: false, error: "Could not change the custom field — it was not found." };
  const s = await currentSession();
  if (!s) return { ok: false, error: "Could not change the custom field — your session has expired. Sign in again." };
  const read = await s.db
    .from("custom_field_definitions")
    .select("id, entity, key, label, type, choices, sensitivity, searchable, source, source_import_run, status, sort")
    .eq("center_id", s.center.id)
    .eq("id", input.id)
    .maybeSingle();
  if (read.error) return failure("Could not change the custom field", read.error);
  if (!read.data) return { ok: false, error: "Could not change the custom field — it was not found." };
  return updateCustomFieldAction(null, statusFormData(asDef(read.data as Record<string, unknown>), input.status));
}

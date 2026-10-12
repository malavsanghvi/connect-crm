"use server";

import { withActivity } from "@/lib/activity/with-activity";
import { runScreenCommand } from "@/lib/commands/screen";
import { userNames } from "@/lib/data/lookups";
import { can } from "@/lib/permissions";
import { HOUSEHOLD_EDITABLE, PERSON_EDITABLE, REASON_MAX, expectText, friendlySaveError, type SaveKind, type Values } from "@/lib/people-v2/inline-edit";
import { householdValues, personValues } from "@/lib/people-v2/family-model";
import { isUuid } from "@/lib/search-params";
import { loadSession, type CrmSession } from "@/lib/session";

// Click-to-edit on the Family page and the person slide-over: one Server Action for a person's details and one for the household's.
// Both are thin: they check the shape of what came from the browser, then run the SAME commands the screens, the palette and Niva
// share (people.update_person, people.update_household) through runScreenCommand, so the permission, the audit trail, the
// activity key and every rule are the ones that already exist. What they add is `expect` (the value the person saw) and `reason`.

export type InlineConflict = { theirs: Values; who: string | null; at: string | null };

export type InlineSave =
  | { ok: true; message: string; /** False when the value was already what the person asked for (nothing was written). */ changed: boolean }
  | { ok: false; error: string; kind: SaveKind; stepUp?: boolean; conflict?: InlineConflict };

type Common = {
  /** The new values, by the command's field names. */
  fields: Record<string, string>;
  /** The values the person saw for those fields (the page's last confirmed ones). */
  expect: Record<string, string>;
  reason?: string | null;
  /** How the thing is called in sentences: "Tunde's mobile". */
  label: string;
};

const NO_CHANGE = "No changes to save.";

function shapeProblem(c: Common, allowed: readonly string[]): string | null {
  if (!c || typeof c !== "object") return "the request was not understood";
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  if (!text(c.label, 120)) return "the request was not understood";
  if (c.reason !== undefined && c.reason !== null && !text(c.reason, 2000)) return "the reason is too long";
  for (const [name, bag] of [
    ["fields", c.fields],
    ["expect", c.expect],
  ] as const) {
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) return "the request was not understood";
    for (const [k, v] of Object.entries(bag)) {
      if (!allowed.includes(k)) return `${name === "fields" ? "that detail" : "the value you saw"} (${k}) cannot be changed here`;
      if (!text(v, 2000)) return "a value is too long";
    }
  }
  if (Object.keys(c.fields).length === 0) return "there was nothing to change";
  return null;
}

async function finish(
  result: Awaited<ReturnType<typeof runScreenCommand>>,
  c: Common,
  conflictFor: (keys: string[]) => Promise<InlineConflict | null>,
): Promise<InlineSave> {
  if (result.ok) return { ok: true, message: result.message ?? "", changed: result.message !== NO_CHANGE };
  const friendly = friendlySaveError(result.error, c.label);
  if (friendly.kind === "conflict") {
    const conflict = await conflictFor(Object.keys(c.fields));
    return { ok: false, error: friendly.message, kind: "conflict", ...(conflict ? { conflict } : {}) };
  }
  return { ok: false, error: friendly.message, kind: friendly.kind, ...(result.stepUp ? { stepUp: true } : {}) };
}

/** Change one person's details. `householdId` is the household the page is about (a relationship change is made in it). */
export async function savePersonFieldsAction(input: Common & { personId: string; householdId: string }): Promise<InlineSave> {
  const bad = shapeProblem(input, PERSON_EDITABLE);
  if (bad) return { ok: false, error: `Could not save ${input?.label ?? "that"} — ${bad}.`, kind: "other" };
  if (!isUuid(input.personId) || !isUuid(input.householdId))
    return { ok: false, error: `Could not save ${input.label} — the person or household was not found.`, kind: "other" };
  const reason = (input.reason ?? "").trim().slice(0, REASON_MAX);
  const raw: Record<string, string> = {
    id: input.personId,
    ...input.fields,
    ...("role" in input.fields ? { household_id: input.householdId } : {}),
    expect: expectText(input.expect),
    ...(reason ? { reason } : {}),
  };
  const result = await withActivity("people.update_person", () => runScreenCommand("people.update_person", raw, `save ${input.label}`), {
    entityFrom: { kind: "person", id: input.personId },
  });
  return finish(result, input, (keys) => personConflict(input.personId, input.householdId, keys));
}

/** Change the household's name, address, notes or preferences. */
export async function saveHouseholdFieldsAction(input: Common & { householdId: string }): Promise<InlineSave> {
  const bad = shapeProblem(input, HOUSEHOLD_EDITABLE);
  if (bad) return { ok: false, error: `Could not save ${input?.label ?? "that"} — ${bad}.`, kind: "other" };
  if (!isUuid(input.householdId)) return { ok: false, error: `Could not save ${input.label} — the household was not found.`, kind: "other" };
  const reason = (input.reason ?? "").trim().slice(0, REASON_MAX);
  const raw: Record<string, string> = { id: input.householdId, ...input.fields, expect: expectText(input.expect), ...(reason ? { reason } : {}) };
  const result = await withActivity("people.update_household", () => runScreenCommand("people.update_household", raw, `save ${input.label}`), {
    entityFrom: { kind: "household", id: input.householdId },
  });
  return finish(result, input, (keys) => householdConflict(input.householdId, keys));
}

// ---------------------------------------------------------------------------
// What the other person did (for the conflict line). Best effort: a failure here is logged and the screen says "Someone changed this".
// ---------------------------------------------------------------------------
async function session(): Promise<CrmSession | null> {
  const state = await loadSession();
  return state.status === "ok" ? state.session : null;
}

/** Who last changed any of these columns and when, from the audit log (only for someone who may read it). */
async function lastChange(s: CrmSession, table: string, recordId: string, keys: string[]): Promise<{ who: string | null; at: string | null }> {
  if (!can(s, "audit.view")) return { who: null, at: null };
  try {
    const res = await s.db
      .from("audit_log")
      .select("occurred_at, actor_user_id, before, after")
      .eq("center_id", s.center.id)
      .eq("record_table", table)
      .eq("record_id", recordId)
      .order("occurred_at", { ascending: false })
      .limit(10);
    if (res.error) throw res.error;
    const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
    const row = (res.data ?? []).find((r) => keys.some((k) => JSON.stringify(asObj(r.after)[k] ?? null) !== JSON.stringify(asObj(r.before)[k] ?? null)));
    if (!row) return { who: null, at: null };
    const names = await userNames(s.db, s.center.id, [row.actor_user_id]);
    const full = row.actor_user_id ? names.get(row.actor_user_id)?.name : undefined;
    return { who: full ? full.split(" ")[0] : null, at: row.occurred_at };
  } catch (error) {
    console.error("[family] could not read who changed it; the conflict line says someone:", error);
    return { who: null, at: null };
  }
}

async function personConflict(personId: string, householdId: string, keys: string[]): Promise<InlineConflict | null> {
  const s = await session();
  if (!s) return null;
  try {
    const [p, link] = await Promise.all([
      s.db
        .from("people")
        .select("first_name, last_name, date_of_birth, gender, profession, employer, phone_e164, email, language")
        .eq("id", personId)
        .eq("center_id", s.center.id)
        .maybeSingle(),
      keys.includes("role")
        ? s.db.from("household_members").select("role").eq("household_id", householdId).eq("person_id", personId).is("left_at", null).maybeSingle()
        : null,
    ]);
    if (p.error || !p.data) throw p.error ?? new Error("the person was not found");
    const all = personValues(p.data, link?.data?.role ?? "");
    const theirs: Values = Object.fromEntries(keys.map((k) => [k, all[k] ?? ""]));
    return { theirs, ...(await lastChange(s, "people", personId, keys)) };
  } catch (error) {
    console.error("[family] could not read the new value for the conflict panel:", error);
    return null;
  }
}

async function householdConflict(householdId: string, keys: string[]): Promise<InlineConflict | null> {
  const s = await session();
  if (!s) return null;
  try {
    const h = await s.db
      .from("households")
      .select("display_name, address_line1, address_line2, city, state_region, postal_code, zone_id, directory_opt_in, physical_mail_opt_in, notes")
      .eq("id", householdId)
      .eq("center_id", s.center.id)
      .maybeSingle();
    if (h.error || !h.data) throw h.error ?? new Error("the household was not found");
    const all = householdValues(h.data);
    const theirs: Values = Object.fromEntries(keys.map((k) => [k, all[k] ?? ""]));
    return { theirs, ...(await lastChange(s, "households", householdId, keys)) };
  } catch (error) {
    console.error("[family] could not read the new value for the conflict panel:", error);
    return null;
  }
}

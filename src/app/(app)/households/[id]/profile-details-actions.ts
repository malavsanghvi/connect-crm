"use server";

import { withActivity } from "@/lib/activity/with-activity";
import { revalidateAfterCommand } from "@/lib/commands/revalidate";
import type { Json } from "@/lib/database.types";
import { userNames } from "@/lib/data/lookups";
import { failure } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { conflictSentence, friendlySaveError, type Values } from "@/lib/people-v2/inline-edit";
import { GROUP_FIELDS, encodePatch, groupOf, nothingToChange, profileConflictKeys, profileShapeProblem, rowValues, type ProfileRow } from "@/lib/people-v2/profile-details";
import { isUuid } from "@/lib/search-params";
import { loadSession, type CrmSession } from "@/lib/session";

import type { InlineSave } from "./inline-actions";

// Staff change what a member gave about themselves (wedding anniversary, dietary needs, emergency contact) from the person slide-over.
// One thin Server Action: it checks the shape of what came from the browser, reads the current row (the conflict check), and calls the
// database function app.staff_save_profile_details AS THE SIGNED-IN PERSON (their own session, never a service key), so the database's
// check (people.manage in this community, the People module on, the allowed keys, the existing check trigger, the audit entry with its
// reason) is the real gate and this only reports it in plain words. The check against people.manage here is a convenience.
//
// These details are private. There is deliberately no command for them: they are not offered to the palette or to Niva, and nothing
// here, about an adult or a child, goes anywhere but the database.
//
// The function has no "expect" input, so the conflict check reads the current row first and compares it with the value the person saw:
// if someone else changed it in between, nothing is written and the screen offers "Use theirs" or "Keep mine". A small window remains
// between that read and the write, as for custom values (docs/PEOPLE_NOTES_AND_FIELDS.md section 1.2); it changes no permission.

export type SaveProfileDetailsInput = {
  personId: string;
  /** The new values, by the database's field names ("" clears; the dietary choices as "key,key"). */
  fields: Values;
  /** The values the person saw for those fields. */
  expect: Values;
  reason?: string | null;
  /** How the thing is called in sentences: "Samira's dietary needs". */
  label: string;
};

const COLUMNS = "anniversary, dietary, dietary_other, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone";

const fail = (error: string, kind: Extract<InlineSave, { ok: false }>["kind"] = "other"): InlineSave => ({ ok: false, error, kind });

async function currentSession(): Promise<CrmSession | null> {
  const state = await loadSession();
  return state.status === "ok" ? state.session : null;
}

/** Who last changed this person's details and when, from the audit log (only for someone who may read it). Best effort: a failure is logged. */
async function lastChange(s: CrmSession, personId: string): Promise<{ who: string | null; at: string | null }> {
  if (!can(s, "audit.view")) return { who: null, at: null };
  try {
    const res = await s.db
      .from("audit_log")
      .select("occurred_at, actor_user_id")
      .eq("center_id", s.center.id)
      .eq("record_table", "person_profile_details")
      .eq("record_id", personId)
      .order("occurred_at", { ascending: false })
      .limit(1);
    if (res.error) throw res.error;
    const row = res.data?.[0];
    if (!row) return { who: null, at: null };
    const names = await userNames(s.db, s.center.id, [row.actor_user_id]);
    const full = row.actor_user_id ? names.get(row.actor_user_id)?.name : undefined;
    return { who: full ? full.split(" ")[0] : null, at: row.occurred_at };
  } catch (error) {
    console.error("[profile details] could not read who changed it; the conflict line says someone:", error);
    return { who: null, at: null };
  }
}

async function save(input: SaveProfileDetailsInput): Promise<InlineSave> {
  const label = typeof input?.label === "string" && input.label ? input.label.slice(0, 120) : "that detail";
  const bad = profileShapeProblem(input);
  if (bad) return fail(`Could not save ${label} — ${bad}.`);
  if (!isUuid(input.personId)) return fail(`Could not save ${label} — that person was not found.`);
  const s = await currentSession();
  if (!s) return fail(`Could not save ${label} — your session has expired. Sign in again.`);
  if (!can(s, "people.manage")) {
    const f = friendlySaveError(`Could not save ${label} — you don't have permission (needs people.manage).`, label);
    return fail(f.message, f.kind);
  }

  // The conflict check: what is there now, against what the person saw.
  const read = await s.db.from("person_profile_details").select(COLUMNS).eq("person_id", input.personId).maybeSingle();
  if (read.error) return { ...failure(`Could not save ${label}`, read.error), kind: "other" };
  const current = rowValues(read.data as ProfileRow | null);
  const keys = Object.keys(input.fields);

  // Already what was asked for (whoever made it so): nothing to write, and nothing to argue about.
  if (nothingToChange(input.fields, current)) return { ok: true, message: "No changes to save.", changed: false };

  const conflicting = profileConflictKeys(input.expect, current, keys);
  if (conflicting.length > 0) {
    // The whole group is shown again, so "Use theirs" brings in every field of it.
    const groupKeys = new Set<string>(
      keys.flatMap((k): readonly string[] => {
        const g = groupOf(k);
        return g ? GROUP_FIELDS[g] : [k];
      }),
    );
    const theirs: Values = Object.fromEntries([...groupKeys].map((k) => [k, current[k] ?? ""]));
    const when = await lastChange(s, input.personId);
    return { ok: false, kind: "conflict", error: conflictSentence(conflicting), conflict: { theirs, who: when.who, at: when.at } };
  }
  const reason = (input.reason ?? "").trim().slice(0, 500);
  const res = await s.db.rpc("staff_save_profile_details", {
    p_person: input.personId,
    p_patch: encodePatch(input.fields) as Json,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (res.error) {
    // Technical detail is logged by failure(); the screen gets a sentence. A refusal for permission reads as "You don't have access".
    const f = failure(`Could not save ${label}`, res.error);
    const friendly = friendlySaveError(f.error, label);
    return { ok: false, error: friendly.message, kind: friendly.kind, ...(f.stepUp ? { stepUp: true } : {}) };
  }
  revalidateAfterCommand(["/people", "/households", "/", `/people/${input.personId}`]);
  return { ok: true, message: "Saved", changed: true };
}

/** Change a person's anniversary, dietary needs or emergency contact. Recorded in the activity stream under people.save_profile_details. */
export async function saveProfileDetailsAction(input: SaveProfileDetailsInput): Promise<InlineSave> {
  return withActivity("people.save_profile_details", () => save(input), {
    entityFrom: { kind: "person", id: typeof input?.personId === "string" ? input.personId : null },
  });
}

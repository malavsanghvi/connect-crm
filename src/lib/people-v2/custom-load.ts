import "server-only";

import type { CustomFieldDef } from "@/lib/custom-fields";
import { loadCustomFieldDefs, loadCustomMap } from "@/lib/data/custom-fields";
import { explainError } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

import { customAccess, type CustomFieldsPayload, type DefGroup } from "./custom-fields";

// Reads what the Family page and the person slide-over need to draw custom fields: the definitions of people and households (and, for
// the people who may manage fields, the archived ones too), and the values of the people on the page and of the household. Everything
// is read as the signed-in person (the database's security decides what comes back; the staff-only values are read through
// app.custom_values, which only staff who may read that kind of record can see). Nothing here writes. A read that fails is said in
// words by the group, never shown as "no fields" or as empty values.
//
// D2: this payload is for the page only. It is never put in the family model, never given to the assistant and never sent to a
// provider; a child's values are in it because authorised staff see them in the slide-over.

const EMPTY: DefGroup = { active: [], archived: [] };

function group(defs: CustomFieldDef[]): DefGroup {
  return { active: defs.filter((d) => d.status === "active"), archived: defs.filter((d) => d.status === "archived") };
}

/** A person's id list and the household's id: pass what is on the page. A person in no family passes householdId null. Never throws: a read that fails is an "error" payload. */
export async function loadCustomFields(session: CrmSession, o: { personIds: readonly string[]; householdId: string | null; canEdit: boolean }): Promise<CustomFieldsPayload> {
  try {
    return await read(session, o);
  } catch (error) {
    console.error("[custom fields] could not read the custom fields:", error);
    return { state: "error", message: `Could not load the custom fields: ${explainError(error)}.` };
  }
}

async function read(session: CrmSession, o: { personIds: readonly string[]; householdId: string | null; canEdit: boolean }): Promise<CustomFieldsPayload> {
  const { db, center } = session;
  const access = customAccess(session, { canEdit: o.canEdit });
  if (!access.canRead) return { state: "no-access" };

  const [people, households] = await Promise.all([
    loadCustomFieldDefs(db, center.id, "people", access.canDefine),
    loadCustomFieldDefs(db, center.id, "households", access.canDefine),
  ]);
  const failed = people.error ?? households.error;
  if (failed) return { state: "error", message: `Could not load the custom fields: ${explainError(failed)}.` };

  const peopleGroup = people.missing ? EMPTY : group(people.defs);
  const householdGroup = households.missing ? EMPTY : group(households.defs);

  const values: Record<string, Record<string, unknown>> = {};
  const [peopleValues, householdValues] = await Promise.all([
    peopleGroup.active.length > 0 && o.personIds.length > 0 ? loadCustomMap(db, "people", [...o.personIds]) : null,
    householdGroup.active.length > 0 && o.householdId ? loadCustomMap(db, "households", [o.householdId]) : null,
  ]);
  for (const r of [peopleValues, householdValues]) {
    if (!r) continue;
    if (r.error) return { state: "error", message: `Could not load the custom details: ${explainError(r.error)}.` };
    for (const [id, custom] of r.map) values[id] = custom;
  }

  return {
    state: "ok",
    currency: center.currency,
    community: center.name,
    kind: { key: session.kind.key, label: session.kind.label, faithBased: session.kind.faithBased },
    access: { canEdit: access.canEdit, canDefine: access.canDefine },
    people: peopleGroup,
    households: householdGroup,
    values,
    settingsHref: access.canDefine ? "/settings/custom-fields" : null,
  };
}

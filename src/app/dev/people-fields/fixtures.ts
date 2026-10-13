// DEV ONLY. The community's custom fields and their values, invented for the preview of custom fields on the Family page and the person
// slide-over (a neutral community hall in Riverside; names and field labels in several scripts). Nothing here is real.

import { asDef, type CustomFieldDef } from "@/lib/custom-fields";
import type { CustomFieldsPayload, OkPayload } from "@/lib/people-v2/custom-fields";
import type { FamilyModel } from "@/lib/people-v2/family-model";

export type FieldsState = "default" | "empty" | "view" | "ask" | "no-access" | "error";

const id = (n: number) => `9c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function def(n: number, over: Partial<CustomFieldDef> & { entity: string; key: string; label: string }): CustomFieldDef {
  return asDef({ id: id(n), type: "text", choices: [], sensitivity: "staff", searchable: false, source: "manual", source_import_run: null, status: "active", sort: n, ...over });
}

const PEOPLE_DEFS = [
  def(1, { entity: "people", key: "shirt_size", label: "Shirt size", type: "choice", choices: ["S", "M", "L", "XL"] }),
  def(2, { entity: "people", key: "volunteer_skills", label: "Volunteer skills", searchable: true }),
  def(3, { entity: "people", key: "anniversary", label: "Anniversary", type: "date", sensitivity: "member_self" }),
  def(4, { entity: "people", key: "newsletter", label: "Newsletter", type: "boolean", sensitivity: "directory" }),
  def(5, { entity: "people", key: "dues_paid", label: "Dues paid", type: "money" }),
];

/** A field with a name in Japanese, for the family whose names are in Japanese and Arabic. */
const JAPANESE_FIELD = def(6, { entity: "people", key: "skills_ja", label: "ボランティアの技能", searchable: true });

const HOUSEHOLD_DEFS = [
  def(11, { entity: "households", key: "hometown", label: "Hometown", sensitivity: "directory" }),
  def(12, { entity: "households", key: "contact_time", label: "Preferred contact time", type: "choice", choices: ["Morning", "Afternoon", "Evening"] }),
];

const ARCHIVED = [def(21, { entity: "people", key: "old_badge", label: "Old badge number", status: "archived" })];

const SIZES = ["M", "L", "S", "XL"];

/** The values of every person and of the household, by id: the first adult has most of them, the others a few, one value is empty. */
function valuesFor(model: FamilyModel): OkPayload["values"] {
  const out: OkPayload["values"] = {};
  const japanese = model.id === "hh-tanaka";
  [...model.adults, ...model.children].forEach((p, i) => {
    out[p.id] = {
      shirt_size: SIZES[i % SIZES.length],
      ...(i === 0 ? { volunteer_skills: "Catering, first aid", anniversary: "2012-06-02", newsletter: true, dues_paid: 2500 } : {}),
      ...(i === 1 ? { volunteer_skills: japanese ? "" : "Driving", anniversary: "2012-06-02" } : {}),
      ...(japanese && i === 0 ? { skills_ja: "料理, 応急手当" } : {}),
    };
  });
  out[model.id] = { hometown: japanese ? "大阪" : "Beirut", contact_time: "Evening" };
  return out;
}

export function fieldsFixture(state: FieldsState, model: FamilyModel): CustomFieldsPayload {
  if (state === "no-access") return { state: "no-access" };
  if (state === "error") return { state: "error", message: "Could not load the custom fields: the database did not answer." };
  const empty = state === "empty";
  const people = [...PEOPLE_DEFS, ...(model.id === "hh-tanaka" ? [JAPANESE_FIELD] : [])];
  const canDefine = state === "default" || state === "empty";
  return {
    state: "ok",
    currency: "USD",
    community: "Riverside Community",
    kind: { key: "nonprofit_secular", label: "Community organization", faithBased: false },
    access: { canEdit: state !== "view", canDefine },
    people: { active: empty ? [] : people, archived: canDefine && !empty ? ARCHIVED : [] },
    households: { active: empty ? [] : HOUSEHOLD_DEFS, archived: [] },
    values: empty ? {} : valuesFor(model),
    settingsHref: canDefine ? "/dev/people-fields" : null,
  };
}

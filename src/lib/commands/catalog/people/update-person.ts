import {
  FIELD_LABELS,
  PERSON_FIELDS,
  RELATIONSHIP_OPTIONS,
  changedKeys,
  genderValue,
  isHouseholdRole,
  listPhrase,
  parseDateInput,
  parsePersonForm,
  type HouseholdRole,
  type PersonProfile,
} from "@/lib/people";
import { loadCommunityLocale } from "@/lib/community-locale";
import { ageOn } from "@/lib/dates";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { CHILD_RECORDS_ON_SCREEN, cardsFor, dbFail, loadPersonBrief, refuseChildForAssistant, relationshipWords, today } from "./shared";

const ROLES = RELATIONSHIP_OPTIONS.map((o) => o.value) as ["spouse", ...string[]];
const text = (what: string) => f.optional(f.string(what, { min: 0, max: 1000 }));

const input = object({
  id: f.uuid("The person to change (their id, from people.find_household or people.household_summary)."),
  first_name: text("New first name."),
  last_name: text("New last name."),
  date_of_birth: text("New date of birth, MM/DD/YYYY or YYYY-MM-DD. Empty clears it."),
  gender: text("Female, Male or Prefer not to say. Empty clears it."),
  profession: text("Profession. Empty clears it."),
  employer: text("Employer (for matching gifts). Empty clears it."),
  phone_e164: text("Mobile number with area code. Empty clears it."),
  email: text("Email address. Empty clears it."),
  language: text("One of the community's languages, as its code (en, es, gu, pt-BR ...) or its name (Spanish)."),
  photo_opt_in: text("Screen only: the person's own photo consent. Niva does not change it."),
  new_member_contact_opt_in: text("Screen only: open to new members. Niva does not change it."),
  expertise_opt_in: text("Screen only: expertise listing. Niva does not change it."),
  expertise_headline: text("Screen only: expertise headline. Niva does not change it."),
  household_id: f.optional(f.uuid("With role: the household this person's relationship is changed in.")),
  role: f.optional(f.enum("A new relationship to that household (never primary). Needs household_id.", ROLES)),
});
export type UpdatePersonInput = Infer<typeof input>;

/** The privacy choices a person makes for themselves: Niva never sets them. */
const PRIVACY_FIELDS = ["photo_opt_in", "new_member_contact_opt_in", "expertise_opt_in", "expertise_headline"] as const;

type Plan = {
  id: string;
  first: string;
  original: PersonProfile;
  changes: Partial<PersonProfile>;
  keys: (keyof PersonProfile)[];
  household: string | null;
  role: HouseholdRole | null;
  roleChanged: boolean;
};

async function plan(ctx: CommandContext, inp: UpdatePersonInput): Promise<Plan> {
  const { db, center } = ctx.session;
  const id = inp.id;
  const current = await db
    .from("people")
    .select(
      "first_name, last_name, date_of_birth, gender, profession, employer, phone_e164, email, language, photo_opt_in, new_member_contact_opt_in, expertise_opt_in, expertise_headline, merged_into_id",
    )
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (current.error) throw new CommandDbError(current.error, "save the profile");
  if (!current.data) throw new CommandError("Could not save the profile — the person was not found, or you can't see them.");
  if (current.data.merged_into_id) throw new CommandError("Could not save the profile — this record was merged into another one. Edit that one instead.");

  const raw: Record<string, string | undefined> = {};
  const given = inp as unknown as Record<string, unknown>;
  for (const k of PERSON_FIELDS) if (typeof given[k] === "string") raw[k] = given[k] as string;

  if (ctx.via === "assistant") {
    // D2: no child's record goes in or out, and the person's own privacy choices are theirs.
    const brief = await loadPersonBrief(ctx, id);
    if (brief) refuseChildForAssistant(ctx, brief);
    if (PRIVACY_FIELDS.some((k) => raw[k] !== undefined)) throw new CommandError("Photo, directory and expertise choices are the person's own to make. They can change them in the app, or you can change them on the People screen.");
    // A new birth date that makes an adult a child is a child's record too (the form accepts MM/DD/YYYY or YYYY-MM-DD).
    const dob = parseDateInput(raw.date_of_birth ?? "");
    const age = dob.ok && dob.value ? ageOn(dob.value, today(ctx)) : null;
    if (age !== null && age < 18) throw new CommandError(CHILD_RECORDS_ON_SCREEN);
  }

  // A new language must be one the community uses (Setup > Profile), or the one the person already has. If the community's list cannot be
  // read just now, any language code is taken rather than refusing a harmless change.
  let languages: string[] | undefined;
  if (raw.language !== undefined) {
    const community = await loadCommunityLocale(db, center);
    languages = community.known ? [...community.languages, (current.data as { language?: string }).language ?? "en"] : undefined;
  }
  const parsed = parsePersonForm(raw, today(ctx), languages);
  if (!parsed.ok) throw new CommandError(`Could not save the profile — ${parsed.error}.`);
  const original = { ...(current.data as unknown as PersonProfile) };
  // Legacy values the form shows normalised ("F" → Female, mixed-case email) are not changes.
  original.gender = genderValue(original.gender) || original.gender;
  if (parsed.value.gender === null && !genderValue(original.gender)) delete parsed.value.gender;
  if (parsed.value.email && original.email && parsed.value.email === original.email.toLowerCase()) delete parsed.value.email;
  const keys = changedKeys(original, parsed.value);

  // Relationship in the household the drawer was opened from.
  const household = inp.household_id ?? null;
  const role = inp.role ?? "";
  let roleChanged = false;
  if (household && role) {
    if (!isHouseholdRole(role) || role === "primary") throw new CommandError("Could not save the profile — choose a relationship from the list.");
    const link = await db.from("household_members").select("role, is_primary").eq("household_id", household).eq("person_id", id).is("left_at", null).maybeSingle();
    if (link.error) throw new CommandDbError(link.error, "save the relationship");
    roleChanged = Boolean(link.data && !link.data.is_primary && link.data.role !== role);
  }
  const first = parsed.value.first_name ?? original.first_name;
  const changes: Partial<PersonProfile> = {};
  for (const k of keys) (changes as Record<string, unknown>)[k] = parsed.value[k];
  return { id, first, original, changes, keys, household, role: roleChanged && isHouseholdRole(role) ? role : null, roleChanged };
}

const shown = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : typeof v === "boolean" ? (v ? "yes" : "no") : String(v));

export const updatePerson = defineCommand<UpdatePersonInput, undefined>({
  key: "people.update_person",
  title: "Update a person's details",
  description:
    "Change an adult's profile: name, birth date, gender, profession, employer, mobile, email or language, and (with household_id and role) their relationship in one household. " +
    "Only the details you send change; the rest stay. It asks the person to confirm first and shows before and after. " +
    "Niva does not edit children's records or a person's own privacy choices (photo, directory, expertise); those are done on the People screen.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/people/actions.ts#updatePersonAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = await plan(ctx, inp);
    const brief = await loadPersonBrief(ctx, p.id);
    const households = await cardsFor(ctx, brief?.links.map((l) => l.household_id) ?? []);
    const labels = [...p.keys.map((k) => FIELD_LABELS[k] ?? String(k)), ...(p.roleChanged ? ["relationship"] : [])];
    return {
      summary: labels.length ? `Change ${listPhrase([...new Set(labels)])} for ${brief?.name ?? p.first}.` : `No changes for ${brief?.name ?? p.first}.`,
      lines: [
        ...p.keys.map((k) => ({ label: FIELD_LABELS[k] ?? String(k), before: shown(p.original[k]), after: shown(p.changes[k]) })),
        ...(p.roleChanged && p.role ? [{ label: "Relationship", after: relationshipWords(p.role) }] : []),
      ],
      households,
      warnings: labels.length ? [] : ["Everything you gave is already what is on file, so nothing would change."],
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const p = await plan(ctx, inp);
    if (p.keys.length === 0 && !p.roleChanged) return { ok: true, data: undefined, message: "No changes to save." };
    const { db, center } = ctx.session;
    if (p.keys.length > 0) {
      const upd = await db.from("people").update(p.changes).eq("id", p.id).eq("center_id", center.id).select("id");
      if (upd.error) throw new CommandDbError(upd.error, `save ${p.first}'s profile`);
      if ((upd.data ?? []).length === 0) throw new CommandError(`Could not save ${p.first}'s profile — nothing was changed (you may not have permission to edit it).`);
    }
    if (p.roleChanged && p.role && p.household) {
      const r = await db.from("household_members").update({ role: p.role }).eq("household_id", p.household).eq("person_id", p.id).select("person_id");
      if (r.error || (r.data ?? []).length === 0) {
        if (r.error) return dbFail("Could not save the relationship", r.error, p.keys.length ? " The other profile changes were saved." : "");
        const why = "Could not save the relationship — nothing was changed.";
        return { ok: false, error: p.keys.length ? `${why} The other profile changes were saved.` : why };
      }
    }
    revalidateAfterCommand(["/people", "/households", "/", `/people/${p.id}`, ...(p.household ? [`/households/${p.household}`] : [])]);
    const what = [...p.keys.map((k) => FIELD_LABELS[k] ?? String(k)), ...(p.roleChanged ? ["relationship"] : [])];
    return { ok: true, data: undefined, message: `Saved ${p.first}'s profile (${listPhrase([...new Set(what)])}) · audit logged` };
  },
});

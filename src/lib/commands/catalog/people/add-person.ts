import { isHouseholdRole, normalizePhone, parseDateInput, RELATIONSHIP_OPTIONS, type HouseholdRole } from "@/lib/people";

import { communityMajority, isAdultMember } from "../../child-filter";
import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { CHILD_RECORDS_ON_SCREEN, cardLine, cardsFor, relationshipWords, today } from "./shared";

const ROLES = RELATIONSHIP_OPTIONS.map((o) => o.value) as ["spouse", ...string[]];

const input = object({
  household_id: f.uuid("The household to add the person to (its id, from people.find_household). Show the household card to the person first."),
  first_name: f.string("First name.", { min: 0, max: 200 }),
  last_name: f.string("Last name.", { min: 0, max: 200 }),
  role: f.optional(f.enum("Their relationship to the household: spouse, child, parent, sibling or other. Never primary (a household keeps its own primary member).", ROLES)),
  date_of_birth: f.optional(f.string("Date of birth, MM/DD/YYYY or YYYY-MM-DD. Optional.", { min: 0, max: 20 })),
  gender: f.optional(f.string("Female, Male or Prefer not to say. Optional.", { min: 0, max: 40 })),
  email: f.optional(f.string("Email address. Optional. With an email or mobile they can sign in to the member app.", { min: 0, max: 200 })),
  phone_e164: f.optional(f.string("Mobile number, with area code. Optional.", { min: 0, max: 40 })),
});
export type AddPersonInput = Infer<typeof input>;

type Plan = {
  household: string;
  first: string;
  last: string;
  role: Exclude<HouseholdRole, "primary">;
  dob: string | null;
  gender: string;
  email: string;
  phone: string | null;
};

/** Every check the Add person form made, with the same sentences. */
function plan(ctx: CommandContext, inp: AddPersonInput): Plan {
  const first = (inp.first_name ?? "").trim();
  const last = (inp.last_name ?? "").trim();
  if (!first || !last) throw new CommandError("Could not add the person — first and last name are required.");
  const role = inp.role ?? "";
  if (!isHouseholdRole(role) || role === "primary") throw new CommandError("Could not add the person — choose their relationship to the household.");
  const dob = parseDateInput(inp.date_of_birth ?? "");
  if (!dob.ok) throw new CommandError(`Could not add the person — ${dob.error}.`);
  if (dob.value && dob.value > today(ctx)) throw new CommandError("Could not add the person — the date of birth is in the future.");
  const phone = normalizePhone(inp.phone_e164 ?? "");
  if (!phone.ok) throw new CommandError(`Could not add the person — ${phone.error}.`);
  const email = (inp.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CommandError("Could not add the person — that email address does not look right.");
  // D2: Niva does not add children. The screen is the person's own hands.
  if (ctx.via === "assistant" && !isAdultMember({ date_of_birth: dob.value, role }, today(ctx), communityMajority(ctx.session.center))) throw new CommandError(CHILD_RECORDS_ON_SCREEN);
  return { household: inp.household_id, first, last, role, dob: dob.value, gender: (inp.gender ?? "").trim(), email, phone: phone.value };
}

export const addPerson = defineCommand<AddPersonInput, { personId: string }>({
  key: "people.add_person",
  title: "Add a person to a household",
  description:
    "Add an adult to an existing household as its spouse, parent, sibling or other relation, with an optional birth date, email and mobile. " +
    "It asks the person to confirm first and shows the household card. Never pick the household by name: find it with people.find_household and show the card. " +
    "Niva does not add children; that is done on the People screen. A new primary member is not added this way.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/households/actions.ts#addPersonAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = plan(ctx, inp);
    const [card] = await cardsFor(ctx, [p.household]);
    if (!card) throw new CommandError("That household was not found, or you can't see it.");
    const warnings: string[] = [];
    if (card.adults.some((a) => a.toLowerCase() === `${p.first} ${p.last}`.toLowerCase())) warnings.push(`${p.first} ${p.last} already lives in this household. Check it is not the same person.`);
    if (p.email || p.phone) warnings.push("They will be able to sign in to the member app with that email or mobile.");
    return {
      summary: `Add ${p.first} ${p.last} to the household as ${relationshipWords(p.role)}.`,
      lines: [
        { label: "Household", value: cardLine(card) },
        { label: "Name", value: `${p.first} ${p.last}` },
        { label: "Relationship", value: relationshipWords(p.role) },
        ...(p.dob ? [{ label: "Date of birth", value: p.dob }] : []),
        ...(p.email ? [{ label: "Email", value: p.email }] : []),
        ...(p.phone ? [{ label: "Mobile", value: p.phone }] : []),
      ],
      households: [card],
      warnings,
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const p = plan(ctx, inp);
    const res = await ctx.session.db.rpc("staff_add_person", {
      p_household: p.household,
      p_first: p.first,
      p_last: p.last,
      p_role: p.role,
      p_dob: p.dob ?? undefined,
      p_gender: p.gender || undefined,
      p_email: p.email || undefined,
      p_phone: p.phone ?? undefined,
    });
    if (res.error) throw new CommandDbError(res.error, "add the person");
    revalidateAfterCommand(["/people", "/households", "/", `/households/${p.household}`]);
    return {
      ok: true,
      message: `${p.first} ${p.last} added to the household · audit logged${p.email || p.phone ? ". They can sign in to the member app with that email or mobile" : ""}`,
      data: { personId: String(res.data) },
    };
  },
});

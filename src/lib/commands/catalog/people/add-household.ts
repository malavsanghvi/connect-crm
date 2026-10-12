import { isEmail, normalizePhone } from "@/lib/people";
import { FAMILY_MATCH_LABELS, familyAdultName, matchesHeading } from "@/lib/people-family";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandPreview } from "../../types";
import { rpcJson } from "../db";

import { findFamilyMatchesFor, matchLine, type FamilyMatch, type FamilyQuery } from "./family-matches";

// Add a family: a household with its first adult as the primary member (People redesign slice 6; the database function is 0721).
// The database looks for families that may already be this one (the same mobile or email, the same name, the same last name) and, if
// there are any, creates NOTHING and gives them back, until the caller says "none of these". No child is created here (D2).

const input = object({
  first_name: f.string("The first adult's first name.", { min: 0, max: 400 }),
  last_name: f.string("The first adult's last name.", { min: 0, max: 400 }),
  mobile: f.optional(f.string("Their mobile number with its area code, for example (713) 555-0142. Optional.", { min: 0, max: 60 })),
  email: f.optional(f.string("Their email address. Optional.", { min: 0, max: 300 })),
  street: f.optional(f.string("The street address. Optional.", { min: 0, max: 600 })),
  none_of_these: f.optional(
    f.boolean("Leave this out the first time. Set it to true ONLY after the person has looked at the families that may already be this one and said that none of them is."),
  ),
});
export type AddFamilyInput = Infer<typeof input>;

/** What the command returns: the new family, or the families that may already be it (and nothing was added). */
export type AddFamilyResult =
  | { created: true; householdId: string; personId: string; householdNumber: string | null }
  | { created: false; total: number; matches: FamilyMatch[] };

type Plan = FamilyQuery & { street: string | null; noneOfThese: boolean };

/** Every check the Add a family sheet makes, with plain sentences. The database checks again. */
function plan(inp: AddFamilyInput): Plan {
  const first = inp.first_name.trim();
  const last = inp.last_name.trim();
  if (!first || !last) throw new CommandError("Could not add the family — enter the first adult's first and last name.");
  if (first.length > 200 || last.length > 200) throw new CommandError("Could not add the family — the name is too long.");
  const phone = normalizePhone(inp.mobile ?? "");
  if (!phone.ok) throw new CommandError(`Could not add the family — ${phone.error}.`);
  const email = (inp.email ?? "").trim().toLowerCase();
  if (email && !isEmail(email)) throw new CommandError("Could not add the family — that email address does not look right.");
  const street = (inp.street ?? "").trim();
  if (street.length > 300) throw new CommandError("Could not add the family — the street address is too long.");
  return { first, last, phone: phone.value, email: email || null, street: street || null, noneOfThese: inp.none_of_these === true };
}

const asString = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export const addHousehold = defineCommand<AddFamilyInput, AddFamilyResult>({
  key: "people.add_household",
  title: "Add a new family",
  description:
    "Add a new family (a household) with its first adult as the primary member: their name and, if the person has them, a mobile number, an email and a street address. " +
    "It first looks for families that may already be this one (the same mobile or email, the same name, the same last name) and if there are any it adds NOTHING and gives their cards back: show every card and let the person open the right one, " +
    "or say that none of them is the same family, and only then ask again with none_of_these set to true. It asks the person to confirm first. " +
    "No child is added this way: add children from the family's page, as a person. Never choose a family by name alone.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/people/add-family-actions.ts#addFamilyAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = plan(inp);
    if (!p.noneOfThese) {
      const found = await findFamilyMatchesFor(ctx, p);
      if (found.matches.length > 0) {
        const lines = found.matches.map((m) => matchLine(m, FAMILY_MATCH_LABELS)).join("; ");
        throw new CommandError(
          `${matchesHeading(found.total)} ${lines}. Show the person every one of them. If one is the same family, open it instead; if none is, ask again with none_of_these set to true.`,
        );
      }
    }
    return {
      summary: `Add a new family with ${familyAdultName({ firstName: p.first, lastName: p.last })} as its first adult.`,
      lines: [
        { label: "First adult", value: familyAdultName({ firstName: p.first, lastName: p.last }) },
        ...(p.phone ? [{ label: "Mobile", value: p.phone }] : []),
        ...(p.email ? [{ label: "Email", value: p.email }] : []),
        ...(p.street ? [{ label: "Street", value: p.street }] : []),
      ],
      warnings: [p.noneOfThese ? "The person has said that none of the similar families is the same one." : "No family with this mobile, email or name was found."],
    };
  },
  confirmText: () => "Yes, add this family",
  async execute(ctx, inp) {
    const p = plan(inp);
    const { db, center } = ctx.session;
    const res = (await rpcJson(
      db,
      "add_household",
      { p_center: center.id, p_first: p.first, p_last: p.last, p_phone: p.phone, p_email: p.email, p_street: p.street, p_none_of_these: p.noneOfThese },
      "add the family",
    )) as Record<string, unknown> | null;
    if (res && res.created === true) {
      const householdId = asString(res.household_id);
      const personId = asString(res.person_id);
      if (!householdId || !personId) throw new CommandDbError(new Error("add_household answered without the new ids"), "add the family");
      revalidateAfterCommand(["/people", "/households", "/", `/households/${householdId}`]);
      const number = asString(res.household_number);
      return {
        ok: true,
        data: { created: true, householdId, personId, householdNumber: number },
        message: `Family added: ${familyAdultName({ firstName: p.first, lastName: p.last })}${number ? ` · household ${number}` : ""} · audit logged`,
      };
    }
    // Not created: families that may already be this one. Cards come from the adult-only reader.
    const found = await findFamilyMatchesFor(ctx, p);
    if (found.matches.length === 0 && found.total === 0) throw new CommandDbError(new Error("add_household neither added the family nor named a match"), "add the family");
    return {
      ok: true,
      data: { created: false, total: found.total, matches: found.matches },
      message: `Nothing was added. ${matchesHeading(found.total)} Open the right one, or say that none of them is the same family.`,
    };
  },
});

import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { cardLine, cardsFor, loadPersonBrief } from "./shared";

// Choose a household's primary member (the prompt after a death, and "Make primary" under More). The database function
// (0420 set_household_primary) checks people.manage, the reason, that the person is a current living adult member and that the
// household was not merged, and moves only the flag: relationships, pledges, payments and memberships stay as they are.
// Only the person's own screen runs it (screenOnly).

const input = object({
  household_id: f.uuid("The household (its id). Show its card to the person."),
  person_id: f.uuid("The adult who becomes the primary member (their id)."),
  reason: f.string("Why the primary member changes. Kept in the audit log.", { min: 0, max: 5000 }),
});
export type SetPrimaryInput = Infer<typeof input>;

function plan(inp: SetPrimaryInput) {
  const reason = inp.reason.trim();
  if (!reason) throw new CommandError("Could not change the primary member — give a reason. It goes in the audit log.");
  return { household: inp.household_id, person: inp.person_id, reason };
}

async function check(ctx: CommandContext, personId: string) {
  const person = await loadPersonBrief(ctx, personId);
  if (!person || person.mergedInto) throw new CommandError("Could not change the primary member — that person was not found, or the record was merged.");
  return person;
}

export const setPrimary = defineCommand<SetPrimaryInput, undefined>({
  key: "people.set_primary",
  title: "Change a household's primary member",
  description:
    "Choose which adult is the primary member of a household. Only the primary flag moves: relationships, pledges, payments, statements and memberships stay with the household, and past records keep the earlier payer. " +
    "It needs a reason, which goes in the audit log. Only a person on the People screen does this; Niva does not change who is primary.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  screenOnly: true,
  input,
  covers: ["src/app/(app)/people/deceased-actions.ts#setHouseholdPrimaryAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = plan(inp);
    const person = await check(ctx, p.person);
    const [card] = await cardsFor(ctx, [p.household]);
    return {
      summary: `Make ${person.name} the primary member of the household.`,
      lines: [
        { label: "Household", value: cardLine(card) },
        { label: "New primary member", value: person.name },
        { label: "Reason", value: p.reason },
      ],
      households: card ? [card] : [],
      warnings: ["Pledges, payments and statements stay with the household."],
    };
  },
  confirmText: () => "Yes, change the primary member",
  async execute(ctx, inp) {
    const p = plan(inp);
    const writer = await dbWithReason(ctx.session, p.reason);
    const res = await writer.rpc("set_household_primary", { p_household: p.household, p_person: p.person, p_reason: p.reason });
    if (res.error) throw new CommandDbError(res.error, "change the primary member");
    revalidateAfterCommand([`/households/${p.household}`, `/people/${p.person}`, "/households"]);
    return { ok: true, data: undefined, message: "The primary member is changed · audit logged. Pledges, payments and statements stay with the household." };
  },
});

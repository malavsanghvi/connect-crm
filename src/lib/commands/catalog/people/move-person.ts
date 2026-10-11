import { RELATIONSHIP_OPTIONS, isHouseholdRole, type HouseholdRole } from "@/lib/people";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { cardLine, cardsFor, loadPersonBrief, refuseChildForAssistant, relationshipWords } from "./shared";

const ROLES = RELATIONSHIP_OPTIONS.map((o) => o.value) as ["spouse", ...string[]];

const input = object({
  person_id: f.uuid("The person to move (their id)."),
  from_household_id: f.uuid("The household they are in now (its id). Show its card to the person."),
  to_household_id: f.optional(f.uuid("The household they move to (its id, from people.find_household). Show its card to the person; never choose it by name.")),
  role: f.optional(f.enum("Their relationship in the new household: spouse, child, parent, sibling or other. Never primary.", ROLES)),
});
export type MovePersonInput = Infer<typeof input>;

type Plan = { id: string; from: string; to: string; role: Exclude<HouseholdRole, "primary"> };

function plan(inp: MovePersonInput): Plan {
  if (!inp.to_household_id) throw new CommandError("Could not move — choose the household to move to first.");
  const role = inp.role ?? "other";
  if (!isHouseholdRole(role) || role === "primary") throw new CommandError("Could not move — choose their relationship in the new household.");
  return { id: inp.person_id, from: inp.from_household_id, to: inp.to_household_id, role };
}

/** The checks the database function makes, said before anything changes. */
async function check(ctx: CommandContext, p: Plan) {
  const person = await loadPersonBrief(ctx, p.id);
  if (!person || person.mergedInto) throw new CommandError("Could not move — that person was not found, or the record was merged.");
  refuseChildForAssistant(ctx, person);
  if (p.from === p.to) throw new CommandError("Could not move — choose a different household to move to.");
  const link = person.links.find((l) => l.household_id === p.from);
  if (!link) throw new CommandError("Could not move — that person is not a current member of the household being left.");
  return { person, link };
}

export const movePerson = defineCommand<MovePersonInput, undefined>({
  key: "people.move_person",
  title: "Move a person to another household",
  description:
    "Move an adult from the household they are in to another existing household, with their relationship there. Pledges and payments stay with the original household. " +
    "It asks the person to confirm first and shows both household cards. Find both households with people.find_household and never choose one by name alone. " +
    "A primary member of a household with other members cannot be moved until someone else is primary. Niva does not move children.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/people/actions.ts#movePersonAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = plan(inp);
    const { person, link } = await check(ctx, p);
    const cards = await cardsFor(ctx, [p.from, p.to]);
    const warnings = ["Pledges and payments stay with the original household."];
    if (link.is_primary) {
      const others = await ctx.session.db.from("household_members").select("person_id").eq("household_id", p.from).is("left_at", null);
      if (others.error) throw new CommandDbError(others.error, "read the household's members");
      const n = (others.data ?? []).filter((m) => m.person_id !== p.id).length;
      if (n > 0) throw new CommandError(`Could not move — this person is the primary member of the household they are leaving, which still has ${n} other member${n === 1 ? "" : "s"}. Make someone else the primary first.`);
    }
    return {
      summary: `Move ${person.name} to another household as ${relationshipWords(p.role)}.`,
      lines: [
        { label: "Leaves", value: cardLine(cards.find((c) => c.household_id === p.from)) },
        { label: "Joins", value: cardLine(cards.find((c) => c.household_id === p.to)) },
        { label: "Relationship there", value: relationshipWords(p.role) },
      ],
      households: cards,
      warnings,
    };
  },
  confirmText: (_i, preview) => `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`,
  async execute(ctx, inp) {
    const p = plan(inp);
    const person = await loadPersonBrief(ctx, p.id);
    if (person) refuseChildForAssistant(ctx, person);
    const first = person?.firstName ?? "The person";
    const res = await ctx.session.db.rpc("move_person_household", { p_person: p.id, p_from: p.from, p_to: p.to, p_role: p.role });
    if (res.error) throw new CommandDbError(res.error, `move ${first}`);
    revalidateAfterCommand(["/people", "/households", "/", `/people/${p.id}`, `/households/${p.from}`, `/households/${p.to}`]);
    return { ok: true, data: undefined, message: `${first} moved · pledges and payments stay with the original household · audit logged` };
  },
});

import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { callMergePreview, householdMoveLines } from "./merge-preview";
import { cardLine, cardsFor } from "./shared";

const input = object({
  keep_id: f.uuid("The household to keep (its id, from people.find_household). Show its card to the person."),
  drop_id: f.uuid("The duplicate household that is merged away (its id). Show its card to the person."),
  reason: f.optional(f.string("Why they are the same household. Optional; kept in the audit log.", { min: 0, max: 1000 })),
});
export type MergeHouseholdsInput = Infer<typeof input>;

function plan(inp: MergeHouseholdsInput) {
  return { keep: inp.keep_id, drop: inp.drop_id, reason: (inp.reason ?? "").trim().slice(0, 500) };
}

async function bothCards(ctx: CommandContext, keep: string, drop: string) {
  const cards = await cardsFor(ctx, [keep, drop]);
  const k = cards.find((c) => c.household_id === keep);
  const d = cards.find((c) => c.household_id === drop);
  if (!k || !d) throw new CommandError("Could not merge the households — one of the two households was not found, or you can't see it.");
  return { cards, k, d };
}

export const mergeHouseholds = defineCommand<MergeHouseholdsInput, undefined>({
  key: "people.merge_households",
  title: "Merge two duplicate households",
  description:
    "Merge a duplicate household into the household to keep: its members join the kept household and the duplicate is marked as merged. " +
    "The duplicate's own identifiers, memberships and giving history stay on it. It asks the person to confirm first and shows both household cards and what would move. There is no undo. " +
    "Find both households with people.find_household or people.suggest_duplicates, and never choose one by name alone.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/households/actions.ts#mergeHouseholdsAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = plan(inp);
    const { cards, k, d } = await bothCards(ctx, p.keep, p.drop);
    const pv = await callMergePreview(ctx, "merge_households_preview", { p_keep: p.keep, p_drop: p.drop });
    if (!pv.canMerge) throw new CommandError(`Could not merge the households — ${pv.blockers[0] ?? "the database would refuse it"}.`);
    return {
      summary: `Merge the duplicate household (${cardLine(d)}) into the household to keep (${cardLine(k)}).`,
      lines: [{ label: "Keeps", value: cardLine(k) }, { label: "Merged away", value: cardLine(d) }, ...householdMoveLines(pv.moves)],
      households: cards,
      warnings: ["There is no undo for a merge. The duplicate stays in the history, marked as merged into the kept household."],
    };
  },
  confirmText: () => "Yes, merge these two households",
  async execute(ctx, inp) {
    const p = plan(inp);
    // Without a reason the database function records its own ("Merged duplicate household …").
    const writer = p.reason ? await dbWithReason(ctx.session, p.reason) : ctx.session.db;
    const res = await writer.rpc("merge_households", { p_keep: p.keep, p_drop: p.drop });
    if (res.error) throw new CommandDbError(res.error, "merge the households");
    revalidateAfterCommand(["/households", "/people", "/", `/households/${p.keep}`, `/households/${p.drop}`, "/people/merge"]);
    return { ok: true, data: undefined, message: "Households merged · members moved · the duplicate's giving history stays on it · audit logged" };
  },
});

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandPreview } from "../../types";

import { cardLine, cardsFor, loadPersonBrief, refuseChildForAssistant } from "./shared";

const input = object({ candidate_id: f.uuid("The suggested pair (its id, from people.suggest_duplicates).") });
export type DismissDuplicateInput = Infer<typeof input>;

export const dismissDuplicate = defineCommand<DismissDuplicateInput, undefined>({
  key: "people.dismiss_duplicate",
  title: "Mark a suggested pair as not a duplicate",
  description:
    "Record that a suggested duplicate pair (from people.suggest_duplicates) is NOT the same person or household, so it stops being suggested. " +
    "It asks the person to confirm first and shows the pair. Nothing is merged or changed on either record.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/households/actions.ts#dismissDuplicateAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const { db, center } = ctx.session;
    const res = await db.from("merge_candidates").select("id, kind, left_id, right_id, status").eq("id", inp.candidate_id).eq("center_id", center.id).maybeSingle();
    if (res.error) throw new CommandDbError(res.error, "read the suggested pair");
    if (!res.data) throw new CommandError("That suggested pair was not found, or you can't see it.");
    if (res.data.status !== "open") throw new CommandError("That suggestion was already resolved.");
    const ids = [res.data.left_id, res.data.right_id];
    if (res.data.kind === "household") {
      const cards = await cardsFor(ctx, ids);
      return {
        summary: "Mark these two households as not duplicates.",
        lines: cards.map((c, i) => ({ label: i === 0 ? "One household" : "The other", value: cardLine(c) })),
        households: cards,
      };
    }
    const people = await Promise.all(ids.map((id) => loadPersonBrief(ctx, id)));
    for (const person of people) if (person) refuseChildForAssistant(ctx, person);
    const cards = await cardsFor(ctx, people.flatMap((p) => p?.links.map((l) => l.household_id) ?? []));
    return {
      summary: `Mark ${people.map((p) => p?.name ?? "a record").join(" and ")} as two different people.`,
      lines: people.map((p, i) => ({ label: i === 0 ? "One record" : "The other", value: p ? `${p.name}${p.memberNumber ? ` · member number ${p.memberNumber}` : ""}` : "a record you can't see" })),
      households: cards,
    };
  },
  confirmText: () => "Yes, these are not duplicates",
  async execute(ctx, inp) {
    const { db, center, userId } = ctx.session;
    const res = await db
      .from("merge_candidates")
      .update({ status: "dismissed", resolved_by: userId, resolved_at: (ctx.now?.() ?? new Date()).toISOString() })
      .eq("id", inp.candidate_id)
      .eq("center_id", center.id)
      .eq("status", "open")
      .select("id");
    if (res.error) throw new CommandDbError(res.error, "dismiss the suggested duplicate");
    if ((res.data ?? []).length === 0) throw new CommandError("Could not dismiss — it was already resolved, or you can't change it.");
    revalidateAfterCommand(["/people/merge", "/people", "/households", "/"]);
    return { ok: true, data: undefined, message: "Marked as not a duplicate" };
  },
});


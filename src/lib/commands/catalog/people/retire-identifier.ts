import { identifierRules } from "@/lib/center-rules";
import { addDays, todayInTz } from "@/lib/dates";
import { identifierKindLabel } from "@/lib/identifiers";
import { canManageIdentifierKind, type IdentifierKind } from "@/lib/permissions";
import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";
import { must } from "../db";

import { cardsFor, loadPersonBrief, refuseChildForAssistant } from "./shared";

// Retire an identifier: it stops matching from today and stays in the history. THE ONE CHANGE from the Identifiers panel's old
// Retire button (People redesign, slice 5): a reason is now required, and it goes on the audit row.

const input = object({
  identifier_id: f.uuid("The identifier to retire (its id, from people.household_summary)."),
  reason: f.string("Why it is retired, for example 'moved to a new system'. Kept in the audit log.", { min: 0, max: 5000 }),
});
export type RetireIdentifierInput = Infer<typeof input>;

type Row = { id: string; kind: string; value: string; valid_to: string | null; household_id: string | null; person_id: string | null };

async function load(ctx: CommandContext, inp: RetireIdentifierInput) {
  const reason = inp.reason.trim();
  if (!reason) throw new CommandError("Could not retire the identifier — give a reason. It goes in the audit log.");
  const { db, center } = ctx.session;
  const row = must(
    await db.from("external_ids").select("id, kind, value, valid_to, household_id, person_id").eq("id", inp.identifier_id).maybeSingle(),
    "retire the identifier",
  ) as Row | null;
  if (!row) throw new CommandError("Could not retire the identifier — it was not found, or you can't see it.");
  const kindLabel = identifierKindLabel(row.kind, identifierRules(center.rules));
  if (!canManageIdentifierKind(ctx.session, row.kind as IdentifierKind)) {
    throw new CommandError(`Could not retire the ${kindLabel} — you don't have permission.`);
  }
  if (row.valid_to) throw new CommandError(`The ${kindLabel} "${row.value}" is already retired.`);
  // D2: Niva takes no child's record. The screen and the palette are the person's own hands.
  if (row.person_id && ctx.via === "assistant") {
    const person = await loadPersonBrief(ctx, row.person_id);
    if (person) refuseChildForAssistant(ctx, person);
  }
  return { row, kindLabel, reason };
}

export const retireIdentifier = defineCommand<RetireIdentifierInput, undefined>({
  key: "people.retire_identifier",
  title: "Retire an identifier",
  description:
    "Retire an identifier of a household or a person (an old member number, a closed account, a bank payer name that moved): it stops matching from today and stays in the history. " +
    "It needs a reason, which goes in the audit log. It asks the person to confirm first and shows what is retired and whose it is. Niva does not retire a child's identifier.",
  level: "confirm",
  permission: "identifiersManage",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/identifiers/actions.ts#retireIdentifierAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const { row, kindLabel, reason } = await load(ctx, inp);
    const cards = row.household_id ? await cardsFor(ctx, [row.household_id]) : [];
    return {
      summary: `Retire the ${kindLabel} "${row.value}".`,
      lines: [
        { label: kindLabel, value: row.value },
        { label: "Reason", value: reason },
      ],
      households: cards,
      warnings: ["It stops matching from today but stays in the history."],
    };
  },
  confirmText: () => "Yes, retire this identifier",
  async execute(ctx, inp) {
    const { row, kindLabel, reason } = await load(ctx, inp);
    // Last valid day = yesterday, so lookups stop resolving it today. The row stays for history.
    const lastDay = addDays(todayInTz(ctx.session.center.time_zone, ctx.now?.()), -1);
    const writer = await dbWithReason(ctx.session, reason);
    const { data, error } = await writer.from("external_ids").update({ valid_to: lastDay }).eq("id", row.id).is("valid_to", null).select("id");
    if (error) throw new CommandDbError(error, `retire the ${kindLabel}`);
    if (!data || data.length === 0) {
      throw new CommandError(`Could not retire the ${kindLabel} — no change was saved (you may not have permission).`);
    }
    revalidateAfterCommand([row.household_id ? `/households/${row.household_id}` : null, row.person_id ? `/people/${row.person_id}` : null].filter((x): x is string => x !== null));
    return { ok: true, data: undefined, message: `Retired "${row.value}". It stays in the history.` };
  },
});

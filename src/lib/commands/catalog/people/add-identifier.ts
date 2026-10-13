import { identifierRules } from "@/lib/center-rules";
import { todayInTz } from "@/lib/dates";
import { externalIdInsert } from "@/lib/db-inserts";
import { identifierKindLabel, identifierTarget, padOrgId } from "@/lib/identifiers";
import { IDENTIFIER_KINDS, canManageIdentifierKind, type IdentifierKind } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { cardLine, cardsFor, loadPersonBrief, refuseChildForAssistant } from "./shared";

// Add an identifier (a Connect number, a member ID from another system, a QuickBooks id, a bank payer name ...) to a household or
// a person. The same rules the Identifiers panel always had: who may add which kind is decided by canManageIdentifierKind
// (people.manage for the people kinds, giving.manage for the finance kinds), and RLS on external_ids is the enforcement.

const input = object({
  kind: f.string(`What kind of identifier it is: one of ${IDENTIFIER_KINDS.join(", ")}.`, { min: 0, max: 80 }),
  target_kind: f.string("Who it belongs to: household or person.", { min: 0, max: 20 }),
  target_id: f.string("The id of that household or person (from people.find_household or people.household_summary). Show the household card to the person.", { min: 0, max: 60 }),
  value: f.string("The identifier exactly as the other system shows it.", { min: 0, max: 1000 }),
  system: f.string("Which system it comes from, for example neon or quickbooks (letters, numbers, dot, dash and underscore).", { min: 0, max: 200 }),
  label: f.optional(f.string("A short label, for example 'Neon account id'. Optional.", { min: 0, max: 1000 })),
  notes: f.optional(f.string("Notes. Optional.", { min: 0, max: 2000 })),
});
export type AddIdentifierInput = Infer<typeof input>;

type Plan = { kind: IdentifierKind; kindLabel: string; targetKind: "household" | "person"; targetId: string; value: string; system: string; label: string; notes: string };

/** Every check the Identifiers panel made, in the same order and with the same sentences. */
function plan(ctx: CommandContext, inp: AddIdentifierInput): Plan {
  const { session } = ctx;
  const rules = identifierRules(session.center.rules);
  const kind = inp.kind as IdentifierKind;
  if (!IDENTIFIER_KINDS.includes(kind)) throw new CommandError("Could not add the identifier — choose what kind of identifier it is.");
  const kindLabel = identifierKindLabel(kind, rules);
  if (!canManageIdentifierKind(session, kind)) {
    const need = ["accounting", "bank_payer", "payment_provider"].includes(kind) ? "giving.manage" : "people.manage";
    throw new CommandError(`Could not add the ${kindLabel} — you don't have permission (needs ${need}).`);
  }
  let value = inp.value.trim();
  const system = inp.system.trim();
  if (!value) throw new CommandError(`Could not add the ${kindLabel} — enter the value exactly as the other system shows it.`);
  if (value.length > 200) throw new CommandError("Could not add the identifier — the value is longer than 200 characters.");
  if (!system) throw new CommandError("Could not add the identifier — say which system it comes from (for example neon or quickbooks).");
  if (!/^[a-z0-9_.-]{1,40}$/i.test(system)) {
    throw new CommandError("Could not add the identifier — the system name may only use letters, numbers, dot, dash and underscore.");
  }
  const targetKind = inp.target_kind.trim();
  const targetId = inp.target_id.trim();
  if (!isUuid(targetId) || (targetKind !== "household" && targetKind !== "person")) {
    throw new CommandError("Could not add the identifier — choose who it belongs to.");
  }
  const mustBe = identifierTarget(kind);
  if (mustBe !== "either" && mustBe !== targetKind) {
    throw new CommandError(
      `Could not add the ${kindLabel} — it belongs to ${mustBe === "person" ? "a person, not the household" : "the household, not a person"}. Choose ${
        mustBe === "person" ? "a member" : "the household"
      } under "Belongs to".`,
    );
  }
  if (kind === "org_member") value = padOrgId(value, rules.orgMemberDigits);
  if (kind === "org_household") value = padOrgId(value, rules.orgHouseholdDigits);
  return { kind, kindLabel, targetKind, targetId, value, system: system.toLowerCase(), label: (inp.label ?? "").trim(), notes: (inp.notes ?? "").trim() };
}

export const addIdentifier = defineCommand<AddIdentifierInput, undefined>({
  key: "people.add_identifier",
  title: "Add an identifier to a household or person",
  description:
    "Record another system's identifier for a household or a person: their member or household number in the organization's own register, a number from a previous system, an accounting id or a bank payer name. " +
    "It asks the person to confirm first and shows who it will belong to. A member ID belongs to a person and a household ID to the household; finance kinds need the giving permission. " +
    "Find the household with people.find_household and never choose it by name alone. Niva does not add identifiers to children.",
  level: "confirm",
  permission: "identifiersManage",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/identifiers/actions.ts#addIdentifierAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const p = plan(ctx, inp);
    const lines: CommandPreview["lines"] = [{ label: p.kindLabel, value: p.value }, { label: "System", value: p.system }];
    let cards = [] as Awaited<ReturnType<typeof cardsFor>>;
    if (p.targetKind === "person") {
      const person = await loadPersonBrief(ctx, p.targetId);
      if (!person || person.mergedInto) throw new CommandError("Could not add the identifier — that person was not found, or the record was merged.");
      refuseChildForAssistant(ctx, person);
      cards = await cardsFor(ctx, person.links.map((l) => l.household_id));
      lines.push({ label: "Belongs to", value: person.name });
    } else {
      cards = await cardsFor(ctx, [p.targetId]);
      if (cards.length === 0) throw new CommandError("Could not add the identifier — that household was not found, or you can't see it.");
      lines.push({ label: "Belongs to", value: cardLine(cards[0]) });
    }
    if (p.label) lines.push({ label: "Label", value: p.label });
    return { summary: `Add the ${p.kindLabel} "${p.value}" (${p.system}).`, lines, households: cards };
  },
  confirmText: () => "Yes, add this identifier",
  async execute(ctx, inp) {
    const p = plan(ctx, inp);
    const { db, center, userId } = ctx.session;
    if (ctx.via === "assistant" && p.targetKind === "person") {
      const person = await loadPersonBrief(ctx, p.targetId);
      if (person) refuseChildForAssistant(ctx, person);
    }
    const { error } = await db.from("external_ids").insert(
      externalIdInsert({
        center_id: center.id,
        household_id: p.targetKind === "household" ? p.targetId : null,
        person_id: p.targetKind === "person" ? p.targetId : null,
        kind: p.kind,
        system: p.system,
        value: p.value,
        label: p.label || null,
        notes: p.notes || null,
        source: "manual",
        valid_from: todayInTz(center.time_zone, ctx.now?.()),
        created_by: userId,
      }),
    );
    if (error) {
      if (error.code === "23505") {
        const holder = await db.rpc("resolve_identifier", { p_center: center.id, p_value: p.value });
        const other = (holder.data ?? []).find((r) => r.kind === p.kind);
        // D2: the holder may be a child, and Niva is never given a child's name. The screen and the palette name them.
        const who = ctx.via !== "assistant" && other?.display_name ? ` to ${other.display_name}` : " to another record";
        throw new CommandError(`Could not add the ${p.kindLabel} — "${p.value}" (${p.system}) is already assigned${who}. Retire it there first if it moved.`);
      }
      throw new CommandDbError(error, `add the ${p.kindLabel}`);
    }
    revalidateAfterCommand([p.targetKind === "household" ? `/households/${p.targetId}` : `/people/${p.targetId}`]);
    return { ok: true, data: undefined, message: `Added ${p.kindLabel} "${p.value}".` };
  },
});

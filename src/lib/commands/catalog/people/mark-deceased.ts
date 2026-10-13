import { markedMessage, parseDeceasedForm } from "@/lib/deceased";
import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { cardsFor, loadPersonBrief, today } from "./shared";

// The "Mark as deceased" form of the person page (owner decision 2026-09-25; the database function is 0420). Gates exactly as
// before: people.manage, then the database function checks the permission, the reason and the date again and writes the audit
// rows with the reason. Only the person's own screen runs it (screenOnly): a model never records a death.

const input = object({
  person_id: f.uuid("The person who passed away (their id)."),
  deceased_on: f.string("The date of death, YYYY-MM-DD (an approximate date is fine; say so in the note).", { min: 0, max: 40 }),
  reason: f.string("Why this is being recorded, for example who told the office. Kept in the audit log.", { min: 0, max: 5000 }),
  note: f.optional(f.string("A note kept with the record. Optional.", { min: 0, max: 5000 })),
  confirmed: f.optional(f.boolean("True when the person ticked the box that confirms this person has passed away.")),
});
export type MarkDeceasedInput = Infer<typeof input>;

/** Every check the form made, with the same sentences. The birth date comes from the record, not from the form. */
async function check(ctx: CommandContext, inp: MarkDeceasedInput) {
  const person = await loadPersonBrief(ctx, inp.person_id);
  if (!person) throw new CommandError("Could not mark as deceased — the person was not found.");
  const parsed = parseDeceasedForm(
    { deceased_on: inp.deceased_on, note: inp.note ?? "", reason: inp.reason, confirm: inp.confirmed ? "on" : null },
    today(ctx),
    person.dateOfBirth,
  );
  if (!parsed.ok) throw new CommandError(`Could not mark ${person.name} as deceased — ${parsed.error}.`);
  return { person, value: parsed.value };
}

export const markDeceased = defineCommand<MarkDeceasedInput, undefined>({
  key: "people.mark_deceased",
  title: "Record that a person has passed away",
  description:
    "Record that a person has passed away, with the date and the reason (who told the office). They leave the directory, the pickers and the active counts, no message is sent to them any more, and memberships they hold end. " +
    "Their giving history and household records are kept, and it can be undone from their page with a reason. Only a person on the People screen does this: Niva never records a death.",
  level: "confirm",
  permission: "householdsEdit",
  module: "people",
  enabledByDefault: false,
  screenOnly: true,
  input,
  covers: ["src/app/(app)/people/deceased-actions.ts#markDeceasedAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const { person, value } = await check(ctx, inp);
    const cards = await cardsFor(ctx, person.links.map((l) => l.household_id));
    return {
      summary: `Record that ${person.name} passed away on ${value.deceasedOn}.`,
      lines: [
        { label: "Person", value: person.name },
        { label: "Date of death", value: value.deceasedOn },
        { label: "Reason", value: value.reason },
        ...(value.note ? [{ label: "Note", value: value.note }] : []),
      ],
      households: cards,
      warnings: ["No message of any kind will be sent to them. Their pledges and payments stay on record. It can be undone."],
    };
  },
  confirmText: () => "Yes, record that this person has passed away",
  async execute(ctx, inp) {
    const { person, value } = await check(ctx, inp);
    const writer = await dbWithReason(ctx.session, value.reason);
    const res = await writer.rpc("mark_person_deceased", {
      p_person: person.id,
      p_deceased_on: value.deceasedOn,
      p_note: value.note ?? "",
      p_reason: value.reason,
    });
    if (res.error) throw new CommandDbError(res.error, `mark ${person.name} as deceased`);
    revalidateAfterCommand(["/people", "/households", "/people/directory", "/", `/people/${person.id}`, ...person.links.map((l) => `/households/${l.household_id}`)]);
    return { ok: true, data: undefined, message: markedMessage(person.name, res.data) };
  },
});

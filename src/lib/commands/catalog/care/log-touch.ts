import { CHANNEL_LABEL, OUTCOME_LABEL, TOUCH_CHANNELS, TOUCH_KINDS, TOUCH_KIND_LABEL, TOUCH_OUTCOMES, parseCard } from "@/lib/care/model";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError, type HouseholdCard } from "../../types";
import { rpcJson } from "../db";

import { cardOf, requireNiva } from "./shared";

export type LogTouchData = { household: HouseholdCard; touch_id: string };

const input = object({
  household_id: f.uuid("The household (its id, from people.search or another card). A household is never found by name alone."),
  kind: f.enum("What the touch was: thank_you, check_in, greeting, welcome, update, invitation, care_moment or other.", TOUCH_KINDS),
  channel: f.enum("How: in_person, phone, text, email, whatsapp, post, video or other.", TOUCH_CHANNELS),
  outcome: f.withDefault(f.enum("How it went: done, no_answer, left_message, declined or later.", TOUCH_OUTCOMES), "done"),
  note: f.optional(f.string("A short note about the touch, from what the person said (at most 1,000 characters). Leave it out when there is nothing to add.", { max: 1000 })),
  is_ask: f.withDefault(f.boolean("True ONLY if the touch asked the household for a gift. A thank-you, a check-in, a greeting and a care moment are not asks."), false),
});

/** A dictated note becomes a touch on the household's log, once the person confirms it. */
export const careLogTouch = defineCommand<Infer<typeof input>, LogTouchData>({
  key: "care.log_touch",
  title: "Record a touch on a household",
  description:
    "Record a personal touch (a call, a visit, a card, a message) on one household's relationship log, from what the person tells you: what it was, how, how it went, and a short note. " +
    "The person confirms before it is saved. Set is_ask to true only if the touch asked the household for a gift; a thank-you, check-in, greeting or care moment is never an ask. " +
    "Needs the household's id (people.search first). It records that something happened; it sends nothing.",
  level: "confirm",
  permission: "care",
  module: "care",
  alsoModules: ["ai"],
  assistantOnly: true,
  input,
  async preview(ctx, i) {
    await requireNiva(ctx);
    const card = parseCard(await rpcJson(ctx.session.db, "care_household_card", { p_household: i.household_id }, "read the household's care record"));
    if (card.household.id === "") throw new CommandError("That household was not found, or you can't see its care record.");
    if (i.kind === "care_moment" && i.is_ask) throw new CommandError("A care moment is never an ask. Record the ask as a touch of its own, later.");
    return {
      summary: `Record ${TOUCH_KIND_LABEL[i.kind].toLowerCase()} by ${(CHANNEL_LABEL[i.channel] ?? i.channel).toLowerCase()} on the log of ${card.household.name}.`,
      lines: [
        { label: "What", value: TOUCH_KIND_LABEL[i.kind] },
        { label: "How", value: CHANNEL_LABEL[i.channel] ?? i.channel },
        { label: "How it went", value: OUTCOME_LABEL[i.outcome] },
        { label: "Ask", value: i.is_ask ? "Yes, this asked for a gift" : "No ask" },
        ...(i.note ? [{ label: "Note", value: i.note }] : []),
      ],
      households: [cardOf(card.household)],
      warnings: i.is_ask ? ["This records an ask. It counts against the touch balance and starts the rest period."] : undefined,
    };
  },
  confirmText: "Record this touch",
  async execute(ctx, i) {
    await requireNiva(ctx);
    const touch = { kind: i.kind, channel: i.channel, outcome: i.outcome, is_ask: i.is_ask, ...(i.note ? { note: i.note } : {}) };
    const id = await rpcJson(ctx.session.db, "log_care_touch", { p_household: i.household_id, p_touch: touch }, "record the touch");
    if (typeof id !== "string") throw new CommandError("The touch could not be recorded. Nothing was changed.");
    const card = parseCard(await rpcJson(ctx.session.db, "care_household_card", { p_household: i.household_id }, "read the household's care record"));
    return { ok: true, data: { household: cardOf(card.household), touch_id: id }, message: "Recorded on the household's log." };
  },
});

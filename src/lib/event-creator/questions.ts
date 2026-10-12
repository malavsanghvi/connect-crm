// The creator's cards: their order, their question, and WHEN each is asked. A card is asked from the community's own data
// (its modules and its past events), never from its name or faith: a card that is not asked keeps its settings under
// "More settings", so nothing is ever out of reach.

import type { CardId, CreatorCtx } from "./types";

export type CardDef = {
  id: CardId;
  /** The stepper's short label. */
  label: string;
  /** The question at the top of the card. */
  question: string;
  /** Asked for this community? */
  asked: (ctx: CreatorCtx) => boolean;
  /** Why it is not asked, for the More settings card ("Money is under More settings because …"). */
  skipped?: (ctx: CreatorCtx) => string;
};

/** At least this many past events before history may decide that a card is not needed. */
export const HISTORY_ENOUGH = 3;

const enoughHistory = (ctx: CreatorCtx) => ctx.history.past.length >= HISTORY_ENOUGH;

/** Money: asked when the community takes donations here (Giving), when any past event charged, or while there is little history. */
function moneyAsked(ctx: CreatorCtx): boolean {
  return ctx.modules.giving || !enoughHistory(ctx) || ctx.history.past.some((e) => e.is_paid || e.commitments_used);
}

/** Help: asked when the community runs volunteers, or its past events had shifts or a meal. */
function helpAsked(ctx: CreatorCtx): boolean {
  return ctx.modules.volunteers || ctx.history.shifts.length > 0 || ctx.history.past.some((e) => e.lunch_enabled);
}

/** Sending: asked when the community sends messages here, or its past events used the confirmation reminder, or history is thin. */
function sendingAsked(ctx: CreatorCtx): boolean {
  return ctx.modules.comms || !enoughHistory(ctx) || ctx.history.past.some((e) => e.confirmation_hours_before > 0);
}

export const CARDS: readonly CardDef[] = [
  { id: "what", label: "What and when", question: "What are we calling it, and when is it?", asked: () => true },
  { id: "where", label: "Where", question: "Where will it be held?", asked: () => true },
  { id: "who", label: "Who", question: "Who is it for?", asked: () => true },
  {
    id: "money",
    label: "Money",
    question: "Will people pay to come?",
    asked: moneyAsked,
    skipped: (ctx) => `Your last ${ctx.history.past.length} events were all free, so tickets and donations are here.`,
  },
  {
    id: "help",
    label: "Help",
    question: "Who will help on the day?",
    asked: helpAsked,
    skipped: () => "Volunteers are switched off and your past events had no shifts or meals, so meal settings are here.",
  },
  { id: "words", label: "Words", question: "How should it read?", asked: () => true },
  {
    id: "sending",
    label: "Sending",
    question: "When should people be reminded?",
    asked: sendingAsked,
    skipped: (ctx) => `Messages are switched off and your last ${ctx.history.past.length} events sent no reminder, so the reminder is here.`,
  },
  { id: "more", label: "More settings", question: "Anything else to set?", asked: () => true },
  { id: "review", label: "Review", question: "Your draft is saved. Is it ready?", asked: () => true },
];

export function cardDef(id: CardId): CardDef {
  return CARDS.find((c) => c.id === id)!;
}

export function asked(id: CardId, ctx: CreatorCtx): boolean {
  return cardDef(id).asked(ctx);
}

/** The cards asked for this community, in order. */
export function askedCards(ctx: CreatorCtx): CardId[] {
  return CARDS.filter((c) => c.asked(ctx)).map((c) => c.id);
}

/** Sentences for the cards this community is not asked, shown on the More settings card. */
export function skippedNotes(ctx: CreatorCtx): string[] {
  return CARDS.filter((c) => !c.asked(ctx) && c.skipped).map((c) => c.skipped!(ctx));
}

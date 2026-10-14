// Which card comes next, and how ready the draft is. Pure.

import { formatShortCents, parseDollarsToCents } from "@/lib/events/format";
import { eventReadiness, type ReadinessCounts } from "@/lib/events/readiness";
import { audienceLabel } from "@/lib/events/report";

import { toReadinessEvent } from "./mapping";
import { askedCards } from "./questions";
import type { CardId, CreatorCtx, EventDraft } from "./types";

export { askedCards };

/** Card 1 is answered when the draft has a name and a start; card 2 when it has a place. The others have usable defaults. */
export function cardComplete(card: CardId, d: EventDraft): boolean {
  if (card === "what") return d.name.trim() !== "" && d.starts_at.trim() !== "";
  if (card === "where") return d.venue.trim() !== "";
  return true;
}

/**
 * Where the creator opens. A new event, or a draft without its name and start: card 1. Otherwise the first asked card the
 * person has not passed yet (`passed` is remembered in this browser); with nothing remembered (another device), the place if it
 * is missing, else the Review card, which shows every answer with a Change button.
 */
export function nextCard(d: EventDraft, ctx: CreatorCtx, passed: readonly CardId[] = []): CardId {
  if (!d.id || !cardComplete("what", d)) return "what";
  if (passed.length === 0) return cardComplete("where", d) ? "review" : "where";
  return askedCards(ctx).find((c) => c !== "what" && c !== "review" && !passed.includes(c)) ?? "review";
}

export function after(card: CardId, ctx: CreatorCtx): CardId {
  const list = askedCards(ctx);
  return list[Math.min(list.indexOf(card) + 1, list.length - 1)] ?? "review";
}

export function before(card: CardId, ctx: CreatorCtx): CardId | null {
  const list = askedCards(ctx);
  const i = list.indexOf(card);
  return i > 0 ? list[i - 1] : null;
}

// ---------------------------------------------------------------------------
// Readiness: the builder's own rules (eventReadiness, goal "publish") plus what the creator sets up
// ---------------------------------------------------------------------------

export type ReadyItem = {
  key: string;
  label: string;
  ok: boolean;
  /** True when this stops publishing (eventReadiness's blockers). */
  blocks: boolean;
  /** Why it is not done yet, in a sentence. */
  hint: string | null;
  /** The card that fixes it. */
  card: CardId;
};

export type CreatorReadiness = { items: ReadyItem[]; percent: number; blocking: number };

export type CreatorCounts = ReadinessCounts;

export const NO_COUNTS: CreatorCounts = { lunch_slots: 0, shifts: 0, shifts_empty: null, checklist_overdue: 0, checklist_open: 0 };

const BLOCKER_ITEM: Record<string, string> = {
  no_start: "when",
  start_passed: "when",
  ends_before_start: "when",
  rsvp_window: "rsvp",
  rsvp_closed_already: "rsvp",
  lunch_time: "meal_time",
  price: "price",
};

export function creatorReadiness(d: EventDraft, ctx: CreatorCtx, counts: CreatorCounts = NO_COUNTS): CreatorReadiness {
  const r = eventReadiness(toReadinessEvent(d, ctx.tz), counts, "publish", new Date(ctx.now), ctx.tz);
  const blockerFor = (item: string) => r.blockers.find((b) => BLOCKER_ITEM[b.code] === item) ?? null;
  const asked = askedCards(ctx);
  const items: ReadyItem[] = [];
  const add = (key: string, label: string, ok: boolean, card: CardId, hint: string | null = null, blocks = false) => items.push({ key, label, ok, blocks: blocks && !ok, hint: ok ? null : hint, card });

  add("saved", "Saved as a draft", d.id !== null, "what", "Saved when the first card is answered.");
  const when = blockerFor("when");
  add("when", "Name, date and time", cardComplete("what", d) && !when, "what", when?.text ?? "Needed to publish.", true);
  add("where", d.venue.trim() ? `At ${d.venue.trim()}${d.capacity.trim() ? `, room for ${d.capacity.trim()}` : ""}` : "Where it is", d.venue.trim() !== "", "where", "Worth adding, so people know where to go.");
  add("who", `For ${audienceLabel(d.audience).toLowerCase()}`, true, "who");
  const price = blockerFor("price");
  const priceText = d.is_paid && !price ? `Tickets ${formatShortCents(parseDollarsToCents(d.member_price), ctx.currency)} for members` : d.is_paid ? "Ticket price" : "Free to come";
  add("price", priceText, !price, asked.includes("money") ? "money" : "more", price?.text ?? null, true);
  const rsvp = blockerFor("rsvp");
  if (d.rsvp_opens_at || d.rsvp_closes_at) add("rsvp", "RSVP dates", !rsvp, "more", rsvp?.text ?? null, true);
  if (d.lunch_enabled) {
    const meal = blockerFor("meal_time");
    const mealCard: CardId = asked.includes("help") ? "help" : "more";
    add("meal_time", "Meal time set", !meal, mealCard, meal?.text ?? null, true);
    add("meal_slots", "Meal slots created", counts.lunch_slots > 0, mealCard, "Create them on the Help card once the times are final.");
  }
  // Any other blocker the builder's rules find (a cancelled event, for one).
  for (const b of r.blockers) if (!BLOCKER_ITEM[b.code]) add(b.code, b.text, false, "review", b.fix, true);
  add("description", "A description", d.description.trim() !== "", "words", "A line or two about the event.");
  if (asked.includes("help") || ctx.modules.volunteers) add("shifts", counts.shifts > 0 ? `${counts.shifts} volunteer shift${counts.shifts === 1 ? "" : "s"}` : "Volunteer shifts", counts.shifts > 0, "help", "Add them on the Help card.");
  add("lead", d.owner ? `Led by ${d.owner.name}` : "An event lead", d.owner !== null, "more", "Choose who is in charge, under More settings.");
  add("flyer", "A flyer", d.flyer_path !== "", "words", "Approve the flyer draft beside the questions.");

  const done = items.filter((i) => i.ok).length;
  return { items, percent: Math.round((done / items.length) * 100), blocking: items.filter((i) => i.blocks).length };
}

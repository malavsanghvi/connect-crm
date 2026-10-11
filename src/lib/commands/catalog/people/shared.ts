// Pieces the People commands share: one person's brief (with the check for a child), household cards for previews (adults only),
// and the sentences used by more than one command. Nothing here writes.

import { todayInTz } from "@/lib/dates";
import { relationshipLabel } from "@/lib/people";

import { isAdultMember } from "../../child-filter";
import { CommandError, type CommandContext, type CommandFailure, type HouseholdCard } from "../../types";
import { failure } from "@/lib/errors";
import { adultHouseholdCards } from "../household";
import { must } from "../db";

export const CHILD_RECORDS_ON_SCREEN = "Niva does not work with children's records. Please do this on the People screen.";

export type PersonBrief = {
  id: string;
  name: string;
  firstName: string;
  dateOfBirth: string | null;
  memberNumber: string | null;
  mergedInto: string | null;
  links: { household_id: string; role: string; is_primary: boolean }[];
  /** 18 or older by birth date; with none on file, a head, spouse or parent in every household they are in. */
  isAdult: boolean;
};

type PersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  member_number: string | null;
  merged_into_id: string | null;
};

export function today(ctx: CommandContext): string {
  return todayInTz(ctx.session.center.time_zone, ctx.now?.());
}

export function fullName(p: { first_name: string; last_name: string; preferred_name?: string | null }): string {
  return `${(p.preferred_name ?? "").trim() || p.first_name} ${p.last_name}`.trim();
}

/** The person and their current household links, or null when the role cannot see them. Merged-away records are returned (mergedInto set). */
export async function loadPersonBrief(ctx: CommandContext, id: string): Promise<PersonBrief | null> {
  const { db, center } = ctx.session;
  const p = must(
    await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth, member_number, merged_into_id").eq("id", id).eq("center_id", center.id).maybeSingle(),
    "read the person",
  ) as PersonRow | null;
  if (!p) return null;
  const links = (must(await db.from("household_members").select("household_id, role, is_primary").eq("person_id", id).is("left_at", null), "read the person's households") ?? []) as PersonBrief["links"];
  const now = today(ctx);
  const isAdult = p.date_of_birth ? isAdultMember({ date_of_birth: p.date_of_birth }, now) : links.length > 0 && links.every((l) => isAdultMember({ date_of_birth: null, role: l.role }, now));
  return { id: p.id, name: fullName(p), firstName: p.first_name, dateOfBirth: p.date_of_birth, memberNumber: p.member_number, mergedInto: p.merged_into_id, links, isAdult };
}

/** D2: Niva takes no child's record as input. The screen and the palette (the person's own hands) are not limited. */
export function refuseChildForAssistant(ctx: CommandContext, person: Pick<PersonBrief, "isAdult">): void {
  if (ctx.via === "assistant" && !person.isAdult) throw new CommandError(CHILD_RECORDS_ON_SCREEN);
}

/** Cards (adults only) for these households, by id. Households the role cannot see are left out. */
export async function cardsFor(ctx: CommandContext, ids: readonly (string | null | undefined)[]): Promise<HouseholdCard[]> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return [];
  const { cards } = await adultHouseholdCards(ctx.session.db, unique, { today: today(ctx), currency: ctx.session.center.currency });
  return cards;
}

/** A household in one line for a preview: never a name alone. "Priya & Rahul · H-1001 · ID 2041 · Austin". */
export function cardLine(card: HouseholdCard | undefined): string {
  if (!card) return "a household you can't see";
  const who = card.adults.length ? card.adults.slice(0, 3).join(" & ") : (card.household_name ?? "a household");
  return [who, card.household_number, card.org_household_id ? `ID ${card.org_household_id}` : null, card.city].filter(Boolean).join(" · ");
}

export function relationshipWords(role: string | null | undefined): string {
  return role ? relationshipLabel(role).toLowerCase() : "member";
}

/** A database failure with the same sentence a Server Action gave, plus something to add ("The other changes were saved."). */
export function dbFail(context: string, error: unknown, suffix = ""): CommandFailure {
  const r = failure(context, error);
  return { ok: false, error: `${r.error}${suffix}`, ...(r.stepUp ? { stepUp: true } : {}) };
}

export function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

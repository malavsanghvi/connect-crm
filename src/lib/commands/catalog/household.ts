// Household cards for the assistant: the same card every picker shows (app.household_card), but with ADULTS ONLY (decision D2).
// The database card lists every member's first name in one text (`members`) and names a primary member; neither is used here.
// Adults come from the household's members and their birth dates (isAdultMember), so a child can never be in a card.

import { chunk } from "@/lib/data/fetch-all";
import { householdCards } from "@/lib/data/lookups";
import { formatCents } from "@/lib/money";
import type { AppSupabase } from "@/lib/supabase/server";

import { householdNameWithoutChildren, isAdultMember } from "../child-filter";
import { CommandDbError, type HouseholdCard } from "../types";

import { must } from "./db";

type PersonRow = { id: string; first_name: string; last_name: string; preferred_name: string | null; date_of_birth: string | null };
type MemberRow = { household_id: string; person_id: string; role: string; is_primary: boolean };

function displayName(p: Pick<PersonRow, "first_name" | "last_name" | "preferred_name">): string {
  return `${(p.preferred_name ?? "").trim() || p.first_name} ${p.last_name}`.trim();
}

export type AdultDirectory = {
  /** household id → its adults, primary first. */
  byHousehold: Map<string, { id: string; name: string; isPrimary: boolean }[]>;
  /** Every adult person id seen (for judging a match on a person). */
  adultIds: Set<string>;
  /** household id → first names of its members under 18 (never shown; used to clean the household's display name). */
  minorFirstNames: Map<string, string[]>;
};

/** The adults of each household (members who have not left, 18 or older by birth date or, with none on file, a head, spouse or parent). */
export async function loadAdults(db: AppSupabase, householdIds: string[], today: string): Promise<AdultDirectory> {
  const byHousehold = new Map<string, { id: string; name: string; isPrimary: boolean }[]>();
  const adultIds = new Set<string>();
  const minorFirstNames = new Map<string, string[]>();
  const members: MemberRow[] = [];
  for (const part of chunk(householdIds)) {
    const rows = must(await db.from("household_members").select("household_id, person_id, role, is_primary").in("household_id", part).is("left_at", null), "read the members of the households");
    members.push(...((rows ?? []) as MemberRow[]));
  }
  const people = new Map<string, PersonRow>();
  for (const part of chunk([...new Set(members.map((m) => m.person_id))])) {
    const rows = must(await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth").in("id", part), "read the people in the households");
    for (const p of (rows ?? []) as PersonRow[]) people.set(p.id, p);
  }
  for (const m of members) {
    const p = people.get(m.person_id);
    // A person the role cannot read is not shown; nothing is guessed about them.
    if (!p) continue;
    if (!isAdultMember({ date_of_birth: p.date_of_birth, role: m.role }, today)) {
      const names = minorFirstNames.get(m.household_id) ?? [];
      names.push(p.first_name, ...(p.preferred_name ? [p.preferred_name] : []));
      minorFirstNames.set(m.household_id, names);
      continue;
    }
    adultIds.add(p.id);
    const list = byHousehold.get(m.household_id) ?? [];
    list.push({ id: p.id, name: displayName(p), isPrimary: m.is_primary });
    byHousehold.set(m.household_id, list);
  }
  for (const list of byHousehold.values()) list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name));
  // A first name that an adult of the same household also has (a "Jr.") is not removed from the household's name.
  for (const [id, names] of minorFirstNames) {
    const adultFirst = new Set((byHousehold.get(id) ?? []).map((a) => a.name.split(" ")[0].toLowerCase()));
    minorFirstNames.set(id, [...new Set(names.map((n) => n.trim()).filter((n) => n && !adultFirst.has(n.toLowerCase())))]);
  }
  return { byHousehold, adultIds, minorFirstNames };
}

/**
 * Cards for these households, in the order given, adults only. Households the person cannot see are left out (the database
 * card is empty for them) and counted in `hidden`.
 */
export async function adultHouseholdCards(
  db: AppSupabase,
  householdIds: string[],
  opts: { today: string; currency: string },
): Promise<{ cards: HouseholdCard[]; hidden: number; adults: AdultDirectory }> {
  const ids = [...new Set(householdIds)];
  if (ids.length === 0) return { cards: [], hidden: 0, adults: { byHousehold: new Map(), adultIds: new Set(), minorFirstNames: new Map() } };
  const raw = await householdCards(db, ids);
  if (raw.error && raw.map.size === 0) throw new CommandDbError(raw.error, "read the household cards");
  const adults = await loadAdults(db, [...raw.map.keys()], opts.today);
  const cards: HouseholdCard[] = [];
  for (const id of ids) {
    const c = raw.map.get(id);
    if (!c) continue;
    const list = adults.byHousehold.get(id) ?? [];
    cards.push({
      household_id: c.household_id,
      household_name: householdNameWithoutChildren(c.household_name, adults.minorFirstNames.get(id) ?? []),
      household_number: c.household_number,
      org_household_id: c.org_household_id,
      adults: list.map((a) => a.name),
      primary_adult: list.find((a) => a.isPrimary)?.name ?? list[0]?.name ?? null,
      zone: c.zone,
      city: c.city,
      last_gift_on: c.last_gift_on,
      open_pledge_cents: c.open_pledge_cents,
      open_pledge: c.open_pledge_cents === null ? null : formatCents(c.open_pledge_cents, opts.currency),
    });
  }
  return { cards, hidden: ids.length - cards.length, adults };
}

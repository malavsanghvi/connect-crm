import "server-only";

// Contact-gap lists, the reads: the adults who have no email, no mobile, no street address or no app account, read under the signed-in
// person's own access (RLS decides what comes back). Only existing tables: people, household_members, households, center_users. The
// decisions (who is an adult, who has a gap, the order) are in gaps.ts. A part that fails is said in words and the list then shows no
// one rather than everyone.

import { communityMajority } from "@/lib/commands/child-filter";
import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { teamPersonIds } from "@/lib/data/people-list";
import { fetchAll, chunk } from "@/lib/data/fetch-all";
import { orgIds, personName } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { todayInTz } from "@/lib/dates";
import { explainError, type DbErrorLike } from "@/lib/errors";
import { householdCardLine } from "@/lib/find/labels";
import type { CrmSession } from "@/lib/session";

import type { HouseholdFilters } from "./ask";
import { gapPeople, type ExportCard, type GapPerson } from "./gaps";
import type { Problem } from "./model";

export type GapListData = {
  /** Every adult who meets the filters, in name order (the page takes one slice of it). */
  people: GapPerson[];
  problems: Problem[];
  notes: string[];
  /** A read that was needed failed: `people` is empty, and the problems say why. */
  failed: boolean;
};

type Link = { household_id: string; person_id: string; role: string; is_primary: boolean; joined_at: string | null };

const problem = (what: string, error: unknown): Problem => ({ what, message: explainError(error) });

/**
 * The adults who meet the contact-gap, band, area and search filters. Reads the people (narrowed in the database by "no email" and "no
 * mobile" when those are asked), their family links, their families, and who has an app account.
 */
export async function loadGapPeople(session: CrmSession, f: HouseholdFilters): Promise<GapListData> {
  const { db, center } = session;
  const cid = center.id;
  const today = todayInTz(center.time_zone);
  const problems: Problem[] = [];
  const notes: string[] = [];
  const fail = (what: string, error: unknown): GapListData => {
    console.error(`[people gap list] could not read ${what}:`, error);
    problems.push(problem(what, error));
    return { people: [], problems, notes, failed: true };
  };

  const blank = (col: string) => `${col}.is.null,${col}.eq.`;
  const groups: string[] = [];
  if (f.noEmail === true) groups.push(blank("email"));
  if (f.noMobile === true) groups.push(blank("phone_e164"));

  const [people, logins, team, search] = await Promise.all([
    fetchAll((from, to) => {
      let q = db
        .from("people")
        .select("id, first_name, last_name, preferred_name, member_number, date_of_birth, email, phone_e164")
        .eq("center_id", cid)
        .is("merged_into_id", null)
        .eq("is_deceased", false);
      // One or() per request: two groups are joined with and(or(…),or(…)).
      if (groups.length === 1) q = q.or(groups[0]);
      else if (groups.length === 2) q = q.or(`and(or(${groups[0]}),or(${groups[1]}))`);
      return q.order("id").range(from, to);
    }),
    fetchAll((from, to) => db.from("center_users").select("person_id").eq("center_id", cid).not("person_id", "is", null).order("person_id").range(from, to)),
    f.band === "roles" ? teamPersonIds(session) : null,
    f.q ? searchHouseholds(db, cid, f.q, { limit: 1000 }) : null,
  ]);
  if (people.error) return fail("the people", people.error);
  if (logins.error) return fail("who has an app account", logins.error);
  if (team?.error) return fail("the teams and roles", team.error);
  if (search?.error) return fail("the search results", search.error);
  if (people.truncated) notes.push("This community has more people than one list can hold; narrow it with a filter to see the rest.");
  if (team?.partial) notes.push("Counts only the roles and teams your permissions let you see.");

  const ids = people.data.map((p) => p.id);
  const links: Link[] = [];
  for (const part of chunk(ids)) {
    const res = await db.from("household_members").select("household_id, person_id, role, is_primary, joined_at").in("person_id", part).is("left_at", null);
    if (res.error) return fail("the families these people are in", res.error);
    links.push(...((res.data ?? []) as Link[]));
  }
  // A person's family here is the one they are primary of, else the earliest joined (the same rule as the People list).
  const linkBy = new Map<string, Link>();
  for (const l of links) {
    const cur = linkBy.get(l.person_id);
    if (!cur || (l.is_primary && !cur.is_primary) || (!cur.is_primary && (l.joined_at ?? "") < (cur.joined_at ?? ""))) linkBy.set(l.person_id, l);
  }
  const householdIds = [...new Set([...linkBy.values()].map((l) => l.household_id))];
  const households = new Map<string, { id: string; display_name: string; household_number: string | null; address_line1: string | null; zone_id: string | null }>();
  for (const part of chunk(householdIds)) {
    const res = await db.from("households").select("id, display_name, household_number, address_line1, zone_id").in("id", part);
    if (res.error) return fail("the families these people are in", res.error);
    for (const h of res.data ?? []) households.set(h.id, h);
  }

  const onApp = new Set(logins.data.map((l) => l.person_id).filter((x): x is string => !!x));
  const teamIds = new Set(team?.ids ?? []);
  const all: GapPerson[] = people.data.map((p) => {
    const link = linkBy.get(p.id);
    const h = link ? households.get(link.household_id) : undefined;
    return {
      id: p.id,
      name: personName(p),
      memberNumber: p.member_number,
      email: p.email,
      phone: p.phone_e164,
      dateOfBirth: p.date_of_birth,
      role: link ? (link.is_primary ? "primary" : link.role) : null,
      onApp: onApp.has(p.id),
      onTeam: teamIds.has(p.id),
      household: link && h ? { id: h.id, name: h.display_name, number: h.household_number, hasAddress: !!h.address_line1 && h.address_line1.trim() !== "", zoneId: h.zone_id } : null,
    };
  });
  const searchIds = search ? new Set(search.householdIds) : null;
  return { people: gapPeople(all, f, { today, majority: communityMajority(center), searchIds }), problems, notes, failed: false };
}

export type GapPageExtras = {
  /** The organization's own IDs for each person on the page. */
  orgIds: Map<string, string[]>;
  /** The household card line for each family on the page ("No. 0127 · RCC-H-0961 · Priya & Anil · Riverside"). */
  cardLine: Map<string, string>;
  /** The card's name WITHOUT any child's first name. */
  cardName: Map<string, string>;
  problems: Problem[];
};

/** What one page of a gap list needs beyond the people: their IDs and each family's card line. */
export async function loadGapPageExtras(session: CrmSession, page: readonly GapPerson[]): Promise<GapPageExtras> {
  const { db, center } = session;
  const out: GapPageExtras = { orgIds: new Map(), cardLine: new Map(), cardName: new Map(), problems: [] };
  if (page.length === 0) return out;
  const householdIds = [...new Set(page.flatMap((p) => (p.household ? [p.household.id] : [])))];
  const [org, cards] = await Promise.all([
    orgIds(db, center.id, { personIds: page.map((p) => p.id) }),
    adultHouseholdCards(db, householdIds, { today: todayInTz(center.time_zone), currency: center.currency, majority: communityMajority(center) }).catch((error: unknown) => ({ error })),
  ]);
  if (org.error) {
    console.error("[people gap list] could not read the organization's IDs:", org.error);
    out.problems.push(problem("the organization's IDs for these people", org.error));
  } else out.orgIds = org.byPerson;
  if ("error" in cards) {
    console.error("[people gap list] could not read the household cards:", cards.error);
    out.problems.push(problem("the household cards", cards.error));
  } else {
    for (const c of cards.cards) {
      out.cardLine.set(c.household_id, householdCardLine(c));
      if (c.household_name) out.cardName.set(c.household_id, c.household_name);
    }
  }
  return out;
}

/** The household cards an export needs, for these families (read in small groups). Names carry no child's first name; adults only. */
export async function loadExportCards(session: CrmSession, householdIdList: readonly string[]): Promise<{ cards: Map<string, ExportCard>; error: DbErrorLike | null }> {
  const { db, center } = session;
  const cards = new Map<string, ExportCard>();
  const householdIds = [...new Set(householdIdList)];
  try {
    for (const part of chunk(householdIds)) {
      const res = await adultHouseholdCards(db, part, { today: todayInTz(center.time_zone), currency: center.currency, majority: communityMajority(center) });
      for (const c of res.cards) cards.set(c.household_id, { name: c.household_name, number: c.household_number, orgId: c.org_household_id, city: c.city, zone: c.zone, adults: c.adults });
    }
    return { cards, error: null };
  } catch (error) {
    return { cards, error: error as DbErrorLike };
  }
}

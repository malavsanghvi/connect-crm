import { identifierRules } from "@/lib/center-rules";
import { searchHouseholds } from "@/lib/data/search";
import { todayInTz } from "@/lib/dates";
import { normalizeSearchQuery } from "@/lib/global-search";
import { identifierKindLabel } from "@/lib/identifiers";

import { defineCommand } from "../define";
import { f, object, type Infer } from "../schema";
import { CommandDbError, CommandError, type HouseholdCard } from "../types";

import { adultHouseholdCards } from "./household";

const MAX_RESULTS = 8;

export type PeopleSearchResult = {
  household: HouseholdCard;
  /** Which identifier matched ("JSH household ID 2041"), when the search was an ID. */
  matched_on: string[];
};

export type PeopleSearchData = { count: number; results: PeopleSearchResult[]; more: number; hidden: number };

/**
 * The top-bar search's logic (households by name, number and member name; people by name, email and member number) plus every
 * identifier a member can have, answered as household cards with the adults of each household only.
 */
const input = object({ query: f.string("What to look for: a name, number, phone, email or ID. At least 2 characters.", { min: 2, max: 80 }) });

export const peopleSearch = defineCommand<Infer<typeof input>, PeopleSearchData>({
  key: "people.search",
  title: "Search people and households",
  description:
    "Find a household by anything someone can tell you: a name, a household number, a phone number or email, a member number, or any ID a member has " +
    "(the Connect number, the community's own member or household ID, an old CRM or QuickBooks customer, a bank payer name). " +
    "Returns up to 8 household cards. Each card shows the household number, the community's household ID, the ADULTS in the household, " +
    "the city and zone, the last gift and what is still pledged, so two households with the same name can be told apart. " +
    "Never pick or confirm a household by name alone: show the card details to the person and let them choose. " +
    "Nothing about children is ever returned.",
  level: "read",
  permission: "identifierSearch",
  input,
  covers: ["src/app/(app)/search/actions.ts#globalSearchAction"],
  async execute(ctx, input) {
    const { db, center } = ctx.session;
    const q = normalizeSearchQuery(input.query);
    if (!q) throw new CommandError("Type at least 2 characters to search.");
    const found = await searchHouseholds(db, center.id, q, { limit: 60 });
    if (found.error) throw new CommandDbError(found.error, "search households and people");
    const ids = found.householdIds.slice(0, MAX_RESULTS);
    const today = todayInTz(center.time_zone, ctx.now?.());
    const { cards, hidden, adults } = await adultHouseholdCards(db, ids, { today, currency: center.currency });
    const rules = identifierRules(center.rules);
    const results: PeopleSearchResult[] = cards.map((card) => {
      const matched = new Set<string>();
      for (const hit of found.identifierMatches) {
        if (hit.household_id !== card.household_id) continue;
        // An ID that belongs to a person is only mentioned when that person is an adult.
        if (hit.person_id && !adults.adultIds.has(hit.person_id)) continue;
        matched.add(`${identifierKindLabel(hit.kind, rules)} ${hit.value}`);
      }
      return { household: card, matched_on: [...matched] };
    });
    const more = Math.max(0, found.householdIds.length - ids.length);
    return {
      ok: true,
      data: { count: results.length, results, more, hidden },
      message: results.length === 0 ? "Nothing matched that search." : more > 0 ? `Showing ${results.length} of ${found.householdIds.length}. Search for something more specific to narrow it down.` : undefined,
    };
  },
});

import { identifierRules } from "@/lib/center-rules";
import { identifierKindLabel, householdIdsFromResolved, type ResolvedIdentifier } from "@/lib/identifiers";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type HouseholdCard } from "../../types";
import { adultHouseholdCards } from "../household";

import { today } from "./shared";

const input = object({
  identifier: f.string("The identifier exactly as another system shows it: a Connect member or household number, the community's own member or household ID (like 0417 or 2041), a CRM (Neon) ID, a QuickBooks customer, or a bank payer name.", { min: 2, max: 120 }),
});

export type FindHouseholdData = {
  count: number;
  /** True when more than one household holds this value (a shared payer name, a reused number). The person must choose from the cards. */
  ambiguous: boolean;
  results: { household: HouseholdCard; matched_on: string[] }[];
  hidden: number;
};

export const findHousehold = defineCommand<Infer<typeof input>, FindHouseholdData>({
  key: "people.find_household",
  title: "Find a household by an identifier",
  description:
    "Look up a household from ONE identifier a member can have: the Connect number, the community's own member or household ID (padded for you, so 417 finds 0417), the old CRM (Neon) ID, the QuickBooks customer, or a bank payer name. " +
    "Returns household cards (household number, the community's household ID, the adults, city and zone, last gift, what is still pledged) and says which identifier matched. " +
    "If more than one household holds the value it says so: show every card and let the person choose; never pick one yourself. For a name or a phone number use people.search. Nothing about children is returned.",
  level: "read",
  permission: "identifierSearch",
  module: "people",
  input,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    const value = inp.identifier.trim();
    if (value.length < 2) throw new CommandError("Type at least 2 characters of the identifier.");
    const res = await db.rpc("resolve_identifier", { p_center: center.id, p_value: value });
    if (res.error) throw new CommandDbError(res.error, "look up the identifier");
    const hits = (res.data ?? []) as ResolvedIdentifier[];
    const ids = householdIdsFromResolved(hits).slice(0, 8);
    const { cards, hidden, adults } = await adultHouseholdCards(db, ids, { today: today(ctx), currency: center.currency });
    const rules = identifierRules(center.rules);
    const results = cards.map((card) => {
      const matched = new Set<string>();
      for (const hit of hits) {
        if (hit.household_id !== card.household_id) continue;
        // An identifier that belongs to a person is only mentioned when that person is an adult.
        if (hit.person_id && !adults.adultIds.has(hit.person_id)) continue;
        matched.add(`${identifierKindLabel(hit.kind, rules)} ${hit.value}`);
      }
      return { household: card, matched_on: [...matched] };
    });
    const ambiguous = results.length > 1;
    return {
      ok: true,
      data: { count: results.length, ambiguous, results, hidden },
      message:
        results.length === 0
          ? "No household has that identifier. Try people.search with a name, phone number or email."
          : ambiguous
            ? "More than one household has this value. Show every card and let the person choose; do not pick one yourself."
            : undefined,
    };
  },
});

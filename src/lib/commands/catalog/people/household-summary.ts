import { identifierRules } from "@/lib/center-rules";
import { identifierKindLabel, isRetired } from "@/lib/identifiers";
import { tierLabel } from "@/lib/people";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type HouseholdCard } from "../../types";
import { adultHouseholdCards } from "../household";

import { relationshipWords, today } from "./shared";

const input = object({ household_id: f.uuid("The household (its id, from people.find_household or people.search).") });

export type HouseholdSummaryData = {
  household: HouseholdCard;
  adults: { name: string; relationship: string; primary: boolean; identifiers: string[] }[];
  /** The household's own identifiers (CRM, QuickBooks, bank payer names, community household ID). */
  household_identifiers: string[];
  membership: { tier: string; since: string | null } | null;
  waiting: { applications: number; family_requests: number };
};

type ExtId = { person_id: string | null; household_id: string | null; kind: string; system: string; value: string; valid_to: string | null };

export const householdSummary = defineCommand<Infer<typeof input>, HouseholdSummaryData>({
  key: "people.household_summary",
  title: "Show a household",
  description:
    "Show one household: its card, its adults with their relationship, every identifier the household and its adults have (Connect, community, CRM, QuickBooks, bank payer names; retired ones are marked), " +
    "the current membership tier, and how many applications and family requests are waiting for it. Contact details and anything about children stay on the screen.",
  level: "read",
  permission: "households",
  module: "people",
  input,
  async execute(ctx, inp) {
    const { db, center } = ctx.session;
    const { cards, adults } = await adultHouseholdCards(db, [inp.household_id], { today: today(ctx), currency: center.currency });
    const card = cards[0];
    if (!card) throw new CommandError("That household was not found, or you can't see it.");
    const list = adults.byHousehold.get(inp.household_id) ?? [];
    const adultIds = list.map((a) => a.id);
    const rules = identifierRules(center.rules);
    const now = today(ctx);

    const roles = await db.from("household_members").select("person_id, role").eq("household_id", inp.household_id).is("left_at", null);
    if (roles.error) throw new CommandDbError(roles.error, "read the household's members");
    const roleOf = new Map((roles.data ?? []).map((r) => [r.person_id, r.role]));

    const [ids, personIds, membership, apps, reqs] = await Promise.all([
      db.from("external_ids").select("person_id, household_id, kind, system, value, valid_to").eq("household_id", inp.household_id),
      adultIds.length ? db.from("external_ids").select("person_id, household_id, kind, system, value, valid_to").in("person_id", adultIds) : Promise.resolve({ data: [] as ExtId[], error: null }),
      db.from("memberships").select("tier, starts_on").eq("household_id", inp.household_id).eq("status", "active").order("starts_on", { ascending: false }).limit(1).maybeSingle(),
      db.from("membership_applications").select("id", { count: "exact", head: true }).eq("household_id", inp.household_id).in("status", ["awaiting_center", "awaiting_ec"]),
      db.from("household_change_requests").select("id", { count: "exact", head: true }).eq("household_id", inp.household_id).eq("status", "open"),
    ]);
    const failed = ids.error ?? personIds.error ?? membership.error ?? apps.error ?? reqs.error;
    if (failed) throw new CommandDbError(failed, "read the household");

    const label = (e: ExtId) => `${identifierKindLabel(e.kind, rules)} ${e.value}${isRetired(e.valid_to, now) ? " (retired)" : ""}`;
    const byPerson = new Map<string, string[]>();
    for (const e of (personIds.data ?? []) as ExtId[]) if (e.person_id) byPerson.set(e.person_id, [...(byPerson.get(e.person_id) ?? []), label(e)]);
    return {
      ok: true,
      data: {
        household: card,
        adults: list.map((a) => ({ name: a.name, relationship: relationshipWords(roleOf.get(a.id)), primary: a.isPrimary, identifiers: byPerson.get(a.id) ?? [] })),
        household_identifiers: ((ids.data ?? []) as ExtId[]).filter((e) => !e.person_id).map(label),
        membership: membership.data ? { tier: tierLabel(membership.data.tier), since: membership.data.starts_on } : null,
        waiting: { applications: apps.count ?? 0, family_requests: reqs.count ?? 0 },
      },
    };
  },
});

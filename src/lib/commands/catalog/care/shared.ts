// What DonorDelight's Niva commands share (slice 8, docs/DONORDELIGHT.md section 8). Every one of them:
//   - needs iWeaver (`ai`) and DonorDelight (`care`) on (alsoModules and module in the command), and the ORGANIZATION'S OWN TICK (requireNiva below);
//   - runs with the asking person's own rights: it calls the same database functions the screens call, as the signed-in person, so a platform admin or a
//     role without a care key gets "You don't have access to this area" exactly as on a screen (W2);
//   - hands a model NO amount, NO free-text note, NO reason a household is not to be asked, NOTHING about anyone under 18 (the cards list adults only and
//     runCommand's child filter checks the answer again), and at most ten households in an answer;
//   - drafts: it never sends anything. A person sends.
// They are not recorded in the activity stream (commandActivityKey): the community's agreement to share that stream with Weaver cannot leave these out.

import { AI_OFF } from "@/lib/ai-gate";
import { parseHousehold, type CareHousehold } from "@/lib/care/model";

import { CommandError, type CommandContext, type HouseholdCard } from "../../types";
import { rpcJson } from "../db";

/** The most households any DonorDelight command hands a model in one answer. */
export const MAX_HOUSEHOLDS = 10;

/** The organization's tick for Niva (DonorDelight > Playbooks), and iWeaver, read with the person's own rights. */
export async function requireNiva(ctx: CommandContext): Promise<void> {
  const raw = (await rpcJson(ctx.session.db, "care_niva_get", { p_center: ctx.session.center.id }, "check whether Niva may help with relationship care")) as {
    enabled?: unknown;
    ai?: unknown;
  } | null;
  if (raw?.ai === false) throw new CommandError(AI_OFF);
  if (raw?.enabled !== true) {
    throw new CommandError(
      `Niva is not set up to help with relationship care for ${ctx.session.center.name} yet. Someone who manages it can switch it on in the care area, under Playbooks. Until then it can be done on the screens.`,
      "switched_off",
    );
  }
}

/** A care household as a household card: the adults, the number, the city; nothing about money, nothing about anyone under 18. */
export function cardOf(h: CareHousehold): HouseholdCard {
  return {
    household_id: h.id,
    household_name: h.name,
    household_number: h.number,
    org_household_id: h.orgHouseholdId,
    adults: h.adults.map((a) => a.name),
    primary_adult: h.primaryMember,
    zone: h.zone,
    city: h.city,
    last_gift_on: null,
    open_pledge_cents: null,
    open_pledge: null,
  };
}

/** The household head from a care answer's `household` key. */
export function headOf(raw: unknown): CareHousehold {
  return parseHousehold(raw);
}

/** The first name of the adult to reach. */
export function firstName(full: string | null | undefined): string | null {
  const t = (full ?? "").trim();
  return t === "" ? null : t.split(/\s+/)[0];
}

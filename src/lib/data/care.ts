import "server-only";

// WeCare slice 2 (connect-crm 0760-0763): the reads, as the signed-in person (their own session, never a service key), so the
// database's rule is the gate: app.care_household_can / app.care_can, with no platform-admin branch. Each read function logs
// itself in the audit log (app.log_private_read). A refusal because of permissions is "no access" (the screen says "You don't
// have access to this area", never an empty list); any other failure is an error in words with a retry.

import { explainError } from "@/lib/errors";
import { careCan } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import {
  isNoAccess,
  offSentence,
  parseCard,
  parseHolders,
  parseList,
  parseTouchPage,
  type CareCard,
  type CareHolder,
  type CareList,
  type CareListFilter,
  type CareTouchPage,
} from "@/lib/care/model";

export type CareRead<T> =
  | { status: "ok"; data: T }
  | { status: "no_access" }
  | { status: "off"; message: string }
  | { status: "error"; error: string };

function refusal<T>(context: string, error: unknown): CareRead<T> {
  const off = offSentence(error);
  if (off) return { status: "off", message: off };
  if (isNoAccess(error)) return { status: "no_access" };
  console.error(`[care] ${context}:`, error);
  return { status: "error", error: explainError(error) };
}

/** May this person see anything of WeCare here? (Convenience: the database decides.) */
export function seesCare(session: CrmSession): boolean {
  return careCan(session, "own");
}

export type CareCardLoad = { card: CareRead<CareCard>; touches: CareRead<CareTouchPage>; holders: CareRead<CareHolder[]> | null };

/** The Care card of one household: the card, the first page of the touch log, and (for a manager) who can own it. */
export async function loadCareCard(session: CrmSession, householdId: string): Promise<CareCardLoad> {
  const [card, touches] = await Promise.all([readCard(session, householdId), readTouches(session, householdId, null)]);
  const holders = card.status === "ok" && card.data.access.manage ? await readHolders(session) : null;
  return { card, touches, holders };
}

export async function readCard(session: CrmSession, householdId: string): Promise<CareRead<CareCard>> {
  const res = await session.db.rpc("care_household_card", { p_household: householdId });
  if (res.error) return refusal("could not read the care card", res.error);
  return { status: "ok", data: parseCard(res.data) };
}

export async function readTouches(session: CrmSession, householdId: string, before: string | null): Promise<CareRead<CareTouchPage>> {
  const res = await session.db.rpc("care_household_touches", { p_household: householdId, p_before: before ?? undefined, p_limit: 30 });
  if (res.error) return refusal("could not read the touch log", res.error);
  return { status: "ok", data: parseTouchPage(res.data) };
}

export async function readHolders(session: CrmSession): Promise<CareRead<CareHolder[]>> {
  const res = await session.db.rpc("care_holders", { p_center: session.center.id });
  if (res.error) return refusal("could not read who can own a household", res.error);
  return { status: "ok", data: parseHolders(res.data) };
}

export const CARE_PAGE_SIZE = 50;

/** The WeCare area's list of households. */
export async function loadCareList(session: CrmSession, filter: CareListFilter, search: string | null, page: number): Promise<CareRead<CareList>> {
  const res = await session.db.rpc("care_households", {
    p_center: session.center.id,
    p_filter: filter,
    p_search: search ?? undefined,
    p_limit: CARE_PAGE_SIZE,
    p_offset: Math.max(0, page - 1) * CARE_PAGE_SIZE,
  });
  if (res.error) return refusal("could not read the households", res.error);
  return { status: "ok", data: parseList(res.data) };
}

import "server-only";

// DonorDelight slice 2 (connect-crm 0760-0763): the reads, as the signed-in person (their own session, never a service key), so the
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
import {
  parseHouseholdThanks,
  parseThanksQueue,
  parseThanksSettings,
  parseThanksSummary,
  type HouseholdThanks,
  type ThanksFilter,
  type ThanksQueue,
  type ThanksSettings,
  type ThanksSummary,
} from "@/lib/care/thanks";

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

/** May this person see anything of DonorDelight here? (Convenience: the database decides.) */
export function seesCare(session: CrmSession): boolean {
  return careCan(session, "own");
}

export type CareCardLoad = {
  card: CareRead<CareCard>;
  touches: CareRead<CareTouchPage>;
  holders: CareRead<CareHolder[]> | null;
  /** The household's open thank-yous (slice 3); null when the card could not be read at all. */
  thanks?: CareRead<HouseholdThanks> | null;
};

/** The Care card of one household: the card, the first page of the touch log, and (for a manager) who can own it. */
export async function loadCareCard(session: CrmSession, householdId: string): Promise<CareCardLoad> {
  const [card, touches] = await Promise.all([readCard(session, householdId), readTouches(session, householdId, null)]);
  const holders = card.status === "ok" && card.data.access.manage ? await readHolders(session) : null;
  const thanks = card.status === "ok" ? await loadHouseholdThanks(session, householdId) : null;
  return { card, touches, holders, thanks };
}

export async function readCard(session: CrmSession, householdId: string): Promise<CareRead<CareCard>> {
  const res = await session.db.rpc("care_household_card", { p_household: householdId });
  if (res.error) return refusal("could not read the care card", res.error);
  return { status: "ok", data: parseCard(res.data) };
}

/** Where the next page of the touch log starts: the time and key of the last row shown (rows sharing a time stay in order). */
export type TouchCursor = { at: string; key: string };

export async function readTouches(session: CrmSession, householdId: string, before: TouchCursor | null): Promise<CareRead<CareTouchPage>> {
  const res = await session.db.rpc("care_household_touches", {
    p_household: householdId,
    p_before_at: before?.at ?? undefined,
    p_before_key: before?.key ?? undefined,
    p_limit: 30,
  });
  if (res.error) return refusal("could not read the touch log", res.error);
  return { status: "ok", data: parseTouchPage(res.data) };
}

export async function readHolders(session: CrmSession): Promise<CareRead<CareHolder[]>> {
  const res = await session.db.rpc("care_holders", { p_center: session.center.id });
  if (res.error) return refusal("could not read who can own a household", res.error);
  return { status: "ok", data: parseHolders(res.data) };
}

export const CARE_PAGE_SIZE = 50;

/** The DonorDelight area's list of households. */
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

// ── The thank-you tracker (slice 3, 0881-0883) ───────────────────────────────

export const THANKS_PAGE_SIZE = 50;

/** The thank-you list: open, overdue, done or set aside. The database opens any step that is missing, and logs the read. */
export async function loadThanksQueue(session: CrmSession, filter: ThanksFilter, page: number): Promise<CareRead<ThanksQueue>> {
  const res = await session.db.rpc("care_thanks_queue", {
    p_center: session.center.id,
    p_filter: filter,
    p_limit: THANKS_PAGE_SIZE,
    p_offset: Math.max(0, page - 1) * THANKS_PAGE_SIZE,
  });
  if (res.error) return refusal("could not read the thank-yous", res.error);
  return { status: "ok", data: parseThanksQueue(res.data) };
}

/** How fast gifts are thanked, over the last 90 days. */
export async function loadThanksSummary(session: CrmSession): Promise<CareRead<ThanksSummary>> {
  const res = await session.db.rpc("care_thanks_summary", { p_center: session.center.id, p_days: 90 });
  if (res.error) return refusal("could not read how fast gifts are thanked", res.error);
  return { status: "ok", data: parseThanksSummary(res.data) };
}

/** The open thank-yous of one household, for the Care card. */
export async function loadHouseholdThanks(session: CrmSession, householdId: string): Promise<CareRead<HouseholdThanks>> {
  const res = await session.db.rpc("care_household_thanks", { p_household: householdId });
  if (res.error) return refusal("could not read this household's thank-yous", res.error);
  return { status: "ok", data: parseHouseholdThanks(res.data) };
}

/** The community's thank-you rules (a manager, or support with the care.settings area, may change them). */
export async function loadThanksSettings(session: CrmSession): Promise<CareRead<ThanksSettings>> {
  const res = await session.db.rpc("care_settings_get", { p_center: session.center.id });
  if (res.error) return refusal("could not read the thank-you rules", res.error);
  return { status: "ok", data: parseThanksSettings(res.data) };
}

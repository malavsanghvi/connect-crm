"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { runScreenCommand } from "@/lib/commands/screen";
import { failure } from "@/lib/errors";
import { isModuleEnabled, moduleDef, moduleOffMessage } from "@/lib/modules";
import { can } from "@/lib/permissions";
import { tierLabel } from "@/lib/people";
import { MEMBERSHIP_NOTE_MAX, MEMBERSHIP_REASON_MAX, canChangeMemberships, inRange, isRealDate } from "@/lib/people-v2/memberships";
import { NO_ACCESS_TEXT } from "@/lib/people-v2/slideover";
import { isUuid } from "@/lib/search-params";
import { authorizeActionWhere, type CrmSession } from "@/lib/session";

// The Memberships section of the person slide-over: three thin Server Actions. Each checks the SHAPE of what came from the browser,
// asks for the people the database asks (both people.approve and people.manage), then runs as the signed-in person; the database
// is the real gate and checks everything again (migration 0724).
//
//   editMembershipAction    app.staff_update_membership: the start date, end date and note, with a reason
//   assignMembershipAction  app.staff_assign_membership: a new membership, ACTIVE AT ONCE and with NO Executive Committee step
//                           (owner decision 2026-10-13), the fee recorded as an open pledge only when asked for
//   changeTierAction        the existing people.update_household command with a tier and its reason (app.change_household_tier)
//
// Every one answers { ok, error } in plain words next to what the person did, logs the technical detail on the server (failure()),
// and never says it worked when it did not. A refusal reads "You don't have access to this area".

export type EditCall = { membershipId: string; householdId: string; startsOn: string; endsOn: string | null; notes: string | null; reason: string };
export type AssignCall = { householdId: string; holderId: string | null; typeId: string; startsOn: string; endsOn: string | null; reason: string; recordFee: boolean };
export type TierCall = { householdId: string; tier: string; reason: string };

export type MembershipSave = { ok: true; message: string } | { ok: false; error: string; stepUp?: boolean };
export type AssignSave =
  | { ok: true; message: string; membershipId: string; /** Whether a fee pledge is linked to the new membership; null when the server could not say. */ feeRecorded: boolean | null }
  | { ok: false; error: string; stepUp?: boolean };

type Refused = { ok: false; error: string; stepUp?: boolean };

const TIERS = ["community", "yearly", "life"];

const accessRefusal = (): Refused => ({ ok: false, error: `${NO_ACCESS_TEXT}. Nothing was changed.` });
const notUnderstood = (doing: string): Refused => ({ ok: false, error: `Could not ${doing} — the request was not understood. Nothing was changed.` });

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isDay = (v: unknown): v is string => typeof v === "string" && isRealDate(v) && inRange(v);
const isOptionalDay = (v: unknown): v is string | null => v === null || isDay(v);

/** The signed-in person, if they hold both permissions and the Membership module is on. Anything else is said in words. */
async function authorize(doing: string): Promise<{ ok: true; session: CrmSession } | Refused> {
  const auth = await authorizeActionWhere((s) => canChangeMemberships((p) => can(s, p)), doing, "people.approve and people.manage");
  if (!auth.ok) return /don't have permission/.test(auth.error) ? accessRefusal() : auth;
  if (!isModuleEnabled(auth.session, "membership")) {
    return { ok: false, error: moduleOffMessage("membership", auth.session.center.name, moduleDef("membership").label) };
  }
  return auth;
}

/** A database error in words. A refusal for lack of permission reads as the access sentence; a switched-off module keeps its own words. */
function dbFailure(doing: string, error: unknown): Refused {
  const e = (error && typeof error === "object" ? error : {}) as { code?: string | null; message?: string | null };
  const message = (e.message ?? "").trim();
  if (e.code === "42501") {
    console.error(`[crm] Could not ${doing}:`, error);
    if (/switched off|is not part of/i.test(message)) return { ok: false, error: `Could not ${doing} — ${message}${/[.!?]$/.test(message) ? "" : "."}` };
    return accessRefusal();
  }
  return failure(`Could not ${doing}`, error);
}

/** The generated argument types know no null; these functions take a null for "none". */
const orNull = <T>(v: T | null): T => v as T;

function refresh(householdId: string) {
  revalidatePath(`/households/${householdId}`);
  revalidatePath("/people");
}

export async function editMembershipAction(input: EditCall): Promise<MembershipSave> {
  const doing = "save the membership";
  if (
    !input ||
    typeof input !== "object" ||
    !isUuid(input.membershipId) ||
    !isUuid(input.householdId) ||
    !isDay(input.startsOn) ||
    !isOptionalDay(input.endsOn) ||
    !(input.notes === null || isText(input.notes, MEMBERSHIP_NOTE_MAX * 2)) ||
    !isText(input.reason, MEMBERSHIP_REASON_MAX * 2)
  ) {
    return notUnderstood(doing);
  }
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  return withActivity(
    "people.edit_membership",
    async (): Promise<MembershipSave> => {
      const res = await session.db.rpc("staff_update_membership", {
        p_membership: input.membershipId,
        p_starts_on: input.startsOn,
        p_ends_on: orNull(input.endsOn),
        p_notes: orNull(input.notes),
        p_reason: input.reason,
      });
      if (res.error) return dbFailure(doing, res.error);
      refresh(input.householdId);
      return { ok: true, message: "Membership saved · audit logged" };
    },
    { entityFrom: { kind: "household", id: input.householdId } },
  );
}

export async function assignMembershipAction(input: AssignCall): Promise<AssignSave> {
  const doing = "assign the membership";
  if (
    !input ||
    typeof input !== "object" ||
    !isUuid(input.householdId) ||
    !(input.holderId === null || isUuid(input.holderId)) ||
    !isUuid(input.typeId) ||
    !isDay(input.startsOn) ||
    !isOptionalDay(input.endsOn) ||
    !isText(input.reason, MEMBERSHIP_REASON_MAX * 2) ||
    typeof input.recordFee !== "boolean"
  ) {
    return notUnderstood(doing);
  }
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  return withActivity(
    "people.assign_membership",
    async (): Promise<AssignSave> => {
      const res = await session.db.rpc("staff_assign_membership", {
        p_household: input.householdId,
        p_person: orNull(input.holderId),
        p_type: input.typeId,
        p_starts_on: input.startsOn,
        p_ends_on: orNull(input.endsOn),
        p_reason: input.reason,
        p_record_fee: input.recordFee,
      });
      if (res.error) return dbFailure(doing, res.error);
      const membershipId = typeof res.data === "string" ? res.data : "";
      // The function answers with the new membership's id; whether a fee pledge was recorded is read from the membership itself.
      let feeRecorded: boolean | null = null;
      if (membershipId) {
        const back = await session.db.from("memberships").select("fee_pledge_id").eq("id", membershipId).maybeSingle();
        if (back.error) console.error("[crm] The new membership's fee pledge could not be read back; the screen says to check the Giving tab:", back.error);
        else if (back.data) feeRecorded = Boolean(back.data.fee_pledge_id);
      }
      refresh(input.householdId);
      return { ok: true, message: "Membership assigned · audit logged", membershipId, feeRecorded };
    },
    { entityFrom: { kind: "household", id: input.householdId } },
  );
}

export async function changeTierAction(input: TierCall): Promise<MembershipSave> {
  const doing = "change the membership tier";
  if (!input || typeof input !== "object" || !isUuid(input.householdId) || !TIERS.includes(input.tier) || !isText(input.reason, MEMBERSHIP_REASON_MAX * 2)) {
    return notUnderstood(doing);
  }
  const auth = await authorize(doing);
  if (!auth.ok) return auth;
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "Could not change the membership tier — say why the tier is changing (it goes in the audit log)." };
  // The SAME command the household screen, the palette and the rules already share (it asks for people.approve and a reason).
  const result = await withActivity(
    "people.update_household",
    () => runScreenCommand("people.update_household", { id: input.householdId, tier: input.tier, tier_reason: reason }, doing),
    { entityFrom: { kind: "household", id: input.householdId } },
  );
  if (!result.ok) return { ok: false, error: result.error, ...(result.stepUp ? { stepUp: true } : {}) };
  refresh(input.householdId);
  return { ok: true, message: `The family now holds a ${tierLabel(input.tier)} membership · audit logged` };
}

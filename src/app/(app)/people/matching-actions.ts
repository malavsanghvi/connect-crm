"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { matchingCan } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeActionWhere, dbWithReason } from "@/lib/session";

// CatchTheMatch (migration 0759): the office records an adult's employer for gift matching from a signed paper form. The database
// (app.record_match_employer) checks matching.manage again (never a platform admin as such), refuses anyone under 18, and records it as
// the person's consent with who recorded it and when; the person sees and removes it in the member app. Not recorded in the activity
// stream: CatchTheMatch is the organization's own data (docs/CATCH_THE_MATCH.md section 6).

export async function recordMatchEmployerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const personId = String(fd.get("person_id") ?? "");
  const firstName = String(fd.get("first_name") ?? "").trim().slice(0, 80) || "This person";
  const employer = String(fd.get("employer") ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!isUuid(personId)) return { ok: false, error: "Could not record the employer — the person was not found. Reload the page and try again." };
  if (!employer) return { ok: false, error: "Could not record the employer — enter the employer's name." };
  if (employer.length > 120) return { ok: false, error: "Could not record the employer — the name can be at most 120 characters." };
  if (fd.get("signed") !== "on") {
    return { ok: false, error: `Could not record the employer — tick the box to confirm ${firstName} signed a paper form agreeing to gift matching.` };
  }
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "record the employer", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Recorded from a signed paper form");
  const { error } = await db.rpc("record_match_employer", { p_center: auth.session.center.id, p_person: personId, p_employer: employer });
  if (error) return failure("Could not record the employer for gift matching", error);
  revalidatePath("/households");
  revalidatePath(`/people/${personId}`);
  return { ok: true, message: `Recorded. ${firstName} can see it and remove it in the member app.` };
}

/** The office withdraws the employer on file when the person asks (app.withdraw_match_employer: matching.manage, a reason, audited). */
export async function withdrawMatchEmployerAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const personId = String(fd.get("person_id") ?? "");
  const firstName = String(fd.get("first_name") ?? "").trim().slice(0, 80) || "This person";
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  if (!isUuid(personId)) return { ok: false, error: "Could not withdraw the employer — the person was not found. Reload the page and try again." };
  if (!reason) return { ok: false, error: `Could not withdraw the employer — say how ${firstName} asked. It goes in the audit log.` };
  const auth = await authorizeActionWhere((s) => matchingCan(s, "manage"), "withdraw the employer", "matching.manage");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const { data, error } = await db.rpc("withdraw_match_employer", { p_center: auth.session.center.id, p_person: personId, p_reason: reason });
  if (error) return failure("Could not withdraw the employer for gift matching", error);
  revalidatePath("/households");
  revalidatePath(`/people/${personId}`);
  if (data !== true) return { ok: false, error: "Could not withdraw the employer — nothing was on file any more. Reload the page." };
  return { ok: true, message: `Withdrawn. Nothing is on file for ${firstName} any more.` };
}

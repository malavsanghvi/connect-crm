// Not "server-only" itself: it is imported only by Server Actions and it reaches the session (which is). What every DonorDelight Server Action shares (slices 5 and later): the convenience permission check and the way a database refusal is
// said. The database is the real gate (app.care_can: no platform-admin branch); the check here only spares a round trip. Each failure is
// said in plain English next to what the person did, with the technical detail logged on the server (failure()), and "Nothing was changed."
// when nothing was.

import { NO_ACCESS, isNoAccess, offSentence } from "@/lib/care/model";
import { failure } from "@/lib/errors";
import { careCan } from "@/lib/permissions";
import { authorizeActionWhere, type CrmSession } from "@/lib/session";

export type CareAuthorized = { ok: true; session: CrmSession };
export type CareRefused = { ok: false; error: string };

export const notUnderstood = (doing: string): CareRefused => ({ ok: false, error: `Could not ${doing} — the request was not understood. Nothing was changed.` });

/** Signed in, and holding a care key of this level (own = any care key, view, manage). */
export async function authorizeCare(doing: string, level: "own" | "view" | "manage"): Promise<CareAuthorized | CareRefused> {
  const needs = level === "manage" ? "care.manage" : level === "view" ? "care.view or care.manage" : "care.own, care.view or care.manage";
  const auth = await authorizeActionWhere((s) => careCan(s, level), doing, needs);
  if (!auth.ok) return /don't have permission/.test(auth.error) ? { ok: false, error: `${NO_ACCESS}. Nothing was changed.` } : auth;
  return auth;
}

/** A database refusal in words: "off" and "no access" keep the database's own sentence when it is more precise; anything else is logged and generic. */
export function careDbFailure(doing: string, error: unknown, tag = "care"): CareRefused {
  const off = offSentence(error);
  if (off) {
    console.error(`[${tag}] could not ${doing}:`, error);
    return { ok: false, error: `Could not ${doing} — ${off} Nothing was changed.` };
  }
  if (isNoAccess(error)) {
    const msg = (error as { message?: string | null }).message ?? "";
    const precise = msg && !/You don't have access to this area/i.test(msg) ? msg : `${NO_ACCESS}.`;
    console.error(`[${tag}] could not ${doing}:`, error);
    return { ok: false, error: `Could not ${doing} — ${precise.replace(/\.?$/, ".")} Nothing was changed.` };
  }
  // A refusal in words from the database (a rule it checked) is shown as it is; a code or a technical message is not.
  const code = (error as { code?: string | null } | null)?.code ?? "";
  const msg = (error as { message?: string | null } | null)?.message ?? "";
  if (["22023", "23514", "23505", "P0002"].includes(code) && msg && msg.length < 300) {
    console.error(`[${tag}] could not ${doing}:`, error);
    return { ok: false, error: `Could not ${doing} — ${msg.replace(/\.?$/, ".")} Nothing was changed.` };
  }
  return failure(`Could not ${doing}`, error);
}

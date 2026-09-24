"use server";

import { failure, type ActionResult } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Accept a staff invitation as the signed-in user (app.accept_invitation links the login and grants the roles). */
export async function acceptInvitationAction(token: string): Promise<ActionResult<{ pendingRoles: string[]; requires2fa: boolean }>> {
  let db;
  try {
    db = await createSupabaseServerClient();
  } catch (error) {
    return failure("Could not accept the invitation", error);
  }
  const { data: claims, error: claimsError } = await db.auth.getClaims();
  if (claimsError || !claims?.claims?.sub) return { ok: false, error: "Could not accept the invitation — sign in first." };
  const { data, error } = await db.rpc("accept_invitation", { p_token: String(token ?? "") });
  if (error) return failure("Could not accept the invitation", error);
  const r = (data ?? {}) as { pending_roles?: string[]; requires_2fa?: boolean };
  return {
    ok: true,
    message: "Invitation accepted",
    data: { pendingRoles: Array.isArray(r.pending_roles) ? r.pending_roles : [], requires2fa: r.requires_2fa === true },
  };
}

"use server";

import { cookies } from "next/headers";

import { CENTER_COOKIE, currentOrigin } from "@/lib/center-resolve";
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
  const r = (data ?? {}) as { pending_roles?: string[]; requires_2fa?: boolean; center_id?: string };
  // Open the portal on the community that invited them (a sandbox or a second organization
  // is not the address's default one). The switcher still lists every community they work with.
  if (typeof r.center_id === "string") {
    const c = await db.from("centers").select("slug").eq("id", r.center_id).maybeSingle();
    if (c.error || !c.data) {
      console.error("[invite] accepted, but could not read the community to open it; the portal opens on its default community:", c.error ?? "no row");
    } else {
      try {
        const origin = await currentOrigin();
        (await cookies()).set(CENTER_COOKIE, String(c.data.slug), {
          path: "/",
          httpOnly: true,
          sameSite: "lax",
          secure: origin.protocol.startsWith("https"),
          maxAge: 60 * 60 * 24 * 365,
        });
      } catch (error) {
        console.error("[invite] accepted, but could not remember the community for the portal; the switcher can open it:", error);
      }
    }
  }
  return {
    ok: true,
    message: "Invitation accepted",
    data: { pendingRoles: Array.isArray(r.pending_roles) ? r.pending_roles : [], requires2fa: r.requires_2fa === true },
  };
}

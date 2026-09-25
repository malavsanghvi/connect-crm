"use server";

import { revalidatePath } from "next/cache";

import { currentOrigin } from "@/lib/center-resolve";
import { failure, type ActionResult } from "@/lib/errors";
import { validateNewSandbox, type NewSandboxInput } from "@/lib/platform-sandbox";
import { invitationLink } from "@/lib/security";
import { dbWithReason, loadSession } from "@/lib/session";

export type CreatedSandbox = { centerId: string; slug: string; link: string; expiresAt: string; emailStatus: string | null; ownerEmail: string };

/**
 * Platform › Centers › New sandbox: app.platform_create_sandbox (platform admin, fresh 2FA
 * check, reason; audited) creates the <slug>-sandbox organization and invites its owner.
 * The invitation link is returned once so the console can show it to be sent by hand.
 */
export async function createSandboxAction(input: NewSandboxInput): Promise<ActionResult<CreatedSandbox>> {
  const doing = "create the sandbox";
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only Community Connect platform admins can do this.` };
  const parsed = validateNewSandbox(input);
  if (!parsed.ok) return { ok: false, error: `Could not ${doing} — ${parsed.error}` };
  const v = parsed.value;
  const origin = await currentOrigin();
  const base = origin.host ? `${origin.protocol.replace(/:$/, "")}://${origin.host}` : null;
  const db = await dbWithReason(state.session, v.reason);
  const { data, error } = await db.rpc("platform_create_sandbox", {
    p_name: v.name,
    p_slug: v.slug,
    p_org_type: v.orgType,
    p_city: v.city,
    p_state: v.state,
    p_owner_first_name: v.ownerFirstName,
    p_owner_last_name: v.ownerLastName,
    p_owner_email: v.ownerEmail,
    p_reason: v.reason,
    p_link_base: base ?? undefined,
  });
  if (error) return failure(`Could not ${doing}`, error);
  const r = (data ?? {}) as { center_id?: string; slug?: string; token?: string; expires_at?: string; email_status?: string | null };
  if (!r.center_id || !r.token || !r.slug) return { ok: false, error: `Could not ${doing} — the database returned no sandbox. Reload Platform › Centers to check.` };
  if (r.email_status && r.email_status !== "queued") console.error(`[platform/new-sandbox] the owner invitation email was not queued: ${r.email_status}`);
  revalidatePath("/platform");
  revalidatePath("/platform/pipeline");
  return {
    ok: true,
    message: `${v.name} sandbox created · owner invited · audit logged`,
    data: {
      centerId: r.center_id,
      slug: r.slug,
      link: invitationLink(base ?? "", r.token),
      expiresAt: r.expires_at ?? "",
      emailStatus: r.email_status ?? null,
      ownerEmail: v.ownerEmail,
    },
  };
}

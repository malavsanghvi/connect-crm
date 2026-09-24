"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { invitationLink, normalizePhone } from "@/lib/security";
import { authorizeAction, dbWithReason, loadSession } from "@/lib/session";

// Settings › Team (stream o-security): staff invitations, 2FA resets and the
// ownership transfer. The database enforces all of it (roles.manage, the
// owner, step-up, the two-person rule); these actions only pass the input on.

export type InviteResult = { link: string; expiresAt: string; pendingRoles: string[] };

/** https://<host> of this request, for the invitation link. */
async function origin(): Promise<string> {
  const h = await headers();
  const o = h.get("origin");
  if (o && /^https?:\/\//.test(o)) return o;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

const TWO_PERSON = new Set(["center_admin", "treasurer", "finance_volunteer", "executive_committee", "privacy_officer"]);

export async function inviteStaffAction(input: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roles: string[];
}): Promise<ActionResult<InviteResult>> {
  const auth = await authorizeAction("roles", "send the invitation");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const email = String(input.email ?? "").trim().toLowerCase();
  const phoneRaw = String(input.phone ?? "").trim();
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  const roles = [...new Set((input.roles ?? []).map(String).filter(Boolean))];
  if (!email && !phoneRaw) return { ok: false, error: "Could not send the invitation — enter an email or a mobile number." };
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Could not send the invitation — that email address does not look right." };
  if (phoneRaw && !phone) return { ok: false, error: "Could not send the invitation — enter the mobile number with its area code, for example (713) 555-0142." };
  if (roles.length === 0) return { ok: false, error: "Could not send the invitation — choose at least one role." };
  const first = String(input.firstName ?? "").trim().slice(0, 80);
  const last = String(input.lastName ?? "").trim().slice(0, 80);

  const { data, error } = await db.rpc("invite_staff", {
    p_center: center.id,
    p_email: email || undefined,
    p_phone: phone ?? undefined,
    p_person: undefined,
    p_role_keys: roles,
    p_scope: { kind: "center" },
    p_first_name: first || undefined,
    p_last_name: last || undefined,
  });
  if (error) return failure("Could not send the invitation", error);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.token) return { ok: false, error: "Could not send the invitation — the database returned no link." };
  revalidatePath("/settings/team");
  return {
    ok: true,
    message: "Invitation created · copy the link and send it — email and text sending are not connected yet",
    data: { link: invitationLink(await origin(), row.token), expiresAt: row.expires_at, pendingRoles: roles.filter((r) => TWO_PERSON.has(r)) },
  };
}

export async function resendInvitationAction(id: string): Promise<ActionResult<InviteResult>> {
  const auth = await authorizeAction("roles", "resend the invitation");
  if (!auth.ok) return auth;
  if (!isUuid(id)) return { ok: false, error: "Could not resend the invitation — it was not found." };
  const { data, error } = await auth.session.db.rpc("resend_invitation", { p_invitation: id });
  if (error) return failure("Could not resend the invitation", error);
  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.token) return { ok: false, error: "Could not resend the invitation — the database returned no link." };
  revalidatePath("/settings/team");
  return {
    ok: true,
    message: "New link created · the old link no longer works",
    data: { link: invitationLink(await origin(), row.token), expiresAt: row.expires_at, pendingRoles: [] },
  };
}

export async function revokeInvitationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("roles", "withdraw the invitation");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not withdraw the invitation — it was not found." };
  const { error } = await auth.session.db.rpc("revoke_invitation", { p_invitation: id, p_reason: "Withdrawn in Settings › Team" });
  if (error) return failure("Could not withdraw the invitation", error);
  revalidatePath("/settings/team");
  return { ok: true, message: "Invitation withdrawn · its link no longer works" };
}

/** Lost phone: another administrator (or the platform team) removes a staff member's authenticator apps. */
export async function resetStaff2faAction(userId: string, reason: string): Promise<ActionResult> {
  const auth = await authorizeAction("roles", "reset 2FA");
  if (!auth.ok) return auth;
  if (!isUuid(userId)) return { ok: false, error: "Could not reset 2FA — choose a person." };
  const why = String(reason ?? "").trim();
  if (!why) return { ok: false, error: "Could not reset 2FA — say why (for example: lost phone, identity checked in person)." };
  const writer = await dbWithReason(auth.session, why);
  const { data, error } = await writer.rpc("reset_staff_2fa", { p_center: auth.session.center.id, p_user: userId, p_reason: why });
  if (error) return failure("Could not reset 2FA", error);
  revalidatePath("/settings/team");
  return {
    ok: true,
    message: `2FA reset · ${data ?? 0} authenticator app${data === 1 ? "" : "s"} removed and they are signed out everywhere · audit logged`,
  };
}

export async function transferOwnershipAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: "Could not transfer ownership — your session has expired. Sign in again." };
  const session = state.session;
  const to = String(formData.get("to_user") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!isUuid(to)) return { ok: false, error: "Could not transfer ownership — choose the new owner." };
  if (!reason) return { ok: false, error: "Could not transfer ownership — give a reason; it goes in the audit log." };
  const writer = await dbWithReason(session, reason);
  const { error } = await writer.rpc("transfer_ownership", { p_center: session.center.id, p_to_user: to, p_reason: reason });
  if (error) return failure("Could not transfer ownership", error);
  revalidatePath("/settings/team");
  revalidatePath("/settings/agreements");
  return { ok: true, message: "Ownership transferred · audit logged" };
}

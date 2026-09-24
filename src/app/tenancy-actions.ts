"use server";

import { cookies } from "next/headers";

import { CENTER_COOKIE, currentOrigin, portalBaseDomain } from "@/lib/center-resolve";
import { failure, type ActionResult } from "@/lib/errors";
import { loadSession } from "@/lib/session";
import { SLUG_RE, switchUrl } from "@/lib/tenancy";

/**
 * Switch the portal to another organization the user works with. Returns the
 * address to load: the organization's own address when it has one (its
 * domain, or <slug>.<PORTAL_BASE_DOMAIN>); otherwise the choice is kept in a
 * cookie and the portal reloads at "/". Either way the page is reloaded in
 * full, so every server component re-reads the session for the new
 * organization (permissions, modules, branding, data).
 */
export async function switchCenterAction(slug: string): Promise<ActionResult<{ url: string }>> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: "Could not switch — your session has expired. Sign in again." };
  const target = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  if (!SLUG_RE.test(target)) return { ok: false, error: "Could not switch — that community is not valid. Reload and try again." };
  if (state.status !== "ok") return { ok: false, error: "Could not switch — the app could not load your session. Reload and try again." };
  const found = state.session.switchable.find((c) => c.slug === target);
  if (!found) return { ok: false, error: "Could not switch — you don't have a role in that community. Ask its administrator for access." };
  try {
    const url = switchUrl(found, await currentOrigin(), portalBaseDomain());
    if (url) return { ok: true, data: { url } };
    const origin = await currentOrigin();
    (await cookies()).set(CENTER_COOKIE, target, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: origin.protocol.startsWith("https"),
      maxAge: 60 * 60 * 24 * 365,
    });
    return { ok: true, data: { url: "/" } };
  } catch (error) {
    return failure("Could not switch community", error);
  }
}

import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { Json } from "@/lib/database.types";
import { readPublicEnv, type EnvProblem } from "@/lib/env";
import { explainError } from "@/lib/errors";
import {
  ACCESS,
  canAccess,
  isGrantActive,
  sessionPermissions,
  type AccessKey,
  type PermissionContext,
  type ScopedGrant,
} from "@/lib/permissions";
import { resolveCenterChoice, type CenterChoice } from "@/lib/center-resolve";
import { loadMyModules, modulesOffFrom } from "@/lib/modules-db";
import { requires2faForStaff, securityRedirect } from "@/lib/security";
import { createSupabaseServerClient, type AppSupabase } from "@/lib/supabase/server";
import { PATHNAME_HEADER, newRequestId } from "@/lib/supabase/trace";

export type CenterInfo = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  time_zone: string;
  currency: string;
  branding: Json;
  feature_flags: Json;
  rules: Json;
  status: string;
  /** "production" or "sandbox" (0160). A sandbox shows the watermark and has sandbox limits. */
  environment: string;
};

/** An organization the user can switch to (app.my_centers). */
export type SwitchableCenter = {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  environment: string;
  status: string;
  portal_domain: string | null;
};

export type CrmSession = PermissionContext & {
  db: AppSupabase;
  userId: string;
  email: string | null;
  center: CenterInfo;
  person: { id: string; name: string; memberNumber: string | null } | null;
  /** Active grants, for display (includes scoped grants). */
  roles: { key: string; name: string; scopeKind: string }[];
  /** Active grants with their scope ids, for scoped-role checks (a class teacher, an event lead). */
  grants: ScopedGrant[];
  /**
   * The organization's owner (app.is_center_owner). The owner holds every permission in their
   * organization, grant or not (0400, owner decision 2026-09-25), and counts as staff for 2FA.
   */
  isOwner: boolean;
  /** x-request-id of this server request / action: every change it makes shares it in the audit log. */
  requestId: string;
  /** Module keys switched off for the center (app.my_modules); empty when all are on or unknown. */
  modulesOff: string[];
  /** "missing" before the s-core migrations land, "error" when my_modules failed: both mean "treat everything as on". */
  modulesStatus: "ok" | "missing" | "error";
  /** The session's assurance level from the JWT: "aal2" once it passed 2FA (o-security). */
  aal: string;
  /** The JWT's amr (sign-in methods with their times), for step-up freshness. */
  amr: unknown;
  /** How this request's organization was chosen (web address, switcher, default). */
  centerSource: CenterChoice["source"];
  /** Organizations this user works with (the switcher); includes the current one. Empty when they could not be loaded. */
  switchable: SwitchableCenter[];
};

export type SessionState =
  | { status: "ok"; session: CrmSession }
  | { status: "env_missing"; problems: EnvProblem[] }
  | { status: "signed_out" }
  | { status: "center_missing"; slug: string; source: CenterChoice["source"] }
  | { status: "error"; message: string };

/** Resolve user → center → grants → permissions once per request. */
export const loadSession = cache(async (): Promise<SessionState> => {
  const envCheck = readPublicEnv();
  if (!envCheck.ok) return { status: "env_missing", problems: envCheck.problems };

  // One id per server request; a Server Action is its own request, so it gets a fresh one.
  const requestId = newRequestId();
  const db = await createSupabaseServerClient({ requestId });
  const { data: claimsData, error: claimsError } = await db.auth.getClaims();
  if (claimsError && claimsError.name !== "AuthSessionMissingError") {
    console.error("[session] could not validate the session:", claimsError);
  }
  const claims = claimsData?.claims;
  if (!claims?.sub) return { status: "signed_out" };
  const userId = claims.sub;
  const email = typeof claims.email === "string" ? claims.email : null;

  // The organization comes from the web address, else the switcher, else NEXT_PUBLIC_CENTER_SLUG.
  const choice = await resolveCenterChoice(envCheck.env.centerSlug);
  const slug = choice.slug;
  const centerRes = await db
    .from("centers")
    .select("id, slug, name, short_name, time_zone, currency, branding, feature_flags, rules, status, environment")
    .eq("slug", slug)
    .maybeSingle();
  if (centerRes.error) {
    console.error("[session] could not load the center:", centerRes.error);
    return { status: "error", message: `Could not load the center "${slug}" — ${explainError(centerRes.error)}` };
  }
  if (!centerRes.data) return { status: "center_missing", slug, source: choice.source };
  const center = centerRes.data;

  const [grantsRes, rolesRes, accountRes, linkRes, modulesRes, switchRes, ownerRes] = await Promise.all([
    db
      .from("role_grants")
      .select("role_key, scope_kind, scope_id, starts_at, ends_at")
      .eq("center_id", center.id)
      .eq("user_id", userId),
    db.from("roles").select("key, name, tier, permissions"),
    db.from("accounts").select("is_platform_admin").eq("user_id", userId).maybeSingle(),
    db.from("center_users").select("person_id").eq("center_id", center.id).eq("user_id", userId).maybeSingle(),
    loadMyModules(db, center.id),
    db.rpc("my_centers"),
    db.rpc("is_center_owner", { p_center: center.id }),
  ]);
  // The switcher is a convenience: without it the user still works in this organization.
  if (switchRes.error) console.error("[session] could not list the organizations for the switcher (showing none):", switchRes.error);
  const firstError = grantsRes.error ?? rolesRes.error ?? accountRes.error ?? linkRes.error ?? ownerRes.error;
  if (firstError) {
    console.error("[session] could not load roles and permissions:", firstError);
    return { status: "error", message: `Could not load your roles and permissions — ${explainError(firstError)}` };
  }

  const grants = grantsRes.data ?? [];
  const roles = rolesRes.data ?? [];
  const now = new Date();
  const isOwner = ownerRes.data === true;
  const permissions = sessionPermissions(grants, roles, isOwner, now);
  const roleNames = new Map(roles.map((r) => [r.key, r.name]));

  let person: CrmSession["person"] = null;
  if (linkRes.data?.person_id) {
    const p = await db
      .from("people")
      .select("id, first_name, last_name, preferred_name, member_number")
      .eq("id", linkRes.data.person_id)
      .maybeSingle();
    if (p.error) {
      console.error("[session] could not load the linked person:", p.error);
    } else if (p.data) {
      person = {
        id: p.data.id,
        name: `${p.data.preferred_name || p.data.first_name} ${p.data.last_name}`,
        memberNumber: p.data.member_number,
      };
    }
  }

  return {
    status: "ok",
    session: {
      db,
      userId,
      email,
      center: { ...center, slug: String(center.slug) },
      isPlatformAdmin: accountRes.data?.is_platform_admin ?? false,
      isOwner,
      permissions,
      person,
      roles: grants
        .filter((g) => isGrantActive(g, now))
        .map((g) => ({ key: g.role_key, name: roleNames.get(g.role_key) ?? g.role_key, scopeKind: g.scope_kind })),
      grants: grants
        .filter((g) => isGrantActive(g, now))
        .map((g) => ({ role_key: g.role_key, scope_kind: g.scope_kind, scope_id: g.scope_id })),
      requestId,
      modulesOff: modulesRes.status === "ok" ? modulesOffFrom(modulesRes.rows) : [],
      modulesStatus: modulesRes.status,
      aal: typeof claims.aal === "string" ? claims.aal : "aal1",
      amr: (claims as { amr?: unknown }).amr ?? null,
      centerSource: choice.source,
      switchable: (switchRes.data ?? []).map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        short_name: c.short_name,
        environment: c.environment,
        status: c.status,
        portal_domain: c.portal_domain,
      })),
    },
  };
});

/**
 * A client for a change the user gave a reason for (write-off, refund,
 * override, tier change, boli close, role grant, module switch…): the same
 * user and request id, plus x-audit-reason, so the audit rows of this change
 * carry the reason. Use it only for the write(s) the reason explains.
 */
export async function dbWithReason(session: Pick<CrmSession, "requestId">, reason: string): Promise<AppSupabase> {
  return createSupabaseServerClient({ requestId: session.requestId, reason });
}

/** What to check when the organization named by the request does not exist. */
export function centerMissingHint(source: CenterChoice["source"]): string {
  switch (source) {
    case "subdomain":
      return "Check the web address: the part before the first dot must be a community's short name.";
    case "domain":
      return "This web address is registered to a community that is no longer active.";
    case "switcher":
      return "The community chosen in the switcher is no longer available. Choose another one.";
    case "default":
      return "Check NEXT_PUBLIC_CENTER_SLUG.";
  }
}

/**
 * Staff 2FA (centers.rules.security.require_2fa_for_staff, o-security): a staff
 * session that has not passed 2FA is sent to Account › Security to set up or
 * enter its authenticator code. Runs in the portal layout (first load) and in
 * getSession (every page). The database refuses sensitive changes on its own.
 */
export async function enforceStaff2fa(session: CrmSession): Promise<void> {
  let pathname: string | null = null;
  try {
    pathname = (await headers()).get(PATHNAME_HEADER);
  } catch (error) {
    console.error("[session] could not read the request pathname for the 2FA check:", error);
  }
  const to = securityRedirect({
    requires: requires2faForStaff(session.center.rules),
    isStaff: session.grants.length > 0 || session.isOwner,
    aal: session.aal,
    pathname,
  });
  if (to) redirect(to);
}

/** For pages: the signed-in session, or a redirect to /login (or to 2FA, for staff who need it). */
export async function getSession(): Promise<CrmSession> {
  const state = await loadSession();
  switch (state.status) {
    case "ok":
      await enforceStaff2fa(state.session);
      return state.session;
    case "signed_out":
      redirect("/login");
    case "env_missing":
      throw new Error("Community Connect is not configured yet. Set the NEXT_PUBLIC_* variables listed on the setup page.");
    case "center_missing":
      throw new Error(`No center with slug "${state.slug}" exists. ${centerMissingHint(state.source)}`);
    case "error":
      throw new Error(state.message);
  }
}

export type Authorized = { ok: true; session: CrmSession };
export type Refused = { ok: false; error: string };

/**
 * For Server Actions: re-check the session and the UI permission before
 * touching data. (Actions are reachable by direct POST; the database still
 * enforces RLS on every write.)
 */
export async function authorizeAction(key: AccessKey, doing: string): Promise<Authorized | Refused> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") {
    const why =
      state.status === "env_missing"
        ? "the app is not configured"
        : state.status === "center_missing"
          ? `community "${state.slug}" was not found`
          : state.message;
    return { ok: false, error: `Could not ${doing} — ${why}.` };
  }
  if (!canAccess(state.session, key)) {
    return {
      ok: false,
      error: `Could not ${doing} — you don't have permission (needs ${ACCESS[key].join(" or ")}).`,
    };
  }
  return { ok: true, session: state.session };
}

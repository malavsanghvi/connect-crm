import type { Metadata } from "next";

import { Alert, PageHeader } from "@/components/ui";
import { explainError } from "@/lib/errors";
import { readSecuritySettings } from "@/lib/settings-rules";
import { safeNext, stepUpFreshNow } from "@/lib/security";
import { getSession } from "@/lib/session";

import { SecurityPanel, type FactorView, type SecurityStatus } from "./security-panel";

export const metadata: Metadata = { title: "Account · Security" };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Account › Security: the signed-in person's own 2FA, phone and sessions (stream o-security). */
export default async function AccountSecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  const sp = await searchParams;
  const required = first(sp.required) === "1";
  const next = safeNext(first(sp.next));
  const welcome = first(sp.welcome) === "1";
  const { db, center } = session;
  const community = center.short_name || center.name;

  const [statusRes, factorsRes] = await Promise.all([db.rpc("my_security_status", { p_center: center.id }), db.auth.mfa.listFactors()]);
  if (statusRes.error) console.error("[account/security] my_security_status failed:", statusRes.error);
  if (factorsRes.error) console.error("[account/security] listFactors failed:", factorsRes.error);
  const raw = (statusRes.data ?? null) as Record<string, unknown> | null;
  const status: SecurityStatus = {
    hasTotp: raw?.has_totp === true,
    phone: typeof raw?.phone === "string" && raw.phone ? `+${String(raw.phone).replace(/^\+/, "")}` : null,
    phoneVerified: raw?.phone_verified === true,
    isStaff: raw?.is_staff === true || session.grants.length > 0 || session.isOwner,
    required: raw?.required === true,
    policyRequires: raw?.policy_requires_2fa === true,
  };
  const factors: FactorView[] = (factorsRes.data?.totp ?? [])
    .filter((f) => f.status === "verified")
    .map((f) => ({ id: f.id, name: f.friendly_name || "Authenticator app", createdAt: f.created_at }));
  const loadProblem = statusRes.error
    ? `Could not load your security status — ${explainError(statusRes.error)}.`
    : factorsRes.error
      ? `Could not load your authenticator apps — ${factorsRes.error.message || "the sign-in service gave no reason"}.`
      : null;
  const policy = readSecuritySettings(center.rules);

  return (
    <>
      <PageHeader
        title="Account"
        description={`Your sign-in security at ${center.name}: two-step verification (2FA), your mobile number and your sessions`}
        tabs={false}
      />
      {welcome ? (
        <div className="mb-4">
          <Alert tone="success" title={`Welcome to ${community}'s team`}>
            Your invitation is accepted. Set up an authenticator app below: staff use it at sign-in and before sensitive changes.
          </Alert>
        </div>
      ) : null}
      {required && session.aal !== "aal2" ? (
        <div className="mb-4">
          <Alert tone="warning" title={factors.length > 0 ? "Enter your 2FA code to continue" : "Set up two-step verification to continue"}>
            {community} requires two-step verification (2FA) for staff.{" "}
            {factors.length > 0
              ? "Enter the 6-digit code from your authenticator app below; the rest of the portal opens once it is checked."
              : "Add an authenticator app below (Google Authenticator, Microsoft Authenticator, 1Password, Authy…); the rest of the portal opens once it is on."}
          </Alert>
        </div>
      ) : null}
      {loadProblem ? (
        <div className="mb-4">
          <Alert tone="danger" title="Something did not load">
            {loadProblem}
          </Alert>
        </div>
      ) : null}
      <SecurityPanel
        status={status}
        factors={factors}
        aal={session.aal}
        stepUpFresh={stepUpFreshNow(session.aal, session.amr)}
        next={next}
        required={required}
        community={community}
        sessionHours={policy.adminSessionHours}
        idleMinutes={policy.adminIdleMinutes}
      />
    </>
  );
}

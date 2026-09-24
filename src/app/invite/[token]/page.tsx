import type { Metadata } from "next";

import { CenteredPanel, SetupScreen } from "@/components/setup-screen";
import { readPublicEnv } from "@/lib/env";
import { explainError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { InviteAccept, type InvitePreview } from "./invite-accept";

export const metadata: Metadata = { title: "Join your team" };

/** A staff invitation link (/invite/<token>): who invited you, to what, and sign in to accept (stream o-security). */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const check = readPublicEnv();
  if (!check.ok) return <SetupScreen problems={check.problems} />;
  const { token } = await params;
  let preview: InvitePreview | null = null;
  let problem: string | null = null;
  let signedInEmail: string | null = null;
  try {
    const db = await createSupabaseServerClient();
    const [res, claims] = await Promise.all([db.rpc("invitation_preview", { p_token: token }), db.auth.getClaims()]);
    if (res.error) {
      console.error("[invite] preview failed:", res.error);
      problem = `Could not open the invitation — ${explainError(res.error)}.`;
    } else {
      const row = Array.isArray(res.data) ? res.data[0] : null;
      preview = row
        ? {
            status: row.status as InvitePreview["status"],
            centerName: row.center_name,
            contact: row.contact,
            contactKind: row.contact_kind === "phone" ? "phone" : "email",
            roles: row.role_names ?? [],
            expiresAt: row.expires_at,
            invitedBy: row.invited_by_name,
          }
        : null;
    }
    const email = claims.data?.claims?.email;
    signedInEmail = typeof email === "string" && email ? email : claims.data?.claims?.sub ? "(a signed-in account)" : null;
  } catch (error) {
    console.error("[invite] could not load the invitation:", error);
    problem = `Could not open the invitation — ${explainError(error)}.`;
  }
  if (problem) {
    return (
      <CenteredPanel title="Join your team">
        <p role="alert" className="text-danger">
          {problem}
        </p>
      </CenteredPanel>
    );
  }
  if (!preview) {
    return (
      <CenteredPanel title="This invitation link is not valid">
        <p>Check that you copied the whole link. If it still does not work, ask the person who invited you to resend the invitation.</p>
      </CenteredPanel>
    );
  }
  return (
    <InviteAccept
      token={token}
      preview={preview}
      signedInAs={signedInEmail}
      supabaseUrl={check.env.supabaseUrl}
      supabaseAnonKey={check.env.supabaseAnonKey}
    />
  );
}

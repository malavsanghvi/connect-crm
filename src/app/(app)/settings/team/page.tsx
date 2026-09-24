import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Alert, BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { can, canAccess } from "@/lib/permissions";
import { formatPhone, invitableRoles, invitationStatus } from "@/lib/security";
import { getSession } from "@/lib/session";

import { revokeInvitationAction, transferOwnershipAction } from "./actions";
import { InviteForm, ResendButton, ResetTwoFactorButton } from "./team-client";

export const metadata: Metadata = { title: "Team · Settings" };

const STATUS_TEXT = {
  pending: { tone: "warn", label: "Waiting to be accepted" },
  accepted: { tone: "ok", label: "Accepted" },
  expired: { tone: "bad", label: "Expired" },
  revoked: { tone: "bad", label: "Withdrawn" },
} as const;

function day(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Settings › Team: staff invitations, who has 2FA, lost-phone resets and the owner (stream o-security). */
export default async function TeamPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Invite staff, see who uses two-step verification, and manage the organization's owner" />;
  if (!canAccess(session, "roles")) {
    return (
      <>
        {header}
        <NoAccess area="Team" access="roles" />
      </>
    );
  }
  const { db, center, userId } = session;
  const [invites, team, roles, owner, check] = await Promise.all([
    db
      .from("staff_invitations")
      .select("id, email, phone_e164, first_name, last_name, role_keys, invited_by, expires_at, accepted_at, accepted_by, revoked_at, created_at, last_sent_at")
      .eq("center_id", center.id)
      .order("created_at", { ascending: false })
      .limit(100),
    db.rpc("team_security", { p_center: center.id }),
    db.from("roles").select("key, name, tier, description").order("name"),
    db.from("center_owners").select("user_id, since").eq("center_id", center.id).maybeSingle(),
    db.rpc("check_owner_and_second_admin_2fa", { p_center: center.id }),
  ]);
  const roleName = new Map((roles.data ?? []).map((r) => [r.key, r.name]));
  const members = team.data ?? [];
  const nameOf = new Map(members.map((m) => [m.user_id, m.name]));
  const isOwner = owner.data?.user_id === userId;
  const ownerName = owner.data ? (nameOf.get(owner.data.user_id) ?? "a former administrator") : null;
  const iAmAdmin = members.some((m) => m.user_id === userId && m.is_admin);
  const canReset = session.isPlatformAdmin || (iAmAdmin && can(session, "roles.manage"));
  const transferTargets = members.filter((m) => m.is_admin && m.user_id !== owner.data?.user_id);
  const readiness = (check.data ?? null) as { ok?: boolean; detail?: string } | null;
  const community = center.short_name || center.name;

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={5} title="Invite staff" description="For people who don't have a Community Connect login yet">
          {roles.error ? (
            <QueryError what="the roles" error={roles.error} retryHref="/settings/team" />
          ) : (
            <InviteForm roles={invitableRoles(roles.data ?? []).map((r) => ({ key: r.key, name: r.name, description: r.description }))} />
          )}
        </Card>

        <Card span={7} title="Invitations" description="Each link works once, for the email or number it was sent to, for 7 days">
          {invites.error ? (
            <QueryError what="the invitations" error={invites.error} retryHref="/settings/team" />
          ) : (invites.data ?? []).length === 0 ? (
            <EmptyState title="No invitations yet">Invite your team with the form. Anyone who already signs in can be given roles in Roles &amp; entitlements.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Roles</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {(invites.data ?? []).map((i) => {
                    const st = invitationStatus(i);
                    const who = [i.first_name, i.last_name].filter(Boolean).join(" ");
                    return (
                      <tr key={i.id} data-testid="invitation-row" data-email={i.email ?? ""}>
                        <td>
                          <span className="block font-bold">{who || i.email || formatPhone(i.phone_e164)}</span>
                          <span className="text-[12px] text-muted">
                            {[i.email, formatPhone(i.phone_e164)].filter(Boolean).join(" · ")}
                            {` · invited by ${nameOf.get(i.invited_by) ?? "a former staff member"} on ${day(i.created_at)}`}
                          </span>
                        </td>
                        <td className="text-[13px]">{i.role_keys.map((k) => roleName.get(k) ?? k).join(", ")}</td>
                        <td>
                          <StatusText tone={STATUS_TEXT[st].tone}>{STATUS_TEXT[st].label}</StatusText>
                          <span className="block text-[12px] text-muted">
                            {st === "accepted"
                              ? `${day(i.accepted_at)} by ${nameOf.get(i.accepted_by ?? "") ?? "the invitee"}`
                              : st === "pending"
                                ? `until ${day(i.expires_at)}`
                                : st === "revoked"
                                  ? day(i.revoked_at)
                                  : `on ${day(i.expires_at)}`}
                          </span>
                        </td>
                        <td className="text-right">
                          {st === "pending" || st === "expired" ? (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <ResendButton id={i.id} />
                              {st === "pending" ? (
                                <ActionForm
                                  action={revokeInvitationAction}
                                  submitLabel="Withdraw"
                                  pendingLabel="Withdrawing…"
                                  variant="bad"
                                  size="xs"
                                  confirmMessage="Withdraw this invitation? Its link stops working."
                                >
                                  <input type="hidden" name="id" value={i.id} />
                                </ActionForm>
                              ) : null}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card
          span={12}
          title="Staff and two-step verification"
          description="Everyone with a staff role here, and whether they use an authenticator app"
          actions={readiness ? <StatusText tone={readiness.ok ? "ok" : "warn"}>{readiness.ok ? "Go-live check passes" : "Go-live check not met"}</StatusText> : null}
        >
          {readiness && !readiness.ok ? (
            <div className="mb-3">
              <Alert tone="warning" title="Go-live check · an owner and a second admin, both with 2FA">
                {readiness.detail}
              </Alert>
            </div>
          ) : null}
          {check.error ? <p className="mb-2 text-[13px] text-danger">Could not run the go-live check — {check.error.message}</p> : null}
          {team.error ? (
            <QueryError what="the team" error={team.error} retryHref="/settings/team" />
          ) : members.length === 0 ? (
            <EmptyState title="No staff yet">Invite someone with the form above.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Roles</th>
                    <th>2FA</th>
                    <th>Phone</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} data-testid="team-row" data-email={m.email}>
                      <td>
                        <span className="block font-bold">
                          {m.name}
                          {m.is_owner ? <span className="ml-2 rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-bold text-navy">Owner</span> : null}
                        </span>
                        <span className="text-[12px] text-muted">{m.email}</span>
                      </td>
                      <td className="text-[13px]">{m.roles.map((k) => roleName.get(k) ?? k).join(", ")}</td>
                      <td>{m.has_totp ? <StatusText tone="ok">On</StatusText> : <StatusText tone="warn">Not set up</StatusText>}</td>
                      <td>{m.phone_verified ? <StatusText tone="ok">Verified</StatusText> : <span className="text-[13px] text-muted">Not verified</span>}</td>
                      <td className="text-right">
                        {canReset && m.user_id !== userId && m.has_totp ? <ResetTwoFactorButton userId={m.user_id} name={m.name} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="crm-hint mt-2">
            Lost phone: another administrator (not the person themselves) resets their 2FA here after checking who they are; the Community Connect team
            can do it too. The reset removes their authenticator apps, signs them out everywhere and is recorded in the audit log.
          </p>
        </Card>

        <Card span={12} title="Owner" description={`The owner accepts the agreements and can hand ${community} over to another administrator`}>
          {owner.error ? (
            <QueryError what="the owner" error={owner.error} retryHref="/settings/team" />
          ) : !owner.data ? (
            <Alert tone="warning" title="No owner yet">
              The first active administrator becomes the owner automatically. Until {community} has one, ask the Community Connect team to designate the owner.
            </Alert>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-[13px]">
                <span className="font-bold">{isOwner ? "You are" : `${ownerName} is`}</span> the owner, since {day(owner.data.since)}.
              </p>
              {isOwner || session.isPlatformAdmin ? (
                transferTargets.length === 0 ? (
                  <p className="text-[13px] text-muted">
                    To transfer ownership, first make someone else an administrator (Center admin); the grant needs a second approver.
                  </p>
                ) : (
                  <ActionForm
                    action={transferOwnershipAction}
                    submitLabel="Transfer ownership"
                    pendingLabel="Transferring…"
                    variant="warn"
                    confirmKicker="Transfer ownership"
                    confirmMessage="Transfer ownership? The new owner accepts agreements and can transfer it again; you stay an administrator."
                    className="flex max-w-xl flex-col gap-2"
                  >
                    <label htmlFor="transfer-to" className="crm-label">
                      New owner (an administrator)
                    </label>
                    <select id="transfer-to" name="to_user" required className="crm-input" defaultValue="">
                      <option value="" disabled>
                        Choose an administrator
                      </option>
                      {transferTargets.map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.name} · {m.email}
                          {m.has_totp ? "" : " (no 2FA yet)"}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="transfer-reason" className="crm-label">
                      Reason (kept in the audit log)
                    </label>
                    <input id="transfer-reason" name="reason" required maxLength={500} className="crm-input" placeholder="e.g. New president elected" />
                  </ActionForm>
                )
              ) : (
                <p className="text-[13px] text-muted">Only the owner can transfer ownership.</p>
              )}
            </div>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}

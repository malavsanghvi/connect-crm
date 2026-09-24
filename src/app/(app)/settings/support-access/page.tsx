import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Alert, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { SUPPORT_DURATIONS, supportState } from "@/lib/platform-onboarding";
import { getSession } from "@/lib/session";

import { grantSupportAction, revokeSupportAction } from "./actions";

export const metadata: Metadata = { title: "Support access · Settings" };

export default async function SupportAccessSettingsPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Support access · give the Community Connect team time-boxed access to help you; every grant is audited" />;
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Support access" access="centerSettings" />
      </>
    );
  }
  const { db, center, userId } = session;
  const [grants, owner, staff] = await Promise.all([
    db.from("support_grants").select("*").eq("center_id", center.id).order("granted_at", { ascending: false }).limit(50),
    db.from("center_owners").select("user_id").eq("center_id", center.id).maybeSingle(),
    db.rpc("support_staff_options", { p_center: center.id }),
  ]);
  if (grants.error || owner.error) {
    return (
      <>
        {header}
        <QueryError what="the support grants" error={grants.error ?? owner.error} retryHref="/settings/support-access" />
      </>
    );
  }
  if (staff.error) console.error("[settings/support-access] could not load the Community Connect team:", staff.error);
  const isOwner = owner.data?.user_id === userId;
  const who = new Map((staff.data ?? []).map((s) => [s.user_id, s.email]));
  const tz = center.time_zone;
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Card title="Give access" description="The person can help inside your organization until the time runs out, or until you end it">
          {!isOwner ? (
            <p className="text-[13px] text-muted">Only the organization&apos;s owner grants support access.</p>
          ) : staff.error ? (
            <Alert tone="danger" title="Could not load the Community Connect team">
              Reload the page to try again.
            </Alert>
          ) : (staff.data ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">No Community Connect team members are set up yet.</p>
          ) : (
            <ActionForm action={grantSupportAction} submitLabel="Grant access" resetOnSuccess>
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_160px]">
                <label className="crm-label">
                  Who at Community Connect
                  <select name="grantee" className="crm-input mt-1">
                    {(staff.data ?? []).map((s) => (
                      <option key={s.user_id} value={s.user_id}>
                        {s.email}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="crm-label">
                  For how long
                  <select name="hours" className="crm-input mt-1" defaultValue="24">
                    {SUPPORT_DURATIONS.map((d) => (
                      <option key={d.hours} value={d.hours}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="crm-label" htmlFor="support-reason">
                What it is for
              </label>
              <input id="support-reason" name="reason" className="crm-input mb-3" maxLength={500} placeholder="e.g. Help mapping our Neon export" />
            </ActionForm>
          )}
        </Card>
        <Card title="Grants" padded={false}>
          {(grants.data ?? []).length === 0 ? (
            <div className="p-4">
              <EmptyState title="No support access has been given" />
            </div>
          ) : (
            <TableWrap>
              <table className="crm-table" aria-label="Support grants">
                <thead>
                  <tr>
                    <th>Given to</th>
                    <th>For</th>
                    <th>Window</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {(grants.data ?? []).map((g) => {
                    const state = supportState(g);
                    return (
                      <tr key={g.id} data-state={state}>
                        <td>{who.get(g.grantee_user_id) ?? "A Community Connect team member"}</td>
                        <td className="text-[13px]">{g.reason}</td>
                        <td className="whitespace-nowrap text-[12px]">
                          {formatDateTime(g.granted_at, tz)}
                          <p className="text-muted">until {formatDateTime(g.expires_at, tz)}</p>
                        </td>
                        <td>{state === "live" ? <StatusText tone="ok">Live</StatusText> : <StatusText tone="warn">{state === "ended" ? "Ended" : "Expired"}</StatusText>}</td>
                        <td className="text-right">
                          {state === "live" && isOwner ? (
                            <ActionForm action={revokeSupportAction} submitLabel="End now" size="xs" variant="ghost">
                              <input type="hidden" name="grant" value={g.id} />
                            </ActionForm>
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
      </div>
    </>
  );
}

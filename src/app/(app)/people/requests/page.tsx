import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { householdsById, userNames } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { RELATIONSHIP_OPTIONS } from "@/lib/people";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { decideHouseholdRequestAction } from "./actions";

export const metadata: Metadata = { title: "People · Family change requests" };

const KIND_LABEL: Record<string, string> = {
  add_member: "Add a family member",
  change_relationship: "Change a relationship",
  remove_member: "Remove a family member",
  new_household: "Move to a new household",
};

function detailsSummary(kind: string, details: unknown): string {
  const d = (details && typeof details === "object" ? (details as Record<string, unknown>) : {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  if (kind === "add_member") {
    const name = [text(d.first_name), text(d.last_name)].filter(Boolean).join(" ") || "New person";
    const rel = text(d.relationship);
    const dob = text(d.dob);
    const phone = text(d.phone);
    const email = text(d.email);
    return [name, rel ? `as their ${rel}` : null, dob ? `DOB ${dob}` : null, phone, email].filter(Boolean).join(" · ");
  }
  if (kind === "change_relationship") {
    const from = text(d.relationship_from);
    const to = text(d.relationship);
    return [from ? `from "${from}"` : null, to ? `to "${to}"` : "no new relationship given"].filter(Boolean).join(" ") || "—";
  }
  return JSON.stringify(d).slice(0, 200);
}

export default async function HouseholdRequestsPage() {
  const session = await getSession();
  const header = <PageHeader title="People" description="Family change requests submitted from the member app — add a family member or change a relationship." />;
  if (!canAccess(session, "householdRequests")) {
    return (
      <>
        {header}
        <NoAccess area="Family change requests" access="householdRequests" />
      </>
    );
  }
  const { db, center } = session;
  const canDecide = canAccess(session, "householdRequestsDecide");

  const openRes = await db
    .from("household_change_requests")
    .select("id, household_id, requested_by, kind, details, created_at")
    .eq("center_id", center.id)
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(100);
  const decidedRes = await db
    .from("household_change_requests")
    .select("id, household_id, requested_by, kind, details, status, decided_by, decided_at, reason")
    .eq("center_id", center.id)
    .neq("status", "open")
    .order("decided_at", { ascending: false })
    .limit(20);

  const error = openRes.error ?? decidedRes.error;
  const open = openRes.data ?? [];
  const decided = decidedRes.data ?? [];

  const households = await householdsById(
    db,
    [...open, ...decided].map((r) => r.household_id),
  );
  const requesters = await userNames(
    db,
    center.id,
    [...open, ...decided].map((r) => r.requested_by),
  );
  const deciders = await userNames(
    db,
    center.id,
    decided.map((r) => r.decided_by),
  );

  return (
    <>
      {header}
      {error ? <QueryError what="the family change requests" error={error} /> : null}
      <Card title={`Needs a decision (${open.length})`} description={canDecide ? undefined : "You can see these but need people.manage to decide them."}>
        {open.length === 0 ? (
          <EmptyState title="Nothing waiting">Requests members send from onboarding or the Family tab show up here.</EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table w-full">
              <thead>
                <tr>
                  <th>Household</th>
                  <th>Requested by</th>
                  <th>Kind</th>
                  <th>Details</th>
                  <th>Sent</th>
                  {canDecide ? <th>Decide</th> : null}
                </tr>
              </thead>
              <tbody>
                {open.map((r) => {
                  const hh = households.map.get(r.household_id);
                  const who = requesters.get(r.requested_by);
                  const canRole = r.kind === "add_member" || r.kind === "change_relationship";
                  return (
                    <tr key={r.id}>
                      <td>
                        {hh ? (
                          <Link href={`/households/${r.household_id}`} className="text-navy underline decoration-1 underline-offset-2">
                            {hh.display_name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{who?.name ?? "—"}</td>
                      <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                      <td className="max-w-xs">{detailsSummary(r.kind, r.details)}</td>
                      <td>{formatDate(r.created_at, center.time_zone)}</td>
                      {canDecide ? (
                        <td>
                          {canRole ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <ActionForm
                                action={decideHouseholdRequestAction}
                                submitLabel="Approve"
                                pendingLabel="Approving…"
                                variant="ok"
                                size="sm"
                                confirmMessage={r.kind === "add_member" ? "Add this person to the household with the relationship chosen below?" : "Change their relationship on the household to the one chosen below?"}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="decision" value="approve" />
                                <select name="role" required defaultValue="" className="crm-input h-8 text-[12px]">
                                  <option value="" disabled>
                                    Relationship…
                                  </option>
                                  {RELATIONSHIP_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </ActionForm>
                              <ActionForm
                                action={decideHouseholdRequestAction}
                                submitLabel="Decline"
                                pendingLabel="Declining…"
                                variant="bad"
                                size="sm"
                                confirmMessage="Decline this request? The reason is kept on the household's record."
                              >
                                <input type="hidden" name="id" value={r.id} />
                                <input type="hidden" name="decision" value="reject" />
                                <input type="hidden" name="reason" value="Declined by staff" />
                              </ActionForm>
                            </div>
                          ) : (
                            <span className="text-[12px] text-muted">Not supported here yet — handle it directly on the household record.</span>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Card title="Recently decided" className="mt-4">
        {decided.length === 0 ? (
          <EmptyState title="Nothing decided yet" />
        ) : (
          <TableWrap>
            <table className="crm-table w-full">
              <thead>
                <tr>
                  <th>Household</th>
                  <th>Kind</th>
                  <th>Details</th>
                  <th>Decision</th>
                  <th>Decided by</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r) => {
                  const hh = households.map.get(r.household_id);
                  const by = r.decided_by ? deciders.get(r.decided_by) : null;
                  return (
                    <tr key={r.id}>
                      <td>{hh?.display_name ?? "—"}</td>
                      <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                      <td className="max-w-xs">{detailsSummary(r.kind, r.details)}</td>
                      <td>
                        <StatusText tone={r.status === "approved" ? "ok" : "bad"}>{r.status === "approved" ? "Approved" : "Declined"}</StatusText>
                        {r.reason ? <span className="ml-1 text-[12px] text-muted">— {r.reason}</span> : null}
                      </td>
                      <td>{by?.name ?? "—"}</td>
                      <td>{r.decided_at ? formatDate(r.decided_at, center.time_zone) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-muted">
        <Link href="/households" className={buttonClass("ghost", "sm")}>
          All households
        </Link>
      </p>
    </>
  );
}

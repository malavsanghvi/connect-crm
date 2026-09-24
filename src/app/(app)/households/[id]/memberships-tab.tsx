import Link from "next/link";

import { CustomDetailsCell } from "@/components/custom-details-cell";
import { Badge, Card, EmptyState, NoAccess, QueryError, TableWrap } from "@/components/ui";
import { loadCustomFieldDefs } from "@/lib/data/custom-fields";
import { peopleById } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { APPLICATION_STATUS_LABEL, MEMBERSHIP_STATUS_TONE } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export async function MembershipsTab({ session, householdId }: { session: CrmSession; householdId: string }) {
  if (!canAccess(session, "memberships")) return <NoAccess area="Memberships" access="memberships" />;
  const { db, center } = session;
  const tz = center.time_zone;
  const retry = `/households/${householdId}?tab=memberships`;

  const [mRes, aRes, typesRes, defs] = await Promise.all([
    db
      .from("memberships")
      .select("id, person_id, membership_type_id, tier, status, starts_on, ends_on, notes, crm_external_id, custom")
      .eq("household_id", householdId)
      .order("starts_on", { ascending: false }),
    db
      .from("membership_applications")
      .select("id, applicant_person_id, tier, status, reference_person_id, reference_decision, fee_cents, created_at, center_reason")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false }),
    db.from("membership_types").select("id, name").eq("center_id", center.id),
    loadCustomFieldDefs(db, center.id, "memberships", true),
  ]);
  const editCustom = canAccess(session, "householdsEdit");
  if (mRes.error) return <QueryError what="memberships" error={mRes.error} retryHref={retry} />;
  if (aRes.error) return <QueryError what="membership applications" error={aRes.error} retryHref={retry} />;
  const typeName = new Map((typesRes.data ?? []).map((t) => [t.id, t.name]));
  const memberships = mRes.data ?? [];
  const applications = aRes.data ?? [];
  const { map: people } = await peopleById(db, [
    ...memberships.map((m) => m.person_id),
    ...applications.map((a) => a.applicant_person_id),
    ...applications.map((a) => a.reference_person_id),
  ]);

  return (
    <div className="space-y-5">
      <Card title="Memberships" padded={false}>
        {memberships.length === 0 ? (
          <EmptyState title="No memberships on record" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th>Holder</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th>Notes</th>
                  {defs.defs.length ? <th>More details</th> : null}
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => (
                  <tr key={m.id}>
                    <td>{typeName.get(m.membership_type_id) ?? "—"}</td>
                    <td className="capitalize">{m.tier}</td>
                    <td>
                      <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]}>{m.status}</Badge>
                    </td>
                    <td>
                      {m.person_id ? (
                        <Link href={`/people/${m.person_id}`} className="crm-link">
                          {people.get(m.person_id)?.name ?? "Person"}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{formatDate(m.starts_on, tz)}</td>
                    <td>{m.ends_on ? formatDate(m.ends_on, tz) : "No end (lifetime)"}</td>
                    <td className="text-[0.8125rem]">{m.notes ?? "—"}</td>
                    {defs.defs.length ? (
                      <td>
                        <CustomDetailsCell defs={defs.defs} entity="memberships" recordId={m.id} custom={m.custom} editable={editCustom} currency={center.currency} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Applications"
        padded={false}
        actions={
          <Link href="/memberships/applications" className="crm-link text-sm font-semibold">
            Open the queue
          </Link>
        }
      >
        {applications.length === 0 ? (
          <EmptyState title="No applications from this household" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Tier</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th className="num">Fee</th>
                  <th>Applied</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td>{people.get(a.applicant_person_id)?.name ?? "—"}</td>
                    <td className="capitalize">{a.tier}</td>
                    <td>{APPLICATION_STATUS_LABEL[a.status] ?? a.status}</td>
                    <td>
                      {a.reference_person_id ? (people.get(a.reference_person_id)?.name ?? "Named") : "—"}
                      {a.reference_decision ? <div className="text-xs text-muted">{a.reference_decision}</div> : null}
                    </td>
                    <td className="num">{formatCents(a.fee_cents, center.currency)}</td>
                    <td>{formatDate(a.created_at, tz)}</td>
                    <td className="text-[0.8125rem]">{a.center_reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

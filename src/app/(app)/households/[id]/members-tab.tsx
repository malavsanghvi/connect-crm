import Link from "next/link";

import { Badge, Card, EmptyState, QueryError, TableWrap } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { orgIds, personName } from "@/lib/data/lookups";
import { ageOn, formatDate, todayInTz } from "@/lib/dates";
import type { CrmSession } from "@/lib/session";

export async function MembersTab({ session, householdId }: { session: CrmSession; householdId: string }) {
  const { db, center } = session;
  const rules = identifierRules(center.rules);
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const retry = `/households/${householdId}?tab=members`;

  const links = await db
    .from("household_members")
    .select("person_id, role, is_primary, joined_at, left_at")
    .eq("household_id", householdId);
  if (links.error) return <QueryError what="members" error={links.error} retryHref={retry} />;
  const personIds = (links.data ?? []).map((l) => l.person_id);
  if (personIds.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState title="No members recorded for this household" />
      </Card>
    );
  }
  const [peopleRes, org] = await Promise.all([
    db
      .from("people")
      .select("id, first_name, last_name, preferred_name, member_number, date_of_birth, email, phone_e164, is_verified, is_deceased")
      .in("id", personIds),
    orgIds(db, center.id, { personIds }),
  ]);
  if (peopleRes.error) return <QueryError what="members" error={peopleRes.error} retryHref={retry} />;
  const people = new Map((peopleRes.data ?? []).map((p) => [p.id, p]));
  const rows = [...(links.data ?? [])].sort(
    (a, b) =>
      Number(a.left_at !== null) - Number(b.left_at !== null) ||
      Number(b.is_primary) - Number(a.is_primary) ||
      (ageOn(people.get(b.person_id)?.date_of_birth, today) ?? 0) - (ageOn(people.get(a.person_id)?.date_of_birth, today) ?? 0),
  );

  return (
    <Card padded={false}>
      {org.error ? (
        <div className="p-4">
          <QueryError what={`${rules.orgMemberLabel}s`} error={org.error} retryHref={retry} />
        </div>
      ) : null}
      <TableWrap>
        <table className="crm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Member no.</th>
              <th>{rules.orgMemberLabel}</th>
              <th>Relationship</th>
              <th className="num">Age</th>
              <th>Contact</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const p = people.get(l.person_id);
              const age = ageOn(p?.date_of_birth, today);
              return (
                <tr key={l.person_id} className={l.left_at ? "opacity-60" : undefined}>
                  <td>
                    {p ? (
                      <Link href={`/people/${p.id}`} className="crm-link font-semibold">
                        {personName(p)}
                      </Link>
                    ) : (
                      <span className="text-muted">Not visible to you</span>
                    )}
                    {p?.preferred_name ? (
                      <div className="text-xs text-muted">
                        {p.first_name} {p.last_name}
                      </div>
                    ) : null}
                  </td>
                  <td className="font-mono text-[0.8125rem]">{p?.member_number ?? "—"}</td>
                  <td className="font-mono text-[0.8125rem] font-semibold">
                    {(org.byPerson.get(l.person_id) ?? []).join(", ") || <span className="font-sans font-normal text-muted">—</span>}
                  </td>
                  <td>
                    <span className="capitalize">{l.role}</span>
                    {l.is_primary ? (
                      <>
                        {" "}
                        <Badge tone="navy">Primary</Badge>
                      </>
                    ) : null}
                  </td>
                  <td className="num">{age === null ? "—" : age < 18 ? `${age} (minor)` : age}</td>
                  <td className="text-[0.8125rem]">
                    {p?.email ? <div>{p.email}</div> : null}
                    {p?.phone_e164 ? <div>{p.phone_e164}</div> : null}
                    {!p?.email && !p?.phone_e164 ? <span className="text-muted">—</span> : null}
                  </td>
                  <td>
                    {l.left_at ? (
                      <Badge>Left {formatDate(l.left_at, tz)}</Badge>
                    ) : p?.is_deceased ? (
                      <Badge>Deceased</Badge>
                    ) : p?.is_verified ? (
                      <Badge tone="success">Verified</Badge>
                    ) : (
                      <Badge tone="warning">Not verified</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

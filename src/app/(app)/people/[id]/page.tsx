import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { IdentifiersPanel } from "@/components/identifiers-panel";
import { PeopleDrawers, drawerHref } from "@/app/(app)/people/_components/drawers";
import { Badge, BlockGrid, Card, DefinitionList, EmptyState, KeyValueRow, NoAccess, PageHeader, QueryError, TableWrap, buttonClass } from "@/components/ui";
import { loadPersonRecord } from "@/lib/data/people-records";
import { genderLabel, languageLabel, relationshipLabel, toUsDate } from "@/lib/people";
import type { RawSearchParams } from "@/lib/search-params";
import { identifierRules } from "@/lib/center-rules";
import { householdsById, orgIds, personName } from "@/lib/data/lookups";
import { ageOn, formatDate, todayInTz } from "@/lib/dates";
import { MEMBERSHIP_STATUS_TONE } from "@/lib/labels";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!canAccess(session, "households")) {
    return (
      <>
        <PageHeader title="Person" />
        <NoAccess area="People records" access="households" />
      </>
    );
  }
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { db, center } = session;
  const rules = identifierRules(center.rules);
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const retry = `/people/${id}`;

  const personRes = await db
    .from("people")
    .select(
      "id, first_name, last_name, preferred_name, member_number, date_of_birth, gender, email, phone_e164, language, profession, employer, is_verified, verified_at, is_deceased, merged_into_id, created_at",
    )
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (personRes.error) {
    return (
      <>
        <PageHeader title="Person" />
        <QueryError what="this person" error={personRes.error} retryHref={retry} />
      </>
    );
  }
  if (!personRes.data) notFound();
  const person = personRes.data;
  const name = personName(person);

  const [linksRes, idsRes, membershipsRes, loginRes, org] = await Promise.all([
    db.from("household_members").select("household_id, role, is_primary, joined_at, left_at").eq("person_id", id),
    db
      .from("external_ids")
      .select("id, kind, system, value, label, person_id, household_id, source, confidence, times_matched, last_matched_at, valid_from, valid_to, notes")
      .eq("center_id", center.id)
      .eq("person_id", id)
      .order("kind")
      .order("created_at", { ascending: false }),
    db.from("memberships").select("id, household_id, tier, status, starts_on, ends_on").eq("person_id", id).order("starts_on", { ascending: false }),
    db.from("center_users").select("user_id, created_at").eq("center_id", center.id).eq("person_id", id).maybeSingle(),
    orgIds(db, center.id, { personIds: [id] }),
  ]);
  const links = linksRes.data ?? [];
  const { map: households } = await householdsById(db, [
    ...links.map((l) => l.household_id),
    ...(membershipsRes.data ?? []).map((m) => m.household_id),
  ]);
  const age = ageOn(person.date_of_birth, today);
  const orgMemberIds = org.byPerson.get(id) ?? [];
  const currentHouseholds = links.filter((l) => l.left_at === null);
  const sp = await searchParams;
  const base = `/people/${id}`;
  const { record } = await loadPersonRecord(session, id);
  const minor = age !== null && age < 18;
  const home = currentHouseholds.find((l) => !l.is_primary) ?? currentHouseholds[0];

  return (
    <>
      <PageHeader
        eyebrow={
          currentHouseholds[0] ? (
            <Link href={`/households/${currentHouseholds[0].household_id}`} className="crm-link">
              ← {households.get(currentHouseholds[0].household_id)?.display_name ?? "Household"}
            </Link>
          ) : (
            <Link href="/households" className="crm-link">
              ← Households
            </Link>
          )
        }
        title={name}
        description={[
          home ? `${home.is_primary ? "Primary" : relationshipLabel(home.role, person.gender)} · ${households.get(home.household_id)?.display_name ?? "household"}` : null,
          age !== null ? `age ${age}` : null,
          person.preferred_name ? `legal name ${person.first_name} ${person.last_name}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canAccess(session, "householdsEdit") && !person.merged_into_id ? (
            <>
              <Link href={drawerHref(base, sp, { person: id })} scroll={false} className={buttonClass("primary")}>
                Edit profile
              </Link>
              {home ? (
                <Link href={drawerHref(base, sp, { person: id, mode: "move" })} scroll={false} className={buttonClass("ghost")}>
                  Move household
                </Link>
              ) : null}
              <Link href={`/people/merge?person=${id}`} className={buttonClass("ghost")}>
                Merge duplicate
              </Link>
            </>
          ) : null
        }
      />

      <section aria-label="Identity" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">Member no.</p>
          <p className="mt-0.5 font-mono text-[0.9375rem] font-semibold">{person.member_number ?? "—"}</p>
        </div>
        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{rules.orgMemberLabel}</p>
          <p className="mt-0.5 font-mono text-[0.9375rem] font-semibold">
            {orgMemberIds.length > 0 ? orgMemberIds.join(", ") : <span className="font-sans font-normal text-muted">Not recorded</span>}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">Status</p>
          <p className="mt-1 flex flex-wrap gap-1">
            {person.is_deceased ? <Badge>Deceased</Badge> : null}
            {person.merged_into_id ? <Badge tone="warning">Merged</Badge> : null}
            {person.is_verified ? <Badge tone="success">Verified</Badge> : <Badge tone="warning">Not verified</Badge>}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-card px-3 py-2.5">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">App login</p>
          <p className="mt-0.5 text-[0.9375rem] font-semibold">
            {loginRes.error ? "Unknown" : loginRes.data ? `Linked ${formatDate(loginRes.data.created_at, tz)}` : "Not linked"}
          </p>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card title="Profile" className="xl:col-span-2">
          <DefinitionList
            items={[
              { label: "Date of birth", value: person.date_of_birth ? `${toUsDate(person.date_of_birth)}${age !== null ? ` · age ${age}` : ""}` : "Not recorded" },
              { label: "Gender", value: genderLabel(person.gender) },
              { label: "Relationship", value: home ? (home.is_primary ? "Primary" : relationshipLabel(home.role, person.gender)) : "—" },
              ...(minor
                ? [
                    { label: "Contact", value: "Through parents · no direct messages to minors" },
                    {
                      label: "App access",
                      value: record && age !== null && age < record.childLoginAge ? `No own login yet (from age ${record.childLoginAge})` : "Own login allowed (age rule) · no RSVP, bolis or payments",
                    },
                  ]
                : [
                    { label: "Email", value: person.email ?? "—" },
                    { label: "Mobile", value: person.phone_e164 ?? "—" },
                    { label: "Profession", value: person.profession ?? "—" },
                    { label: "Employer (matching gifts)", value: person.employer ?? "—" },
                  ]),
              { label: "Language", value: <span className="cc-chip pointer-events-none min-h-7" aria-current="page">{languageLabel(person.language)}</span> },
              { label: "Verified", value: person.verified_at ? formatDate(person.verified_at, tz) : "Not yet" },
              { label: "Record created", value: formatDate(person.created_at, tz) },
            ]}
          />
        </Card>
        <Card title="Households" padded={false}>
          {linksRes.error ? (
            <div className="p-4">
              <QueryError what="household links" error={linksRes.error} retryHref={retry} />
            </div>
          ) : links.length === 0 ? (
            <EmptyState title="Not linked to a household" />
          ) : (
            <ul className="divide-y divide-line">
              {links.map((l) => {
                const h = households.get(l.household_id);
                return (
                  <li key={l.household_id} className={`px-5 py-3 ${l.left_at ? "opacity-60" : ""}`}>
                    <Link href={`/households/${l.household_id}`} className="crm-link font-semibold">
                      {h?.display_name ?? "Household"}
                    </Link>
                    <span className="ml-2 font-mono text-xs text-muted">{h?.household_number}</span>
                    <p className="text-sm text-muted">
                      <span className="capitalize">{l.role}</span>
                      {l.is_primary ? " · primary" : ""}
                      {l.joined_at ? ` · joined ${formatDate(l.joined_at, tz)}` : ""}
                      {l.left_at ? ` · left ${formatDate(l.left_at, tz)}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {record ? (
        <BlockGrid className="mt-5">
          <Card span={6} title="Roles, teams and waivers">
            <div className="flex flex-col gap-1.5">
              <KeyValueRow
                label="Roles"
                value={record.roles === null ? "Visible to role managers" : !record.roles.ok ? "Could not load" : record.roles.data.length ? record.roles.data.join(", ") : "None"}
                tone={record.roles && !record.roles.ok ? "bad" : "ink"}
              />
              <KeyValueRow
                label="Volunteer waiver"
                value={minor ? "Parent signs" : record.waiver === null ? "Needs a volunteers permission" : !record.waiver.ok ? "Could not load" : record.waiver.data}
              />
              <KeyValueRow
                label="Background check"
                value={minor ? "Not applicable" : record.backgroundCheck === null ? "Needs a safety permission" : !record.backgroundCheck.ok ? "Could not load" : record.backgroundCheck.data}
              />
            </div>
          </Card>
          <Card span={6} title="Account">
            <div className="flex flex-col gap-1.5">
              <KeyValueRow
                label="App account"
                value={loginRes.error ? "Could not load" : loginRes.data ? `Active · linked ${formatDate(loginRes.data.created_at, tz)}` : minor && age !== null && age < record.childLoginAge ? "Managed by parents" : "Not signed in yet"}
                tone={loginRes.data ? "ok" : "warn"}
              />
              <KeyValueRow label="Member card" value={person.member_number ? `Rotating QR · ${person.member_number}` : "No member number yet"} />
              <KeyValueRow
                label="Sign-in methods"
                value={loginRes.data ? [person.email ? "email" : null, person.phone_e164 ? "mobile" : null].filter(Boolean).join(" and ").replace(/^(.+)$/, "Code by $1") || "—" : "—"}
              />
              {record.activity && record.activity.ok
                ? record.activity.data.slice(0, 3).map((a, i) => (
                    <KeyValueRow key={i} label={`${formatDate(a.at, tz)} · ${a.what}`} value={a.detail || undefined} />
                  ))
                : null}
            </div>
          </Card>
        </BlockGrid>
      ) : null}

      <Card title="Memberships held" padded={false} className="mt-5">
        {membershipsRes.error ? (
          <div className="p-4">
            <QueryError what="memberships" error={membershipsRes.error} retryHref={retry} />
          </div>
        ) : (membershipsRes.data ?? []).length === 0 ? (
          <EmptyState title="This person is not the holder of a membership" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Status</th>
                  <th>Household</th>
                  <th>Starts</th>
                  <th>Ends</th>
                </tr>
              </thead>
              <tbody>
                {(membershipsRes.data ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="capitalize">{m.tier}</td>
                    <td>
                      <Badge tone={MEMBERSHIP_STATUS_TONE[m.status]}>{m.status}</Badge>
                    </td>
                    <td>{households.get(m.household_id)?.display_name ?? "—"}</td>
                    <td>{formatDate(m.starts_on, tz)}</td>
                    <td>{m.ends_on ? formatDate(m.ends_on, tz) : "Lifetime"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <h2 className="mb-3 mt-8 font-display text-xl font-semibold text-navy">Identifiers</h2>
      {idsRes.error ? (
        <QueryError what="identifiers" error={idsRes.error} retryHref={retry} />
      ) : (
        <IdentifiersPanel
          session={session}
          rows={(idsRes.data ?? []).filter((r) => r.kind !== "org_household")}
          ownerNames={new Map([[id, name]])}
          today={today}
          returnPath={`/people/${id}`}
          targets={[{ value: `person:${id}`, label: name, type: "person" }]}
          connectNumbers={[{ label: "Member no.", value: person.member_number, owner: name }]}
          personOnly
        />
      )}
      <PeopleDrawers session={session} sp={sp} base={base} />
    </>
  );
}

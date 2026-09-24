import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, QueryError, Stat, StatusText } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Data quality · Settings" };

type Who = { id: string; name: string; member_number: string | null; org_id: string | null; household_id: string | null; household: string | null; household_number: string | null; value?: string };
type Block<T> = { count: number; rows: T[] };
type DQ = {
  coverage: { households: number; reachable: number; percent: number; target: number };
  unreachable: Block<{ id: string; display_name: string; household_number: string | null }>;
  duplicates: Block<{ why: string; a: Who; b: Who }> & { open_merge_candidates: number };
  minors_without_birth_date: Block<Who>;
  without_consent: Block<Who>;
  invalid_emails: Block<Who>;
  invalid_phones: Block<Who>;
  people: number;
};

/** A person as the prototype identifies people: never a name alone. */
function PersonCell({ p }: { p: Who }) {
  return (
    <span>
      <Link className="crm-link font-semibold" href={`/people/${p.id}`}>
        {p.name}
      </Link>
      <span className="block text-[12px] text-muted">
        {[p.member_number, p.org_id ? `ID ${p.org_id}` : null, p.household ? `${p.household}${p.household_number ? ` · ${p.household_number}` : ""}` : "No household"]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  );
}

function PeopleList({ rows, count, empty, extra }: { rows: Who[]; count: number; empty: string; extra?: (p: Who) => string | null }) {
  if (count === 0) return <EmptyState title={empty} />;
  return (
    <>
      <ul className="divide-y divide-line-soft">
        {rows.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 py-2 text-[13px]">
            <PersonCell p={p} />
            {extra ? <span className="font-mono text-[12px] text-danger">{extra(p)}</span> : null}
          </li>
        ))}
      </ul>
      {count > rows.length ? <p className="mt-1 text-[12px] text-muted">Showing {rows.length} of {count}.</p> : null}
    </>
  );
}

export default async function DataQualityPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Settings"
      description="Data quality · what to clean up before members are invited: who can be reached, likely duplicates, children without a birth date, missing consents, and contact details that cannot work."
    />
  );
  if (!canAccess(session, "dataQuality")) {
    return (
      <>
        {header}
        <NoAccess area="Data quality" access="dataQuality" />
      </>
    );
  }
  const res = await session.db.rpc("data_quality", { p_center: session.center.id, p_limit: 25 });
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the data-quality view" error={res.error} retryHref="/settings/data-quality" />
      </>
    );
  }
  const dq = res.data as unknown as DQ;
  const cov = dq.coverage;
  const covOk = cov.percent >= cov.target;
  return (
    <>
      {header}
      <KpiGrid cols={5}>
        <Stat label="Contact coverage" value={`${cov.percent}%`} tone={covOk ? "success" : "danger"} hint={`${cov.reachable} of ${cov.households} households · target ${cov.target}%`} />
        <Stat label="Likely duplicates" value={dq.duplicates.count} tone={dq.duplicates.count ? "brown" : "ink"} hint={`${dq.duplicates.open_merge_candidates} waiting in merge review`} href="/people/merge" />
        <Stat label="Children without a birth date" value={dq.minors_without_birth_date.count} tone={dq.minors_without_birth_date.count ? "danger" : "ink"} />
        <Stat label="No consent record" value={dq.without_consent.count} tone={dq.without_consent.count ? "brown" : "ink"} hint={`of ${dq.people} people`} />
        <Stat label="Invalid emails or phones" value={dq.invalid_emails.count + dq.invalid_phones.count} tone={dq.invalid_emails.count + dq.invalid_phones.count ? "danger" : "ink"} />
      </KpiGrid>
      <BlockGrid className="mt-4">
        <Card span={6} title="Households nobody can reach" description="No current adult member with an email or a mobile number. Sign-in matches on email and mobile, so these families cannot join the app yet.">
          {dq.unreachable.count === 0 ? (
            <EmptyState title="Every household can be reached." />
          ) : (
            <ul className="divide-y divide-line-soft">
              {dq.unreachable.rows.map((h) => (
                <li key={h.id} className="py-2 text-[13px]">
                  <Link className="crm-link font-semibold" href={`/households/${h.id}`}>
                    {h.display_name}
                  </Link>
                  <span className="ml-2 font-mono text-[12px] text-muted">{h.household_number}</span>
                </li>
              ))}
              {dq.unreachable.count > dq.unreachable.rows.length ? <li className="py-2 text-[12px] text-muted">…and {dq.unreachable.count - dq.unreachable.rows.length} more</li> : null}
            </ul>
          )}
          <p className="mt-2 text-[12px]">
            {covOk ? <StatusText tone="ok">Coverage meets the target</StatusText> : <StatusText tone="bad">Coverage is below the target</StatusText>} · the target is set in Settings › Rules
            (onboarding.contact_coverage_target).
          </p>
        </Card>
        <Card span={6} title="Likely duplicates" description="The same email, the same mobile, or the same name and birth date. Names alone are never merged: compare the records, then merge.">
          {dq.duplicates.count === 0 ? (
            <EmptyState title="No likely duplicates." />
          ) : (
            <ul className="divide-y divide-line-soft">
              {dq.duplicates.rows.map((d, i) => (
                <li key={i} className="grid gap-2 py-2 text-[13px] md:grid-cols-[1fr_1fr_auto]">
                  <PersonCell p={d.a} />
                  <PersonCell p={d.b} />
                  <span className="flex flex-col items-end gap-1">
                    <span className="text-[12px] text-muted">{d.why}</span>
                    <Link className="crm-link text-[12px]" href={`/people/merge?person=${d.a.id}&other=${d.b.id}`}>
                      Compare
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card span={6} title="Children without a birth date" description="The birth date decides who is a minor: under 13 cannot sign in until a parent consents.">
          <PeopleList rows={dq.minors_without_birth_date.rows} count={dq.minors_without_birth_date.count} empty="Every child has a birth date." />
        </Card>
        <Card span={6} title="People without a consent record" description="No channel opt-in or opt-out and no consent on file. Only explicit opt-ins with a date and a source count.">
          <PeopleList rows={dq.without_consent.rows} count={dq.without_consent.count} empty="Everyone has a consent record." />
        </Card>
        <Card span={6} title="Emails that cannot work">
          <PeopleList rows={dq.invalid_emails.rows} count={dq.invalid_emails.count} empty="No invalid email addresses." extra={(p) => p.value ?? null} />
        </Card>
        <Card span={6} title="Phone numbers that cannot work" description="Not in international format (+1…).">
          <PeopleList rows={dq.invalid_phones.rows} count={dq.invalid_phones.count} empty="No invalid phone numbers." extra={(p) => p.value ?? null} />
        </Card>
      </BlockGrid>
    </>
  );
}

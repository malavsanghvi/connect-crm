import type { Metadata } from "next";
import Link from "next/link";

import { ClickableRow, ExportButton } from "@/app/(app)/people/_components/client";
import { PeopleDrawers, drawerHref } from "@/app/(app)/people/_components/drawers";
import {
  Alert,
  Badge,
  Card,
  ChipLinks,
  EmptyState,
  NoAccess,
  PageHeader,
  Pagination,
  QueryError,
  TableWrap,
  buttonClass,
} from "@/components/ui";
import { CustomColumnPicker } from "@/components/custom-column-picker";
import { identifierRules } from "@/lib/center-rules";
import { formatCustomValue } from "@/lib/custom-fields";
import { loadCustomColumn, loadCustomFieldDefs } from "@/lib/data/custom-fields";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { orgIds, personName } from "@/lib/data/lookups";
import { peopleTotals } from "@/lib/data/people-list";
import { searchHouseholds } from "@/lib/data/search";
import { identifierKindLabel } from "@/lib/identifiers";
import { formatCents } from "@/lib/money";
import { bestTier, tierLabel, tierTone } from "@/lib/people";
import { can, canAccess } from "@/lib/permissions";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "People · Households" };

const PAGE_SIZE = 50;
const TIERS = ["life", "yearly", "community"] as const;

type MembershipEmbed = { tier: string; status: string }[];
type Member = { person_id: string; name: string; is_primary: boolean; orgIds: string[] };

export default async function HouseholdsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const { db, center } = session;
  const rules = identifierRules(center.rules);
  if (!canAccess(session, "households")) {
    return (
      <>
        <PageHeader title="People" description="Households, people, membership applications, the directory and voting eligibility" />
        <NoAccess area="Households" access="households" />
      </>
    );
  }
  const totals = await peopleTotals(session);
  if (totals.error) console.error("[households] totals for the sub-line failed; showing none:", totals.error);
  const header = (
    <PageHeader
      title="People"
      description={
        totals.households !== null && totals.people !== null
          ? `${totals.households.toLocaleString("en-US")} households · ${totals.people.toLocaleString("en-US")} people · search, filter and open a household`
          : "Search, filter and open a household"
      }
      actions={<ExportButton what="households" />}
    />
  );

  const sp = await searchParams;
  const cid = center.id;
  const q = param(sp, "q");
  const zoneParam = param(sp, "zone");
  const zone = isUuid(zoneParam) ? zoneParam : undefined;
  const tierParam = param(sp, "tier");
  const tier = TIERS.find((t) => t === tierParam);
  const page = pageParam(sp);
  const retry = hrefWith("/households", sp, {});

  const zonesRes = await db.from("zones").select("id, name").eq("center_id", cid).order("name");
  const zones = zonesRes.data ?? [];
  const zoneName = new Map(zones.map((z) => [z.id, z.name]));

  const search = q ? await searchHouseholds(db, cid, q) : null;

  let query = db
    .from("households")
    .select("id, display_name, household_number, zone_id, city, memberships(tier, status)", { count: "exact" })
    .eq("center_id", cid)
    .is("merged_into_id", null)
    .eq("memberships.status", "active");
  if (zone) query = query.eq("zone_id", zone);
  if (tier) query = query.eq("memberships.tier", tier).not("memberships", "is", null);
  if (search) {
    // No match → an id that cannot exist, so the table is honestly empty.
    query = query.in("id", search.householdIds.length > 0 ? search.householdIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const from = (page - 1) * PAGE_SIZE;
  const res = await query.order("display_name").range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];
  const ids = rows.map((r) => r.id);

  // Open balances need a giving permission.
  const canSeeGiving = can(session, ["giving.view", "giving.manage", "giving.record_offline"]);
  const balances = new Map<string, number>();
  let balanceError: unknown = null;
  if (canSeeGiving && ids.length > 0) {
    const { data, error } = await fetchAll((f, t) =>
      db
        .from("pledges")
        .select("id, household_id, amount_cents, paid_cents")
        .eq("center_id", cid)
        .in("household_id", ids)
        .in("status", ["open", "partially_paid"])
        .order("id")
        .range(f, t),
    );
    if (error) balanceError = error;
    for (const p of data) balances.set(p.household_id, (balances.get(p.household_id) ?? 0) + p.amount_cents - p.paid_cents);
  }

  // Members (names + their org person IDs) and the household's org household ID, so rows
  // with near-identical names can be told apart.
  const membersByHousehold = new Map<string, Member[]>();
  let householdOrgIds = new Map<string, string[]>();
  let detailError: unknown = null;
  const onApp = new Set<string>();
  if (ids.length > 0) {
    const links: { household_id: string; person_id: string; is_primary: boolean }[] = [];
    for (const part of chunk(ids)) {
      const r = await db
        .from("household_members")
        .select("household_id, person_id, is_primary")
        .in("household_id", part)
        .is("left_at", null);
      if (r.error) {
        detailError = r.error;
        break;
      }
      links.push(...(r.data ?? []));
    }
    const personIds = links.map((l) => l.person_id);
    const people = new Map<string, string>();
    for (const part of chunk([...new Set(personIds)])) {
      const r = await db.from("people").select("id, first_name, last_name, preferred_name").in("id", part);
      if (r.error) {
        detailError = r.error;
        break;
      }
      for (const p of r.data ?? []) people.set(p.id, personName(p));
    }
    for (const part of chunk([...new Set(personIds)])) {
      const r = await db.from("center_users").select("person_id").eq("center_id", cid).in("person_id", part);
      if (r.error) {
        detailError = r.error;
        break;
      }
      for (const u of r.data ?? []) if (u.person_id) onApp.add(u.person_id);
    }
    const org = await orgIds(db, cid, { personIds, householdIds: ids });
    if (org.error) detailError = org.error;
    householdOrgIds = org.byHousehold;
    for (const l of links) {
      const list = membersByHousehold.get(l.household_id) ?? [];
      list.push({
        person_id: l.person_id,
        name: people.get(l.person_id) ?? "—",
        is_primary: l.is_primary,
        orgIds: org.byPerson.get(l.person_id) ?? [],
      });
      membersByHousehold.set(l.household_id, list);
    }
    for (const list of membersByHousehold.values()) list.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  }

  const base = "/households";
  const defs = await loadCustomFieldDefs(session.db, center.id, "households");
  const cfDef = defs.defs.find((d) => d.key === param(sp, "cf")) ?? null;
  const cfValues = cfDef ? await loadCustomColumn(session.db, "households", rows.map((r) => r.id)) : null;
  const openId = param(sp, "hh");
  const chipHref = (t?: string) => hrefWith(base, sp, { tier: t, page: undefined, hh: undefined, person: undefined, mode: undefined });

  return (
    <>
      {header}

      {search?.error ? (
        <div className="mb-4">
          <QueryError what="all search results" error={search.error} retryHref={retry} />
        </div>
      ) : null}

      {search && search.identifierMatches.length > 0 ? (
        <div className="mb-4">
          <Alert
            tone="info"
            title={`"${q}" matched ${search.identifierMatches.length === 1 ? "an identifier" : `${search.identifierMatches.length} identifiers`}`}
          >
            {search.identifierMatches.length > 1 ? (
              <p className="mb-1">A number can be both a person ID and a household ID — check which record you mean.</p>
            ) : null}
            <ul className="mt-1 space-y-2">
              {search.identifierMatches.map((m, i) => (
                <li key={`${m.kind}-${m.value}-${i}`} className="rounded-md bg-white/70 px-3 py-2 text-ink">
                  <span className="font-semibold">{identifierKindLabel(m.kind, rules)}</span> <span className="font-mono">{m.value}</span>
                  {m.system && m.system !== "connect" ? <span className="text-muted"> ({m.system})</span> : null} →{" "}
                  {m.person_id ? (
                    <>
                      <Link href={drawerHref(base, sp, { person: m.person_id })} scroll={false} className="crm-link font-semibold">
                        {m.display_name ?? "person"}
                      </Link>
                      {m.household_id ? (
                        <>
                          {" in "}
                          <Link href={drawerHref(base, sp, { hh: m.household_id })} scroll={false} className="crm-link">
                            {m.household_name ?? "household"}
                          </Link>
                        </>
                      ) : null}
                    </>
                  ) : m.household_id ? (
                    <Link href={drawerHref(base, sp, { hh: m.household_id })} scroll={false} className="crm-link font-semibold">
                      {m.household_name ?? m.display_name ?? "household"}
                    </Link>
                  ) : (
                    m.display_name
                  )}
                  <span className="block text-xs text-muted">
                    {[m.household_number, m.org_household_id ? `${rules.orgHouseholdLabel} ${m.org_household_id}` : null, m.members ? `Members: ${m.members}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {res.error ? (
        <QueryError what="households" error={res.error} retryHref={retry} />
      ) : (
        <Card title="Households" description="Children’s details visible to your role" padded={false}>
          <div className="px-2.5">
            <ChipLinks
              label="Membership"
              active={tier ?? "all"}
              items={[
                { key: "all", label: "All", href: chipHref(undefined) },
                ...TIERS.map((t) => ({ key: t, label: tierLabel(t), href: chipHref(t) })),
              ]}
            />
            <form method="get" action={base} className="mb-3 flex flex-wrap items-end gap-2.5">
              {tier ? <input type="hidden" name="tier" value={tier} /> : null}
              <div className="min-w-[16rem] flex-1">
                <label htmlFor="q" className="crm-label">
                  Search
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={q ?? ""}
                  placeholder={`Name, email, household no., ${rules.orgMemberLabel} or ${rules.orgHouseholdLabel}, legacy CRM id, QuickBooks id, Zelle name…`}
                  className="crm-input"
                />
              </div>
              <div>
                <label htmlFor="zone" className="crm-label">
                  Zone
                </label>
                <select id="zone" name="zone" defaultValue={zone ?? ""} className="crm-input min-w-40">
                  <option value="">All zones</option>
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className={buttonClass("primary")}>
                Search
              </button>
              {q || zone ? (
                <Link href={hrefWith(base, sp, { q: undefined, zone: undefined, page: undefined })} className={buttonClass("ghost")}>
                  Clear
                </Link>
              ) : null}
            </form>
          </div>
          <div className="px-2.5 pb-2">
            <CustomColumnPicker action={base} sp={sp} defs={defs.defs} current={cfDef?.key ?? null} />
            {cfValues?.error ? <p className="mt-1 text-xs text-danger">Could not load the “{cfDef?.label}” column. Reload to try again.</p> : null}
          </div>
          {balanceError ? (
            <div className="p-2.5">
              <QueryError what="open balances" error={balanceError} retryHref={retry} />
            </div>
          ) : null}
          {detailError ? (
            <div className="p-2.5">
              <QueryError what="members and IDs" error={detailError} retryHref={retry} />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title={q || zone || tier ? "No household matches that search" : "Nothing here right now"}>
              {q ? "Try part of the name, or an identifier exactly as another system shows it." : null}
            </EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Household</th>
                    <th>Zone</th>
                    <th>Membership</th>
                    <th className="num">People</th>
                    <th>On app</th>
                    <th className="num">Open balance</th>
                    {cfDef ? <th>{cfDef.label}</th> : null}
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => {
                    const memberships = (h.memberships as unknown as MembershipEmbed | null) ?? [];
                    const best = bestTier(memberships);
                    const members = membersByHousehold.get(h.id) ?? [];
                    const open = drawerHref(base, sp, { hh: h.id });
                    const org = householdOrgIds.get(h.id) ?? [];
                    return (
                      <ClickableRow key={h.id} href={open} selected={openId === h.id}>
                        <td className="font-mono text-[12px]">
                          {h.household_number ?? "—"}
                          {org.length ? <div className="text-[11px] text-muted" title={rules.orgHouseholdLabel}>{org.join(", ")}</div> : null}
                        </td>
                        <td>
                          <span className="font-bold">{h.display_name}</span>
                          <div className="text-xs text-muted">
                            {members.length === 0
                              ? h.city ?? ""
                              : members.map((m, i) => (
                                  <span key={m.person_id}>
                                    {i > 0 ? ", " : ""}
                                    {m.name}
                                    {m.orgIds.length > 0 ? <span className="font-mono"> {m.orgIds.join("/")}</span> : null}
                                  </span>
                                ))}
                            {members.length > 0 && h.city ? ` · ${h.city}` : null}
                          </div>
                        </td>
                        <td>{h.zone_id ? (zoneName.get(h.zone_id) ?? "—") : "—"}</td>
                        <td>{best ? <Badge tone={tierTone(best.tier)}>{tierLabel(best.tier)}</Badge> : <span className="text-faint">None active</span>}</td>
                        <td className="num">{detailError ? "—" : members.length}</td>
                        <td>{detailError ? "—" : members.some((m) => onApp.has(m.person_id)) ? "Yes" : "No"}</td>
                        <td className="num font-bold">
                          {canSeeGiving ? (
                            formatCents(balances.get(h.id) ?? 0, center.currency)
                          ) : (
                            <span className="font-normal text-faint" title="Needs a giving permission">
                              —
                            </span>
                          )}
                        </td>
                        {cfDef ? <td>{formatCustomValue(cfDef, cfValues?.map.get(h.id)?.[cfDef.key], center.currency) || "—"}</td> : null}
                        <td className="row-actions">
                          <Link href={open} scroll={false} className={buttonClass("ghost", "xs")}>
                            Open
                          </Link>
                        </td>
                      </ClickableRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(p) => hrefWith(base, sp, { page: p })} />
        </Card>
      )}
      <PeopleDrawers session={session} sp={sp} base={base} />
    </>
  );
}

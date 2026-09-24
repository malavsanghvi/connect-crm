import type { Metadata } from "next";
import Link from "next/link";

import {
  Alert,
  Badge,
  Card,
  EmptyState,
  NoAccess,
  PageHeader,
  Pagination,
  QueryError,
  TableWrap,
  buttonClass,
} from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { orgIds, personName } from "@/lib/data/lookups";
import { searchHouseholds } from "@/lib/data/search";
import { identifierKindLabel } from "@/lib/identifiers";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Households" };

const PAGE_SIZE = 50;
const TIER_RANK: Record<string, number> = { life: 3, yearly: 2, community: 1 };
const TIERS = ["life", "yearly", "community"] as const;

type MembershipEmbed = { tier: string; status: string }[];
type Member = { person_id: string; name: string; is_primary: boolean; orgIds: string[] };

export default async function HouseholdsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const { db, center } = session;
  const rules = identifierRules(center.rules);
  const header = (
    <PageHeader
      title="Households"
      description={`Every family record. Search by name, member name or email — or by any identifier: Connect number, ${rules.orgMemberLabel}, ${rules.orgHouseholdLabel}, legacy CRM id, QuickBooks id or a Zelle payer name.`}
    />
  );
  if (!canAccess(session, "households")) {
    return (
      <>
        {header}
        <NoAccess area="Households" access="households" />
      </>
    );
  }

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

  return (
    <>
      {header}
      <form method="get" action="/households" className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="q" className="crm-label">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder={`Name, email, JSH-H-2041, ${rules.orgMemberLabel} or ${rules.orgHouseholdLabel} (e.g. 417), Neon id, QuickBooks id, Zelle name…`}
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
        <div>
          <label htmlFor="tier" className="crm-label">
            Membership
          </label>
          <select id="tier" name="tier" defaultValue={tier ?? ""} className="crm-input min-w-40">
            <option value="">Any</option>
            <option value="life">Life (active)</option>
            <option value="yearly">Yearly (active)</option>
            <option value="community">Community (active)</option>
          </select>
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Search
        </button>
        {q || zone || tier ? (
          <Link href="/households" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

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
                  <span className="font-semibold">{identifierKindLabel(m.kind, rules)}</span>{" "}
                  <span className="font-mono">{m.value}</span>
                  {m.system && m.system !== "connect" ? <span className="text-muted"> ({m.system})</span> : null} →{" "}
                  {m.person_id ? (
                    <>
                      <Link href={`/people/${m.person_id}`} className="crm-link font-semibold">
                        {m.display_name ?? "person"}
                      </Link>
                      {m.household_id ? (
                        <>
                          {" in "}
                          <Link href={`/households/${m.household_id}`} className="crm-link">
                            {m.household_name ?? "household"}
                          </Link>
                        </>
                      ) : null}
                    </>
                  ) : m.household_id ? (
                    <Link href={`/households/${m.household_id}`} className="crm-link font-semibold">
                      {m.household_name ?? m.display_name ?? "household"}
                    </Link>
                  ) : (
                    m.display_name
                  )}
                  <span className="block text-xs text-muted">
                    {[
                      m.household_number,
                      m.org_household_id ? `${rules.orgHouseholdLabel} ${m.org_household_id}` : null,
                      m.members ? `Members: ${m.members}` : null,
                    ]
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
        <Card padded={false}>
          {balanceError ? (
            <div className="p-4">
              <QueryError what="open balances" error={balanceError} retryHref={retry} />
            </div>
          ) : null}
          {detailError ? (
            <div className="p-4">
              <QueryError what="members and IDs" error={detailError} retryHref={retry} />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title={q || zone || tier ? "No households match" : "No households yet"}>
              {q ? "Try part of the name, or an identifier exactly as another system shows it." : null}
            </EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th>Connect no.</th>
                    <th>{rules.orgHouseholdLabel}</th>
                    <th>Members ({rules.orgMemberLabel})</th>
                    <th>Zone</th>
                    <th>Membership</th>
                    <th className="num">Open balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((h) => {
                    const memberships = (h.memberships as unknown as MembershipEmbed | null) ?? [];
                    const best = [...memberships].sort((a, b) => (TIER_RANK[b.tier] ?? 0) - (TIER_RANK[a.tier] ?? 0))[0];
                    const members = membersByHousehold.get(h.id) ?? [];
                    return (
                      <tr key={h.id}>
                        <td>
                          <Link href={`/households/${h.id}`} className="crm-link font-semibold">
                            {h.display_name}
                          </Link>
                          {h.city ? <div className="text-xs text-muted">{h.city}</div> : null}
                        </td>
                        <td className="font-mono text-[0.8125rem]">{h.household_number ?? "—"}</td>
                        <td className="font-mono text-[0.8125rem]">{(householdOrgIds.get(h.id) ?? []).join(", ") || "—"}</td>
                        <td className="text-[0.8125rem]">
                          {members.length === 0
                            ? "—"
                            : members.map((m, i) => (
                                <span key={m.person_id}>
                                  {i > 0 ? ", " : ""}
                                  {m.name}
                                  {m.orgIds.length > 0 ? <span className="font-mono text-muted"> {m.orgIds.join("/")}</span> : null}
                                </span>
                              ))}
                        </td>
                        <td>{h.zone_id ? (zoneName.get(h.zone_id) ?? "—") : "—"}</td>
                        <td>
                          {best ? (
                            <Badge tone={best.tier === "life" ? "purple" : best.tier === "yearly" ? "navy" : "neutral"}>
                              {best.tier}
                            </Badge>
                          ) : (
                            <span className="text-muted">None active</span>
                          )}
                        </td>
                        <td className="num">
                          {canSeeGiving ? (
                            formatCents(balances.get(h.id) ?? 0, center.currency)
                          ) : (
                            <span className="text-muted" title="Needs a giving permission">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={res.count ?? null}
            hrefFor={(p) => hrefWith("/households", sp, { page: p })}
          />
        </Card>
      )}
    </>
  );
}

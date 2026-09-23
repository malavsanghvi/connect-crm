import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge, NoAccess, PageHeader, QueryError, Tabs } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { orgIds } from "@/lib/data/lookups";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { AuditTab } from "./audit-tab";
import { IdentifiersTab } from "./identifiers-tab";
import { MembersTab } from "./members-tab";
import { MembershipsTab } from "./memberships-tab";
import { PaymentsTab } from "./payments-tab";
import { PledgesTab } from "./pledges-tab";

export const metadata: Metadata = { title: "Household" };

const TABS = [
  { key: "members", label: "Members" },
  { key: "identifiers", label: "Identifiers" },
  { key: "memberships", label: "Memberships" },
  { key: "pledges", label: "Pledges" },
  { key: "payments", label: "Payments" },
  { key: "audit", label: "Audit" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function HouseholdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();
  if (!canAccess(session, "households")) {
    return (
      <>
        <PageHeader title="Household" />
        <NoAccess area="Household records" access="households" />
      </>
    );
  }
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const sp = await searchParams;
  const tabParam = param(sp, "tab");
  const tab: TabKey = TABS.find((t) => t.key === tabParam)?.key ?? "members";

  const { db, center } = session;
  const rules = identifierRules(center.rules);
  const tz = center.time_zone;

  const hh = await db
    .from("households")
    .select("id, display_name, household_number, zone_id, address_line1, address_line2, city, state_region, postal_code, merged_into_id, directory_opt_in, notes, created_at")
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (hh.error) {
    return (
      <>
        <PageHeader title="Household" />
        <QueryError what="this household" error={hh.error} retryHref={`/households/${id}`} />
      </>
    );
  }
  if (!hh.data) notFound();
  const household = hh.data;

  const [zoneRes, cardRes, org, activeMembership] = await Promise.all([
    household.zone_id ? db.from("zones").select("name").eq("id", household.zone_id).maybeSingle() : null,
    db.rpc("household_card", { p_household: id }),
    orgIds(db, center.id, { householdIds: [id] }),
    db
      .from("memberships")
      .select("tier, status, starts_on, ends_on")
      .eq("household_id", id)
      .eq("status", "active")
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const card = cardRes.data?.[0];
  const orgHouseholdIds = org.byHousehold.get(id) ?? [];
  const address = [household.address_line1, household.address_line2, household.city, household.state_region, household.postal_code]
    .filter(Boolean)
    .join(", ");
  const canSeeGiving = can(session, ["giving.view", "giving.manage", "giving.record_offline"]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/households" className="crm-link">
            ← Households
          </Link>
        }
        title={household.display_name}
        description={address || "No address on file"}
      />

      {household.merged_into_id ? (
        <p className="mb-4 rounded-lg border border-saffron/40 bg-saffron-50 px-4 py-2 text-sm text-brown">
          This household was merged into{" "}
          <Link href={`/households/${household.merged_into_id}`} className="crm-link font-semibold">
            another household
          </Link>
          . Its history is kept here.
        </p>
      ) : null}

      <section aria-label="Identity" className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <IdentityCell label="Connect household no." value={household.household_number} mono />
        <IdentityCell
          label={rules.orgHouseholdLabel}
          value={orgHouseholdIds.length > 0 ? orgHouseholdIds.join(", ") : null}
          mono
          emptyHint="Not recorded"
        />
        <IdentityCell
          label="Primary member"
          value={card?.primary_member ? `${card.primary_member}${card.primary_org_member_id ? ` · ${card.primary_org_member_id}` : ""}` : null}
        />
        <IdentityCell label="Zone" value={zoneRes?.data?.name ?? null} />
        <IdentityCell
          label="Membership"
          value={
            activeMembership.data ? (
              <Badge tone={activeMembership.data.tier === "life" ? "purple" : "navy"}>{activeMembership.data.tier} · active</Badge>
            ) : (
              "None active"
            )
          }
        />
        <IdentityCell
          label="Open pledges"
          value={canSeeGiving && card ? formatCents(card.open_pledge_cents ?? 0, center.currency) : null}
          emptyHint={canSeeGiving ? "—" : "Needs a giving permission"}
          sub={card?.last_gift_on ? `Last gift ${formatDate(card.last_gift_on, tz)}` : undefined}
        />
      </section>

      <Tabs active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/households/${id}?tab=${t.key}` }))} />

      {tab === "members" ? <MembersTab session={session} householdId={id} /> : null}
      {tab === "identifiers" ? <IdentifiersTab session={session} householdId={id} household={household} /> : null}
      {tab === "memberships" ? <MembershipsTab session={session} householdId={id} /> : null}
      {tab === "pledges" ? <PledgesTab session={session} householdId={id} /> : null}
      {tab === "payments" ? <PaymentsTab session={session} householdId={id} /> : null}
      {tab === "audit" ? <AuditTab session={session} householdId={id} /> : null}
    </>
  );
}

function IdentityCell({
  label,
  value,
  mono,
  emptyHint = "—",
  sub,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  emptyHint?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2.5">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-0.5 text-[0.9375rem] font-semibold text-ink ${mono ? "font-mono" : ""}`}>
        {value ?? <span className="font-sans font-normal text-muted">{emptyHint}</span>}
      </p>
      {sub ? <p className="text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

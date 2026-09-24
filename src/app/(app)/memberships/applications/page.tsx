import type { Metadata } from "next";
import Link from "next/link";

import { ClickableRow, UrlDrawer } from "@/app/(app)/people/_components/client";
import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, ChipLinks, DrawerSection, EmptyState, KeyValueRow, NoAccess, PageHeader, Pagination, QueryError, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { needsEcApproval } from "@/lib/applications";
import { identifierRules } from "@/lib/center-rules";
import { householdsById, orgIds, peopleById, userNames } from "@/lib/data/lookups";
import { daysBetween, formatDate, todayInTz, dateInTz } from "@/lib/dates";
import type { Enums } from "@/lib/database.types";
import { APPLICATION_STATUS_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { tierLabel } from "@/lib/people";
import { hrefWith, isUuid, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession, type CrmSession } from "@/lib/session";

import { decideApplicationAction } from "./actions";

export const metadata: Metadata = { title: "People · Membership applications" };

const PAGE_SIZE = 40;
const SUB = "Yearly and life memberships need a verified reference at the same tier or higher, then center approval";
type AppStatus = Enums<"application_status">;
const VIEWS: Record<string, { label: string; statuses: AppStatus[] }> = {
  decide: { label: "Needs a decision", statuses: ["awaiting_center", "awaiting_ec"] },
  reference: { label: "Awaiting reference", statuses: ["awaiting_reference", "draft"] },
  declined: { label: "Reference declined", statuses: ["reference_declined"] },
  approved: { label: "Approved", statuses: ["approved"] },
  rejected: { label: "Declined / expired", statuses: ["rejected", "expired", "withdrawn"] },
  all: { label: "All", statuses: [] },
};
type ViewKey = keyof typeof VIEWS & string;
const TIER_RANK: Record<string, number> = { community: 1, yearly: 2, life: 3 };
const OPEN = ["draft", "awaiting_reference", "reference_declined", "awaiting_center", "awaiting_ec"];

/** "Approved Sep 19" / "Declined" / "Pending · expires Oct 2" and its colour. */
function referenceStatus(a: { reference_person_id: string | null; reference_decision: string | null; reference_decided_at: string | null; reference_expires_at: string | null }, tz: string): { text: string; tone: "ok" | "warn" | "bad" } {
  if (!a.reference_person_id) return { text: "No reference named", tone: "warn" };
  if (a.reference_decision === "approved") return { text: `Approved${a.reference_decided_at ? ` ${formatDate(a.reference_decided_at, tz)}` : ""}`, tone: "ok" };
  if (a.reference_decision === "unknown") return { text: "Not eligible · doesn't know the applicant", tone: "bad" };
  if (a.reference_decision) return { text: `Not eligible · ${a.reference_decision}`, tone: "bad" };
  return { text: `Pending${a.reference_expires_at ? ` · expires ${formatDate(a.reference_expires_at, tz)}` : ""}`, tone: "warn" };
}

function feeText(fee: number, ref: string | null, status: string, currency: string): string {
  if (fee <= 0) return "No fee";
  const amount = formatCents(fee, currency);
  if (status === "approved") return `${amount} ${ref ? "captured on approval" : "due"}`;
  return `${amount} ${ref ? "authorized" : "not yet authorized"}`;
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="People" description={SUB} />;
  if (!canAccess(session, "applications")) {
    return (
      <>
        {header}
        <NoAccess area="Membership applications" access="applications" />
      </>
    );
  }
  const sp = await searchParams;
  const base = "/memberships/applications";
  const viewParam = param(sp, "view");
  const openApp = param(sp, "app");
  const view: ViewKey = viewParam && viewParam in VIEWS ? viewParam : isUuid(openApp) ? "all" : "decide";
  const page = pageParam(sp);
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const rules = identifierRules(center.rules);
  const canDecide = canAccess(session, "applicationsDecide");

  let query = db
    .from("membership_applications")
    .select(
      "id, applicant_person_id, household_id, membership_type_id, tier, reference_person_id, reference_note, reference_decision, reference_decided_at, reference_expires_at, fee_cents, fee_authorization_ref, status, center_decided_by, center_decided_at, center_reason, ec_decided_by, ec_decided_at, created_at, updated_at",
      { count: "exact" },
    )
    .eq("center_id", center.id);
  const statuses = VIEWS[view].statuses;
  if (statuses.length > 0) query = query.in("status", statuses);
  const from = (page - 1) * PAGE_SIZE;
  const res = await query.order("created_at", { ascending: true }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];

  const [people, households, types, deciders, org] = await Promise.all([
    peopleById(db, [...rows.map((r) => r.applicant_person_id), ...rows.map((r) => r.reference_person_id)]),
    householdsById(db, rows.map((r) => r.household_id)),
    db.from("membership_types").select("id, name, ec_approval_required, reference_tier_min").eq("center_id", center.id),
    userNames(db, center.id, [...rows.map((r) => r.center_decided_by), ...rows.map((r) => r.ec_decided_by)]),
    orgIds(db, center.id, { personIds: rows.flatMap((r) => [r.applicant_person_id, r.reference_person_id ?? ""]).filter(Boolean) }),
  ]);
  const typeById = new Map((types.data ?? []).map((t) => [t.id, t]));
  const lookupError = people.error ?? households.error ?? types.error ?? org.error;
  const retry = hrefWith(base, sp, {});

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={12} title="Applications" padded={false}>
          <div className="px-2.5">
            <ChipLinks
              label="Status"
              active={view}
              items={Object.keys(VIEWS).map((k) => ({ key: k, label: VIEWS[k].label, href: `${base}?view=${k}` }))}
            />
            {!canDecide ? <p className="mb-2 text-xs text-muted">You can view applications. Decisions need the people.approve permission.</p> : null}
          </div>
          {res.error ? (
            <div className="p-2.5">
              <QueryError what="applications" error={res.error} retryHref={retry} />
            </div>
          ) : null}
          {lookupError ? (
            <div className="p-2.5">
              <QueryError what="names for some applications" error={lookupError} retryHref={retry} />
            </div>
          ) : null}
          {!res.error && rows.length === 0 ? (
            <EmptyState title="Nothing here right now">{view === "decide" ? "Nothing is waiting for a center or EC decision." : null}</EmptyState>
          ) : rows.length > 0 ? (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Applicant</th>
                    <th>Tier</th>
                    <th>Reference</th>
                    <th>Reference status</th>
                    <th>Fee</th>
                    <th>Status</th>
                    <th className="num">Age</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const applicant = people.map.get(a.applicant_person_id);
                    const reference = a.reference_person_id ? people.map.get(a.reference_person_id) : null;
                    const household = households.map.get(a.household_id);
                    const type = typeById.get(a.membership_type_id);
                    const ec = needsEcApproval(a.tier, type?.ec_approval_required ?? false);
                    const age = daysBetween(dateInTz(a.created_at, tz), today);
                    const applicantOrg = org.byPerson.get(a.applicant_person_id) ?? [];
                    const ref = referenceStatus(a, tz);
                    const href = hrefWith(base, sp, { app: a.id });
                    const decide = canDecide && (a.status === "awaiting_center" || a.status === "awaiting_ec");
                    return (
                      <ClickableRow key={a.id} href={href} selected={openApp === a.id}>
                        <td className="font-mono text-[12px]">{a.id.slice(0, 8).toUpperCase()}</td>
                        <td>
                          <span className="font-bold">{applicant?.name ?? "Applicant"}</span>
                          <div className="text-xs text-muted">
                            {household?.display_name ?? "Household"}
                            {household?.household_number ? ` · ${household.household_number}` : ""}
                            {applicantOrg.length ? ` · ${rules.orgMemberLabel} ${applicantOrg.join(", ")}` : ""}
                          </div>
                        </td>
                        <td>
                          {tierLabel(a.tier)}
                          {ec ? <div className="text-xs text-purple">EC approval</div> : null}
                        </td>
                        <td>{reference?.name ?? <span className="text-faint">None named</span>}</td>
                        <td>
                          <StatusText tone={ref.tone}>{ref.text}</StatusText>
                        </td>
                        <td className="whitespace-nowrap">{feeText(a.fee_cents, a.fee_authorization_ref, a.status, center.currency)}</td>
                        <td>
                          <span className={`font-bold ${a.status === "approved" ? "text-success" : a.status === "rejected" ? "text-danger" : "text-ink"}`}>
                            {a.status === "rejected" ? "Declined" : (APPLICATION_STATUS_LABEL[a.status] ?? a.status)}
                          </span>
                          {a.center_decided_at ? (
                            <div className="text-xs text-muted">
                              Center: {deciders.get(a.center_decided_by ?? "")?.name ?? "reviewer"}, {formatDate(a.center_decided_at, tz)}
                            </div>
                          ) : null}
                          {a.ec_decided_at ? (
                            <div className="text-xs text-muted">
                              EC: {deciders.get(a.ec_decided_by ?? "")?.name ?? "member"}, {formatDate(a.ec_decided_at, tz)}
                            </div>
                          ) : null}
                        </td>
                        <td className="num">
                          <span className={age > 14 && OPEN.includes(a.status) ? "font-bold text-danger" : ""}>{age}d</span>
                        </td>
                        <td className="row-actions">
                          <Link href={href} scroll={false} className={buttonClass(decide ? "primary" : "ghost", "xs")}>
                            {decide ? "Review" : "View"}
                          </Link>
                        </td>
                      </ClickableRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(p) => hrefWith(base, sp, { page: p })} />
        </Card>
        <Card span={12} title="Rules in effect">
          <p className="text-[13px] text-ink-2">
            Yearly: reference must be a verified Yearly or Life member outside the household. Life: reference must be a Life member; after the center
            review, a different Executive Committee member records the EC approval. Fees are authorized at application and captured only on approval.
            Configure in Settings › Center settings.
          </p>
        </Card>
      </BlockGrid>
      {isUuid(openApp) ? <ApplicationDrawer session={session} id={openApp} closeHref={hrefWith(base, sp, { app: undefined })} /> : null}
    </>
  );
}

async function ApplicationDrawer({ session, id, closeHref }: { session: CrmSession; id: string; closeHref: string }) {
  const { db, center } = session;
  const tz = center.time_zone;
  const res = await db
    .from("membership_applications")
    .select("id, applicant_person_id, household_id, membership_type_id, tier, reference_person_id, reference_note, reference_decision, reference_decided_at, reference_expires_at, fee_cents, fee_authorization_ref, status, center_decided_by, center_reason")
    .eq("id", id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (res.error || !res.data) {
    return (
      <UrlDrawer closeHref={closeHref} kicker="Application" title={res.error ? "Could not load this application" : "Application not found"}>
        {res.error ? <QueryError what="this application" error={res.error} /> : <p className="text-[13px] text-muted">It may have been removed, or your role cannot see it.</p>}
      </UrlDrawer>
    );
  }
  const a = res.data;
  const [people, type, refLinks, refTier, dupes] = await Promise.all([
    peopleById(db, [a.applicant_person_id, a.reference_person_id]),
    db.from("membership_types").select("name, ec_approval_required, reference_tier_min").eq("id", a.membership_type_id).maybeSingle(),
    a.reference_person_id ? db.from("household_members").select("household_id").eq("person_id", a.reference_person_id).is("left_at", null) : null,
    a.reference_person_id ? db.from("memberships").select("tier").eq("person_id", a.reference_person_id).eq("status", "active") : null,
    db.from("merge_candidates").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "open").or(`left_id.eq.${a.applicant_person_id},right_id.eq.${a.applicant_person_id}`),
  ]);
  // The reference's tier: their own membership, else the best active one of their households.
  let bestRefTier = (refTier?.data ?? []).map((m) => m.tier).sort((x, y) => (TIER_RANK[y] ?? 0) - (TIER_RANK[x] ?? 0))[0] ?? null;
  const refHouseholds = (refLinks?.data ?? []).map((l) => l.household_id);
  if (!bestRefTier && refHouseholds.length) {
    const hm = await db.from("memberships").select("tier").in("household_id", refHouseholds).eq("status", "active");
    if (hm.error) console.error("[applications] reference household tier failed; tier check shows unknown:", hm.error);
    bestRefTier = (hm.data ?? []).map((m) => m.tier).sort((x, y) => (TIER_RANK[y] ?? 0) - (TIER_RANK[x] ?? 0))[0] ?? null;
  }
  const minTier = type.data?.reference_tier_min ?? (a.tier === "life" ? "life" : a.tier === "yearly" ? "yearly" : null);
  const tierPasses = !minTier ? null : bestRefTier ? (TIER_RANK[bestRefTier] ?? 0) >= (TIER_RANK[minTier] ?? 0) : false;
  const outside = a.reference_person_id ? !refHouseholds.includes(a.household_id) : null;
  const applicant = people.map.get(a.applicant_person_id);
  const reference = a.reference_person_id ? people.map.get(a.reference_person_id) : null;
  const ec = needsEcApproval(a.tier, type.data?.ec_approval_required ?? false);
  const isEc = session.isPlatformAdmin || session.roles.some((r) => r.key === "executive_committee" && r.scopeKind === "center");
  const ref = referenceStatus(a, tz);
  const canDecide = canAccess(session, "applicationsDecide") && OPEN.includes(a.status);
  const canApprove = a.status === "awaiting_center" || (a.status === "awaiting_ec" && isEc && a.center_decided_by !== session.userId);
  const approveLabel = a.status === "awaiting_ec" ? "Record EC approval" : ec ? "Approve — send to EC" : "Approve and grant";
  const lookupError = people.error ?? type.error ?? refLinks?.error ?? refTier?.error ?? dupes.error;

  return (
    <UrlDrawer
      closeHref={closeHref}
      kicker={`Application · ${a.id.slice(0, 8).toUpperCase()}`}
      title={applicant?.name ?? "Applicant"}
      subtitle={`${tierLabel(a.tier)} membership${type.data?.name ? ` · ${type.data.name}` : ""}`}
      footer={
        <>
          <Link href={`/households/${a.household_id}`} className={buttonClass("ghost")}>
            Household record
          </Link>
          {canDecide && canApprove ? (
            <ActionForm
              action={decideApplicationAction}
              submitLabel={approveLabel}
              pendingLabel="Saving…"
              variant="ok"
              confirmKicker="Membership decision"
              confirmMessage={
                a.status === "awaiting_ec"
                  ? "Record the Executive Committee approval? The application becomes approved."
                  : ec
                    ? "Approve the center review? A different Executive Committee member then records the EC approval."
                    : `Approve this ${tierLabel(a.tier)} membership? This records the decision; the membership record and fee capture are not created automatically yet.`
              }
            >
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="decision" value="approve" />
            </ActionForm>
          ) : null}
        </>
      }
    >
      {lookupError ? <QueryError what="some checks" error={lookupError} /> : null}
      <DrawerSection title="Reference">
        <KeyValueRow label="Reference" value={reference?.name ?? "None named"} />
        <KeyValueRow label="Decision" value={ref.text} tone={ref.tone} />
        <KeyValueRow label="Their note" value={a.reference_note ? `“${a.reference_note}”` : "—"} />
      </DrawerSection>
      <DrawerSection title="Checks">
        <KeyValueRow
          label="Reference tier rule"
          value={tierPasses === null ? "No minimum" : tierPasses ? `Passes (${tierLabel(bestRefTier)})` : bestRefTier ? `Fails (${tierLabel(bestRefTier)})` : "Fails (no active membership)"}
          tone={tierPasses === false ? "bad" : tierPasses ? "ok" : "ink"}
        />
        <KeyValueRow label="Reference outside household" value={outside === null ? "—" : outside ? "Yes" : "No — same household"} tone={outside === false ? "bad" : "ink"} />
        <KeyValueRow label="Duplicate check" value={dupes.error ? "Could not check" : (dupes.count ?? 0) > 0 ? "Possible duplicate — compare" : "No match found"} tone={(dupes.count ?? 0) > 0 ? "warn" : "ink"} href={(dupes.count ?? 0) > 0 ? `/people/merge?person=${a.applicant_person_id}` : undefined} />
        <KeyValueRow label="Fee" value={feeText(a.fee_cents, a.fee_authorization_ref, a.status, center.currency)} />
      </DrawerSection>
      <DrawerSection title="Final approval">
        <KeyValueRow
          label="Approver"
          value={ec ? "Center, then a second EC member" : "Membership coordinator"}
        />
        <KeyValueRow label="Status" value={a.status === "rejected" ? "Declined" : (APPLICATION_STATUS_LABEL[a.status] ?? a.status)} tone={a.status === "approved" ? "ok" : a.status === "rejected" ? "bad" : "ink"} />
        {a.center_reason ? <KeyValueRow label="Reason" value={a.center_reason} /> : null}
        {canDecide && a.status === "awaiting_ec" && !canApprove ? (
          <p className="text-xs text-muted">
            {a.center_decided_by === session.userId
              ? "You made the center review — a different Executive Committee member gives the EC approval."
              : "Waiting for an Executive Committee member."}
          </p>
        ) : null}
        {canDecide && !["awaiting_center", "awaiting_ec"].includes(a.status) ? (
          <p className="text-xs text-muted">Can be approved once the reference approves.</p>
        ) : null}
      </DrawerSection>
      {canDecide ? (
        <DrawerSection title="Decline">
          <ActionForm action={decideApplicationAction} submitLabel="Decline" pendingLabel="Declining…" variant="bad" confirmMessage="Decline this application? The reason is kept on the application.">
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="decision" value="reject" />
            <label htmlFor={`reason-${a.id}`} className="crm-label">
              Reason (required)
            </label>
            <textarea id={`reason-${a.id}`} name="reason" required maxLength={1000} className="crm-input mb-2 min-h-16" />
          </ActionForm>
        </DrawerSection>
      ) : null}
    </UrlDrawer>
  );
}

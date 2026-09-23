import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, NoAccess, PageHeader, Pagination, QueryError, TableWrap, Tabs } from "@/components/ui";
import { needsEcApproval } from "@/lib/applications";
import { identifierRules } from "@/lib/center-rules";
import { householdsById, orgIds, peopleById, userNames } from "@/lib/data/lookups";
import { daysBetween, formatDate, todayInTz, dateInTz } from "@/lib/dates";
import type { Enums } from "@/lib/database.types";
import { APPLICATION_STATUS_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { decideApplicationAction } from "./actions";

export const metadata: Metadata = { title: "Membership applications" };

const PAGE_SIZE = 40;
type AppStatus = Enums<"application_status">;
const VIEWS: Record<string, { label: string; statuses: AppStatus[] }> = {
  decide: { label: "Needs a decision", statuses: ["awaiting_center", "awaiting_ec"] },
  reference: { label: "Awaiting reference", statuses: ["awaiting_reference", "draft"] },
  declined: { label: "Reference declined", statuses: ["reference_declined"] },
  approved: { label: "Approved", statuses: ["approved"] },
  rejected: { label: "Rejected / expired", statuses: ["rejected", "expired", "withdrawn"] },
  all: { label: "All", statuses: [] },
};
type ViewKey = keyof typeof VIEWS & string;

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Membership applications"
      description="Yearly memberships need the named reference, then a center decision. Life memberships add an Executive Committee approval by a second person."
    />
  );
  if (!canAccess(session, "applications")) {
    return (
      <>
        {header}
        <NoAccess area="Membership applications" access="applications" />
      </>
    );
  }
  const sp = await searchParams;
  const viewParam = param(sp, "view");
  const view: ViewKey = viewParam && viewParam in VIEWS ? viewParam : "decide";
  const page = pageParam(sp);
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const rules = identifierRules(center.rules);
  const canDecide = canAccess(session, "applicationsDecide");
  const isEc = session.isPlatformAdmin || session.roles.some((r) => r.key === "executive_committee" && r.scopeKind === "center");

  let query = db
    .from("membership_applications")
    .select(
      "id, applicant_person_id, household_id, membership_type_id, tier, reference_person_id, reference_note, reference_decision, reference_decided_at, reference_expires_at, fee_cents, status, center_decided_by, center_decided_at, center_reason, ec_decided_by, ec_decided_at, created_at, updated_at",
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
    db.from("membership_types").select("id, name, ec_approval_required").eq("center_id", center.id),
    userNames(db, center.id, [...rows.map((r) => r.center_decided_by), ...rows.map((r) => r.ec_decided_by)]),
    orgIds(db, center.id, { personIds: rows.flatMap((r) => [r.applicant_person_id, r.reference_person_id ?? ""]).filter(Boolean) }),
  ]);
  const typeById = new Map((types.data ?? []).map((t) => [t.id, t]));
  const lookupError = people.error ?? households.error ?? types.error ?? org.error;

  return (
    <>
      {header}
      <Tabs
        active={view}
        tabs={Object.keys(VIEWS).map((k) => ({ key: k, label: VIEWS[k].label, href: `/memberships/applications?view=${k}` }))}
      />
      {!canDecide ? (
        <p className="mb-4 text-sm text-muted">You can view applications. Decisions need the people.approve permission.</p>
      ) : null}
      {res.error ? (
        <QueryError what="applications" error={res.error} retryHref={hrefWith("/memberships/applications", sp, {})} />
      ) : (
        <Card padded={false}>
          {lookupError ? (
            <div className="p-4">
              <QueryError what="names for some applications" error={lookupError} retryHref={hrefWith("/memberships/applications", sp, {})} />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title="No applications here">
              {view === "decide" ? "Nothing is waiting for a center or EC decision." : null}
            </EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Applicant</th>
                    <th>Household</th>
                    <th>Tier</th>
                    <th>Reference</th>
                    <th className="num">Fee</th>
                    <th>Status</th>
                    <th className="num">Age</th>
                    {canDecide ? <th>Decision</th> : null}
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
                    const referenceOrg = a.reference_person_id ? (org.byPerson.get(a.reference_person_id) ?? []) : [];
                    return (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/people/${a.applicant_person_id}`} className="crm-link font-semibold">
                            {applicant?.name ?? "Applicant"}
                          </Link>
                          <div className="font-mono text-xs text-muted">
                            {applicant?.member_number ?? "—"}
                            {applicantOrg.length > 0 ? ` · ${rules.orgMemberLabel} ${applicantOrg.join(", ")}` : ""}
                          </div>
                        </td>
                        <td>
                          <Link href={`/households/${a.household_id}`} className="crm-link">
                            {household?.display_name ?? "Household"}
                          </Link>
                          <div className="font-mono text-xs text-muted">{household?.household_number ?? ""}</div>
                        </td>
                        <td>
                          <span className="capitalize">{a.tier}</span>
                          <div className="text-xs text-muted">{type?.name ?? ""}</div>
                          {ec ? (
                            <div className="mt-1">
                              <Badge tone="purple">Needs EC approval</Badge>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {reference ? (
                            <>
                              <Link href={`/people/${a.reference_person_id}`} className="crm-link">
                                {reference.name}
                              </Link>
                              <div className="font-mono text-xs text-muted">
                                {referenceOrg.length > 0 ? `${rules.orgMemberLabel} ${referenceOrg.join(", ")}` : reference.member_number}
                              </div>
                            </>
                          ) : (
                            <span className="text-muted">None named</span>
                          )}
                          <div className="text-xs">
                            {a.reference_decision ? (
                              <Badge tone={a.reference_decision === "approved" ? "success" : "danger"}>
                                {a.reference_decision === "unknown" ? "Doesn't know applicant" : a.reference_decision}
                              </Badge>
                            ) : a.reference_expires_at ? (
                              <span className="text-muted">Request expires {formatDate(a.reference_expires_at, tz)}</span>
                            ) : null}
                          </div>
                          {a.reference_note ? <div className="mt-1 text-xs text-muted">“{a.reference_note}”</div> : null}
                        </td>
                        <td className="num">{formatCents(a.fee_cents, center.currency)}</td>
                        <td>
                          <Badge tone={a.status === "approved" ? "success" : a.status === "rejected" ? "danger" : a.status === "awaiting_ec" ? "purple" : "warning"}>
                            {APPLICATION_STATUS_LABEL[a.status] ?? a.status}
                          </Badge>
                          {a.center_decided_at ? (
                            <div className="mt-1 text-xs text-muted">
                              Center: {deciders.get(a.center_decided_by ?? "")?.name ?? "reviewer"}, {formatDate(a.center_decided_at, tz)}
                            </div>
                          ) : null}
                          {a.ec_decided_at ? (
                            <div className="text-xs text-muted">
                              EC: {deciders.get(a.ec_decided_by ?? "")?.name ?? "member"}, {formatDate(a.ec_decided_at, tz)}
                            </div>
                          ) : null}
                          {a.center_reason ? <div className="mt-1 text-xs">Reason: {a.center_reason}</div> : null}
                        </td>
                        <td className="num">
                          <span className={age > 14 ? "font-semibold text-maroon" : ""}>{age}d</span>
                        </td>
                        {canDecide ? (
                          <td className="min-w-[15rem]">
                            <DecisionControls
                              id={a.id}
                              status={a.status}
                              ec={ec}
                              isEc={isEc}
                              iReviewed={a.center_decided_by === session.userId}
                            />
                          </td>
                        ) : null}
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
            hrefFor={(p) => hrefWith("/memberships/applications", sp, { page: p })}
          />
        </Card>
      )}
    </>
  );
}

function DecisionControls({
  id,
  status,
  ec,
  isEc,
  iReviewed,
}: {
  id: string;
  status: string;
  ec: boolean;
  isEc: boolean;
  iReviewed: boolean;
}) {
  const open = ["draft", "awaiting_reference", "reference_declined", "awaiting_center", "awaiting_ec"].includes(status);
  if (!open) return <span className="text-sm text-muted">Decided</span>;
  const canApprove = status === "awaiting_center" || (status === "awaiting_ec" && isEc && !iReviewed);
  const approveLabel = status === "awaiting_ec" ? "Record EC approval" : ec ? "Approve — send to EC" : "Approve";
  return (
    <div className="space-y-2">
      {canApprove ? (
        <ActionForm
          action={decideApplicationAction}
          submitLabel={approveLabel}
          pendingLabel="Saving…"
          variant="success"
          size="sm"
          confirmMessage={status === "awaiting_ec" ? "Record the Executive Committee approval?" : undefined}
        >
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="approve" />
        </ActionForm>
      ) : status === "awaiting_ec" ? (
        <p className="text-xs text-muted">
          {iReviewed
            ? "You made the center review — a different Executive Committee member gives the EC approval."
            : "Waiting for an Executive Committee member."}
        </p>
      ) : status !== "awaiting_center" ? (
        <p className="text-xs text-muted">Can be approved once the reference approves.</p>
      ) : null}
      <details>
        <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-maroon">Reject…</summary>
        <ActionForm action={decideApplicationAction} submitLabel="Reject" pendingLabel="Rejecting…" variant="danger" size="sm" className="mt-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="reject" />
          <label htmlFor={`reason-${id}`} className="crm-label">
            Reason (required)
          </label>
          <textarea id={`reason-${id}`} name="reason" required maxLength={1000} className="crm-input mb-2 min-h-16" />
        </ActionForm>
      </details>
    </div>
  );
}

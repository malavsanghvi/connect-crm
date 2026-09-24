import type { Metadata } from "next";
import Link from "next/link";

import { approveAsSecondAction } from "@/app/(app)/approvals/actions";
import { ActionForm } from "@/components/action-form";
import { ChipGroup } from "@/components/controls";
import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, QueryError, Stat, StatusText, TableWrap } from "@/components/ui";
import { loadVoting } from "@/lib/data/voting";
import { formatDate } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { overrideStep } from "@/lib/voting";

import { applyOverrideAction, requestOverrideAction } from "../actions";
import { ClickableRow, ExportButton } from "../_components/client";
import { PeopleDrawers, drawerHref } from "../_components/drawers";

export const metadata: Metadata = { title: "People · Voting eligibility" };

const SUB = "Election eligibility computed nightly from membership and pledge data · rules set per center";

export default async function VotingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!canAccess(session, "voting")) {
    return (
      <>
        <PageHeader title="People" description={SUB} />
        <NoAccess area="Voting eligibility" access="voting" />
      </>
    );
  }
  const sp = await searchParams;
  const base = "/people/voting";
  const tz = session.center.time_zone;
  const v = await loadVoting(session);
  const canDecide = canAccess(session, "peopleApprove");
  const openPerson = param(sp, "person");
  const openHh = param(sp, "hh");

  return (
    <>
      <PageHeader title="People" description={SUB} actions={<ExportButton label="Export voter list" what="the eligible voter list" />} />
      {v.error ? (
        <div className="mb-4">
          <QueryError what="some eligibility data" error={v.error} retryHref={base} />
        </div>
      ) : null}
      <BlockGrid>
        <Card span={12}>
          <KpiGrid cols={4}>
            <Stat label="Eligible voters" value={v.eligible.toLocaleString("en-US")} hint="latest nightly check, overrides applied" tone="success" />
            <Stat label="Not eligible" value={v.notEligible.toLocaleString("en-US")} hint={`open prior-year pledges or under ${v.waitDays} days`} tone="danger" />
            <Stat
              label="Can become eligible"
              value={v.canBecome === null ? "—" : v.canBecome.toLocaleString("en-US")}
              hint={v.canBecome === null ? "needs a giving permission to check pledges" : "by paying open pledges before cutoff"}
              tone="brown"
            />
            <Stat
              label="Ballot cutoff"
              value={v.ballotCutoff ? formatDate(v.ballotCutoff, tz) : "Not set"}
              hint={v.ballotCutoff ? "set by the election committee" : "set in the center rules (voting.ballot_cutoff)"}
              tone="navy"
            />
          </KpiGrid>
        </Card>

        <Card span={12} title="Life-member households" padded={false}>
          {v.households.length === 0 ? (
            <EmptyState title="Nothing here right now" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Household</th>
                    <th>Since</th>
                    <th>Pledges</th>
                    <th>Tenure</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {v.households.map((h) => (
                    <ClickableRow key={h.id} href={drawerHref(base, sp, { hh: h.id })} selected={openHh === h.id}>
                      <td className="font-mono text-[12px]">{h.number ?? "—"}</td>
                      <td className="font-bold">{h.name}</td>
                      <td>{h.since.slice(0, 4)}</td>
                      <td>
                        {h.priorYearOpen === null ? (
                          <span className="text-faint">Needs a giving permission</span>
                        ) : h.priorYearOpen ? (
                          <StatusText tone="warn">Prior-year pledge open</StatusText>
                        ) : (
                          <StatusText tone="ok">Paid up</StatusText>
                        )}
                      </td>
                      <td>{h.tenureOk ? <StatusText tone="ok">Over {v.waitDays} days</StatusText> : <StatusText tone="warn">Under {v.waitDays} days</StatusText>}</td>
                      <td>
                        {h.status === "eligible" ? (
                          <StatusText tone="ok">Eligible</StatusText>
                        ) : h.status === "not_eligible" ? (
                          <StatusText tone="bad">Not eligible</StatusText>
                        ) : (
                          <span className="text-faint">Not computed yet</span>
                        )}
                      </td>
                    </ClickableRow>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card
          span={12}
          title="Voters and overrides"
          description="Each person's latest nightly check. An override needs a reason and two different people with people.approve."
          padded={false}
        >
          {v.voters.length === 0 ? (
            <EmptyState title="No eligibility has been computed yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Household</th>
                    <th>Checked</th>
                    <th>Status</th>
                    <th>Why</th>
                    <th>Override</th>
                  </tr>
                </thead>
                <tbody>
                  {v.voters.map((r) => {
                    const step = overrideStep(r.override);
                    const want = r.override.requestedValue === false ? "not eligible" : "eligible";
                    return (
                      <tr key={r.snapshotId} aria-selected={openPerson === r.personId || undefined}>
                        <td>
                          <Link href={drawerHref(base, sp, { person: r.personId })} scroll={false} className="crm-link font-bold">
                            {r.name}
                          </Link>
                        </td>
                        <td>{r.householdName ?? <span className="text-faint">—</span>}</td>
                        <td className="whitespace-nowrap">{formatDate(r.computedAt, tz)}</td>
                        <td>
                          {r.effective ? <StatusText tone="ok">Eligible</StatusText> : <StatusText tone="bad">Not eligible</StatusText>}
                          {r.override.applied !== null ? <div className="text-xs text-muted">by override</div> : null}
                        </td>
                        <td className="max-w-[22rem] text-xs text-muted">{r.reasons.length ? r.reasons.join(" · ") : "—"}</td>
                        <td className="min-w-[14rem]">
                          {step === "applied" ? (
                            <span className="text-[13px] text-muted">Override applied{r.override.reason ? ` · “${r.override.reason}”` : ""}</span>
                          ) : step === "ready_to_apply" ? (
                            canDecide ? (
                              <ActionForm action={applyOverrideAction} submitLabel={`Apply · mark ${want}`} pendingLabel="Applying…" variant="ok" size="xs">
                                <input type="hidden" name="snapshot" value={r.snapshotId} />
                              </ActionForm>
                            ) : (
                              <span className="text-[13px] text-muted">Approved · waiting to be applied</span>
                            )
                          ) : step === "awaiting_second" ? (
                            r.override.requestedBy === session.userId || !canDecide ? (
                              <span className="text-[13px] text-muted">
                                Asked to mark {want} · waiting for a different approver{r.override.reason ? ` · “${r.override.reason}”` : ""}
                              </span>
                            ) : (
                              <ActionForm
                                action={approveAsSecondAction}
                                submitLabel="Approve override"
                                pendingLabel="Approving…"
                                variant="ok"
                                size="xs"
                                confirmKicker="Two-person approval"
                                confirmMessage={`Approve marking ${r.name} ${want}? ${r.override.reason ? `Reason given: ${r.override.reason}.` : ""}`}
                              >
                                <input type="hidden" name="table" value="eligibility_snapshots" />
                                <input type="hidden" name="id" value={r.snapshotId} />
                              </ActionForm>
                            )
                          ) : canDecide ? (
                            <details>
                              <summary className="inline-flex min-h-8 cursor-pointer items-center text-[13px] font-bold text-navy">Request override…</summary>
                              <ActionForm action={requestOverrideAction} submitLabel="Request override" pendingLabel="Requesting…" size="xs" className="mt-2 w-64">
                                <input type="hidden" name="snapshot" value={r.snapshotId} />
                                <p className="crm-label">Mark as</p>
                                <ChipGroup
                                  label="Mark as"
                                  name="value"
                                  defaultValue={r.effective ? "false" : "true"}
                                  options={[
                                    { value: "true", label: "Eligible" },
                                    { value: "false", label: "Not eligible" },
                                  ]}
                                />
                                <label htmlFor={`why-${r.snapshotId}`} className="crm-label mt-2">
                                  Reason (the second approver reads this)
                                </label>
                                <textarea id={`why-${r.snapshotId}`} name="reason" required maxLength={500} className="crm-input mb-2 min-h-16" />
                              </ActionForm>
                            </details>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card span={12} title="Rules in effect">
          <p className="text-[13px] text-ink-2">
            Only adult spouses with life membership can vote. Life membership must be held at least {v.waitDays} days before the election starts. All
            pledges, bolis and maintenance fees from prior calendar years must be paid. Members see their status and a checklist in the app.
          </p>
          <p className="mt-2 text-xs text-muted">
            The status here comes from the nightly check; the Pledges and Tenure columns show the same rules for each household so you can see why.{" "}
            <Link href="/settings/center" className="crm-link">
              Center rules
            </Link>
          </p>
        </Card>
      </BlockGrid>
      <PeopleDrawers session={session} sp={sp} base={base} />
    </>
  );
}


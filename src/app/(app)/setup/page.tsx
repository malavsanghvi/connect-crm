import type { Metadata } from "next";
import Link from "next/link";

import { DrawerForm } from "@/components/drawer-form";
import { Alert, Card, KpiGrid, QueryError, Stat, TableWrap, buttonClass } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { getSession } from "@/lib/session";
import { checklistProgress, MANUAL_STATUSES, routeAvailable, SETUP_STAGES, stepStatusLabel } from "@/lib/setup";

import { saveSetupStepAction } from "./actions";
import { ProgressBar, SetupHeader, StepStatus, setupGate } from "./_components/setup-ui";

export const metadata: Metadata = { title: "Checklist · Setup" };

const SUB = "the ordered checklist from sandbox to live · each step has an owner, a due date and what done means";

export default async function SetupChecklistPage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "The Setup checklist");
  if (gate) return gate;
  const { db, center } = session;

  const [list, staff] = await Promise.all([
    db.rpc("setup_checklist", { p_center: center.id }),
    db.rpc("setup_staff_options", { p_center: center.id }),
  ]);
  if (list.error) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="the Setup checklist" error={list.error} retryHref="/setup" />
      </>
    );
  }
  if (staff.error) console.error("[setup] could not load the staff who can own steps:", staff.error);
  const rows = list.data ?? [];
  const all = checklistProgress(rows);
  const waiting = rows.filter((r) => r.status === "waiting_on_provider").length;
  const review = rows.filter((r) => r.status === "needs_review").length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = rows.filter((r) => r.due_on && r.due_on < today && r.status !== "done" && r.status !== "skipped").length;
  const staffOptions = staff.data ?? [];

  return (
    <>
      <SetupHeader
        session={session}
        sub={SUB}
        actions={
          <Link href="/setup/readiness" className={buttonClass("primary")}>
            Go-live readiness
          </Link>
        }
      />
      <div className="mb-4">
        <KpiGrid cols={4}>
          <Stat label="Overall" value={`${all.pct}%`} hint={`${all.done} of ${all.total} steps done · skipped steps don't count`} tone="success" />
          <Stat label="Waiting on a provider" value={waiting} hint="Texting, WhatsApp and payment checks take longest" tone="saffron" />
          <Stat label="Needs Community Connect review" value={review} hint="Non-profit proof, go-live" tone="purple" />
          <Stat label="Overdue" value={overdue} hint="Past their due date and not done" tone={overdue > 0 ? "danger" : "ink"} />
        </KpiGrid>
      </div>
      {staff.error ? (
        <div className="mb-4">
          <Alert tone="warning" title="Could not load the staff list">
            Steps can still be saved, but you can&apos;t pick an owner until the staff list loads. Reload to try again.
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {SETUP_STAGES.map((st) => {
          const steps = rows.filter((r) => r.stage === st.stage);
          if (steps.length === 0) return null;
          const p = checklistProgress(steps);
          return (
            <Card
              key={st.stage}
              title={`${st.stage} · ${st.title}`}
              description={`Usually: ${st.who}`}
              actions={<ProgressBar done={p.done} total={p.total} label={`Stage ${st.stage}`} />}
              padded={false}
            >
              <TableWrap>
                <table className="crm-table" aria-label={`Stage ${st.stage} · ${st.title}`}>
                  <thead>
                    <tr>
                      <th>Step</th>
                      <th>Status</th>
                      <th>Owner</th>
                      <th>Due</th>
                      <th>Where</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((s) => {
                      const open = routeAvailable(s.route);
                      const late = s.due_on && s.due_on < today && s.status !== "done" && s.status !== "skipped";
                      return (
                        <tr key={s.step_key} data-step={s.step_key} data-status={s.status}>
                          <td className="min-w-[260px]">
                            <p className="font-bold">
                              {s.title}
                              {!s.required ? <span className="ml-1.5 text-[12px] font-semibold text-faint">optional</span> : null}
                            </p>
                            <p className="text-[12px] text-muted">{s.description}</p>
                            {s.detail ? <p className="mt-0.5 text-[12px] text-ink-2">{s.detail}</p> : null}
                          </td>
                          <td>
                            <StepStatus status={s.status} />
                            {s.auto && s.status !== "skipped" ? <p className="text-[11px] text-faint">Checked automatically</p> : null}
                          </td>
                          <td>{s.owner_name ?? <span className="text-faint">{s.owner_role ?? "—"}</span>}</td>
                          <td className={late ? "font-bold text-danger" : ""}>{s.due_on ? formatDate(s.due_on, center.time_zone) : "—"}</td>
                          <td>
                            {!s.route ? (
                              <span className="text-[12px] text-faint">Off-screen</span>
                            ) : open ? (
                              <Link href={s.route} className="crm-link whitespace-nowrap">
                                Open
                              </Link>
                            ) : (
                              <span className="whitespace-nowrap text-[12px] font-semibold text-faint" title={`${s.route} is not built in this version yet`}>
                                Coming soon
                              </span>
                            )}
                            {s.step_key === "hist.giving" ? (
                              <Link href="/accounting/qbo/matching" className="crm-link block whitespace-nowrap text-[12px]">
                                QuickBooks donors
                              </Link>
                            ) : null}
                          </td>
                          <td className="text-right">
                            <DrawerForm
                              label="Edit"
                              variant="ghost"
                              size="xs"
                              kicker={`Stage ${st.stage} · ${st.title}`}
                              title={s.title}
                              subtitle={stepStatusLabel(s.status)}
                              action={saveSetupStepAction}
                              submitLabel="Save step"
                              resetOnSuccess={false}
                              intro={
                                <div className="flex flex-col gap-2 text-[13px]">
                                  <p>{s.help}</p>
                                  <p>
                                    <strong>Done means:</strong> {s.done_means}
                                  </p>
                                  {s.detail ? (
                                    <p className="text-muted">
                                      <strong>Now:</strong> {s.detail}
                                    </p>
                                  ) : null}
                                  {s.completed_at ? <p className="text-muted">Marked done {formatDateTime(s.completed_at, center.time_zone)}</p> : null}
                                  {s.route && !open ? <p className="text-muted">The screen for this step is coming soon; you can still track it here.</p> : null}
                                </div>
                              }
                            >
                              <input type="hidden" name="step_key" value={s.step_key} />
                              <input type="hidden" name="manual" value={String(s.manual)} />
                              <div>
                                <label className="crm-label" htmlFor={`status-${s.step_key}`}>
                                  Status
                                </label>
                                {s.manual ? (
                                  <select id={`status-${s.step_key}`} name="status" className="crm-input" defaultValue={s.stored_status ?? "not_started"}>
                                    {MANUAL_STATUSES.map((v) => (
                                      <option key={v} value={v}>
                                        {stepStatusLabel(v)}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <p className="crm-hint">Worked out automatically: {stepStatusLabel(s.status)}.</p>
                                )}
                                {s.auto && s.manual ? <p className="crm-hint">Checked automatically too: once the database sees it done, it shows as done.</p> : null}
                              </div>
                              <div>
                                <label className="crm-label" htmlFor={`owner-${s.step_key}`}>
                                  Owner
                                </label>
                                <select id={`owner-${s.step_key}`} name="owner_person_id" className="crm-input" defaultValue={s.owner_person_id ?? ""}>
                                  <option value="">Not assigned</option>
                                  {staffOptions.map((o) => (
                                    <option key={o.person_id} value={o.person_id}>
                                      {o.name} · {o.roles}
                                    </option>
                                  ))}
                                </select>
                                <p className="crm-hint">Staff with a role in {center.short_name || center.name}. Usually: {s.owner_role ?? "the owner"}.</p>
                              </div>
                              <div>
                                <label className="crm-label" htmlFor={`due-${s.step_key}`}>
                                  Due date
                                </label>
                                <input id={`due-${s.step_key}`} type="date" name="due_on" className="crm-input" defaultValue={s.due_on ?? ""} />
                              </div>
                              <div>
                                <label className="crm-label" htmlFor={`notes-${s.step_key}`}>
                                  Notes
                                </label>
                                <textarea id={`notes-${s.step_key}`} name="notes" className="crm-input min-h-[80px]" maxLength={2000} defaultValue={s.notes ?? ""} />
                              </div>
                            </DrawerForm>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          );
        })}
      </div>
    </>
  );
}

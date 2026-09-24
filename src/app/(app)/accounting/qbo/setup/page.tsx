import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Alert, Badge, BlockGrid, Card, DefinitionList, EmptyState, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import { QBO_PURPOSES } from "@/lib/labels";
import { canAccess } from "@/lib/permissions";
import { accountChoices, COMPANY_LABEL, connectionSummary, setupSteps, type PulledAccount, type QboStatus } from "@/lib/qbo/setup";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import {
  approveQboMappingAction,
  approveQboTestPostAction,
  disconnectQboAction,
  postQboNowAction,
  pullQboListsAction,
  runQboTestPostAction,
  saveFundClassAction,
  saveQboMappingAction,
  saveQboSettingsAction,
} from "./actions";
import { ConnectQboForm } from "./connect-form";

export const metadata: Metadata = { title: "QuickBooks setup" };

const LIST_LABEL: Record<string, string> = {
  accounts: "Accounts",
  classes: "Classes",
  locations: "Locations",
  items: "Items",
  tax_codes: "Tax codes",
  payment_methods: "Payment methods",
};
const ENTITY_LABEL: Record<string, string> = {
  SalesReceipt: "Sales receipt",
  RefundReceipt: "Refund receipt",
  Deposit: "Deposit",
  JournalEntry: "Journal entry",
};

function ReasonField({ id, placeholder }: { id: string; placeholder: string }) {
  return (
    <div className="mb-2">
      <label htmlFor={id} className="crm-label">
        Reason (kept in the audit log)
      </label>
      <input id={id} name="reason" required maxLength={500} className="crm-input" placeholder={placeholder} />
    </div>
  );
}

export default async function QboSetupPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Accounting"
      description="QuickBooks setup: connect the company, pull its chart of accounts, choose the basis and go-live date, map and approve, test-post"
    />
  );
  if (!canAccess(session, "qbo")) {
    return (
      <>
        {header}
        <NoAccess area="QuickBooks setup" access="qbo" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const statusRes = await db.rpc("qbo_status", { p_center: center.id });
  if (statusRes.error) {
    return (
      <>
        {header}
        <QueryError what="QuickBooks setup" error={statusRes.error} retryHref="/accounting/qbo/setup" />
      </>
    );
  }
  const s = statusRes.data as unknown as QboStatus;
  const conn = s.connection;
  const connected = Boolean(conn && (conn.status === "connected" || conn.status === "expiring"));
  const canConnect = s.can_connect;
  const canManage = s.can_manage && canAccess(session, "qboManage");
  const sandbox = s.environment === "sandbox";

  const [accountsRes, classesRes, fundsRes, mappingsRes] = conn
    ? await Promise.all([
        db.from("qbo_accounts").select("qbo_id, name, fully_qualified_name, account_type, active").eq("connection_id", conn.id).order("fully_qualified_name"),
        db.from("qbo_classes").select("qbo_id, name, active").eq("connection_id", conn.id).order("name"),
        db.from("funds").select("id, key, name, restricted, qbo_class_id, active").eq("center_id", center.id).eq("active", true).order("name"),
        db.from("qbo_account_mappings").select("purpose, qbo_account_id, qbo_account_name, approved_at").eq("center_id", center.id),
      ])
    : [null, null, null, null];
  const accounts = (accountsRes?.data ?? []) as PulledAccount[];
  const classes = classesRes?.data ?? [];
  const mappingBy = new Map((mappingsRes?.data ?? []).map((m) => [m.purpose, m]));
  const warnBy = new Map(s.warnings.filter((w) => w.purpose).map((w) => [w.purpose!, w]));
  const fundWarn = new Map(s.warnings.filter((w) => w.fund_id).map((w) => [w.fund_id!, w]));
  const steps = setupSteps(s);
  const connectMsg = param(sp, "msg");
  const connectOutcome = param(sp, "connect");
  const required = new Set(s.required_purposes);
  const pulled = accounts.length > 0;
  const test = s.test_post;
  const errors = s.warnings.filter((w) => w.level === "error");

  return (
    <>
      {header}
      {!s.module_on ? (
        <div className="mb-4">
          <Alert tone="info" title="QuickBooks not used">
            The Accounting module is switched off, so QuickBooks is not used and readiness check 7 passes.
          </Alert>
        </div>
      ) : null}
      {connectMsg ? (
        <div className="mb-4">
          <Alert tone={connectOutcome === "ok" ? "success" : "danger"} title={connectOutcome === "ok" ? "QuickBooks sign-in received" : "QuickBooks was not connected"}>
            {connectMsg}
          </Alert>
        </div>
      ) : null}
      {conn?.alert ? (
        <div className="mb-4">
          <Alert tone="warning" title={conn.alert.subject}>
            {conn.alert.detail} <span className="text-xs">({formatDateTime(conn.alert.at, tz)} · {conn.alert.outcome})</span>
          </Alert>
        </div>
      ) : null}

      <ol className="mb-4 flex flex-wrap gap-2" aria-label="QuickBooks setup steps">
        {steps.map((st, i) => (
          <li key={st.key}>
            <Badge tone={st.state === "done" ? "success" : st.state === "current" ? "navy" : "neutral"}>
              {i + 1}. {st.label}
              {st.state === "done" ? " ✓" : ""}
            </Badge>
          </li>
        ))}
      </ol>

      <BlockGrid className="mb-4">
        <Card span={7} title="1 · Connection" description={sandbox ? "Sandbox: an Intuit sandbox company, or your real company read-only" : "Your organization's own QuickBooks Online company"}>
          {conn && conn.status !== "disconnected" ? (
            <>
              <p className="mb-3">
                <StatusText tone={conn.status === "connected" ? "ok" : conn.status === "error" ? "bad" : "warn"}>
                  {conn.status === "connected" ? "Connected" : conn.status === "expiring" ? "Connected · connect again soon" : "Needs connecting again"}
                </StatusText>{" "}
                <span className="text-sm">{connectionSummary(conn)}</span>
              </p>
              <DefinitionList
                items={[
                  { label: "Company", value: conn.display_name ?? "—" },
                  { label: "Company id", value: conn.realm_id ?? "—" },
                  { label: "Kind", value: `${COMPANY_LABEL[conn.company]}${conn.read_only ? " · read-only" : ""}` },
                  { label: "Connected", value: conn.connected_at ? `${formatDateTime(conn.connected_at, tz)}${conn.connected_by ? ` · ${conn.connected_by}` : ""}` : "—" },
                  { label: "Sign-in renewed", value: formatDateTime(conn.last_refresh_at, tz) },
                  { label: "Must reconnect by", value: formatDate(conn.token_expires_at, tz) },
                ]}
              />
              {conn.last_error ? (
                <div className="mt-3">
                  <Alert tone="danger" title="Last problem">
                    {conn.last_error}
                  </Alert>
                </div>
              ) : null}
              {canConnect ? (
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {conn.status === "error" || conn.status === "expiring" ? <ConnectQboForm sandbox={sandbox} reconnect /> : null}
                  <ActionForm action={disconnectQboAction} submitLabel="Disconnect QuickBooks" pendingLabel="Disconnecting…" variant="danger" size="sm"
                    confirmMessage="Disconnect QuickBooks? Nothing posts until it is connected again. The lists, mapping and posting history stay.">
                    <ReasonField id="qbo-disc-reason" placeholder="e.g. Switching to the real company" />
                  </ActionForm>
                </div>
              ) : null}
            </>
          ) : (
            <>
              {conn?.connect_state === "exchanging" ? (
                <Alert tone="info" title="Finishing the connection">
                  Intuit&apos;s sign-in arrived; the background service is finishing it. Reload in a moment.
                </Alert>
              ) : (
                <p className="mb-3 text-sm text-muted">
                  Not connected. The treasurer signs in to Intuit and authorizes one company; the sign-in is kept in the credential vault and never shown.
                </p>
              )}
              {s.other_connection && s.other_connection.status !== "disconnected" ? (
                <Alert tone="warning">Another QuickBooks company ({s.other_connection.display_name ?? s.other_connection.provider}) is connected.</Alert>
              ) : null}
              {canConnect ? (
                <div className="mt-3">
                  <ConnectQboForm sandbox={sandbox} reconnect={false} />
                </div>
              ) : (
                <p className="text-sm text-muted">Connecting QuickBooks needs the owner, integrations.manage or accounting.manage.</p>
              )}
            </>
          )}
        </Card>

        <Card span={5} title="Go-live readiness" description="Readiness check 7">
          <p className="mb-3">
            <StatusText tone={s.readiness.ok ? "ok" : "warn"}>{s.readiness.ok ? "Ready" : "Not ready yet"}</StatusText>
          </p>
          <p className="text-sm">{s.readiness.detail}</p>
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-sm font-semibold">Posting</p>
            <p className="text-sm">{s.post_ready.ok ? "The poster is on: money events post to QuickBooks as they happen." : s.post_ready.reason}</p>
            {s.post_ready.ok && canManage ? (
              <div className="mt-2">
                <ActionForm action={postQboNowAction} submitLabel="Post now" pendingLabel="Queuing…" variant="secondary" size="sm" />
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted">
              Historical payments and anything dated before the go-live date never post. <Link href="/accounting/qbo" className="crm-link">Posting queue →</Link>
            </p>
          </div>
        </Card>
      </BlockGrid>

      {conn && conn.status !== "disconnected" ? (
        <>
          <BlockGrid className="mb-4">
            <Card span={7} title="2 · Chart of accounts and lists" description="Pulled from QuickBooks, read-only here, refreshed daily. Never uploaded by hand."
              actions={connected && canConnect ? <ActionForm action={pullQboListsAction} submitLabel="Pull now" pendingLabel="Queuing…" variant="secondary" size="sm" /> : null}>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(LIST_LABEL).map(([k, label]) => (
                  <div key={k} className="rounded-lg border border-line px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
                    <p className="font-display text-xl font-semibold tabular-nums">{s.lists[k] ?? 0}</p>
                  </div>
                ))}
              </div>
              <p className="text-sm">
                {s.last_pull
                  ? s.last_pull.status === "succeeded"
                    ? `Last pulled ${formatDateTime(s.last_pull.finished_at, tz)}.`
                    : `The last pull failed (${formatDateTime(s.last_pull.finished_at, tz)}): ${s.last_pull.error}`
                  : "Not pulled yet. The first pull runs right after connecting."}
              </p>
              {s.warnings.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {s.warnings.map((w, i) => (
                    <li key={i}>
                      <Alert tone={w.level === "error" ? "danger" : "warning"}>{w.text}</Alert>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>

            <Card span={5} title="3 · Basis, posting and go-live date" description="Only money received on or after the go-live date posts">
              {canManage ? (
                <ActionForm action={saveQboSettingsAction} submitLabel="Save choices" pendingLabel="Saving…" size="sm">
                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="qbo-basis" className="crm-label">Basis</label>
                      <select id="qbo-basis" name="basis" defaultValue={s.settings.basis ?? "cash"} className="crm-input">
                        <option value="cash">Cash</option>
                        <option value="accrual">Accrual</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="qbo-posting" className="crm-label">Posting</label>
                      <select id="qbo-posting" name="posting" defaultValue={s.settings.posting ?? "per_txn"} className="crm-input">
                        <option value="per_txn">Each transaction</option>
                        <option value="daily_summary">A daily summary</option>
                      </select>
                    </div>
                  </div>
                  <div className="mb-2">
                    <label htmlFor="qbo-golive" className="crm-label">QuickBooks go-live date</label>
                    <input id="qbo-golive" name="go_live_date" type="date" required defaultValue={s.settings.go_live_date ?? ""} className="crm-input" />
                  </div>
                  <ReasonField id="qbo-set-reason" placeholder="e.g. Cash basis; books kept in QuickBooks until June 30" />
                  <p className="mb-2 text-xs text-muted">Accrual basis needs the pledges receivable account; posting on accrual basis is not built yet, so nothing posts until cash basis is chosen.</p>
                </ActionForm>
              ) : (
                <DefinitionList
                  items={[
                    { label: "Basis", value: s.settings.basis ?? "—" },
                    { label: "Posting", value: s.settings.posting?.replace(/_/g, " ") ?? "—" },
                    { label: "Go-live date", value: s.settings.go_live_date ?? "—" },
                  ]}
                />
              )}
            </Card>
          </BlockGrid>

          <Card
            title="4 · Account mapping"
            description="Choose, from the chart pulled from QuickBooks, where each kind of money posts. The treasurer approves the whole mapping; any change needs approval again."
            padded={false}
            className="mb-4"
          >
            {!pulled ? (
              <EmptyState title="Pull the chart of accounts first">The accounts to choose from come from QuickBooks.</EmptyState>
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Purpose</th>
                      <th>QuickBooks account</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {QBO_PURPOSES.map((p) => {
                      const m = mappingBy.get(p.purpose);
                      const w = warnBy.get(p.purpose);
                      const choices = accountChoices(p.purpose, accounts);
                      return (
                        <tr key={p.purpose}>
                          <td>
                            <span className="font-semibold">{p.label}</span>
                            {required.has(p.purpose) ? <> <Badge tone="navy">required</Badge></> : null}
                            <div className="text-xs text-muted">{p.hint}</div>
                          </td>
                          <td className="min-w-72">
                            {canManage ? (
                              <ActionForm action={saveQboMappingAction} submitLabel="Save" pendingLabel="Saving…" size="xs" variant="secondary" buttonsClassName="mt-1">
                                <input type="hidden" name="purpose" value={p.purpose} />
                                <select name="qbo_account_id" aria-label={`QuickBooks account for ${p.label}`} defaultValue={m?.qbo_account_id ?? ""} className="crm-input">
                                  <option value="">— choose an account —</option>
                                  {choices.map((a) => (
                                    <option key={a.qbo_id} value={a.qbo_id}>
                                      {a.fully_qualified_name ?? a.name} · {a.account_type}
                                    </option>
                                  ))}
                                </select>
                              </ActionForm>
                            ) : (
                              (m?.qbo_account_name ?? "—")
                            )}
                          </td>
                          <td>
                            {w ? (
                              <StatusText tone={w.level === "error" ? "bad" : "warn"}>{w.level === "error" ? "Needs a new account" : "Renamed in QuickBooks"}</StatusText>
                            ) : m?.approved_at ? (
                              <StatusText tone="ok">Approved</StatusText>
                            ) : m ? (
                              <StatusText tone="warn">Not approved</StatusText>
                            ) : required.has(p.purpose) ? (
                              <StatusText tone="bad">Not mapped</StatusText>
                            ) : (
                              <span className="text-xs text-muted">Optional</span>
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

          <Card title="Funds → QuickBooks classes" description="Each fund's money is tagged with its class" padded={false} className="mb-4">
            {fundsRes?.error ? (
              <div className="p-3">
                <QueryError what="the funds" error={fundsRes.error} retryHref="/accounting/qbo/setup" />
              </div>
            ) : !pulled ? (
              <EmptyState title="Pull the lists first" />
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Fund</th>
                      <th>QuickBooks class</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fundsRes?.data ?? []).map((f) => (
                      <tr key={f.id}>
                        <td>
                          <span className="font-semibold">{f.name}</span> {f.restricted ? <Badge tone="purple">restricted</Badge> : null}
                          {fundWarn.get(f.id) ? <div className="text-xs text-danger">{fundWarn.get(f.id)!.text}</div> : null}
                        </td>
                        <td className="min-w-72">
                          {canManage ? (
                            <ActionForm action={saveFundClassAction} submitLabel="Save" pendingLabel="Saving…" size="xs" variant="secondary" buttonsClassName="mt-1">
                              <input type="hidden" name="fund_id" value={f.id} />
                              <select name="qbo_class_id" aria-label={`QuickBooks class for ${f.name}`} defaultValue={f.qbo_class_id ?? ""} className="crm-input">
                                <option value="">No class</option>
                                {classes.filter((k) => k.active || k.qbo_id === f.qbo_class_id).map((k) => (
                                  <option key={k.qbo_id} value={k.qbo_id}>
                                    {k.name}
                                    {k.active ? "" : " (inactive)"}
                                  </option>
                                ))}
                              </select>
                            </ActionForm>
                          ) : (
                            (classes.find((k) => k.qbo_id === f.qbo_class_id)?.name ?? "—")
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <BlockGrid className="mb-6">
            <Card span={6} title="Approve the mapping" description="The treasurer, with a fresh 2FA check">
              {s.settings.mapping_approved_at ? (
                <p className="mb-3 text-sm">
                  <StatusText tone="ok">Approved</StatusText> {formatDateTime(s.settings.mapping_approved_at, tz)}
                  {s.settings.mapping_approved_by ? ` by ${s.settings.mapping_approved_by}` : ""}
                </p>
              ) : (
                <p className="mb-3 text-sm">
                  {s.missing_purposes.length > 0
                    ? `Still to map: ${s.missing_purposes.map((p) => QBO_PURPOSES.find((x) => x.purpose === p)?.label ?? p).join(", ")}.`
                    : errors.length > 0
                      ? "Fix the problems above first."
                      : "Everything required is mapped. Check it against your books, then approve."}
                </p>
              )}
              {canManage && !s.settings.mapping_approved_at ? (
                <ActionForm action={approveQboMappingAction} submitLabel="Approve mapping" pendingLabel="Approving…" variant="success" size="sm"
                  submitDisabled={s.missing_purposes.length > 0 || errors.length > 0}>
                  <ReasonField id="qbo-approve-reason" placeholder="e.g. Checked against the chart of accounts" />
                </ActionForm>
              ) : null}
            </Card>

            <Card span={6} title="5 · Test post" description={conn.read_only ? "Read-only company: checks every account, item and class in QuickBooks without posting" : "One $1.00 sales receipt, refund receipt, deposit and journal entry"}>
              {test ? (
                <div className="mb-3">
                  <p className="text-sm">
                    <StatusText tone={test.status === "succeeded" ? "ok" : test.status === "failed" ? "bad" : "warn"}>
                      {test.status === "succeeded" ? "Succeeded" : test.status === "failed" ? "Failed" : "Running…"}
                    </StatusText>{" "}
                    {test.mode === "dry_run" ? "(checked, nothing posted)" : "(posted)"} · {formatDateTime(test.requested_at, tz)}
                    {test.requested_by ? ` by ${test.requested_by}` : ""}
                  </p>
                  {test.error ? <p className="mt-1 text-sm text-danger">{test.error}</p> : null}
                  {test.results.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm">
                      {test.results.map((r) => (
                        <li key={r.entity}>
                          {r.ok ? "✓" : "✗"} {ENTITY_LABEL[r.entity] ?? r.entity}
                          {r.qbo_id ? ` · QuickBooks #${r.qbo_id}` : ""}
                          {r.error ? <span className="text-danger"> — {r.error}</span> : r.checked ? <span className="text-muted"> — {r.checked.join("; ")}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {test.approved_at ? (
                    <p className="mt-2 text-sm">
                      <StatusText tone="ok">Approved</StatusText> {formatDateTime(test.approved_at, tz)}
                      {test.approved_by ? ` by ${test.approved_by}` : ""}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="mb-3 text-sm text-muted">No test post yet.</p>
              )}
              {canManage && test && test.status === "succeeded" && !test.approved_at ? (
                <ActionForm action={approveQboTestPostAction} submitLabel="Approve test post" pendingLabel="Approving…" variant="success" size="sm" className="mb-3">
                  <input type="hidden" name="test_id" value={test.id} />
                  <ReasonField id="qbo-test-approve-reason" placeholder="e.g. All four entries checked in QuickBooks" />
                </ActionForm>
              ) : null}
              {canManage && s.settings.mapping_approved_at && connected ? (
                <ActionForm action={runQboTestPostAction} submitLabel={test ? "Run the test post again" : "Run the test post"} pendingLabel="Queuing…" variant="secondary" size="sm">
                  {!conn.read_only && conn.provider === "quickbooks_online" ? (
                    <label className="mb-2 flex items-start gap-2 text-sm">
                      <input type="checkbox" name="confirm_real" className="mt-1" />
                      <span>I understand this creates four $1.00 entries marked “Community Connect test post” in our real QuickBooks company; I will void them there.</span>
                    </label>
                  ) : null}
                  <ReasonField id="qbo-test-reason" placeholder="e.g. Checking the mapping before go-live" />
                </ActionForm>
              ) : null}
            </Card>
          </BlockGrid>
        </>
      ) : null}
    </>
  );
}

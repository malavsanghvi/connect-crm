import Link from "next/link";

import { cancelMappingChangeAction, decideMappingChangeAction, requestMappingChangeAction } from "@/app/(app)/accounting/qbo/mapping/actions";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import {
  changeLine,
  choicesFor,
  MAPPING_REQUEST_DAYS,
  mappingStatusView,
  roleStateView,
  waitingFor,
  waitingNote,
  waitingRequests,
  type MappingRequest,
  type MappingRole,
  type MappingSubject,
  type PulledChoice,
} from "@/lib/books/mapping";
import type { AccountMappingIn } from "@/lib/data/books-mapping";
import { formatDateTime } from "@/lib/dates";

// Books › Account mapping (migration 0779, docs/FUND_ACCOUNT_MAPPING_GAPS.md), the same in both looks: what each fund and
// account posts to now, the changes waiting for a second person (confirm, turn down, withdraw) and the history. Every rule
// is the database's; the forms only collect what it asks for (the new value and a reason). No fresh 2FA code is asked (owner
// rule 2026-10-13); the second person is the control.

const PATH = "/accounting/qbo/mapping";
const BANK_TYPES = ["Bank"] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Reason({ id, placeholder, required }: { id: string; placeholder: string; required: boolean }) {
  return (
    <div className="mb-2">
      <label htmlFor={id} className="crm-label">
        Reason {required ? "(kept in the audit log; the other person sees it)" : "(optional during setup)"}
      </label>
      <input id={id} name="reason" required={required} maxLength={500} className="crm-input" placeholder={placeholder} />
    </div>
  );
}

/** Choose (setup) or ask to change (in use) one thing. A waiting request for it is replaced by a new one. */
function ChangeForm({
  subject,
  target,
  label,
  inUse,
  options,
  current,
  emptyLabel,
  waiting,
}: {
  subject: MappingSubject;
  target: string;
  label: string;
  inUse: boolean;
  options: { value: string; text: string }[];
  current: string | null;
  /** Fund classes and bank accounts can be set to nothing (no class / the main bank account). */
  emptyLabel?: string;
  waiting: MappingRequest | null;
}) {
  const id = `${subject}-${target}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-navy">{inUse ? "Ask for a change" : "Choose"}</summary>
      <div className="mt-2">
        {inUse ? (
          <p className="mb-2 text-xs text-muted">
            A different person with giving.approve confirms it, with a reason. It applies to postings sent after it; entries already posted keep their
            accounts.{waiting ? " Asking again replaces the request that is waiting." : ""}
          </p>
        ) : null}
        {options.length === 0 && !emptyLabel ? (
          <p className="mb-2 text-xs text-danger">
            Nothing in the pulled QuickBooks lists fits. Pull the lists again in <Link href="/accounting/qbo/setup" className="crm-link">QuickBooks setup</Link>.
          </p>
        ) : null}
        <ActionForm
          action={requestMappingChangeAction}
          submitLabel={inUse ? "Ask for this change" : "Save"}
          pendingLabel={inUse ? "Asking…" : "Saving…"}
          size="xs"
          variant={inUse ? "primary" : "secondary"}
          resetOnSuccess={inUse}
        >
          <input type="hidden" name="subject" value={subject} />
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="label" value={label} />
          <input type="hidden" name="in_use" value={inUse ? "1" : "0"} />
          <div className="mb-2">
            <label htmlFor={`${id}-to`} className="crm-label">
              New QuickBooks {subject === "fund_class" ? "class" : "account"} for {label}
            </label>
            <select id={`${id}-to`} name="to" defaultValue={current ?? ""} className="crm-input" required={!emptyLabel}>
              {emptyLabel ? <option value="">{emptyLabel}</option> : <option value="">— choose —</option>}
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.text}
                </option>
              ))}
            </select>
          </div>
          <Reason id={`${id}-reason`} required={inUse} placeholder={inUse ? "e.g. Our accountant opened a separate dues account" : "e.g. Matches our chart of accounts"} />
        </ActionForm>
      </div>
    </details>
  );
}

function RequestDecision({ r, canApprove, canWithdraw }: { r: MappingRequest; canApprove: boolean; canWithdraw: boolean }) {
  const id = r.id.slice(0, 8);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {canApprove && !r.mine && !r.expired ? (
        <>
          <ActionForm
            action={decideMappingChangeAction}
            submitLabel="Confirm the change"
            pendingLabel="Confirming…"
            variant="success"
            size="xs"
            confirmMessage={`Confirm: ${r.target_label}, ${changeLine(r)}? Postings sent from now on use it.`}
          >
            <input type="hidden" name="request_id" value={r.id} />
            <input type="hidden" name="approve" value="1" />
            <Reason id={`ok-${id}`} required placeholder="e.g. Checked the account in QuickBooks with the accountant" />
          </ActionForm>
          <ActionForm action={decideMappingChangeAction} submitLabel="Turn it down" pendingLabel="Turning down…" variant="danger" size="xs">
            <input type="hidden" name="request_id" value={r.id} />
            <input type="hidden" name="approve" value="0" />
            <Reason id={`no-${id}`} required placeholder="e.g. That account is for the store, not dues" />
          </ActionForm>
        </>
      ) : null}
      {canWithdraw || r.mine ? (
        <ActionForm action={cancelMappingChangeAction} submitLabel="Withdraw the request" pendingLabel="Withdrawing…" variant="ghost" size="xs">
          <input type="hidden" name="request_id" value={r.id} />
          <Reason id={`wd-${id}`} required placeholder="e.g. Asked too early" />
        </ActionForm>
      ) : null}
    </div>
  );
}

function WaitingLine({ r }: { r: MappingRequest | null }) {
  if (!r) return null;
  return (
    <p className="mt-1 text-xs text-brown">
      Waiting for a second person: {changeLine(r)} (asked by {r.requested_by_name}).
    </p>
  );
}

function WaitsFor({ n }: { n: number }) {
  return n > 0 ? <div className="text-xs text-danger">{plural(n, "posting")} {n === 1 ? "waits" : "wait"} for it in the exception queue</div> : null;
}

function accountOption(a: PulledChoice): { value: string; text: string } {
  return { value: a.qbo_id, text: `${a.fully_qualified_name ?? a.name}${a.account_type ? ` · ${a.account_type}` : ""}` };
}

function RoleTable({ title, description, roles, canAsk, inUse, accounts, requests, first }: {
  title: string;
  description: string;
  roles: MappingRole[];
  canAsk: boolean;
  inUse: boolean;
  accounts: PulledChoice[];
  requests: MappingRequest[];
  first: string;
}) {
  return (
    <Card title={title} description={description} padded={false} className="mb-4">
      {roles.length === 0 ? (
        <EmptyState title="Nothing to map here" />
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>{first}</th>
                <th>QuickBooks account</th>
                <th>State</th>
                {canAsk ? <th>Change</th> : null}
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => {
                const state = roleStateView(r);
                const waiting = waitingFor(requests, "role", r.key);
                return (
                  <tr key={r.key} id={`role-${r.key}`}>
                    <td>
                      <span className="font-semibold">{r.label}</span>
                      {r.required ? <> <Badge tone="navy">required</Badge></> : null}
                      {r.hint ? <div className="text-xs text-muted">{r.hint}</div> : null}
                      {r.used ? <div className="text-xs text-muted">In use: {plural(r.used, "open pledge or published campaign", "open pledges or published campaigns")}</div> : null}
                    </td>
                    <td>
                      {r.account_name ?? (r.mapped_account_id ? `id ${r.mapped_account_id}` : "—")}
                      {r.account_type ? <div className="text-xs text-muted">{r.account_type}</div> : null}
                    </td>
                    <td className="max-w-sm">
                      {state.tone === "muted" ? <span className="text-xs text-muted">{state.label}</span> : <StatusText tone={state.tone}>{state.label}</StatusText>}
                      {r.problem && !r.account_id && (r.mapped_account_id || r.required || (r.used ?? 0) > 0) ? <div className="text-xs text-danger">{r.problem}</div> : null}
                      <WaitsFor n={r.waiting_postings} />
                      <WaitingLine r={waiting} />
                    </td>
                    {canAsk ? (
                      <td className="min-w-72">
                        <ChangeForm subject="role" target={r.key} label={r.label} inUse={inUse} current={r.mapped_account_id}
                          options={choicesFor(r.account_types, accounts).map(accountOption)} waiting={waiting} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

export function AccountMappingView({ data, timeZone: tz }: { data: AccountMappingIn; timeZone: string }) {
  const { overview: ov, accounts, classes, listsError } = data;
  const conn = ov.connection;
  const connected = Boolean(conn && conn.status !== "disconnected");
  const canAsk = ov.can_request && connected;
  const waiting = waitingRequests(ov.requests);
  const funds = ov.roles.filter((r) => r.kind === "fund");
  const others = ov.roles.filter((r) => r.kind === "role");
  const classOptions = classes.filter((k) => k.active).map((k) => ({ value: k.qbo_id, text: k.name }));

  return (
    <>
      <div className="mb-4">
        {!conn ? (
          <Alert tone="info" title="QuickBooks is not connected">
            Connect it first in{" "}
            <Link href="/accounting/qbo/setup" className="crm-link">
              QuickBooks setup
            </Link>
            : accounts and classes are chosen from the company&apos;s own lists.
          </Alert>
        ) : ov.in_use ? (
          <Alert tone="info" title="The mapping is in use: every change needs a second person">
            A change is asked for here, with a reason, and takes effect only when a different person with giving.approve confirms it (a request lapses
            after {MAPPING_REQUEST_DAYS} days). It applies to postings sent after it; entries already posted keep their accounts and are never sent
            again. A fund with no account never falls back to another one: its postings wait in the{" "}
            <Link href="/accounting/qbo?status=failed" className="crm-link">
              exception queue
            </Link>{" "}
            and go back in the queue by themselves once the account is confirmed.
          </Alert>
        ) : (
          <Alert tone="info" title="Setup: the mapping has not been approved yet">
            Choose the accounts here or in{" "}
            <Link href="/accounting/qbo/setup" className="crm-link">
              QuickBooks setup
            </Link>
            ; the treasurer then approves the whole mapping there. From then on every change needs a second person.
          </Alert>
        )}
      </div>
      {conn ? (
        <p className="mb-4 text-sm text-muted">
          Company: {conn.display_name ?? `QuickBooks company ${conn.realm_id ?? "—"}`}
          {conn.read_only ? " · read-only (a rehearsal: nothing is posted)" : ""}
          {ov.mapping_approved_at
            ? ` · mapping approved ${formatDateTime(ov.mapping_approved_at, tz)}${ov.mapping_approved_by_name ? ` by ${ov.mapping_approved_by_name}` : ""}`
            : " · mapping not approved"}
        </p>
      ) : null}
      {listsError ? (
        <div className="mb-4">
          <QueryError what="the QuickBooks lists" error={{ message: listsError }} retryHref={PATH} />
        </div>
      ) : null}

      <Card
        id="waiting"
        title="Waiting for a second person"
        description={ov.can_approve ? "You hold giving.approve: you can confirm or turn down a change someone else asked for." : "A person with giving.approve confirms these."}
        padded={false}
        className="mb-4"
      >
        {waiting.length === 0 ? (
          <EmptyState title="Nothing is waiting" />
        ) : (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {waiting.map((r) => (
              <li key={r.id} className="p-4" data-testid="mapping-waiting">
                <p className="m-0 font-semibold">
                  {r.target_label}: {changeLine(r)}
                </p>
                <p className="m-0 text-sm text-muted">
                  Asked by {r.requested_by_name} {formatDateTime(r.requested_at, tz)} · “{r.request_reason}” · lapses {formatDateTime(r.expires_at, tz)}
                </p>
                <p className="mb-3 mt-1 text-sm">{waitingNote(r, ov.can_approve)}</p>
                <RequestDecision r={r} canApprove={ov.can_approve} canWithdraw={ov.can_request || ov.can_approve} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <RoleTable
        title="Funds"
        description="The income account each fund's money posts to. Which fund money belongs to: its campaign's kind, else what the pledge is for (dues, fees, event commitments…); money not tied to a pledge is a general donation."
        first="Fund"
        roles={funds}
        canAsk={canAsk}
        inUse={ov.in_use}
        accounts={accounts}
        requests={ov.requests}
      />
      <RoleTable
        title="Other accounts"
        description="Clearing, fees, the bank, the store, refunds and the other accounts postings use"
        first="Account role"
        roles={others}
        canAsk={canAsk}
        inUse={ov.in_use}
        accounts={accounts}
        requests={ov.requests}
      />

      <Card title="Fund classes" description="The QuickBooks class that keeps a fund's money apart (restricted funds above all)" padded={false} className="mb-4">
        {ov.funds.length === 0 ? (
          <EmptyState title="No funds yet" />
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Fund</th>
                  <th>QuickBooks class</th>
                  <th>State</th>
                  {canAsk ? <th>Change</th> : null}
                </tr>
              </thead>
              <tbody>
                {ov.funds.map((f) => {
                  const w = waitingFor(ov.requests, "fund_class", f.id);
                  return (
                    <tr key={f.id} id={`fund-${f.id}`}>
                      <td>
                        <span className="font-semibold">{f.name}</span> {f.restricted ? <Badge tone="purple">restricted</Badge> : null}
                      </td>
                      <td>{f.class_name ?? (f.mapped_class_id ? `id ${f.mapped_class_id}` : "No class")}</td>
                      <td className="max-w-sm">
                        {f.problem ? (
                          <>
                            <StatusText tone="bad">Needs a new class</StatusText>
                            <div className="text-xs text-danger">{f.problem}</div>
                          </>
                        ) : f.class_id ? (
                          <StatusText tone="ok">In use</StatusText>
                        ) : f.restricted ? (
                          <StatusText tone="warn">No class: not kept apart</StatusText>
                        ) : (
                          <span className="text-xs text-muted">No class</span>
                        )}
                        <WaitsFor n={f.waiting_postings} />
                        <WaitingLine r={w} />
                      </td>
                      {canAsk ? (
                        <td className="min-w-72">
                          <ChangeForm subject="fund_class" target={f.id} label={`the class of the fund "${f.name}"`} inUse={ov.in_use} current={f.mapped_class_id}
                            options={classOptions} emptyLabel="No class" waiting={w} />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card
        title="Bank accounts"
        description="The QuickBooks register each bank account's deposits and Zelle or ACH lines land in. With one bank account, the Bank account role above is used."
        padded={false}
        className="mb-4"
      >
        {ov.bank_accounts.length === 0 ? (
          <EmptyState title="No bank accounts yet">Bank accounts are added in Giving › Bank.</EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Bank account</th>
                  <th>QuickBooks account</th>
                  <th>State</th>
                  {canAsk ? <th>Change</th> : null}
                </tr>
              </thead>
              <tbody>
                {ov.bank_accounts.map((b) => {
                  const w = waitingFor(ov.requests, "bank_account", b.id);
                  return (
                    <tr key={b.id} id={`bank-${b.id}`}>
                      <td>
                        <span className="font-semibold">{b.name}</span>
                        {b.last4 ? <span className="font-mono text-xs text-muted"> ····{b.last4}</span> : null}
                      </td>
                      <td>{b.account_name ?? (b.mapped_account_id ? `id ${b.mapped_account_id}` : b.uses_main_bank ? "The Bank account role" : "—")}</td>
                      <td className="max-w-sm">
                        {b.problem ? (
                          <>
                            <StatusText tone={b.mapped_account_id ? "bad" : "warn"}>{b.mapped_account_id ? "Needs a new account" : "Needs its own account"}</StatusText>
                            <div className="text-xs text-danger">{b.problem}</div>
                          </>
                        ) : (
                          <StatusText tone="ok">In use</StatusText>
                        )}
                        <WaitsFor n={b.waiting_postings} />
                        <WaitingLine r={w} />
                      </td>
                      {canAsk ? (
                        <td className="min-w-72">
                          <ChangeForm subject="bank_account" target={b.id} label={`the QuickBooks account of the bank account "${b.name}"`} inUse={ov.in_use}
                            current={b.mapped_account_id} options={choicesFor(BANK_TYPES, accounts).map(accountOption)} emptyLabel="The main Bank account"
                            waiting={w} />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="History" description="Every choice and change: who asked, who confirmed, old and new, and why. The audit log keeps the same with every row." padded={false} className="mb-6">
        {ov.requests.length === 0 ? (
          <EmptyState title="No changes yet" />
        ) : (
          <TableWrap>
            <table className="crm-table" data-testid="mapping-history">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Old → new</th>
                  <th>Asked by</th>
                  <th>Decision</th>
                </tr>
              </thead>
              <tbody>
                {ov.requests.map((r) => {
                  const st = mappingStatusView(r);
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap text-sm">{formatDateTime(r.requested_at, tz)}</td>
                      <td className="font-semibold">{r.target_label}</td>
                      <td className="text-sm">{changeLine(r)}</td>
                      <td className="text-sm">
                        {r.requested_by_name}
                        <div className="text-xs text-muted">“{r.request_reason}”</div>
                      </td>
                      <td className="text-sm">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {r.decided_by_name || r.cancelled_by_name ? (
                          <div className="text-xs text-muted">
                            {r.decided_by_name ?? r.cancelled_by_name}
                            {r.decided_at ? `, ${formatDateTime(r.decided_at, tz)}` : ""}
                          </div>
                        ) : null}
                        {r.decision_reason ? <div className="text-xs text-muted">“{r.decision_reason}”</div> : null}
                        {r.status === "applied" && r.requeued_postings ? (
                          <div className="text-xs text-muted">{plural(r.requeued_postings, "waiting posting")} went back in the queue</div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

"use client";

import { useId, useState } from "react";

import { Alert, Badge, buttonClass, Card, InfoBox } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import {
  payeeStatusView, readinessSummary, waitingNote, waitingRequests, walletConfirmable, zelleApprovalView, zelleChange,
  type PaymentReadiness, type PayeeQueue, type PayeeRequest, type PluginReadiness, type ZelleCurrent,
} from "@/lib/payments/change-control";

import {
  approveZelleInstructionsAction, cancelPayeeChangeAction, confirmWalletAction, decidePayeeChangeAction, requestZelleChangeAction,
} from "./change-actions";
import { usePaymentsPanel } from "./payments-panel";

// Change control and readiness on Settings › Payments (docs/PAYMENTS_PLAN.md §2.5 and §2.6, migration 0597). The rules are the
// database's: who may ask, who may confirm (a DIFFERENT person with giving.approve), the fresh 2FA check and the reason each of
// them gives. Every button here asks for a reason (kept in the audit log) through the panel's reason box, answers a request for a
// fresh 2FA check with the code box, and shows a refusal in plain English next to what was clicked.

/** What the page loaded for this part of the screen: each answer, or why it could not be read. */
export type ChangeControl = {
  queue: PayeeQueue | null;
  queueError: string | null;
  readiness: PaymentReadiness | null;
  readinessError: string | null;
};

function RetryAlert({ title, message }: { title: string; message: string }) {
  return (
    <Alert tone="danger" title={title} action={<a href="/settings/payments" className={buttonClass("bad", "xs")}>Try again</a>}>
      {message}
    </Alert>
  );
}

// ── Requests to change where gifts go ────────────────────────────────────────
function RequestRow({ r, canApprove, canRequest, tz }: { r: PayeeRequest; canApprove: boolean; canRequest: boolean; tz: string }) {
  const { run, busy, askReason } = usePaymentsPanel();
  const view = payeeStatusView(r);
  const what = r.plugin_key === "paypal" ? "PayPal" : "Zelle";
  const live = r.status === "pending" && !r.expired;
  const decide = (approve: boolean) =>
    askReason({
      title: approve ? `Confirm the change to ${what}` : `Turn the change to ${what} down`,
      confirmLabel: approve ? "Confirm the change" : "Turn it down",
      tone: approve ? "primary" : "bad",
      body: approve ? (
        <>
          <p>This changes where gifts go. Check each line against what you know is right:</p>
          <ul className="mt-1 list-disc pl-5">
            {r.fields.map((f) => (
              <li key={f.field}>
                {f.label}: <span className="font-mono">{f.from ?? "not set"}</span> becomes <span className="font-mono">{f.to ?? "not set"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">It needs a fresh 2FA check and a reason. Members then see a dated notice for 30 days.</p>
        </>
      ) : (
        <p>Nothing changes. {r.requested_by_name} can see why.</p>
      ),
      run: async (reason) => void (await run(`payee-${r.id}`, approve ? "confirm the change" : "turn the change down", () => decidePayeeChangeAction(r.id, approve, reason))),
    });
  const withdraw = () =>
    askReason({
      title: `Withdraw the request to change ${what}`,
      confirmLabel: "Withdraw",
      tone: "bad",
      body: <p>Nothing is changed.</p>,
      run: async (reason) => void (await run(`payee-${r.id}`, "withdraw the request", () => cancelPayeeChangeAction(r.id, reason))),
    });
  return (
    <li className="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0" data-request={r.id} data-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{what}</span>
        <Badge tone={view.tone}>{view.label}</Badge>
        <span className="text-muted">
          asked by {r.requested_by_name} on {formatDateTime(r.requested_at, tz)}
        </span>
      </div>
      <ul className="list-disc pl-5">
        {r.fields.map((f) => (
          <li key={f.field}>
            {f.label}: <span className="font-mono">{f.from ?? "not set"}</span> → <span className="font-mono">{f.to ?? "not set"}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted">Reason given: {r.request_reason}</p>
      {live || (r.status === "pending" && r.expired) ? <p>{waitingNote(r, canApprove)}</p> : null}
      {r.status !== "pending" && r.decided_by_name ? (
        <p className="text-muted">
          {r.status === "applied" ? "Confirmed" : r.status === "rejected" ? "Turned down" : "Closed"} by {r.decided_by_name}
          {r.decided_at ? ` on ${formatDateTime(r.decided_at, tz)}` : ""}
          {r.decision_reason ? `: ${r.decision_reason}` : ""}
        </p>
      ) : null}
      {live ? (
        <div className="flex flex-wrap gap-2">
          {canApprove && !r.mine ? (
            <>
              <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null} onClick={() => decide(true)}>
                Confirm the change
              </button>
              <button type="button" className={buttonClass("ghost", "sm")} disabled={busy !== null} onClick={() => decide(false)}>
                Turn it down
              </button>
            </>
          ) : null}
          {canRequest || r.mine ? (
            <button type="button" className={buttonClass("ghost", "sm")} disabled={busy !== null} onClick={withdraw}>
              Withdraw the request
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function PayeeRequestsCard({ cc, tz }: { cc: ChangeControl; tz: string }) {
  if (cc.queueError) return <RetryAlert title="Could not load the changes to where gifts go" message={cc.queueError} />;
  const q = cc.queue;
  if (!q || q.requests.length === 0) return null;
  const waiting = waitingRequests(q).length;
  return (
    <Card
      title="Changes to where gifts go"
      description="The Zelle address or name, the bank account Zelle payments arrive in and the PayPal email change only when a different person with giving.approve confirms it, with a fresh 2FA check and a reason."
      actions={waiting > 0 ? <Badge tone="warning">{waiting} waiting</Badge> : null}
    >
      <ul className="flex flex-col gap-3 text-[13px]" aria-label="Requests to change where gifts go">
        {q.requests.map((r) => (
          <RequestRow key={r.id} r={r} canApprove={q.can_approve} canRequest={q.can_request} tz={tz} />
        ))}
      </ul>
    </Card>
  );
}

/** Zelle card: the address and the name are saved once; changing them is asked for here and confirmed by a second person. */
export function RequestZelleChange({ current, waiting }: { current: ZelleCurrent; waiting: number }) {
  const { run, busy, askReason } = usePaymentsPanel();
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState(current.recipient);
  const [name, setName] = useState(current.name);
  const [problem, setProblem] = useState<string | null>(null);
  const recipientId = useId();
  const nameId = useId();
  if (!current.recipient.trim() && !current.name.trim()) return null;
  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("ghost", "sm")} disabled={busy !== null} onClick={() => { setRecipient(current.recipient); setName(current.name); setProblem(null); setOpen(true); }}>
          Request a change to the address or name
        </button>
        {waiting > 0 ? <span className="text-muted">A change is already waiting; a new request replaces it.</span> : null}
      </div>
    );
  }
  const ask = () => {
    const change = zelleChange(current, { recipient, name });
    if (!change.ok) return setProblem(change.error);
    setProblem(null);
    askReason({
      title: "Ask to change where Zelle gifts go",
      confirmLabel: "Ask for the change",
      body: (
        <>
          <p>Nothing changes yet. A different person with giving.approve has to confirm it, and members keep seeing the current details until then.</p>
          <ul className="mt-1 list-disc pl-5">
            {Object.entries(change.changes).map(([k, v]) => (
              <li key={k}>
                {k === "recipient" ? "Zelle email or phone" : "Name shown in Zelle"}: <span className="font-mono">{v}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2">This needs a fresh 2FA check.</p>
        </>
      ),
      run: async (reason) => {
        const res = await run("zelle-change", "ask for the Zelle change", () => requestZelleChangeAction(current, { recipient, name }, reason));
        if (res?.ok) setOpen(false);
      },
    });
  };
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <p className="font-semibold">Ask to change where Zelle gifts go</p>
      <div className="grid gap-2 md:grid-cols-2">
        <label htmlFor={recipientId} className="flex flex-col">
          <span>New Zelle email or phone</span>
          <input id={recipientId} className="crm-input" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
        </label>
        <label htmlFor={nameId} className="flex flex-col">
          <span>New name shown in Zelle</span>
          <input id={nameId} className="crm-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
      </div>
      {problem ? <p className="text-danger">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null} onClick={ask}>
          Ask for the change
        </button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── The treasurer's approval of the Zelle instructions ───────────────────────
export function ZelleApprovalRow({ cc, tz }: { cc: ChangeControl; tz: string }) {
  const { run, busy, askReason } = usePaymentsPanel();
  if (cc.readinessError) return <RetryAlert title="Could not load the Zelle approval" message={cc.readinessError} />;
  const r = cc.readiness;
  if (!r) return null;
  const a = r.zelle_approval;
  const view = zelleApprovalView(a);
  const approve = () =>
    askReason({
      title: "Approve the Zelle instructions",
      confirmLabel: "Approve",
      body: (
        <p>
          You are saying that the Zelle address, the name shown in Zelle, the memo wording, the bank account and the report window are right, and
          that you know how Zelle payments are matched to the bank statement. If any of them changes later, they need approving again.
        </p>
      ),
      run: async (note) => void (await run("zelle-approval", "approve the Zelle instructions", () => approveZelleInstructionsAction(note))),
    });
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3" data-testid="zelle-approval">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Go-live approval of the Zelle instructions</span>
        <Badge tone={view.tone}>{view.label}</Badge>
      </div>
      {a.state !== "none" && a.approved_by_name ? (
        <p className="text-muted">
          {a.approved_by_name}
          {a.approved_at ? ` on ${formatDateTime(a.approved_at, tz)}` : ""}
          {a.note ? `: ${a.note}` : ""}
        </p>
      ) : null}
      {a.state === "changed" ? <p>The details changed after they were approved. The treasurer approves the new version.</p> : null}
      {a.state !== "current" ? (
        r.is_treasurer ? (
          <div>
            <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null} onClick={approve}>
              Approve the Zelle instructions
            </button>
          </div>
        ) : (
          <p className="text-muted">Only the person with the Treasurer role approves them (readiness check 6 asks for it before going live).</p>
        )
      ) : null}
    </div>
  );
}

// ── Apple Pay and Google Pay: "I turned it on in Stripe" ─────────────────────
export function WalletConfirm({ pluginKey, label, cc }: { pluginKey: string; label: string; cc: ChangeControl }) {
  const { run, busy, askReason } = usePaymentsPanel();
  const entry = cc.readiness?.plugins.find((p) => p.key === pluginKey);
  if (!entry) return null;
  if (entry.ready) return <p className="text-muted">{entry.detail}</p>;
  if (!walletConfirmable(entry)) return null;
  return (
    <div className="flex flex-col gap-1 border-t border-line pt-3" data-testid={`wallet-${pluginKey}`}>
      <p>{entry.detail}</p>
      <div>
        <button
          type="button"
          className={buttonClass("ghost", "sm")}
          disabled={busy !== null}
          onClick={() =>
            askReason({
              title: `${label} is turned on in Stripe`,
              confirmLabel: "Record it",
              body: <p>You are saying you turned {label} on in the organization&apos;s Stripe payment-method settings. Community Connect cannot check that setting yet, so it records your word, who said it and when.</p>,
              run: async (reason) => void (await run(`wallet-${pluginKey}`, `say that ${label} is turned on in Stripe`, () => confirmWalletAction(pluginKey, reason))),
            })
          }
        >
          I turned it on in Stripe
        </button>
      </div>
    </div>
  );
}

// ── Readiness ────────────────────────────────────────────────────────────────
function ReadinessLine({ p }: { p: PluginReadiness }) {
  return (
    <li className="flex flex-col gap-0.5" data-plugin={p.key} data-ready={p.ready ? "yes" : "no"}>
      <span>
        <span className="font-semibold">{p.label}</span> · <Badge tone={p.ready ? "success" : "danger"}>{p.ready ? "Ready" : "Not ready"}</Badge>
      </span>
      <span className={p.ready ? "text-muted" : ""}>{p.detail}</span>
    </li>
  );
}

export function ReadinessCard({ cc }: { cc: ChangeControl }) {
  if (cc.readinessError) return <RetryAlert title="Could not load the go-live readiness for payments" message={cc.readinessError} />;
  const r = cc.readiness;
  if (!r) return null;
  return (
    <Card
      title="Ready to go live?"
      description={
        r.environment === "sandbox"
          ? "What Community Connect checks before approving this organization to go live (readiness check 6), shown for every way to pay that is switched on. A sandbox is checked in test mode."
          : "What Community Connect checks before approving this organization to go live (readiness check 6), shown for every way to pay that is switched on."
      }
      actions={<Badge tone={r.ok ? "success" : "warning"}>{r.ok ? "Ready" : "Not ready"}</Badge>}
    >
      <div className="flex flex-col gap-2 text-[13px]">
        <p>{readinessSummary(r)}</p>
        {r.offline_only ? <InfoBox>The organization takes offline payments only, so Stripe and PayPal are not offered and are not checked. Zelle and the offline methods still are.</InfoBox> : null}
        <ul className="flex flex-col gap-2" aria-label="Readiness of each way to pay">
          {r.plugins.map((p) => (
            <ReadinessLine key={p.key} p={p} />
          ))}
        </ul>
      </div>
    </Card>
  );
}

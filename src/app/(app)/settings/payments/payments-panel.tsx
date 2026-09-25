"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type ReactNode } from "react";

import { Toggle } from "@/components/controls";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Alert, buttonClass, Card, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  connectMethodLabel, OFFLINE_METHODS, ONLINE_METHODS, PROCESSOR_LABEL, processorStatusView, statementDescriptorProblem,
  type MethodSettings, type PaymentSettings, type ProcessorSettings,
} from "@/lib/payments/view";

import { useStepUp } from "../integrations/step-up";
import {
  confirmPaypalCodeAction, disconnectAction, runTestAction, saveMethodAction, saveProcessorAction, sendPaypalCodeAction,
  setDefaultAction, setModeAction, setOfflineOnlyAction, startConnectAction, syncPayoutsAction, type PayResult,
} from "./actions";

type Env = { supabaseUrl: string; supabaseAnonKey: string } | null;
type Ask = { title: string; confirmLabel: string; body: ReactNode; tone?: "primary" | "bad"; run: (reason: string) => Promise<void> };

/** Runs an action; answers a fresh-2FA request (CCSTP) with the step-up modal and retries once. */
function useRunner(env: Env) {
  const router = useRouter();
  const toast = useToast();
  const noEnv = { request: async () => false, modal: null };
  const stepUp = useStepUp(env ?? { supabaseUrl: "", supabaseAnonKey: "" });
  const su = env ? stepUp : noEnv;
  const [busy, setBusy] = useState<string | null>(null);
  async function run<T>(key: string, what: string, fn: () => Promise<PayResult<T>>): Promise<PayResult<T> | null> {
    setBusy(key);
    try {
      let res = await fn();
      if (!res.ok && res.stepUp) {
        const ok = await su.request(what);
        if (!ok) {
          toast?.show("Nothing was changed — the 2FA check was not completed.", "bad");
          return res;
        }
        res = await fn();
      }
      if (!res.ok) toast?.show(res.error, "bad");
      else {
        if (res.message) toast?.show(res.message, "ok");
        router.refresh();
      }
      return res;
    } catch (err) {
      console.error(`[settings/payments] ${what} failed:`, err);
      toast?.show(`Could not ${what} — the server could not be reached. Nothing was changed; try again.`, "bad");
      return null;
    } finally {
      setBusy(null);
    }
  }
  return { run, busy, modal: su.modal };
}

export function PaymentsPanel({ settings, centerName, tz, env }: { settings: PaymentSettings; centerName: string; tz: string; env: Env }) {
  const { run, busy, modal } = useRunner(env);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [reason, setReason] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const reasonId = useId();

  function askReason(a: Ask) {
    setReason("");
    setAskError(null);
    setAsk(a);
  }
  async function confirmAsk() {
    if (!ask) return;
    if (!reason.trim()) return setAskError("Say why — the reason is kept in the audit log.");
    const a = ask;
    setAsk(null);
    await a.run(reason.trim());
  }

  const s = settings;
  return (
    <div className="flex flex-col gap-4">
      {s.forced_test ? (
        <Alert tone="info" title="Test mode only">
          {s.environment === "sandbox"
            ? "This is a sandbox: every charge runs in the processor's test mode and no real money moves. Live mode is switched on in production."
            : "Community Connect is holding this organization to test mode."}
        </Alert>
      ) : null}
      {!s.can_configure ? (
        <p className="text-[13px] text-muted">You can see these settings. Changing them needs the organization owner, integrations.manage or giving.manage.</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {s.processors.map((p) => (
          <ProcessorCard key={p.processor} p={p} s={s} tz={tz} run={run} busy={busy} askReason={askReason} />
        ))}
      </div>

      <OfflineOnlyCard s={s} run={run} busy={busy} askReason={askReason} centerName={centerName} />
      <OfflineMethodsCard s={s} run={run} busy={busy} askReason={askReason} />
      <PayoutsCard s={s} tz={tz} run={run} busy={busy} />

      <Modal
        open={!!ask}
        kicker="Settings › Payments"
        title={ask?.title ?? ""}
        confirmLabel={ask?.confirmLabel ?? "Save"}
        tone={ask?.tone}
        error={askError}
        onConfirm={() => void confirmAsk()}
        onCancel={() => setAsk(null)}
      >
        {ask?.body}
        <label htmlFor={reasonId} className="mt-3 block text-[13px] font-semibold">
          Reason (kept in the audit log)
        </label>
        <textarea id={reasonId} className="crm-input mt-1 w-full" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
      {modal}
    </div>
  );
}

type Runner = ReturnType<typeof useRunner>["run"];

function ProcessorCard({ p, s, tz, run, busy, askReason }: { p: ProcessorSettings; s: PaymentSettings; tz: string; run: Runner; busy: string | null; askReason: (a: Ask) => void }) {
  const label = PROCESSOR_LABEL[p.processor];
  const st = processorStatusView(p.status, p.api_mode);
  const connected = p.status === "test" || p.status === "live";
  const [methods, setMethods] = useState<string[]>(p.methods.length ? p.methods : [ONLINE_METHODS[p.processor][0].key]);
  const [descriptor, setDescriptor] = useState(p.statement_descriptor ?? "");
  const [email, setEmail] = useState(s.paypal_email_pending?.email ?? "");
  const [code, setCode] = useState("");
  const descId = useId();
  const emailId = useId();
  const codeId = useId();
  const descProblem = statementDescriptorProblem(descriptor);
  const c = p.connection;
  const lastLive = p.tests.find((t) => t.mode === "live");
  const lastAny = p.tests[0];

  const connect = () =>
    askReason({
      title: `Connect ${label}`,
      confirmLabel: `Continue to ${label}`,
      body: (
        <p>
          You will sign in to the organization&apos;s {label} account and allow Community Connect to take payments for it. {label} may take a few days to verify the
          organization. This needs a fresh 2FA check.
        </p>
      ),
      run: async (reason) => {
        const res = await run(`connect-${p.processor}`, `connect ${label}`, () => startConnectAction(p.processor, reason));
        if (res?.ok && res.data?.url) window.location.assign(res.data.url);
      },
    });

  return (
    <Card
      title={label}
      description={
        p.processor === "stripe"
          ? "Card, ACH bank debit, Apple Pay and Google Pay, through the organization's own Stripe account (Stripe Connect)."
          : "PayPal, Venmo and cards, through the organization's own PayPal Business account."
      }
      actions={<StatusText tone={st.tone}>{st.label}</StatusText>}
    >
      <div className="flex flex-col gap-3 text-[13px]">
        {c && c.status === "connected" ? (
          <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Account</dt>
            <dd className="font-mono">{c.external_account_id ?? c.paypal_email ?? "—"}</dd>
            <dt className="text-muted">Connected with</dt>
            <dd>{connectMethodLabel(c.connect_method)}</dd>
            <dt className="text-muted">Connected</dt>
            <dd>{c.connected_at ? formatDateTime(c.connected_at, tz) : "—"}</dd>
            <dt className="text-muted">Charges</dt>
            <dd>{p.api_mode === "live" ? "Live — real money" : "Test mode — no real money"}</dd>
            <dt className="text-muted">Default at checkout</dt>
            <dd>{p.is_default ? "Yes" : "No"}</dd>
          </dl>
        ) : null}
        {c?.charges_enabled === false ? (
          <Alert tone="warning">{label} has not finished verifying this account (the organization, its EIN and its bank). Finish the steps in the {label} dashboard.</Alert>
        ) : null}
        {p.last_job && p.last_job.status === "failed" ? (
          <Alert tone="danger" title="The last connection attempt failed">{p.last_job.last_error ?? "No reason was given."}</Alert>
        ) : p.last_job && (p.last_job.status === "queued" || p.last_job.status === "running") ? (
          <p className="text-muted">The background service is finishing the connection…</p>
        ) : null}

        {s.can_connect ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass(connected ? "ghost" : "primary", "sm")} disabled={busy !== null} onClick={connect}>
              {connected ? `Reconnect ${label}` : p.processor === "paypal" ? "Connect with PayPal" : "Connect Stripe"}
            </button>
            {connected ? (
              <>
                <button
                  type="button"
                  className={buttonClass("ghost", "sm")}
                  disabled={busy !== null}
                  onClick={async () => {
                    const res = await run(`test-${p.processor}`, `run the $1 test of ${label}`, () => runTestAction(p.processor));
                    if (res?.ok && res.data?.url) window.open(res.data.url, "_blank", "noopener");
                  }}
                >
                  Run the $1 test
                </button>
                {!s.forced_test ? (
                  <button
                    type="button"
                    className={buttonClass("ghost", "sm")}
                    disabled={busy !== null}
                    onClick={() =>
                      askReason({
                        title: p.status === "live" ? `Switch ${label} to test mode` : `Switch ${label} to live`,
                        confirmLabel: p.status === "live" ? "Switch to test" : "Go live",
                        body: p.status === "live"
                          ? <p>Members will no longer be able to pay online with {label}.</p>
                          : <p>Members will be charged real money through {label}. This needs a fresh 2FA check.</p>,
                        run: async (reason) => void (await run(`mode-${p.processor}`, `switch ${label} mode`, () => setModeAction(p.processor, p.status === "live" ? "test" : "live", reason))),
                      })
                    }
                  >
                    {p.status === "live" ? "Switch to test mode" : "Switch to live"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={buttonClass("danger", "sm")}
                  disabled={busy !== null}
                  onClick={() =>
                    askReason({
                      title: `Disconnect ${label}`,
                      tone: "bad",
                      confirmLabel: "Disconnect",
                      body: <p>{label} stops taking payments here. Nothing is deleted: past payments and their history stay. This needs a fresh 2FA check.</p>,
                      run: async (reason) => void (await run(`disconnect-${p.processor}`, `disconnect ${label}`, () => disconnectAction(p.processor, reason))),
                    })
                  }
                >
                  Disconnect
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {p.processor === "paypal" && s.can_connect && !connected ? (
          <div className="rounded-[10px] border border-line p-3">
            <p className="font-semibold">Or use the PayPal Business email</p>
            <p className="text-muted">If Connect with PayPal isn&apos;t available, enter the account&apos;s email. We send it a 6-digit code to prove it is yours.</p>
            {!s.messaging_available ? (
              <p className="mt-1 text-danger">Email sending isn&apos;t set up on Community Connect yet, so the code can&apos;t be sent. Use Connect with PayPal for now.</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label htmlFor={emailId} className="flex flex-col">
                <span>PayPal Business email</span>
                <input id={emailId} type="email" className="crm-input w-64" value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <button type="button" className={buttonClass("ghost", "sm")} disabled={busy !== null || !email.trim()}
                onClick={() => void run("paypal-code", "send the PayPal code", () => sendPaypalCodeAction(email))}>
                Send code
              </button>
            </div>
            {s.paypal_email_pending ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label htmlFor={codeId} className="flex flex-col">
                  <span>Code sent to {s.paypal_email_pending.email}</span>
                  <input id={codeId} inputMode="numeric" maxLength={6} className="crm-input w-32" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                </label>
                <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null || code.length !== 6}
                  onClick={() => void run("paypal-verify", "verify the PayPal email", () => confirmPaypalCodeAction(code))}>
                  Verify email
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <p className="font-semibold">$1 charge and refund</p>
          {p.test_pending ? (
            <p className="text-muted">
              A $1 {p.test_pending.mode === "live" ? "live" : "test-mode"} charge is {p.test_pending.status === "paid" ? "paid and being refunded" : "waiting to be paid"}
              {p.test_pending.checkout_url && p.test_pending.status !== "paid" ? (
                <> · <a className="crm-link" href={p.test_pending.checkout_url} target="_blank" rel="noopener noreferrer">open the payment page</a></>
              ) : null}
            </p>
          ) : null}
          {lastAny ? (
            <p>
              {lastAny.ok ? <StatusText tone="ok">Passed</StatusText> : <StatusText tone="bad">Failed</StatusText>} {lastAny.mode} mode, {formatDateTime(lastAny.ran_at, tz)} ·{" "}
              {lastAny.detail}
              {lastAny.ok ? <span className="text-muted"> (charge {lastAny.charge_ref}, refund {lastAny.refund_ref})</span> : null}
            </p>
          ) : (
            <p className="text-muted">Not run yet.</p>
          )}
          {!s.forced_test && !lastLive?.ok ? <p className="text-muted">Go-live needs a passing live-mode test on the default processor.</p> : null}
        </div>

        <p className="text-[13px]" data-testid={`donor-fee-${p.processor}`}>
          <span className="font-semibold">Donors covering the processing fee:</span> <StatusText tone="warn">Not offered yet</StatusText>{" "}
          <span className="text-muted">No fee is ever added to a gift: the donor pays exactly the amount they choose.</span>
        </p>

        {connected && s.can_configure ? (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <fieldset>
              <legend className="font-semibold">Online methods</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {ONLINE_METHODS[p.processor].map((m) => (
                  <label key={m.key} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={methods.includes(m.key)}
                      onChange={(e) => setMethods((cur) => (e.target.checked ? [...cur, m.key] : cur.filter((x) => x !== m.key)))} />
                    {m.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor={descId} className="flex flex-col">
              <span className="font-semibold">Statement descriptor</span>
              <span className="text-muted">What donors see on their card statement, 5–22 characters.</span>
              <input id={descId} className="crm-input mt-1 w-64" maxLength={22} value={descriptor} onChange={(e) => setDescriptor(e.target.value)} />
            </label>
            {descProblem ? <p className="text-danger">{descProblem}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null || !!descProblem || methods.length === 0}
                onClick={() => askReason({
                  title: `Save the ${label} settings`, confirmLabel: "Save", body: null,
                  run: async (reason) => void (await run(`save-${p.processor}`, `save the ${label} settings`, () => saveProcessorAction(p.processor, methods, descriptor, reason))),
                })}>
                Save {label} settings
              </button>
              {!p.is_default ? (
                <button type="button" className={buttonClass("ghost", "sm")} disabled={busy !== null}
                  onClick={() => askReason({
                    title: `Make ${label} the default`, confirmLabel: "Make default", body: <p>Members pay with {label} unless they choose otherwise.</p>,
                    run: async (reason) => void (await run(`default-${p.processor}`, `make ${label} the default`, () => setDefaultAction(p.processor, reason))),
                  })}>
                  Make default at checkout
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function OfflineOnlyCard({ s, run, busy, askReason, centerName: name }: { s: PaymentSettings; run: Runner; busy: string | null; askReason: (a: Ask) => void; centerName: string }) {
  return (
    <Card title="Offline payments only" description={`${name} may go live taking checks, cash, Zelle and the other offline methods only, and add card payments later.`}>
      <Toggle
        label="Offline payments only"
        checked={s.offline_only}
        disabled={!s.can_configure || busy !== null}
        onNote="Offline only — members see the offline instructions; no online checkout"
        offNote="Online payments are offered when a processor is live"
        onChange={(on) =>
          askReason({
            title: on ? "Take offline payments only" : "Offer online payments again",
            confirmLabel: "Save",
            body: null,
            run: async (reason) => void (await run("offline-only", "change offline-only", () => setOfflineOnlyAction(on, reason))),
          })
        }
      />
    </Card>
  );
}

function OfflineMethodsCard({ s, run, busy, askReason }: { s: PaymentSettings; run: Runner; busy: string | null; askReason: (a: Ask) => void }) {
  return (
    <Card title="Offline methods" description="Each accepted method shows its instructions to members in the app (How to give).">
      <div className="flex flex-col divide-y divide-line">
        {OFFLINE_METHODS.map((m, i) => {
          const row = s.methods.find((x) => x.method === m.method);
          return <MethodRow key={m.method} def={m} row={row} sort={i + 1} canEdit={s.can_configure} run={run} busy={busy} askReason={askReason} />;
        })}
      </div>
    </Card>
  );
}

function MethodRow({ def, row, sort, canEdit, run, busy, askReason }: {
  def: (typeof OFFLINE_METHODS)[number]; row: MethodSettings | undefined; sort: number; canEdit: boolean; run: Runner; busy: string | null; askReason: (a: Ask) => void;
}) {
  const [accepted, setAccepted] = useState(row?.accepted ?? false);
  const [vals, setVals] = useState<Record<string, string>>(row?.instructions ?? {});
  const baseId = useId();
  const required = row?.required ?? [];
  const missing = accepted ? required.filter((k) => !(vals[k] ?? "").trim()) : [];
  return (
    <section className="py-3" aria-label={def.label}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold">{def.label}</h3>
        <Toggle label={`Accept ${def.label}`} checked={accepted} disabled={!canEdit} onChange={setAccepted} onNote="Accepted" offNote="Not offered" />
      </div>
      {accepted ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {def.fields.map((f) => {
            const id = `${baseId}-${f.key}`;
            return (
              <label key={f.key} htmlFor={id} className="flex flex-col text-[13px]">
                <span>
                  {f.label}
                  {required.includes(f.key) ? " *" : ""}
                </span>
                {f.multiline ? (
                  <textarea id={id} rows={2} className="crm-input" disabled={!canEdit} placeholder={f.placeholder} value={vals[f.key] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} />
                ) : (
                  <input id={id} className="crm-input" disabled={!canEdit} placeholder={f.placeholder} value={vals[f.key] ?? ""}
                    onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} />
                )}
              </label>
            );
          })}
        </div>
      ) : null}
      {missing.length > 0 ? <p className="mt-1 text-[13px] text-danger">Fill in the fields marked * before accepting {def.label.toLowerCase()}.</p> : null}
      {canEdit && (accepted !== (row?.accepted ?? false) || JSON.stringify(vals) !== JSON.stringify(row?.instructions ?? {})) ? (
        <button type="button" className={`${buttonClass("primary", "sm")} mt-2`} disabled={busy !== null || missing.length > 0}
          onClick={() => askReason({
            title: `Save ${def.label}`, confirmLabel: "Save", body: null,
            run: async (reason) => void (await run(`method-${def.method}`, `save ${def.label}`, () => saveMethodAction(def.method, accepted, vals, sort, reason))),
          })}>
          Save {def.label}
        </button>
      ) : null}
    </section>
  );
}

function PayoutsCard({ s, tz, run, busy }: { s: PaymentSettings; tz: string; run: Runner; busy: string | null }) {
  return (
    <Card
      title="Payouts"
      description="Money the processor sent to the bank, with its fees. Bank reconciliation matches each deposit to its payout. PayPal does not report payouts; its bank transfers are matched from the statement."
      actions={s.can_configure ? (
        <button type="button" className={buttonClass("ghost", "sm")} disabled={busy !== null} onClick={() => void run("payouts", "sync the payouts", () => syncPayoutsAction())}>
          Sync payouts now
        </button>
      ) : null}
      padded={false}
    >
      {s.payouts.length === 0 ? (
        <p className="px-3 pb-3 text-[13px] text-muted">No payouts yet.</p>
      ) : (
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr><th>Payout</th><th>Arrives</th><th className="text-right">Gross</th><th className="text-right">Fees</th><th className="text-right">Net</th><th>Matched</th></tr>
            </thead>
            <tbody>
              {s.payouts.map((po) => (
                <tr key={po.provider_ref}>
                  <td className="font-mono text-[13px]">{PROCESSOR_LABEL[po.provider as "stripe"] ?? po.provider} {po.provider_ref}</td>
                  <td>{po.arrives_on ? formatDateTime(`${po.arrives_on}T12:00:00Z`, tz).split(",")[0] : "—"}</td>
                  <td className="text-right">{formatCents(po.gross_cents)}</td>
                  <td className="text-right">{formatCents(po.fee_cents)}</td>
                  <td className="text-right">{formatCents(po.net_cents)}</td>
                  <td>{po.matched ? <StatusText tone="ok">Matched</StatusText> : <StatusText tone="warn">Not yet</StatusText>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

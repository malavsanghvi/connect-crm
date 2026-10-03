"use client";

import { useState, useTransition } from "react";

import { HouseholdCard, type CardLabels, type HouseholdCardData } from "@/components/household-card";
import { Badge, Card, EmptyState, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  REPORT_STATUS_LABEL,
  candidateLabel,
  queueSections,
  type ExactPair,
  type QueueHousehold,
  type QueueReport,
  type RecordedZelle,
  type ReportQueue,
} from "@/lib/payments/zelle";

import { confirmBankMatchAction } from "./actions";
import { useReportOutcome } from "./bank-results";
import { confirmExactMatchesAction, linkReportAction, rejectReportAction, saveZelleReportingAction } from "./zelle-actions";

type Shared = { labels: CardLabels; timeZone: string; currency: string; canConfirm: boolean };

const ERROR_BOX = "rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger";

function card(h: QueueHousehold | null): HouseholdCardData | null {
  return h ? { ...h } : null;
}

/**
 * Zelle reports (0582–0583): what members said they sent, against the bank statement. A report
 * credits nobody; the treasurer's click records the one payment. Sections: exact matches (bulk
 * confirm), waiting for the bank, not seen at the bank, recorded by hand, and the settings.
 */
export function ZelleReports({
  queue,
  accounts,
  canConfigure,
  ...shared
}: Shared & {
  queue: ReportQueue;
  accounts: { id: string; name: string; last4: string | null; active: boolean }[];
  canConfigure: boolean;
}) {
  const sections = queueSections(queue);
  const anyTest = queue.reports.some((r) => r.is_test);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Members report a Zelle they sent from their own bank app. Nothing is credited, receipted or posted until you match it to
        the bank line here or under Gifts to match. Reports are flagged as not seen at the bank after {queue.window_days} days, and the
        member is told.
      </p>
      {anyTest ? (
        <p className="rounded-md border border-purple/40 bg-purple-50 px-3 py-2 text-sm text-ink">
          Sandbox rehearsal: these are test reports. Members never see the real Zelle address in a sandbox, and no real money moves.
        </p>
      ) : null}

      <ExactMatches pairs={sections.exact} {...shared} />

      <ReportSection
        title="Waiting for the bank"
        description="Reported, not on an imported statement yet. Import the latest statement, then match."
        empty="No reports waiting for the bank."
        reports={sections.waiting}
        {...shared}
      />
      <ReportSection
        title="Not seen at the bank"
        description={`Past the ${queue.window_days}-day window with no matching bank line. The member was told to check the confirmation number.`}
        empty="No reports past their window."
        reports={sections.unmatched}
        {...shared}
      />
      <ReportSection
        title="Recorded by hand"
        description="The family already has a Zelle of this amount recorded around that date. If it is the same gift, link the report to it; nothing about the payment changes."
        empty="No reports that match a payment already recorded."
        reports={sections.recorded}
        {...shared}
      />

      {canConfigure ? <ZelleSettings windowDays={queue.window_days} bankAccountId={queue.bank_account_id} accounts={accounts} /> : null}
    </div>
  );
}

function ExactMatches({ pairs, labels, timeZone, currency, canConfirm }: Shared & { pairs: ExactPair[] }) {
  const report = useReportOutcome();
  const [ticked, setTicked] = useState<string[]>(() => pairs.map((p) => p.report_id));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const chosen = pairs.filter((p) => ticked.includes(p.report_id));

  function confirmAll() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await confirmExactMatchesAction(chosen.map((p) => ({ report_id: p.report_id, bank_transaction_id: p.bank_transaction_id })));
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const d = res.data!;
        report({
          id: `zelle-exact-${Date.now()}`,
          title: res.message ?? `Confirmed ${d.confirmed.length} Zelle${d.confirmed.length === 1 ? "" : "s"}`,
          lines: [
            ...(d.confirmed.length > 0 ? [`Receipts: ${d.confirmed.map((c) => c.receipt_number ?? "pending").join(", ")}.`] : []),
            ...d.skipped.map((s) => `Skipped: ${s.reason}`),
          ],
        });
      } catch (err) {
        console.error("[bank/zelle] bulk confirm failed:", err);
        setError("Could not confirm the exact matches — the server did not respond. Reload the page to see which were recorded before trying again.");
      }
    });
  }

  return (
    <Card
      title="Exact matches"
      description="Same confirmation number, amount and date range, one report to one bank line, nothing recorded by hand. Each is checked again when you confirm."
      actions={
        canConfirm && pairs.length > 0 ? (
          <button type="button" disabled={pending || chosen.length === 0} onClick={confirmAll} className={buttonClass("primary", "sm")}>
            {pending ? "Confirming…" : `Confirm ${chosen.length} exact match${chosen.length === 1 ? "" : "es"}`}
          </button>
        ) : null
      }
    >
      {pairs.length === 0 ? (
        <EmptyState title="No exact matches right now" />
      ) : (
        <div className="space-y-3">
          {canConfirm ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <button type="button" onClick={() => setTicked(pairs.map((p) => p.report_id))} className={buttonClass("ghost", "xs")}>
                Tick all
              </button>
              <button type="button" onClick={() => setTicked([])} className={buttonClass("ghost", "xs")}>
                Untick all
              </button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className={ERROR_BOX}>
              {error}
            </p>
          ) : null}
          {pairs.map((p) => {
            const hh = card(p.household);
            return (
              <div key={p.report_id} className="rounded-lg border border-line p-3">
                <label className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
                  {canConfirm ? (
                    <input
                      type="checkbox"
                      checked={ticked.includes(p.report_id)}
                      onChange={() =>
                        setTicked((t) => (t.includes(p.report_id) ? t.filter((x) => x !== p.report_id) : [...t, p.report_id]))
                      }
                      className="h-5 w-5"
                    />
                  ) : null}
                  <span className="font-display text-lg font-semibold tabular-nums">{formatCents(p.amount_cents, currency)}</span>
                  <span>
                    sent {formatDate(p.sent_on, timeZone)} · on the statement {formatDate(p.posted_on, timeZone)}
                  </span>
                  <span className="font-mono">{p.confirmation}</span>
                  {p.payer_name ? <span className="text-muted">from {p.payer_name}</span> : null}
                </label>
                {hh ? <HouseholdCard card={hh} labels={labels} timeZone={timeZone} currency={currency} href={`/households/${hh.household_id}`} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ReportSection({ title, description, empty, reports, ...shared }: Shared & { title: string; description: string; empty: string; reports: QueueReport[] }) {
  return (
    <Card title={`${title} (${reports.length})`} description={description}>
      {reports.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <ReportCard key={r.id} report={r} {...shared} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ReportCard({ report: r, labels, timeZone, currency, canConfirm }: Shared & { report: QueueReport }) {
  const outcome = useReportOutcome();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [linking, setLinking] = useState<RecordedZelle | null>(null);
  const [linkReason, setLinkReason] = useState("");
  const [pending, startTransition] = useTransition();
  const hh = card(r.household);
  const recorded = [...r.hand_recorded, ...r.bank_recorded];
  const idp = r.id.slice(0, 8);

  function run(work: () => Promise<{ ok: boolean; error?: string; message?: string }>, title: (msg: string | undefined) => string) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await work();
        if (!res.ok) {
          setError(res.error ?? "Something went wrong. Try again.");
          return;
        }
        setRejecting(false);
        setLinking(null);
        outcome({ id: `zelle-${r.id}`, title: title(res.message), lines: res.message ? [res.message] : [] });
      } catch (err) {
        console.error("[bank/zelle] action failed:", err);
        setError("The server did not respond. Reload the page to see whether it went through before trying again.");
      }
    });
  }

  function matchLine(txnId: string) {
    if (!hh) return;
    const amount = formatCents(r.amount_cents, currency);
    setError(null);
    startTransition(async () => {
      try {
        const res = await confirmBankMatchAction({ txnId, householdId: hh.household_id, pledgeIds: null, learnPayer: true, reportId: r.id });
        if (!res.ok) {
          setError(
            res.duplicate
              ? `${res.error} Open Gifts to match to attach the line to that payment, or record it there as a separate gift with a reason.`
              : res.error,
          );
          return;
        }
        const d = res.data!;
        outcome({
          id: `zelle-${r.id}`,
          title: `${amount} matched to ${d.householdName} — receipt ${d.receiptNumber ?? "pending"}`,
          lines: [
            d.applied.length > 0
              ? `Applied to ${d.applied.map((a) => `${a.pledge_number ?? "pledge"} (${formatCents(a.amount_cents, currency)})`).join(", ")}.`
              : "Not applied to a pledge (no open pledges).",
            "The member's report is matched.",
          ],
        });
      } catch (err) {
        console.error("[bank/zelle] match failed:", err);
        setError("Could not match the line — the server did not respond. Reload the page to see whether it went through before trying again.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-2xl font-semibold tabular-nums">{formatCents(r.amount_cents, currency)}</span>
            <Badge tone={r.status === "unmatched" ? "warning" : "navy"}>{REPORT_STATUS_LABEL[r.status]}</Badge>
            {r.is_test ? <Badge tone="purple">Test</Badge> : null}
          </p>
          <p>
            Sent {formatDate(r.sent_on, timeZone)} · flagged after {formatDate(r.due_on, timeZone)}
          </p>
          <p>
            <span className="text-muted">Confirmation:</span>{" "}
            {r.confirmation ? <span className="font-mono">{r.confirmation}</span> : <span className="text-muted">not given</span>}
          </p>
          {r.sender_name ? (
            <p>
              <span className="text-muted">Name at their bank:</span> {r.sender_name}
            </p>
          ) : null}
          <p>
            <span className="text-muted">Reported by</span> {r.reported_by_name}, {formatDate(r.created_at, timeZone)}
          </p>
          {r.pledges.length > 0 ? (
            <p>
              <span className="text-muted">For:</span>{" "}
              {r.pledges.map((p) => `${p.pledge_number ?? "pledge"} (${formatCents(p.open_cents, currency)} open)`).join(", ")}
            </p>
          ) : null}
          {r.note ? <p className="text-muted">“{r.note}”</p> : null}
        </div>
        <div className="min-w-0 space-y-2">
          {hh ? <HouseholdCard card={hh} labels={labels} timeZone={timeZone} currency={currency} href={`/households/${hh.household_id}`} /> : null}

          {recorded.length > 0 ? (
            <div className="space-y-1 text-sm">
              <p className="cc-section">ALREADY RECORDED FOR THIS FAMILY</p>
              {recorded.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2">
                  <span>
                    {p.kind === "bank" ? "From the bank statement" : "Recorded by hand"} · {formatCents(p.amount_cents, currency)} on{" "}
                    {formatDate(p.date, timeZone)} · receipt <span className="font-mono">{p.receipt_number ?? "not numbered yet"}</span>
                  </span>
                  {canConfirm ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setLinking(p);
                        setLinkReason("");
                      }}
                      className={buttonClass("ghost", "xs")}
                    >
                      Link to this payment…
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {r.candidates.length > 0 ? (
            <div className="space-y-1 text-sm">
              <p className="cc-section">BANK LINES THAT MAY BE THIS ZELLE</p>
              {r.candidates.map((c) => (
                <div key={c.bank_transaction_id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.exact ? "success" : c.score >= 0.93 ? "navy" : "neutral"}>{candidateLabel(c.score, c.exact)}</Badge>
                  <span>
                    {formatCents(c.amount_cents, currency)} on {formatDate(c.posted_on, timeZone)}
                  </span>
                  <span className="break-all font-mono text-[0.8125rem]">{c.description}</span>
                  {canConfirm ? (
                    <button type="button" disabled={pending || !hh} onClick={() => matchLine(c.bank_transaction_id)} className={buttonClass("primary", "xs")}>
                      {pending ? "Matching…" : "Match to this line"}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : recorded.length === 0 ? (
            <p className="text-sm text-muted">No unmatched bank line of this amount around that date yet.</p>
          ) : null}

          {error ? (
            <p role="alert" className={ERROR_BOX}>
              {error}
            </p>
          ) : null}

          {linking && canConfirm ? (
            <div className="space-y-2 rounded-lg border border-navy/30 bg-navy-50/40 p-3">
              <p className="text-sm">
                Link this report to receipt <span className="font-mono">{linking.receipt_number ?? "(not numbered yet)"}</span>? The payment
                stays exactly as recorded; the report is marked matched.
              </p>
              <label htmlFor={`link-${idp}`} className="crm-label">
                Why (kept in the audit log)
              </label>
              <input
                id={`link-${idp}`}
                value={linkReason}
                onChange={(e) => setLinkReason(e.target.value)}
                maxLength={500}
                className="crm-input"
                placeholder="e.g. recorded at the office on Sunday"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending || linkReason.trim() === ""}
                  onClick={() => run(() => linkReportAction(r.id, linking.id, linkReason), () => `Report of ${formatCents(r.amount_cents, currency)} linked to receipt ${linking.receipt_number ?? ""}`.trim())}
                  className={buttonClass("primary", "sm")}
                >
                  {pending ? "Linking…" : "Link the report"}
                </button>
                <button type="button" disabled={pending} onClick={() => setLinking(null)} className={buttonClass("ghost", "sm")}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          {canConfirm ? (
            rejecting ? (
              <div className="space-y-2 rounded-lg border border-danger/30 p-3">
                <label htmlFor={`reject-${idp}`} className="crm-label">
                  Why is it not accepted? The member is told this.
                </label>
                <input
                  id={`reject-${idp}`}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  maxLength={500}
                  className="crm-input"
                  placeholder="e.g. no Zelle of this amount reached our account; please check with your bank"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || rejectReason.trim() === ""}
                    onClick={() => run(() => rejectReportAction(r.id, rejectReason), () => `Report of ${formatCents(r.amount_cents, currency)} closed as not accepted`)}
                    className={buttonClass("bad", "sm")}
                  >
                    {pending ? "Closing…" : "Close as not accepted"}
                  </button>
                  <button type="button" disabled={pending} onClick={() => setRejecting(false)} className={buttonClass("ghost", "sm")}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRejecting(true);
                  setRejectReason("");
                }}
                className={buttonClass("ghost", "xs")}
              >
                Not accepted…
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ZelleSettings({
  windowDays,
  bankAccountId,
  accounts,
}: {
  windowDays: number;
  bankAccountId: string | null;
  accounts: { id: string; name: string; last4: string | null; active: boolean }[];
}) {
  const [days, setDays] = useState(String(windowDays));
  const [account, setAccount] = useState(bankAccountId ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const n = Number(days);
  const daysOk = Number.isInteger(n) && n >= MIN_WINDOW_DAYS && n <= MAX_WINDOW_DAYS;

  function save() {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await saveZelleReportingAction(n, account || null, reason);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setReason("");
        setMessage(res.message ?? "Saved.");
      } catch (err) {
        console.error("[bank/zelle] saving settings failed:", err);
        setError("Could not save the Zelle report settings — the server did not respond. Try again.");
      }
    });
  }

  return (
    <Card title="Zelle report settings" description="How long a report waits for the bank before the member and you are told, and which account Zelle lines arrive in.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="zelle-days" className="crm-label">
            Report window (days)
          </label>
          <input
            id="zelle-days"
            type="number"
            inputMode="numeric"
            min={MIN_WINDOW_DAYS}
            max={MAX_WINDOW_DAYS}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="crm-input"
            aria-invalid={!daysOk}
          />
          {!daysOk ? <p className="crm-hint text-danger">Enter a whole number of days from 3 to 30.</p> : null}
        </div>
        <div>
          <label htmlFor="zelle-account" className="crm-label">
            Bank account Zelle arrives in
          </label>
          <select id="zelle-account" value={account} onChange={(e) => setAccount(e.target.value)} className="crm-input">
            <option value="">Any account</option>
            {accounts
              .filter((a) => a.active || a.id === bankAccountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.last4 ? ` ··${a.last4}` : ""}
                  {a.active ? "" : " (inactive)"}
                </option>
              ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="zelle-reason" className="crm-label">
            Why (kept in the audit log)
          </label>
          <input id="zelle-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="crm-input" />
        </div>
      </div>
      {error ? (
        <p role="alert" className={`mt-2 ${ERROR_BOX}`}>
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="mt-2 rounded-lg border border-success/30 bg-success-50 px-3 py-2 text-sm text-success-900">
          {message}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={pending || !daysOk || reason.trim() === ""} onClick={save} className={buttonClass("primary", "sm")}>
          {pending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </Card>
  );
}

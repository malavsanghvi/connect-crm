import { ActionForm } from "@/components/action-form";
import { Card, TableWrap } from "@/components/ui";
import { centsAsDecimal } from "@/lib/money";
import { DEFAULT_WINDOW_DAYS, METHOD_ROWS, REPLY_WAIT_MAX, REPLY_WAIT_MIN, WINDOW_MAX, WINDOW_MIN, type ProofPolicy } from "@/lib/payment-proofs/policy";

import { saveProofRulesAction } from "./proof-actions";

// Settings › Payments › Payment proofs: the rules, per organization, for what a family sends when it paid another way. Mirrors the
// prototype (docs/handoff/prototypes/payment-proofs-2026-10/Settings.dc.html). How long files are kept is under Settings › Storage.

export function ProofRules({ policy, canEdit, currency }: { policy: ProofPolicy; canEdit: boolean; currency: string }) {
  const off = !canEdit;
  return (
    <Card
      title="Payment confirmations"
      description="Families can send a photo or file when they paid another way. These rules are per organization. Under Giving, Payment confirmations is an add-on switch."
    >
      <ActionForm action={saveProofRulesAction} submitLabel="Save the confirmation rules" pendingLabel="Saving…" hideSubmit={off} className="flex flex-col gap-5">
        <div data-proof-rules>
          <TableWrap>
            <table className="crm-table min-w-[640px]" aria-label="Payment confirmation rules by way of paying">
              <thead>
                <tr>
                  <th>Way of paying</th>
                  <th>Confirmation needed?</th>
                  <th>Usual days to reach the bank</th>
                </tr>
              </thead>
              <tbody>
                {METHOD_ROWS.map((m) => (
                  <tr key={m.key}>
                    <td className="font-bold">
                      {m.label}
                      <span className="block text-[12.5px] font-normal text-muted">{m.note}</span>
                    </td>
                    <td>
                      <label className="flex min-h-[44px] items-center gap-2 text-[13.5px]">
                        <input type="checkbox" name={`need_${m.key}`} defaultChecked={policy.requiredMethods.includes(m.key)} disabled={off} className="h-4 w-4" />
                        <span>Required</span>
                      </label>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <input
                          name={`days_${m.key}`}
                          defaultValue={policy.windows[m.key] ?? ""}
                          placeholder={String(DEFAULT_WINDOW_DAYS[m.key])}
                          inputMode="numeric"
                          autoComplete="off"
                          disabled={off}
                          aria-label={`Usual days for ${m.label} to reach the bank`}
                          className="crm-input min-h-[44px] w-[84px] text-right tabular-nums"
                        />
                        <span className="text-[13px] text-muted">days</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="m-0 mt-2 text-[12.5px] text-muted">
            Leave a box empty for the usual number shown in grey ({WINDOW_MIN} to {WINDOW_MAX} days). A payment that has not reached the bank after these days shows in Bank › Paid, not on the bank.
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <strong className="text-[14px]">Who checks, and when two people are needed</strong>
            <p className="m-0 text-[13.5px] text-ink-2">Anyone who can record payments (treasurer, finance volunteer) may review a payment confirmation, except one from their own household.</p>
            <div className="flex flex-col gap-1">
              <label htmlFor="second_approver" className="text-[13px] font-bold">
                A payment confirmation above this amount needs a second person with approval rights ({currency})
              </label>
              <input
                id="second_approver"
                name="second_approver"
                defaultValue={policy.secondApproverOverCents > 0 ? centsAsDecimal(policy.secondApproverOverCents) : ""}
                placeholder="0.00"
                inputMode="decimal"
                autoComplete="off"
                disabled={off}
                className="crm-input min-h-[44px] max-w-[220px] tabular-nums"
              />
              <span className="text-[12.5px] text-muted">Empty or 0 turns the second approval off.</span>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="reply_wait_days" className="text-[13px] font-bold">
                Days to wait for a family&apos;s reply before the confirmation returns to the queue
              </label>
              <input
                id="reply_wait_days"
                name="reply_wait_days"
                defaultValue={policy.replyWaitDays}
                inputMode="numeric"
                autoComplete="off"
                disabled={off}
                className="crm-input min-h-[44px] max-w-[120px] tabular-nums"
              />
              <span className="text-[12.5px] text-muted">
                {REPLY_WAIT_MIN} to {REPLY_WAIT_MAX} days. A confirmation nobody answered is never rejected on its own.
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <strong className="text-[14px]">While a confirmation is waiting (Soft credit)</strong>
            <label className="flex items-start gap-2.5 text-[13.5px] text-ink">
              <input type="checkbox" name="honour_event_entry" defaultChecked={policy.honourEventEntry} disabled={off} className="mt-1 h-4 w-4" />
              <span>Admit people to an event whose pledge is in Soft credit</span>
            </label>
            <label className="flex items-start gap-2.5 text-[13.5px] text-ink">
              <input type="checkbox" name="release_store_orders" defaultChecked={policy.releaseStoreOrders} disabled={off} className="mt-1 h-4 w-4" />
              <span>Release a store order for pickup while its pledge is in Soft credit</span>
            </label>
            <p className="m-0 text-[13px] text-muted">Reminders for a pledge in Soft credit are always paused. Soft credit never counts as given until the payment confirmation is approved.</p>
          </div>
        </div>
        {off ? <p className="m-0 text-[12.5px] text-muted">Changing these rules needs the permission to manage settings.</p> : null}
      </ActionForm>
    </Card>
  );
}

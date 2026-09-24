import {
  approveAsSecondAction,
  cancelWriteOffRequestAction,
  completeWriteOffAction,
  recordRefundAction,
  refundThroughProviderAction,
  requestRefundAction,
  requestWriteOffAction,
} from "@/app/(app)/approvals/actions";
import { ActionForm } from "@/components/action-form";
import { formatCents } from "@/lib/money";

// Per-row controls for the two-person rule. What shows depends on where the
// request is and who is looking; the database enforces it either way.

export function WriteOffControls({
  pledgeId,
  requestedBy,
  secondApprover,
  requesterName,
  reason,
  me,
  canManage,
  canApprove,
}: {
  pledgeId: string;
  requestedBy: string | null;
  secondApprover: string | null;
  requesterName: string | null;
  reason: string | null;
  me: string;
  canManage: boolean;
  canApprove: boolean;
}) {
  if (!requestedBy) {
    if (!canManage) return null;
    return (
      <details>
        <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-danger">
          Write off…
        </summary>
        <ActionForm action={requestWriteOffAction} submitLabel="Request write-off" pendingLabel="Requesting…" variant="danger" size="sm" className="mt-2 w-64">
          <input type="hidden" name="id" value={pledgeId} />
          <label htmlFor={`wo-${pledgeId}`} className="crm-label">
            Reason (the second approver reads this)
          </label>
          <textarea id={`wo-${pledgeId}`} name="reason" required maxLength={1000} className="crm-input mb-2 min-h-16" />
        </ActionForm>
      </details>
    );
  }
  return (
    <div className="w-64 space-y-1.5 text-[0.8125rem]">
      <p>
        <span className="font-semibold">Write-off requested</span> by {requestedBy === me ? "you" : (requesterName ?? "a colleague")}
        {reason ? <span className="block text-muted">“{reason}”</span> : null}
      </p>
      {!secondApprover ? (
        requestedBy !== me && canApprove ? (
          <ActionForm action={approveAsSecondAction} submitLabel="Approve as second person" pendingLabel="Approving…" variant="success" size="sm">
            <input type="hidden" name="table" value="pledges" />
            <input type="hidden" name="id" value={pledgeId} />
          </ActionForm>
        ) : (
          <p className="text-muted">
            Waiting for a second approver{requestedBy === me ? " — someone other than you, with giving.approve" : " with giving.approve"}.
          </p>
        )
      ) : canManage ? (
        <ActionForm
          action={completeWriteOffAction}
          submitLabel="Complete write-off"
          pendingLabel="Writing off…"
          variant="danger"
          size="sm"
          confirmMessage="Write off the open balance of this pledge? This closes it."
        >
          <input type="hidden" name="id" value={pledgeId} />
        </ActionForm>
      ) : (
        <p className="text-muted">Approved by two people — a treasurer can complete it.</p>
      )}
      {canManage && !secondApprover ? (
        <ActionForm action={cancelWriteOffRequestAction} submitLabel="Withdraw request" pendingLabel="Withdrawing…" variant="ghost" size="sm">
          <input type="hidden" name="id" value={pledgeId} />
        </ActionForm>
      ) : null}
    </div>
  );
}

export function RefundControls({
  paymentId,
  provider,
  refundable,
  requestedBy,
  secondApprover,
  requesterName,
  me,
  canManage,
  canApprove,
  refundableCents,
  requestedCents,
  reason,
  currency = "USD",
}: {
  paymentId: string;
  provider: string | null;
  refundable: boolean;
  refundableCents?: number;
  requestedCents?: number | null;
  reason?: string | null;
  currency?: string;
  requestedBy: string | null;
  secondApprover: string | null;
  requesterName: string | null;
  me: string;
  canManage: boolean;
  canApprove: boolean;
}) {
  if (!refundable) return null;
  if (!requestedBy) {
    if (!canManage) return null;
    return (
      <details>
        <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-navy">Request refund…</summary>
        <ActionForm action={requestRefundAction} submitLabel="Request refund" pendingLabel="Requesting…" variant="ghost" size="sm" className="mt-2 w-64">
          <input type="hidden" name="id" value={paymentId} />
          <label htmlFor={`rfa-${paymentId}`} className="crm-label">
            Amount to refund ($)
          </label>
          <input
            id={`rfa-${paymentId}`}
            name="amount"
            inputMode="decimal"
            defaultValue={refundableCents !== undefined ? (refundableCents / 100).toFixed(2) : ""}
            className="crm-input mb-2"
          />
          <label htmlFor={`rfr-${paymentId}`} className="crm-label">
            Reason (the second approver reads this)
          </label>
          <textarea id={`rfr-${paymentId}`} name="reason" required maxLength={1000} className="crm-input mb-2 min-h-16" />
        </ActionForm>
      </details>
    );
  }
  return (
    <div className="w-56 space-y-1.5 text-[0.8125rem]">
      <p>
        <span className="font-semibold">Refund{requestedCents ? ` of ${formatCents(requestedCents, currency)}` : ""} requested</span> by{" "}
        {requestedBy === me ? "you" : (requesterName ?? "a colleague")}
        {reason ? <span className="block text-muted">“{reason}”</span> : null}
      </p>
      {!secondApprover ? (
        requestedBy !== me && canApprove ? (
          <ActionForm action={approveAsSecondAction} submitLabel="Approve as second person" pendingLabel="Approving…" variant="success" size="sm">
            <input type="hidden" name="table" value="payments" />
            <input type="hidden" name="id" value={paymentId} />
          </ActionForm>
        ) : (
          <p className="text-muted">Waiting for a second approver with giving.approve.</p>
        )
      ) : provider === "offline" || provider === "bank" ? (
        canManage ? (
          <ActionForm action={recordRefundAction} submitLabel="Record refund" pendingLabel="Recording…" variant="danger" size="sm">
            <input type="hidden" name="id" value={paymentId} />
            <label htmlFor={`rf-${paymentId}`} className="crm-label">
              Amount refunded ($)
            </label>
            <input
              id={`rf-${paymentId}`}
              name="amount"
              inputMode="decimal"
              required
              defaultValue={requestedCents ? (requestedCents / 100).toFixed(2) : ""}
              className="crm-input mb-2"
            />
          </ActionForm>
        ) : (
          <p className="text-muted">Approved — a treasurer records the refund.</p>
        )
      ) : (provider === "stripe" || provider === "paypal") && canManage ? (
        <ActionForm action={refundThroughProviderAction} submitLabel={`Refund through ${provider === "paypal" ? "PayPal" : "Stripe"}`} pendingLabel="Sending…" variant="danger" size="sm">
          <input type="hidden" name="id" value={paymentId} />
        </ActionForm>
      ) : (
        <p className="text-muted">Approved. Card refunds are issued through the payment provider.</p>
      )}
    </div>
  );
}

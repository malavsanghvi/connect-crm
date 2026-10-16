import { ActionForm } from "@/components/action-form";
import { FEE_CLASSES, FEE_CLASS_LABEL } from "@/lib/payments/chip-in-platform";

import { addFeeRateAction } from "../payments/actions";

/**
 * Add a Stripe fee-rate row: a way to pay, the percentage, the fixed part in dollars, an optional cap in dollars, where the rate comes
 * from and a reason. Used for the platform-wide rate (Platform › Payments, no `centerId`) and for one organization's own rate
 * (Platform › Centers › [organization], its approved nonprofit pricing). Platform admins only (the pages check, the database enforces).
 * A rate is an estimate for the card fee a member may cover; Stripe's real fee is what is recorded on a payment.
 */
export function FeeRateForm({ centerId, submitLabel }: { centerId: string | null; submitLabel: string }) {
  return (
    <ActionForm action={addFeeRateAction} submitLabel={submitLabel} size="sm" resetOnSuccess className="space-y-3">
      {centerId ? <input type="hidden" name="center" value={centerId} /> : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[14rem]">
          <span className="crm-label">Way to pay</span>
          <select name="method_class" className="crm-input" defaultValue="card">
            {FEE_CLASSES.map((c) => (
              <option key={c} value={c}>
                {FEE_CLASS_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="w-32">
          <span className="crm-label">Percentage</span>
          <input name="percent" inputMode="decimal" className="crm-input" placeholder="e.g. 2.9" autoComplete="off" />
        </label>
        <label className="w-32">
          <span className="crm-label">Fixed part ($)</span>
          <input name="fixed" inputMode="decimal" className="crm-input" placeholder="e.g. 0.30" autoComplete="off" />
        </label>
        <label className="w-36">
          <span className="crm-label">Never more than ($)</span>
          <input name="cap" inputMode="decimal" className="crm-input" placeholder="no cap" autoComplete="off" />
        </label>
      </div>
      <label className="block max-w-xl">
        <span className="crm-label">Where this rate comes from</span>
        <input name="note" className="crm-input" placeholder="e.g. approved nonprofit pricing, letter of 2026-11-02" autoComplete="off" />
      </label>
      <label className="block max-w-xl">
        <span className="crm-label">Reason</span>
        <input name="reason" className="crm-input" placeholder="Reason (required)" autoComplete="off" />
      </label>
    </ActionForm>
  );
}

"use client";

import { useState } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";
import { Toggle } from "@/components/controls";
import { HOLD_HOURS, OFFICE_HOLD_DAYS, type PaymentMode, type SeatRule } from "@/lib/pathshala-registration/contract";
import { feeInputValue } from "@/lib/pathshala-registration/money";
import { PAYMENT_MODE_LABEL, SEAT_RULE_HINT, SEAT_RULE_LABEL, paymentModeSentence } from "@/lib/pathshala-registration/rules";

export type RulesValues = {
  payment_mode: PaymentMode;
  hold_hours: number;
  office_payment_allowed: boolean;
  office_hold_days: number;
  seat_rule: SeatRule;
  sibling_discount_pct: number;
  fee_per_family_cap_cents: number | null;
  /** For <input type="datetime-local">, in the community's time zone; "" when there is no late window. */
  late_registration_closes_local: string;
  late_fee_cents: number;
  withdrawal_credit_until: string | null;
  age_cutoff_on: string | null;
  fund_id: string | null;
};

const money = (cents: number | null) => (cents === null ? "" : cents === 0 ? "0" : feeInputValue(cents));

/**
 * The term's registration rules (plan §2.6, §2.7, §3.3): how families pay — with the plain reason when “Pay when
 * registering” cannot be chosen yet (P20), shown, never hidden — the hold windows, paying at the office, the seat
 * rule, the sibling discount and family cap, the late window and fee, the withdrawal deadline and the age cut-off.
 */
export function RulesForm({
  values,
  action,
  needsReason,
  payNowBlocked,
  givingOn,
  funds,
  canChooseFund,
  startsOnLabel,
  registrationClosesLabel,
}: {
  values: RulesValues;
  action: FormAction;
  needsReason: boolean;
  /** Why pay now cannot be chosen, or null when it can. */
  payNowBlocked: string | null;
  givingOn: boolean;
  /** The community's active funds, for the fee pledges; null when they could not be read. */
  funds: { id: string; name: string }[] | null;
  /** giving.manage: the fund of the fee pledges is the treasurer's (0590). */
  canChooseFund: boolean;
  startsOnLabel: string;
  /** "Tue, Sep 1, 11:59 PM", or null when registration has no closing date. */
  registrationClosesLabel: string | null;
}) {
  const [mode, setMode] = useState<PaymentMode>(values.payment_mode);
  const [seat, setSeat] = useState<SeatRule>(values.seat_rule);
  const [office, setOffice] = useState(values.office_payment_allowed);
  // A term already set to pay now keeps that choice selectable, so saving other rules does not fail on it.
  const payNowDisabled = payNowBlocked !== null && values.payment_mode !== "pay_now";

  function chooseMode(next: PaymentMode) {
    setMode(next);
    // The office step works only with "Register now, pay later".
    if (next === "pay_now" && seat === "office") setSeat("automatic");
  }

  return (
    <ActionForm action={action} submitLabel="Save rules" pendingLabel="Saving rules…" buttonsClassName="mt-3">
      <div className="flex flex-col gap-4">
        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-[13px] font-bold">How families pay</legend>
          <label className="flex min-h-10 cursor-pointer items-start gap-3 py-1.5">
            <input
              type="radio"
              name="payment_mode"
              value="pledge"
              checked={mode === "pledge"}
              onChange={() => chooseMode("pledge")}
              className="mt-0.5 h-5 w-5 shrink-0 accent-navy"
            />
            <span>
              <span className="text-[13px] font-bold text-ink">{PAYMENT_MODE_LABEL.pledge}</span>
              <span className="block text-xs text-muted">{paymentModeSentence("pledge", values)}</span>
            </span>
          </label>
          <label className={`flex min-h-10 items-start gap-3 py-1.5 ${payNowDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="radio"
              name="payment_mode"
              value="pay_now"
              checked={mode === "pay_now"}
              disabled={payNowDisabled}
              onChange={() => chooseMode("pay_now")}
              aria-describedby={payNowBlocked ? "pay-now-blocked" : undefined}
              className="mt-0.5 h-5 w-5 shrink-0 accent-navy"
            />
            <span>
              <span className={`text-[13px] font-bold ${payNowDisabled ? "text-muted" : "text-ink"}`}>{PAYMENT_MODE_LABEL.pay_now}</span>
              <span className="block text-xs text-muted">{paymentModeSentence("pay_now", values)}</span>
              {payNowBlocked ? (
                <span id="pay-now-blocked" className="mt-1 block text-xs font-bold text-brown">
                  {values.payment_mode === "pay_now" ? "This term is set to it, but it cannot be used yet: " : "Cannot be chosen yet: "}
                  {payNowBlocked}
                </span>
              ) : null}
            </span>
          </label>
          {mode === "pay_now" ? (
            <div className="mt-2 grid grid-cols-1 gap-3 border-t border-line-soft pt-3 sm:grid-cols-2">
              <label className="block">
                <span className="crm-label">Seat held for payment (hours)</span>
                <input name="hold_hours" inputMode="numeric" defaultValue={values.hold_hours} className="crm-input w-28" />
                <span className="crm-hint block">
                  {HOLD_HOURS.min} to {HOLD_HOURS.max}; {HOLD_HOURS.default} is usual. A reminder goes 6 hours before; a seat is never released while its
                  payment page is still open.
                </span>
              </label>
              <div>
                <span className="crm-label">Pay at the office</span>
                <Toggle
                  name="office_payment_allowed"
                  checked={office}
                  onChange={setOffice}
                  label="Pay at the office"
                  onNote="Allowed: Zelle, check or cash, recorded by the treasurer"
                  offNote="Online only"
                />
                {office ? (
                  <label className="mt-2 block">
                    <span className="crm-label">Seat held for an office payment (days)</span>
                    <input name="office_hold_days" inputMode="numeric" defaultValue={values.office_hold_days} className="crm-input w-28" />
                    <span className="crm-hint block">
                      {OFFICE_HOLD_DAYS.min} to {OFFICE_HOLD_DAYS.max}. A Zelle “I sent it” report keeps the seat held, but only the treasurer&apos;s
                      match counts as paid.
                    </span>
                  </label>
                ) : (
                  <input type="hidden" name="office_hold_days" value={values.office_hold_days} />
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Kept as they are while families register now and pay later. */}
              <input type="hidden" name="hold_hours" value={values.hold_hours} />
              <input type="hidden" name="office_payment_allowed" value={values.office_payment_allowed ? "true" : "false"} />
              <input type="hidden" name="office_hold_days" value={values.office_hold_days} />
            </>
          )}
        </fieldset>

        <fieldset className="rounded-xl border border-line p-3">
          <legend className="px-1 text-[13px] font-bold">Seats</legend>
          {(["automatic", "office"] as const).map((rule) => {
            const disabled = rule === "office" && mode === "pay_now";
            return (
              <label key={rule} className={`flex min-h-10 items-start gap-3 py-1.5 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
                <input
                  type="radio"
                  name="seat_rule"
                  value={rule}
                  checked={seat === rule}
                  disabled={disabled}
                  onChange={() => setSeat(rule)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-navy"
                />
                <span>
                  <span className={`text-[13px] font-bold ${disabled ? "text-muted" : "text-ink"}`}>{SEAT_RULE_LABEL[rule]}</span>
                  <span className="block text-xs text-muted">{SEAT_RULE_HINT[rule]}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="crm-label">Sibling discount (%)</span>
            <input name="sibling_discount_pct" inputMode="numeric" defaultValue={values.sibling_discount_pct} className="crm-input w-28" />
            <span className="crm-hint block">
              Among children only: the first child pays the full fee, every other child gets this much off each of their levels. Adult learners never get it.
            </span>
          </label>
          <label className="block">
            <span className="crm-label">Family cap ($)</span>
            <input name="fee_per_family_cap" inputMode="decimal" defaultValue={money(values.fee_per_family_cap_cents)} placeholder="No cap" className="crm-input w-32" />
            <span className="crm-hint block">
              The most a family pays for its children, after the sibling discount: at least $0.50, or blank for no cap. Adult learners are outside it.
            </span>
          </label>
          <label className="block">
            <span className="crm-label">Late registration until</span>
            <input type="datetime-local" name="late_registration_closes_at" defaultValue={values.late_registration_closes_local} className="crm-input" />
            <span className="crm-hint block">
              {registrationClosesLabel ? `Registration closes ${registrationClosesLabel} (the term's form). ` : "Registration has no closing date yet (the term's form). "}
              Blank for no late window; after it only the office registers.
            </span>
          </label>
          <label className="block">
            <span className="crm-label">Late fee per learner ($)</span>
            <input name="late_fee" inputMode="decimal" defaultValue={money(values.late_fee_cents)} placeholder="0" className="crm-input w-32" />
            <span className="crm-hint block">
              $0, or at least $0.50. Added once to each learner registered after registration closes (families in the late window, the office after it),
              adults included, outside the discount and the cap.
            </span>
          </label>
          <label className="block">
            <span className="crm-label">Withdrawal deadline</span>
            <input type="date" name="withdrawal_credit_until" defaultValue={values.withdrawal_credit_until ?? ""} className="crm-input" />
            <span className="crm-hint block">
              Withdraw by this date and the fee pledge is cancelled; anything paid becomes credit for the treasurer. After it the fee stays due. Blank: 14
              days after the first class day.
            </span>
          </label>
          <label className="block">
            <span className="crm-label">Age cut-off date</span>
            <input type="date" name="age_cutoff_on" defaultValue={values.age_cutoff_on ?? ""} className="crm-input" />
            <span className="crm-hint block">
              Ages are measured on this date: under 18 counts as a child. Blank: the first day of term ({startsOnLabel}).
            </span>
          </label>
        </div>

        {givingOn ? (
          !funds ? (
            <p className="text-[13px] text-brown">The funds could not be read, so the fund for the fee pledges cannot be shown or changed here right now. Reload to try again.</p>
          ) : canChooseFund ? (
            <label className="block max-w-xl">
              <span className="crm-label">Fund for the fee pledges</span>
              <select name="fund_id" defaultValue={values.fund_id ?? ""} className="crm-input">
                <option value="">Found when registration opens (the Pathshala fund)</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <span className="crm-hint block">
                Opening registration links the fees to the community&apos;s Pathshala fund. Pick one only when the community has no fund called Pathshala.
              </span>
            </label>
          ) : (
            <div className="max-w-xl text-[13px]">
              <span className="crm-label">Fund for the fee pledges</span>
              <p>{values.fund_id ? (funds.find((f) => f.id === values.fund_id)?.name ?? "A fund chosen by the treasurer") : "Found when registration opens (the Pathshala fund)"}</p>
              <p className="crm-hint">The treasurer (giving.manage) chooses the fund.</p>
            </div>
          )
        ) : null}

        {needsReason ? (
          <label className="block max-w-xl">
            <span className="crm-label">Why the rules change</span>
            <input name="reason" required maxLength={300} className="crm-input" placeholder="For example: the committee extended late registration by a week" />
            <span className="crm-hint block">Required after registration opens. A change applies to new registrations only.</span>
          </label>
        ) : null}
      </div>
    </ActionForm>
  );
}

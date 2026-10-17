"use client";

import { useId, useState, useTransition } from "react";

import { saveThanksSettingsAction } from "@/app/(app)/care/thanks/actions";
import { buttonClass } from "@/components/ui";
import type { ThanksSettings } from "@/lib/care/thanks";

// The thank-you rules form (DonorDelight slice 3). The amount is typed in dollars (or the community's money) and sent as whole cents.
// Saving says what happened in words next to the button; a refusal keeps what was typed.

function toCents(text: string): number | null | "bad" {
  const t = text.trim().replace(/[$,\s]/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "bad";
  const cents = Math.round(Number(t) * 100);
  return cents > 0 ? cents : "bad";
}

export function ThanksSettingsForm({ initial, currencySymbol }: { initial: ThanksSettings; currencySymbol: string }) {
  const [windowDays, setWindowDays] = useState(String(initial.thankWindowDays));
  const [firstGift, setFirstGift] = useState(initial.firstGiftPersonal);
  const [amount, setAmount] = useState(initial.personalFromCents === null ? "" : (initial.personalFromCents / 100).toFixed(2));
  const [fees, setFees] = useState(initial.countFees);
  const [last30, setLast30] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { days: useId(), amount: useId() };

  function save() {
    setMessage(null);
    const days = Number(windowDays);
    const cents = toCents(amount);
    if (!Number.isInteger(days) || days < 1 || days > 30) return setMessage({ ok: false, text: "Could not save the rules — thank a gift within 1 to 30 days." });
    if (cents === "bad") return setMessage({ ok: false, text: "Could not save the rules — the amount is a number more than zero, or empty." });
    start(async () => {
      const r = await saveThanksSettingsAction({ thankWindowDays: days, firstGiftPersonal: firstGift, personalFromCents: cents, countFees: fees, includeLast30: !initial.saved && last30 });
      setMessage(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (initial.canManage) save();
      }}
      className="flex max-w-[640px] flex-col gap-4"
    >
      <div>
        <label htmlFor={ids.days} className="crm-label">
          Thank a gift within (days)
        </label>
        <input id={ids.days} type="number" min={1} max={30} value={windowDays} onChange={(e) => setWindowDays(e.target.value)} disabled={!initial.canManage} className="crm-input w-28" />
        <p className="m-0 mt-1 text-[12.5px] text-muted">Each gift opens a thank-you due this many days after it. It closes when the receipt is sent or a thank-you is recorded.</p>
      </div>
      <label className="flex items-start gap-2.5 text-[14px]">
        <input type="checkbox" checked={firstGift} onChange={(e) => setFirstGift(e.target.checked)} disabled={!initial.canManage} className="mt-1 h-5 w-5" />
        <span>
          <span className="font-semibold">A household&apos;s first gift needs a personal thank-you</span>
          <span className="block text-[12.5px] text-muted">A call, a visit, a card or a video, not only the receipt.</span>
        </span>
      </label>
      <div>
        <label htmlFor={ids.amount} className="crm-label">
          A gift of this much or more needs a personal thank-you ({currencySymbol})
        </label>
        <input id={ids.amount} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!initial.canManage} placeholder="No amount" className="crm-input w-40" />
        <p className="m-0 mt-1 text-[12.5px] text-muted">Leave it empty if no amount does.</p>
      </div>
      <label className="flex items-start gap-2.5 text-[14px]">
        <input type="checkbox" checked={fees} onChange={(e) => setFees(e.target.checked)} disabled={!initial.canManage} className="mt-1 h-5 w-5" />
        <span>
          <span className="font-semibold">Thank memberships, school and class fees and store sales too</span>
          <span className="block text-[12.5px] text-muted">Off: only donations open a thank-you.</span>
        </span>
      </label>
      {initial.saved ? (
        <p className="m-0 text-[13px] text-muted">Thank-yous began on {initial.thanksFrom ?? "the day the rules were first saved"}.</p>
      ) : (
        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="checkbox" checked={last30} onChange={(e) => setLast30(e.target.checked)} disabled={!initial.canManage} className="mt-1 h-5 w-5" />
          <span>
            <span className="font-semibold">Include the last 30 days</span>
            <span className="block text-[12.5px] text-muted">Off: thank-yous begin today. On: gifts from the last 30 days open one too.</span>
          </span>
        </label>
      )}
      {initial.canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary")}>
            {pending ? "Saving…" : "Save the rules"}
          </button>
          {message ? (
            <p role={message.ok ? "status" : "alert"} className={`m-0 text-[13.5px] ${message.ok ? "text-success" : "text-danger"}`}>
              {message.text}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">Someone who manages this area can change the rules.</p>
      )}
    </form>
  );
}

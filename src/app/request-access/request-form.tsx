"use client";

import { useActionState } from "react";

import { OnboardingError, OnboardingNotice, onboardingInputClass } from "@/components/onboarding-split";
import { buttonClass } from "@/components/ui";
import { MODULES } from "@/lib/modules";
import { CURRENT_SYSTEMS, HONEYPOT_FIELD, ORG_TYPES } from "@/lib/platform-onboarding";

import { submitAccessRequestAction } from "./actions";

const label = "flex flex-col gap-1.5 text-[13px] text-muted";

export function RequestForm() {
  const [state, action, pending] = useActionState(submitAccessRequestAction, null);
  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4" data-testid="request-sent">
        <h2 className="font-display text-[28px] font-semibold text-ink">Request sent</h2>
        <OnboardingNotice text={state.message} />
        <p className="text-[13px] text-muted">
          If we approve it, the email includes a single-use sandbox code and a link to start setting up. You can close this page.
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h2 className="font-display text-[28px] font-semibold text-ink">Request access</h2>
      <fieldset className="flex flex-col gap-3">
        <legend className="crm-label mb-1">Your organization</legend>
        <label className={label}>
          Legal name
          <input name="org_legal_name" required maxLength={200} autoComplete="organization" className={onboardingInputClass} />
        </label>
        <div className={label}>
          <span>Kind of organization</span>
          <div className="flex flex-wrap gap-3 text-[14px] text-ink">
            {ORG_TYPES.map((t, i) => (
              <label key={t.value} className="flex items-center gap-2">
                <input type="radio" name="org_type" value={t.value} defaultChecked={i === 0} /> {t.label}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_160px]">
          <label className={label}>
            City
            <input name="city" required maxLength={100} autoComplete="address-level2" className={onboardingInputClass} />
          </label>
          <label className={label}>
            State
            <input name="state" required maxLength={60} autoComplete="address-level1" className={onboardingInputClass} />
          </label>
          <label className={label}>
            About how many households
            <input name="approx_households" inputMode="numeric" maxLength={9} className={onboardingInputClass} />
          </label>
        </div>
        <label className={label}>
          Website (optional)
          <input name="website" type="url" maxLength={300} placeholder="https://" className={onboardingInputClass} />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="crm-label mb-1">You</legend>
        <label className={label}>
          Your name
          <input name="contact_name" required maxLength={120} autoComplete="name" className={onboardingInputClass} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}>
            Email
            <input name="contact_email" type="email" required autoComplete="email" className={onboardingInputClass} />
          </label>
          <label className={label}>
            Mobile
            <input name="contact_phone" type="tel" autoComplete="tel" placeholder="(713) 555-0142" className={onboardingInputClass} />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="crm-label mb-1">What you would use</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[14px] text-ink sm:grid-cols-2">
          {MODULES.map((m) => (
            <label key={m.key} className="flex items-center gap-2">
              <input type="checkbox" name="modules_interested" value={m.key} defaultChecked={m.core} /> {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="crm-label mb-1">What you use today</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[14px] text-ink">
          {CURRENT_SYSTEMS.map((sys) => (
            <label key={sys} className="flex items-center gap-2">
              <input type="checkbox" name="current_systems" value={sys} /> {sys}
            </label>
          ))}
        </div>
        <label className={label}>
          Anything else (separate with commas)
          <input name="other_systems" maxLength={300} className={onboardingInputClass} />
        </label>
      </fieldset>

      <label className={label}>
        How did you hear about Community Connect? (optional)
        <input name="heard_from" maxLength={300} className={onboardingInputClass} />
      </label>

      {/* Spam trap: hidden from people and screen readers; bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Company fax
          <input name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <OnboardingError text={state && !state.ok ? state.error : null} />
      <button type="submit" disabled={pending} className={`${buttonClass("primary", "lg")} w-full`}>
        {pending ? "Sending…" : "Send request"}
      </button>
      <p className="text-xs text-muted">
        We use these details only to review your request and contact you. Requests are limited per connection and email to keep out spam.
      </p>
    </form>
  );
}

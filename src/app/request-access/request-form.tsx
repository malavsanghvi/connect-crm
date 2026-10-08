"use client";

import { useActionState, useState } from "react";

import { OnboardingError, OnboardingNotice, onboardingInputClass } from "@/components/onboarding-split";
import { buttonClass } from "@/components/ui";
import { NEEDS, type OrgGroup } from "@/lib/org-choices";
import { CURRENT_SYSTEMS, HONEYPOT_FIELD } from "@/lib/platform-onboarding";

import { submitAccessRequestAction, type RequestFormValues, type RequestResult } from "./actions";

const label = "flex flex-col gap-1.5 text-[13px] text-muted";

function text(v: RequestFormValues | undefined, key: string): string {
  const x = v?.[key];
  return typeof x === "string" ? x : "";
}
function list(v: RequestFormValues | undefined, key: string): string[] {
  const x = v?.[key];
  return Array.isArray(x) ? x : [];
}

/** A group's choices under their family headings, when they come from more than one family. */
function choiceSections(group: OrgGroup): { heading: string | null; choices: OrgGroup["choices"] }[] {
  const out: { heading: string | null; choices: OrgGroup["choices"] }[] = [];
  for (const c of group.choices) {
    const last = out[out.length - 1];
    if (last && last.heading === c.family) last.choices.push(c);
    else out.push({ heading: c.family, choices: [c] });
  }
  return out;
}

export function RequestForm({ groups }: { groups: OrgGroup[] }) {
  const [state, action, pending] = useActionState<RequestResult | null, FormData>(submitAccessRequestAction, null);
  // What was typed comes back with an error, because React clears a form once its action has run.
  const kept = state && !state.ok ? state.values : undefined;
  const [groupKey, setGroupKey] = useState<string>(() => text(kept, "org_type"));
  const group = groups.find((g) => g.key === groupKey) ?? null;
  const keptGroup = group && text(kept, "org_type") === group.key;

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
  const needsKept = kept ? list(kept, "needs") : null;
  const systemsKept = list(kept, "current_systems");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <h2 className="font-display text-[28px] font-semibold text-ink">Request access</h2>
      <fieldset className="flex flex-col gap-3">
        <legend className="crm-label mb-1">Your organization</legend>
        <label className={label}>
          Legal name
          <input name="org_legal_name" required maxLength={200} autoComplete="organization" defaultValue={text(kept, "org_legal_name")} className={onboardingInputClass} />
        </label>

        <div className={label} role="radiogroup" aria-labelledby="kind-legend">
          <span id="kind-legend">What kind of organization are you?</span>
          <div className="flex flex-col gap-1.5 text-[14px] text-ink" data-testid="org-kinds">
            {groups.map((g) => (
              <label key={g.key} className="flex items-center gap-2">
                <input type="radio" name="org_type" value={g.key} defaultChecked={groupKey === g.key} onChange={() => setGroupKey(g.key)} /> {g.label}
              </label>
            ))}
          </div>
        </div>

        {group && group.choices.length > 1 ? (
          <label className={label}>
            {group.choicesLabel || "Which best describes you?"}
            <select name="experience" key={group.key} defaultValue={keptGroup ? text(kept, "experience") : ""} className={onboardingInputClass}>
              <option value="">Choose one…</option>
              {choiceSections(group).map((section) =>
                section.heading ? (
                  <optgroup key={section.heading} label={section.heading}>
                    {section.choices.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  section.choices.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))
                ),
              )}
            </select>
          </label>
        ) : null}

        {group ? (
          <label className={label}>
            {group.detailLabel}
            <input
              name="org_detail"
              key={group.key}
              maxLength={500}
              placeholder={group.detailPlaceholder || undefined}
              defaultValue={keptGroup ? text(kept, "org_detail") : ""}
              className={onboardingInputClass}
            />
          </label>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_160px]">
          <label className={label}>
            City
            <input name="city" required maxLength={100} autoComplete="address-level2" defaultValue={text(kept, "city")} className={onboardingInputClass} />
          </label>
          <label className={label}>
            State
            <input name="state" required maxLength={60} autoComplete="address-level1" defaultValue={text(kept, "state")} className={onboardingInputClass} />
          </label>
          <label className={label}>
            About how many households
            <input name="approx_households" inputMode="numeric" maxLength={9} defaultValue={text(kept, "approx_households")} className={onboardingInputClass} />
          </label>
        </div>
        <label className={label}>
          Website (optional)
          <input name="website" type="url" maxLength={300} placeholder="https://" defaultValue={text(kept, "website")} className={onboardingInputClass} />
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="crm-label mb-1">You</legend>
        <label className={label}>
          Your name
          <input name="contact_name" required maxLength={120} autoComplete="name" defaultValue={text(kept, "contact_name")} className={onboardingInputClass} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}>
            Email
            <input name="contact_email" type="email" required autoComplete="email" defaultValue={text(kept, "contact_email")} className={onboardingInputClass} />
          </label>
          <label className={label}>
            Mobile
            <input name="contact_phone" type="tel" autoComplete="tel" placeholder="(212) 555-0123" defaultValue={text(kept, "contact_phone")} className={onboardingInputClass} />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="crm-label mb-1">What do you want to use Weaver for?</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[14px] text-ink sm:grid-cols-2">
          {NEEDS.map((n) => (
            <label key={n.key} className="flex items-center gap-2">
              <input type="checkbox" name="needs" value={n.key} defaultChecked={needsKept ? needsKept.includes(n.key) : n.key === "members"} /> {n.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="crm-label mb-1">What you use today</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[14px] text-ink">
          {CURRENT_SYSTEMS.map((sys) => (
            <label key={sys} className="flex items-center gap-2">
              <input type="checkbox" name="current_systems" value={sys} defaultChecked={systemsKept.includes(sys)} /> {sys}
            </label>
          ))}
        </div>
        <label className={label}>
          Anything else (separate with commas)
          <input name="other_systems" maxLength={300} defaultValue={text(kept, "other_systems")} className={onboardingInputClass} />
        </label>
      </fieldset>

      <label className={label}>
        How did you hear about Weaver? (optional)
        <input name="heard_from" maxLength={300} defaultValue={text(kept, "heard_from")} className={onboardingInputClass} />
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

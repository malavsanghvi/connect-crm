"use client";

import { useActionState } from "react";

import { buttonClass } from "@/components/ui";
import type { DemoPerson } from "@/lib/demo-signin/rules";
import type { ActionResult } from "@/lib/errors";

import { startDemoAction } from "./actions";

/** One demo person: their role, who they are in a sentence, and Start. A failure is shown right here, under the button that was pressed. */
export function PersonaCard({ person }: { person: DemoPerson }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(startDemoAction, null);
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4 shadow-sm" data-testid="demo-person">
      <p className="text-[12px] font-bold uppercase tracking-wide text-navy">{person.role}</p>
      <p className="font-display text-[18px] font-semibold leading-snug text-ink">{person.name}</p>
      <p className="flex-1 text-[14px] leading-relaxed text-muted">{person.story}</p>
      <form action={action} className="mt-1 flex flex-col gap-2">
        <input type="hidden" name="persona" value={person.id} />
        <button type="submit" disabled={pending} className={`${buttonClass("primary")} w-full`} aria-label={`Start the demo as ${person.name}, ${person.role}`}>
          {pending ? "Starting…" : "Start"}
        </button>
        {state && !state.ok ? (
          <p role="alert" className="rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </p>
        ) : null}
      </form>
    </li>
  );
}

/**
 * One demo person whose work lives in the member app (a community role, owner decision 2026-10-15): the same card, but its control is a
 * plain link to the member app's demo for exactly this person (`href`, built by memberAppDemoPersonUrl on the server). It opens in this
 * tab and starts nothing here: no portal session, no Server Action, and the visitor's portal sign-in is left alone. The member app
 * starts the demo (POST /api/demo/session) and lands on the signed-in Home.
 */
export function MemberAppPersonaCard({ person, href }: { person: DemoPerson; href: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl border-2 border-navy/40 bg-white p-4 shadow-sm" data-testid="demo-person" data-opens="member-app">
      <p className="w-fit rounded-tag bg-navy-50 px-2 py-0.5 text-[12px] font-bold text-navy" data-testid="demo-quick-path">
        Quickest way in: opens the member app
      </p>
      <p className="text-[12px] font-bold uppercase tracking-wide text-navy">{person.role}</p>
      <p className="font-display text-[18px] font-semibold leading-snug text-ink">{person.name}</p>
      <p className="flex-1 text-[14px] leading-relaxed text-muted">{person.story}</p>
      <div className="mt-1 flex flex-col gap-2">
        <a href={href} className={`${buttonClass("primary")} w-full`} aria-label={`Open the member app as ${person.name}, ${person.role}`} data-testid="demo-open-member-app">
          Open the member app
        </a>
        <p className="text-[12.5px] leading-snug text-muted">Opens in this tab and lands on their Home, already signed in. Nothing to install; your sign-in here is not touched.</p>
      </div>
    </li>
  );
}

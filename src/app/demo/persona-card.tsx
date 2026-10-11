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
          <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {state.error}
          </p>
        ) : null}
      </form>
    </li>
  );
}

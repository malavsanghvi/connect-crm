"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { countersProblem } from "@/lib/giving";

import { createCountingSessionAction } from "./counting-actions";

export type CounterOption = { userId: string; name: string; householdId: string | null; household: string | null };

/** New bhandar counting session: date, two (or three) counters from different households, bags, total. */
export function CountingForm({ counters, today }: { counters: CounterOption[]; today: string }) {
  const [picked, setPicked] = useState<string[]>(["", "", ""]);
  const chosen = picked.filter(Boolean).map((id) => counters.find((c) => c.userId === id)).filter((c): c is CounterOption => !!c);
  const problem = chosen.length >= 2 ? countersProblem(chosen) : null;

  return (
    <ActionForm action={createCountingSessionAction} submitLabel="Save counting session" pendingLabel="Saving…" size="sm" resetOnSuccess>
      <div className="mb-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label htmlFor="cs-date" className="crm-label">
            Counting date
          </label>
          <input id="cs-date" name="counted_on" type="date" defaultValue={today} required className="crm-input" />
        </div>
        <div>
          <label htmlFor="cs-bags" className="crm-label">
            Sealed bag numbers
          </label>
          <input id="cs-bags" name="bags" placeholder="e.g. 1041, 1042" className="crm-input" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <label htmlFor={`cs-c${i}`} className="crm-label">
              {i < 2 ? `Counter ${i + 1}` : "Counter 3 (optional)"}
            </label>
            <select
              id={`cs-c${i}`}
              name="counter"
              value={picked[i]}
              onChange={(e) => setPicked((cur) => cur.map((v, j) => (j === i ? e.target.value : v)))}
              required={i < 2}
              className="crm-input"
            >
              <option value="">Choose a person…</option>
              {counters.map((c) => (
                <option key={c.userId} value={c.userId} disabled={picked.includes(c.userId) && picked[i] !== c.userId}>
                  {c.name}
                  {c.household ? ` · ${c.household}` : " · no household"}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div>
          <label htmlFor="cs-total" className="crm-label">
            Counted total ($, blank if not counted yet)
          </label>
          <input id="cs-total" name="total" inputMode="decimal" className="crm-input" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="cs-notes" className="crm-label">
            Notes (optional)
          </label>
          <input id="cs-notes" name="notes" maxLength={1000} className="crm-input" />
        </div>
      </div>
      {problem ? (
        <p role="alert" className="mb-2 text-[13px] font-semibold text-danger">
          {problem}
        </p>
      ) : null}
    </ActionForm>
  );
}

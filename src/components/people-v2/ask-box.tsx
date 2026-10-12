"use client";

import Link from "next/link";
import { useId } from "react";

import { useNiva } from "@/components/niva/niva-context";
import { buttonClass } from "@/components/ui";
import type { AskModel } from "@/lib/people-v2/model";

import { FindBox } from "./find/find-box";
import { SparkIcon } from "./icons";

const CHIP = "inline-flex min-h-9 items-center gap-2 rounded-[18px] border px-3 text-[13px] font-bold";

/**
 * The filters of a list. The box that takes the words is the find box (the top bar, or the People home): a sentence it reads by rules
 * as filters opens this list with the filters shown here as chips the person can remove, or change with "Add a filter". This
 * component no longer has an input of its own; on a phone, where the top bar has no box, the find box sits at the top of it.
 * With Niva on (and a model key) the person can also send the sentence to Niva's panel as typed.
 */
export function PeopleAskBox({ ask }: { ask: AskModel }) {
  const niva = useNiva();
  const nivaOn = !!niva?.enabled;
  const canAsk = !!niva?.enabled && !!niva.aiReady;

  return (
    <section aria-label="Filters" className="flex flex-col gap-3 rounded-[18px] border border-line bg-white px-4 py-3.5">
      <div className="md:hidden">
        <FindBox variant="bar" cookieName={ask.cookieName} />
      </div>
      {ask.said ? (
        <p className="m-0 text-[14px] text-ink-2">
          You asked: <strong className="font-semibold text-ink">“{ask.said}”</strong>
        </p>
      ) : (
        <p className="m-0 hidden text-[14px] text-muted md:block">Type a name, a number or a question in the box at the top of the page.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-muted">{nivaOn ? "Niva read this as" : "Read as"}</span>
        {ask.chips.map((c) => (
          <Link key={c.key} href={c.removeHref} scroll={false} aria-label={`Remove the filter: ${c.label}`} title="Remove this filter" className={`${CHIP} border-navy-300 bg-navy-50 text-[#164690] no-underline hover:border-navy`}>
            {c.label}
            <span aria-hidden="true">×</span>
          </Link>
        ))}
        {ask.chips.length === 0 ? (
          <span className="text-[13px] text-muted">
            {ask.unread
              ? "Nothing in that could be read as a filter or a search. Try a name, any ID, or a sentence like the example."
              : "No filters yet. Type a sentence, a name, or any ID: a member or household number, your own IDs, an old system or QuickBooks ID, a bank payer name."}
          </span>
        ) : null}
        <AddFilter ask={ask} />
        {canAsk && ask.said && ask.unread ? (
          <button type="button" onClick={() => niva?.ask(ask.said)} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-[18px] px-3 text-[13px] font-bold text-[var(--v2-sun-ink)] hover:bg-[var(--v2-sun-tint)]">
            <SparkIcon size={14} />
            Ask Niva instead
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** "+ Add a filter": the same filters as a small form, so every chip can be set and changed by hand. */
function AddFilter({ ask }: { ask: AskModel }) {
  const id = useId();
  const f = ask.filters;
  const field = "crm-input w-full";
  return (
    <details className="relative">
      <summary className={`${CHIP} cursor-pointer list-none border-dashed border-[#9FB0C6] font-semibold text-muted [&::-webkit-details-marker]:hidden`}>+ Add a filter</summary>
      <form method="get" action={ask.action} className="absolute left-0 z-30 mt-2 grid w-[min(88vw,360px)] gap-3 rounded-2xl border border-line bg-white p-4 text-[13px] shadow-lg">
        {Object.entries(ask.keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <div>
          <label htmlFor={`${id}-zone`} className="crm-label">
            Area
          </label>
          <select id={`${id}-zone`} name="zone" defaultValue={f.zone ?? ""} className={field}>
            <option value="">Any area</option>
            {ask.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-tier`} className="crm-label">
            Membership
          </label>
          <select id={`${id}-tier`} name="tier" defaultValue={f.tier ?? ""} className={field}>
            <option value="">Any membership</option>
            {ask.tiers.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-over`} className="crm-label">
            Open balance over
          </label>
          <input id={`${id}-over`} name="over_amount" inputMode="decimal" defaultValue={f.overCents === null ? "" : (f.overCents / 100).toFixed(2)} className={field} />
        </div>
        <div>
          <label htmlFor={`${id}-rsvp`} className="crm-label">
            No RSVP in
          </label>
          <select id={`${id}-rsvp`} name="norsvp" defaultValue={f.noRsvpYear === null ? "" : String(f.noRsvpYear)} className={field}>
            <option value="">Any</option>
            {[ask.year, ask.year - 1].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-ending`} className="crm-label">
            Membership ends within
          </label>
          <select id={`${id}-ending`} name="ending" defaultValue={f.endingDays === null ? "" : String(f.endingDays)} className={field}>
            <option value="">Any time</option>
            {[30, 60, 90].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
            {f.endingDays !== null && ![30, 60, 90].includes(f.endingDays) ? <option value={f.endingDays}>{f.endingDays} days</option> : null}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-q`} className="crm-label">
            Name or any ID
          </label>
          <input id={`${id}-q`} name="q" defaultValue={f.q ?? ""} className={field} />
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Apply filters
        </button>
      </form>
    </details>
  );
}

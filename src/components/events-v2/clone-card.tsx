"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";

import { draftCloneAction } from "@/app/(app)/events/[id]/workspace-actions";
import { useNiva } from "@/components/niva/niva-context";
import { buttonClass } from "@/components/ui";
import { browserFetch, runCommand } from "@/lib/assistant/client";
import type { CloneView } from "@/lib/commands/catalog/events/clone";

const input = "min-h-[40px] w-full rounded-[10px] border border-line-input bg-white px-2.5 text-[13px] text-ink";

/**
 * "Copy this event to a new date" (events.clone_draft): what next year's edition would look like, and what is not copied. A
 * preparation only: nothing is saved. Saving it is events.create_from_clone, a card to confirm in Niva's panel when the community
 * switched it on; otherwise the builder is where a new event starts.
 */
export function CloneCard({
  eventId,
  communityName,
  defaultDate,
  cannot,
  createOn,
  newEventHref,
}: {
  eventId: string;
  communityName: string;
  defaultDate: string;
  cannot: string | null;
  createOn: boolean;
  newEventHref: string;
}) {
  const niva = useNiva();
  const titleId = useId();
  const dateId = useId();
  const nameId = useId();
  const [date, setDate] = useState(defaultDate);
  const [name, setName] = useState("");
  const [copy, setCopy] = useState<CloneView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [handed, setHanded] = useState(false);
  const [pending, start] = useTransition();
  const canPropose = createOn && !!niva && niva.enabled;

  function prepare(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    setHanded(false);
    start(async () => {
      const res = await draftCloneAction(eventId, date, name);
      if (res.ok && res.data) setCopy(res.data);
      else {
        setCopy(null);
        setProblem(res.error ?? "Could not prepare the copy — try again.");
      }
    });
  }

  function propose() {
    if (!copy || !niva) return;
    setProblem(null);
    start(async () => {
      const named = name.trim();
      const res = await runCommand(browserFetch, { key: "events.create_from_clone", input: { source_event_id: eventId, new_date: date, ...(named ? { name: named } : {}) } });
      if (!res.ok) setProblem(res.error);
      else if (res.kind === "proposal") {
        niva.showProposal({ asked: `Save ${copy.prepared.name} as a draft`, proposal: res.proposal });
        setHanded(true);
      } else setProblem("Could not get the copy ready to confirm — Niva answered without a card to confirm. Nothing was saved.");
    });
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-[16px] border border-line bg-white px-4 py-3.5">
      <h3 id={titleId} className="m-0 text-[15px] font-bold text-ink">
        Copy this event to a new date
      </h3>
      {cannot ? (
        <p className="m-0 text-[13px] text-ink-2">{cannot}</p>
      ) : (
        <>
          <form onSubmit={prepare} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={dateId} className="text-[12px] font-semibold text-ink-2">
                New date
              </label>
              <input id={dateId} type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={nameId} className="text-[12px] font-semibold text-ink-2">
                New name (optional)
              </label>
              <input id={nameId} value={name} onChange={(e) => setName(e.target.value)} placeholder="Keeps the name, year moved on" className={input} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={pending || !date} className={`${buttonClass("ghost", "sm")} disabled:cursor-not-allowed disabled:opacity-60`}>
                {pending && !copy ? "Working…" : "Prepare the copy"}
              </button>
            </div>
          </form>
          {problem ? (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {problem}
            </p>
          ) : null}
          {copy ? (
            <div role="status" className="flex flex-col gap-2 rounded-[12px] bg-ground px-3 py-2.5 text-[13px] text-ink">
              <p className="m-0 font-bold">
                {copy.prepared.name} <span className="font-normal text-muted">· Draft</span>
              </p>
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px]">
                <dt className="text-muted">Starts</dt>
                <dd className="m-0">{copy.prepared.starts}</dd>
                {copy.prepared.venue ? (
                  <>
                    <dt className="text-muted">Venue</dt>
                    <dd className="m-0">{copy.prepared.venue}</dd>
                  </>
                ) : null}
                <dt className="text-muted">Places</dt>
                <dd className="m-0">{copy.prepared.capacity}</dd>
                <dt className="text-muted">Who can RSVP</dt>
                <dd className="m-0">{copy.prepared.who_can_rsvp}</dd>
                {copy.prepared.prices ? (
                  <>
                    <dt className="text-muted">Prices</dt>
                    <dd className="m-0">{copy.prepared.prices}</dd>
                  </>
                ) : null}
              </dl>
              {copy.left_out.length > 0 ? <p className="m-0 text-[12px] text-ink-2">Not copied: {copy.left_out.join(", ")}.</p> : null}
              {copy.notes.map((n) => (
                <p key={n} className="m-0 text-[12px] text-ink-2">
                  {n}
                </p>
              ))}
              <p className="m-0 text-[12px] text-muted">This is only prepared. Nothing has been saved.</p>
              {canPropose ? (
                handed ? (
                  <p className="m-0 text-[12px] font-semibold text-success">The card to confirm is in Niva&apos;s panel. Nothing is saved until you press its button.</p>
                ) : (
                  <button type="button" onClick={propose} disabled={pending} className={`${buttonClass("primary", "sm")} self-start disabled:opacity-60`}>
                    {pending ? "Getting it ready…" : "Get it ready to save as a draft"}
                  </button>
                )
              ) : (
                <p className="m-0 text-[12px] leading-snug text-ink-2">
                  Niva is not set up to save copies for {communityName} yet.{" "}
                  <Link href={newEventHref} className="font-bold text-navy">
                    Start the new event in the builder
                  </Link>
                </p>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

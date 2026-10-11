"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";

import { draftEventChangeAction } from "@/app/(app)/events/[id]/workspace-actions";
import { useNiva } from "@/components/niva/niva-context";
import { Sparkle } from "@/components/niva/sparkle";
import { buttonClass } from "@/components/ui";
import { browserFetch, runCommand } from "@/lib/assistant/client";
import type { EventChange } from "@/lib/commands/catalog/events/change";
import { changeFieldOptions } from "@/lib/events/workspace";

const FIELDS = changeFieldOptions();
const input = "min-h-[40px] w-full rounded-[10px] border border-line-input bg-white px-2.5 text-[13px] text-ink";

/**
 * "Change one thing": say it in a sentence to Niva, or pick the detail and the new value. Either way the person first sees the
 * before and after (events.draft_change), and nothing changes. Making the change is events.set_field, a card to confirm in Niva's
 * panel, and only when the community switched it on; when it is off this says so and points to the builder.
 */
export function ChangeCard({
  eventId,
  eventName,
  communityName,
  cannot,
  setFieldOn,
  builderHref,
}: {
  eventId: string;
  eventName: string;
  communityName: string;
  /** Why this person cannot prepare a change (their role), or null. */
  cannot: string | null;
  setFieldOn: boolean;
  /** The builder for this event, when the person may edit it. */
  builderHref: string | null;
}) {
  const niva = useNiva();
  const titleId = useId();
  const sentenceId = useId();
  const fieldId = useId();
  const valueId = useId();
  const [sentence, setSentence] = useState("");
  const [field, setField] = useState(FIELDS[0].value);
  const [value, setValue] = useState("");
  const [change, setChange] = useState<EventChange | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [handed, setHanded] = useState(false);
  const [pending, start] = useTransition();
  const option = FIELDS.find((f) => f.value === field) ?? FIELDS[0];
  const canAsk = !!niva && niva.enabled && niva.aiReady;
  const canPropose = setFieldOn && !!niva && niva.enabled;

  function ask(e: FormEvent) {
    e.preventDefault();
    const said = sentence.trim();
    if (!said || !niva) return;
    niva.ask(`Change one thing about this event: ${said}. Show me the before and after first.`);
    setSentence("");
  }

  function preview(e: FormEvent) {
    e.preventDefault();
    setProblem(null);
    setHanded(false);
    start(async () => {
      const res = await draftEventChangeAction(eventId, field, value);
      if (res.ok && res.data) setChange(res.data);
      else {
        setChange(null);
        setProblem(res.error ?? "Could not show the change — try again.");
      }
    });
  }

  function propose() {
    if (!change || !niva) return;
    setProblem(null);
    start(async () => {
      const res = await runCommand(browserFetch, { key: "events.set_field", input: { event_id: eventId, field: change.field, value } });
      if (!res.ok) setProblem(res.error);
      else if (res.kind === "proposal") {
        niva.showProposal({ asked: `Change the ${change.label.toLowerCase()} of ${eventName}`, proposal: res.proposal });
        setHanded(true);
      } else setProblem("Could not get the change ready to confirm — Niva answered without a card to confirm. Nothing was changed.");
    });
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2.5 rounded-[16px] border border-line bg-white px-4 py-3.5">
      <h3 id={titleId} className="m-0 text-[15px] font-bold text-ink">
        Change one thing
      </h3>
      {cannot ? (
        <p className="m-0 text-[13px] text-ink-2">{cannot}</p>
      ) : (
        <>
          {canAsk ? (
            <form onSubmit={ask} className="flex flex-col gap-1">
              <label htmlFor={sentenceId} className="text-[12px] font-semibold text-ink-2">
                Say what to change
              </label>
              <div className="flex gap-2">
                <input id={sentenceId} value={sentence} onChange={(e) => setSentence(e.target.value)} placeholder="Move it to 6:30 pm" className={input} />
                <button type="submit" disabled={!sentence.trim()} className={`${buttonClass("ghost", "sm")} shrink-0 disabled:cursor-not-allowed disabled:opacity-60`}>
                  <span className="text-saffron">
                    <Sparkle />
                  </span>
                  Ask Niva
                </button>
              </div>
            </form>
          ) : null}
          <form onSubmit={preview} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="flex flex-col gap-1">
              <label htmlFor={fieldId} className="text-[12px] font-semibold text-ink-2">
                {canAsk ? "Or pick the detail" : "Detail"}
              </label>
              <select
                id={fieldId}
                value={field}
                onChange={(e) => {
                  setField(e.target.value as typeof field);
                  setValue("");
                  setChange(null);
                }}
                className={input}
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={valueId} className="text-[12px] font-semibold text-ink-2">
                New {option.label.toLowerCase()}
              </label>
              <input
                id={valueId}
                type={option.input}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setChange(null);
                }}
                className={input}
              />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={pending} className={`${buttonClass("ghost", "sm")} disabled:cursor-not-allowed disabled:opacity-60`}>
                {pending && !change ? "Working…" : "Show before and after"}
              </button>
            </div>
          </form>
          {problem ? (
            <p role="alert" className="m-0 text-[13px] text-danger">
              {problem}
            </p>
          ) : null}
          {change ? (
            <div role="status" className="flex flex-col gap-2 rounded-[12px] bg-ground px-3 py-2.5 text-[13px] text-ink">
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                <dt className="font-semibold text-muted">Before</dt>
                <dd className="m-0 break-words">{change.before}</dd>
                <dt className="font-semibold text-muted">After</dt>
                <dd className="m-0 break-words font-bold">{change.after}</dd>
              </dl>
              {change.warnings.map((w) => (
                <p key={w} className="m-0 text-[12px] text-ink-2">
                  {w}
                </p>
              ))}
              <p className="m-0 text-[12px] text-muted">{change.changed ? "Nothing has been changed yet." : `${eventName} already has that ${change.label.toLowerCase()}.`}</p>
              {change.changed ? (
                canPropose ? (
                  handed ? (
                    <p className="m-0 text-[12px] font-semibold text-success">The card to confirm is in Niva&apos;s panel. Nothing changes until you press its button.</p>
                  ) : (
                    <button type="button" onClick={propose} disabled={pending} className={`${buttonClass("primary", "sm")} self-start disabled:opacity-60`}>
                      {pending ? "Getting it ready…" : "Get it ready to confirm"}
                    </button>
                  )
                ) : (
                  <p className="m-0 text-[12px] leading-snug text-ink-2">
                    Niva is not set up to change events for {communityName} yet, so this only shows the before and after.{" "}
                    {builderHref ? (
                      <Link href={builderHref} className="font-bold text-navy">
                        Make the change in the builder
                      </Link>
                    ) : (
                      "Only event managers and this event's lead can make the change."
                    )}
                  </p>
                )
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { completeTaskAction, skipTaskAction } from "@/app/(app)/care/week/actions";
import { ThankActions } from "@/components/care/thank-actions";
import { CopyButton } from "@/components/copy-button";
import { StatusText, buttonClass } from "@/components/ui";
import { CHANNEL_LABEL, TOUCH_CHANNELS, householdLine } from "@/lib/care/model";
import { dueLine, type WeekTask } from "@/lib/care/week";

// One task of "Your 5 this week" (DonorDelight slice 5): why, a ready draft you send yourself (Weaver sends nothing), and one tap to say it is
// done. Done records the step's touch (never an ask). A thank-you of the tracker offers its own ways to thank. Setting aside needs a reason, which
// is kept. Every failure is said next to the buttons, in words, and what was typed stays.

export function WeekTaskCard({ task, draft, today }: { task: WeekTask; draft: string; today: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [channel, setChannel] = useState<string>(task.channel);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const ids = { channel: useId(), note: useId(), reason: useId() };
  const h = task.household;

  function done() {
    if (!task.runId || !task.stepId) return;
    setError(null);
    start(async () => {
      const r = await completeTaskAction({ runId: task.runId!, stepId: task.stepId!, channel: channel === task.channel ? null : channel, note });
      if (!r.ok) setError(r.error);
    });
  }
  function setAside() {
    if (!task.runId || !task.stepId) return;
    setError(null);
    start(async () => {
      const r = await skipTaskAction({ runId: task.runId!, stepId: task.stepId!, reason });
      if (!r.ok) setError(r.error);
    });
  }

  return (
    <article className="cc-card px-[18px] py-4" data-task={task.kind === "step" ? task.stepId : task.thankId}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="m-0 text-[16px] font-bold text-ink">{task.title}</h2>
        <StatusText tone={task.overdue ? "bad" : "ok"}>{dueLine(task.dueOn, today)}</StatusText>
      </div>
      <p className="m-0 mt-1 text-[13.5px]">
        <Link href={`/households/${h.id}`} className="crm-link font-semibold">
          {h.name}
        </Link>
        <span className="text-muted"> · {householdLine(h)}</span>
      </p>
      <p className="m-0 mt-2 text-[14px] text-ink-2">
        <span className="font-semibold">Why: </span>
        {task.why}
      </p>
      {draft ? (
        <div className="mt-3 rounded-field border border-line bg-ground px-3 py-2.5">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] font-bold uppercase tracking-wide text-muted">Draft — you send it, Weaver sends nothing</span>
            <CopyButton value={draft} label="Copy the draft" />
          </div>
          <p className="m-0 whitespace-pre-wrap text-[14px] leading-snug text-ink">{draft}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2">
        {task.kind === "thank" && task.thankId ? (
          <ThankActions stepId={task.thankId} householdId={h.id} needsPersonal={task.personal} />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={pending} onClick={done} className={buttonClass("primary", "sm")}>
                {pending && !asking ? "Saving…" : `Done · ${CHANNEL_LABEL[channel] ?? channel}`}
              </button>
              <button type="button" disabled={pending} onClick={() => setMore((m) => !m)} aria-expanded={more} className={buttonClass("plain", "xs")}>
                Add a note or change how
              </button>
              <button type="button" disabled={pending} onClick={() => setAsking((a) => !a)} aria-expanded={asking} className={buttonClass("plain", "xs")}>
                Set aside
              </button>
            </div>
            {more ? (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor={ids.channel} className="crm-label">
                    How you did it
                  </label>
                  <select id={ids.channel} value={channel} onChange={(e) => setChannel(e.target.value)} className="crm-input">
                    {TOUCH_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[220px] flex-1">
                  <label htmlFor={ids.note} className="crm-label">
                    Note (kept on the household&apos;s log)
                  </label>
                  <input id={ids.note} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} className="crm-input" placeholder="For example: left a message" />
                </div>
              </div>
            ) : null}
            {asking ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label htmlFor={ids.reason} className="crm-label">
                    Why is this set aside?
                  </label>
                  <input id={ids.reason} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="crm-input" placeholder="For example: they asked us not to call" />
                </div>
                <button type="button" disabled={pending || reason.trim() === ""} onClick={setAside} className={buttonClass("primary", "xs")}>
                  {pending ? "Saving…" : "Set aside"}
                </button>
              </div>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}

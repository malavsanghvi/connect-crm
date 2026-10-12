"use client";

import Link from "next/link";
import { useState } from "react";

import type { DraftReminderData } from "@/lib/commands/catalog/messages-draft-reminder";
import { defaultConfirmationHours } from "@/lib/events/rules";
import { lessonsFor, reminderSuggestion } from "@/lib/event-creator/smart";
import type { CreatorCtx, EventDraft } from "@/lib/event-creator/types";

import { ComingNext, ErrorNote, Field, LessonNotes, Note, Pill, SwitchRow, UseSuggestion, linkClass, sectionLabel, softButton, type CardProps } from "../parts";

/** The confirmation reminder (confirmation_hours_before): sent by Weaver after publishing, to the people who RSVP'd. */
export function ReminderFields({ draft, set, ctx }: { draft: EventDraft; set: (p: Partial<EventDraft>) => void; ctx: CreatorCtx }) {
  const s = reminderSuggestion(draft, ctx, defaultConfirmationHours(ctx.rules));
  return (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label="Ask people to confirm before the day"
        sub="Sent once the event is published, to the people who RSVP'd: push, SMS or WhatsApp for guests."
        checked={draft.reminder_enabled}
        onChange={(v) => set({ reminder_enabled: v })}
        onNote={`${draft.confirmation_hours_before || "24"} hours before`}
        offNote="Off"
      />
      {draft.reminder_enabled ? (
        <>
          <Field label="Hours before the event">
            {(id) => <input id={id} type="number" min={1} max={336} className="crm-input max-w-[160px]" value={draft.confirmation_hours_before} onChange={(e) => set({ confirmation_hours_before: e.target.value })} />}
          </Field>
          <UseSuggestion why={s.why} source={s.source} action={s.label} used={draft.confirmation_hours_before === String(s.value)} onUse={() => set({ confirmation_hours_before: String(s.value) })} />
        </>
      ) : null}
    </div>
  );
}

/** Card 7, "Sending": the confirmation reminder, the reminder's wording in every language (drafted, never sent), and what comes next. */
export function SendingCard({ draft, set, ctx, api }: CardProps) {
  const [drafts, setDrafts] = useState<{ busy: boolean; error: string | null; data: DraftReminderData | null }>({ busy: false, error: null, data: null });

  async function draftText() {
    if (!draft.id) return;
    setDrafts({ busy: true, error: null, data: null });
    const res = await api.draftReminder(draft.id);
    setDrafts(res.ok ? { busy: false, error: null, data: res.data ?? null } : { busy: false, error: res.error, data: null });
  }

  return (
    <div className="flex flex-col gap-5">
      <ReminderFields draft={draft} set={set} ctx={ctx} />
      <section className="flex flex-col gap-2" aria-label="The reminder's wording">
        <p className={sectionLabel}>The reminder&apos;s wording</p>
        {ctx.modules.comms ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={softButton} disabled={drafts.busy || !draft.id} onClick={draftText}>
                {drafts.busy ? "Drafting…" : drafts.data ? "Draft it again" : "Draft the reminder text"}
              </button>
              <span className="crm-hint">In every language your community uses. Nothing is sent or saved.</span>
            </div>
            {drafts.error ? <ErrorNote onRetry={draftText}>{drafts.error}</ErrorNote> : null}
            {drafts.data?.drafts.map((d) => (
              <div key={d.language} className="rounded-[12px] border border-line bg-white px-3.5 py-2.5" dir={d.text_direction}>
                <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-bold text-muted" dir="ltr">
                  {d.language_name}
                  {d.needs_translation ? <Pill tone="sun">Needs translation</Pill> : null}
                </p>
                <p className="m-0 mt-1 text-[14px] font-semibold text-ink">{d.subject}</p>
                <p className="m-0 mt-0.5 whitespace-pre-line text-[14px] text-ink-2">{d.body}</p>
              </div>
            ))}
            {drafts.data ? (
              <p className="crm-hint m-0">
                A draft to read and copy. Send it from{" "}
                <Link className={linkClass} href="/comms">
                  Messages
                </Link>{" "}
                when the event is published.
              </p>
            ) : null}
          </>
        ) : (
          <Note>Messages are switched off for your community, so reminders are not drafted here. The confirmation reminder above still goes out.</Note>
        )}
      </section>
      <section className="flex flex-col gap-2" aria-label="Coming next">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-ground px-3.5 py-2.5">
          <span className="text-[14px] text-ink-2">More reminders on a schedule (a week before, the morning of)</span>
          <ComingNext />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-ground px-3.5 py-2.5">
          <span className="text-[14px] text-ink-2">Publishing to your website, Facebook and Instagram from here</span>
          <ComingNext />
        </div>
      </section>
      <LessonNotes lessons={lessonsFor("sending", draft, ctx)} />
    </div>
  );
}

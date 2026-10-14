"use client";

import Link from "next/link";

import { askedCards, type CreatorReadiness } from "@/lib/event-creator/plan";
import { cardDef } from "@/lib/event-creator/questions";
import { lessonsFor } from "@/lib/event-creator/smart";
import { summaryOf } from "@/lib/event-creator/summary";

import { LessonNotes, Note, linkClass, primaryButton, sectionLabel, softButton, type CardProps } from "../parts";

/** Card 9, "Review": every answer with Change, what still stops publishing, and the screens that take it from here. Never publishes. */
export function ReviewCard({ draft, ctx, existing, goTo, readiness, dirty, saving, onSave }: CardProps & { readiness: CreatorReadiness; dirty: boolean; saving: boolean; onSave: () => void }) {
  const cards = askedCards(ctx).filter((c) => c !== "review");
  const blocked = readiness.items.filter((i) => i.blocks);
  const id = draft.id;
  return (
    <div className="flex flex-col gap-4">
      {dirty ? (
        <div className="flex flex-wrap items-center gap-3 rounded-field bg-saffron-50 px-3 py-2 text-[14px] text-brown-900">
          <span className="min-w-0 flex-1">Some changes are not saved yet.</span>
          <button type="button" className={softButton} disabled={saving} onClick={onSave}>
            {saving ? "Saving…" : "Save the draft"}
          </button>
        </div>
      ) : id ? (
        <Note tone="ok">Saved as a draft. Nothing is published and nothing has been sent. You can leave and come back: this page keeps your place.</Note>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {cards.map((c) => (
          <li key={c} className="flex items-start justify-between gap-3 rounded-field border border-line bg-white px-3.5 py-2.5">
            <span className="min-w-0">
              <span className="block text-[12px] font-bold uppercase tracking-[0.06em] text-muted">{cardDef(c).label}</span>
              <span className="block text-[14px] text-ink">{summaryOf(c, draft, ctx, existing)}</span>
            </span>
            <button type="button" className="min-h-[36px] shrink-0 text-[14px] font-semibold text-navy hover:underline" onClick={() => goTo(c)}>
              Change<span className="sr-only"> {cardDef(c).label.toLowerCase()}</span>
            </button>
          </li>
        ))}
      </ul>
      {blocked.length ? (
        <Note tone="warn">
          Publishing is blocked until: {blocked.map((b) => b.label.toLowerCase()).join(", ")}.
        </Note>
      ) : (
        <Note tone="ok">Nothing blocks publishing. Approve the flyer, then publish now or schedule it in the publish box beside the questions (or from the event page).</Note>
      )}
      <LessonNotes lessons={lessonsFor("review", draft, ctx)} />
      {id ? (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>From here</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/events/${id}`} className={primaryButton}>
              Open the event page
            </Link>
            <Link href={`/events/builder?event=${id}`} className={softButton}>
              Advanced form
            </Link>
          </div>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] text-ink-2">
            <li>
              <Link className={linkClass} href={`/events/${id}?tab=volunteers`}>
                Volunteers
              </Link>
              : assign people and their access for the day
            </li>
            {draft.lunch_enabled ? (
              <li>
                <Link className={linkClass} href={`/events/${id}?tab=lunch`}>
                  Meal slots
                </Link>
                : seats and the serving board
              </li>
            ) : null}
            <li>
              <Link className={linkClass} href={`/events/${id}?tab=checklist`}>
                Checklist and lessons learned
              </Link>
            </li>
            <li>
              <Link className={linkClass} href={`/events/${id}?tab=rsvps`}>
                RSVPs
              </Link>
              {ctx.modules.surveys ? (
                <>
                  {" "}
                  and the{" "}
                  <Link className={linkClass} href={`/events/${id}?tab=survey`}>
                    survey
                  </Link>
                </>
              ) : null}
            </li>
          </ul>
        </div>
      ) : null}
    </div>
  );
}

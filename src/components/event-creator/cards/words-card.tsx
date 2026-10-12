"use client";

import Link from "next/link";

import { languageName } from "@/lib/languages";
import { lessonsFor } from "@/lib/event-creator/smart";

import { ComingNext, Field, LessonNotes, Note, linkClass, sectionLabel, type CardProps } from "../parts";

/** Card 6, "Words": the description (one text today) and the flyer maker. */
export function WordsCard({ draft, set, ctx }: CardProps) {
  const [main, ...others] = ctx.languages;
  return (
    <div className="flex flex-col gap-4">
      <Field label={`Description (${languageName(main ?? "en")})`} hint="A line or two about the event: what it is, who it is for, what to bring.">
        {(id) => <textarea id={id} rows={5} className="crm-input" value={draft.description} onChange={(e) => set({ description: e.target.value })} />}
      </Field>
      {others.length ? (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>Other languages your community uses</p>
          {others.map((code) => (
            <div key={code} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line bg-white px-3.5 py-2.5">
              <span className="text-[15px] font-semibold text-ink">{languageName(code)}</span>
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                A translation of the description, reviewed by a person <ComingNext />
              </span>
            </div>
          ))}
          <p className="crm-hint m-0">An event keeps one description today, so members see it in {languageName(main ?? "en")}.</p>
        </div>
      ) : null}
      <Note>
        The flyer draft beside the questions uses these words: approve it there, then publish or schedule it.{" "}
        {draft.id ? (
          <>
            To change its words by hand, use a photo or upload your own file, open the{" "}
            <Link className={linkClass} href={`/events/builder?event=${draft.id}#flyer`}>
              full flyer maker
            </Link>
            .
          </>
        ) : null}
      </Note>
      <LessonNotes lessons={lessonsFor("words", draft, ctx)} />
    </div>
  );
}

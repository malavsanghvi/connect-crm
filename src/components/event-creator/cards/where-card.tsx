"use client";

import { capacitySuggestion, clashesFor, lessonsFor, venueSuggestions } from "@/lib/event-creator/smart";

import { Field, LessonNotes, Note, SuggestionButton, SwitchRow, UseSuggestion, sectionLabel, type CardProps } from "../parts";

/** Card 2, "Where": the place (from the places this community has used), how many can come, and the waitlist. */
export function WhereCard({ draft, set, ctx }: CardProps) {
  const venues = venueSuggestions(draft, ctx);
  const cap = capacitySuggestion(draft, ctx);
  const warns = clashesFor(draft, ctx).filter((c) => c.level === "warn");
  return (
    <div className="flex flex-col gap-4">
      {venues.length ? (
        <div className="flex flex-col gap-2">
          <p className={sectionLabel}>Places you have used</p>
          {venues.map((s) => (
            <SuggestionButton
              key={s.label}
              label={s.label}
              why={s.why}
              source={s.source}
              best={s.best}
              meta={s.value.capacity ? `holds ${s.value.capacity}` : undefined}
              pressed={draft.venue.trim().toLowerCase() === s.value.venue.toLowerCase()}
              onPick={() => set({ venue: s.value.venue })}
            />
          ))}
        </div>
      ) : null}
      <Field label={venues.length ? "Or type the place" : "Place"} hint="A room, an address, or a link for an online event.">
        {(id) => <input id={id} className="crm-input" value={draft.venue} onChange={(e) => set({ venue: e.target.value })} autoComplete="off" />}
      </Field>
      {warns.map((c) => (
        <Note key={c.text} tone="warn">
          {c.text}
        </Note>
      ))}
      <Field label="How many people can come" hint="Leave it empty for no limit.">
        {(id) => <input id={id} type="number" min={0} inputMode="numeric" className="crm-input max-w-[200px]" placeholder="No limit" value={draft.capacity} onChange={(e) => set({ capacity: e.target.value })} />}
      </Field>
      {cap ? <UseSuggestion why={cap.why} source={cap.source} action={cap.label} used={draft.capacity === String(cap.value)} onUse={() => set({ capacity: String(cap.value) })} /> : null}
      <div>
        <SwitchRow
          label="Waitlist when it is full"
          checked={draft.waitlist_enabled}
          onChange={(v) => set({ waitlist_enabled: v })}
          onNote="On · freed places are offered automatically"
          offNote="Off"
        />
      </div>
      <LessonNotes lessons={lessonsFor("where", draft, ctx)} />
    </div>
  );
}

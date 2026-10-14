"use client";

import Link from "next/link";

import { PersonPicker } from "@/components/events/person-picker";
import { fieldsOn } from "@/lib/event-creator/fields";
import { skippedNotes } from "@/lib/event-creator/questions";

import { Field, Note, SwitchRow, linkClass, sectionLabel, type CardProps } from "../parts";
import { MealFields } from "./help-card";
import { MoneyFields } from "./money-card";
import { ReminderFields } from "./sending-card";

/**
 * Card 8, "More settings": every other setting of the old builder (the RSVP window, the lead, the program year, confidential),
 * plus the settings of any card this community is not asked (tickets, meals, the reminder), so nothing is out of reach.
 */
export function MoreCard({ draft, set, ctx, existing, api, saveNow, refresh, dirty }: CardProps & { dirty: boolean }) {
  const here = new Set(fieldsOn("more", ctx));
  const notes = skippedNotes(ctx);
  const eventId = draft.id;
  return (
    <div className="flex flex-col gap-5">
      {notes.map((n) => (
        <Note key={n}>{n}</Note>
      ))}
      <section className="flex flex-col gap-3" aria-label="RSVP window">
        <p className={sectionLabel}>RSVP window</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="RSVP opens" hint="Empty: as soon as it is published.">
            {(id) => <input id={id} type="datetime-local" className="crm-input" value={draft.rsvp_opens_at} onChange={(e) => set({ rsvp_opens_at: e.target.value })} />}
          </Field>
          <Field label="RSVP closes" hint="Empty: when the event starts.">
            {(id) => <input id={id} type="datetime-local" className="crm-input" value={draft.rsvp_closes_at} onChange={(e) => set({ rsvp_closes_at: e.target.value })} />}
          </Field>
        </div>
      </section>
      <section className="flex flex-col gap-3" aria-label="Who runs it">
        <p className={sectionLabel}>Who runs it</p>
        <PersonPicker
          name="owner_person_id"
          label="Owner (event lead)"
          initial={draft.owner ? [draft.owner] : []}
          onChange={(picked) => set({ owner: picked[0] ?? null })}
          hint="The lead can edit this event and see its volunteers."
        />
        <SwitchRow
          label="Confidential (committee only)"
          checked={draft.confidential}
          onChange={(v) => set({ confidential: v })}
          onNote="Committee only"
          offNote="Visible to members once published"
        />
        <Field label={`${ctx.school ?? "Program"} year`} hint="For reports by year, such as 2026-2027.">
          {(id) => <input id={id} className="crm-input max-w-[220px]" placeholder="e.g. 2026-2027" value={draft.program_year} onChange={(e) => set({ program_year: e.target.value })} />}
        </Field>
      </section>
      {here.has("is_paid") ? (
        <section className="flex flex-col gap-3" aria-label="Tickets and donations">
          <p className={sectionLabel}>Tickets and donations</p>
          <MoneyFields draft={draft} set={set} ctx={ctx} />
        </section>
      ) : null}
      {here.has("lunch_enabled") ? (
        <section className="flex flex-col gap-3" aria-label="Meals">
          <p className={sectionLabel}>Meals</p>
          <MealFields draft={draft} set={set} ctx={ctx} slots={{ eventId, api, existing, saveNow, refresh, dirty }} />
        </section>
      ) : null}
      {here.has("confirmation_hours_before") ? (
        <section className="flex flex-col gap-3" aria-label="Reminder">
          <p className={sectionLabel}>Reminder</p>
          <ReminderFields draft={draft} set={set} ctx={ctx} />
        </section>
      ) : null}
      <section className="flex flex-col gap-2" aria-label="On other screens">
        <p className={sectionLabel}>On other screens</p>
        {eventId ? (
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] text-ink-2">
            <li>
              <Link className={linkClass} href={`/events/${eventId}`}>
                The event page
              </Link>
              : its own extra details, history and status.
            </li>
            <li>
              <Link className={linkClass} href={`/events/${eventId}?tab=volunteers`}>
                Volunteers
              </Link>
              : assign people to shifts and give them access for the day.
            </li>
            <li>
              <Link className={linkClass} href={`/events/${eventId}?tab=survey`}>
                Survey
              </Link>
              : a feedback survey after the event.
            </li>
            <li>
              <Link className={linkClass} href={`/events/builder?event=${eventId}`}>
                Advanced form
              </Link>
              : every setting on one page, and the full flyer maker.
            </li>
          </ul>
        ) : (
          <p className="crm-hint m-0">Links to the event page appear once card 1 is saved.</p>
        )}
      </section>
    </div>
  );
}

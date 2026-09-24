"use client";

import { useMemo, useState } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { PersonPicker } from "@/components/events/person-picker";
import { Card, InfoBox, buttonClass } from "@/components/ui";
import { audienceChips, commitmentSummary, lunchPriorityText, slotPreview, type CommitmentOptions, type LunchRules } from "@/lib/events/report";

export type BuilderEvent = {
  id: string | null;
  status: string;
  name: string;
  description: string;
  flyer_path: string;
  venue: string;
  /** datetime-local values in the center's zone */
  starts_at: string;
  ends_at: string;
  program_year: string;
  capacity: string;
  waitlist_enabled: boolean;
  audience: string;
  rsvp_opens_at: string;
  rsvp_closes_at: string;
  confirmation_hours_before: number;
  attendee_flags: string[];
  commitment: CommitmentOptions;
  commitments_enabled: boolean;
  lunch_enabled: boolean;
  lunch_starts_at: string;
  lunch_slot_minutes: number;
  lunch_seats_per_slot: string;
  is_paid: boolean;
  member_price: string;
  guest_price: string;
  confidential: boolean;
  owner: { id: string; name: string; detail: string | null } | null;
};

const SLOT_CHOICES = [15, 20, 30];

function dollars(list: number[] | undefined): string {
  return (list ?? []).map((c) => (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2))).join(", ");
}

function money(c: number): string {
  return c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`;
}

function parseList(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((s) => s.replace(/\$/g, ""))
    .filter((s) => /^\d+(\.\d{1,2})?$/.test(s))
    .map((s) => Math.round(Number(s) * 100));
}

function minutesOf(local: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(local);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function clock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(mm).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * The prototype's Event builder: "Details and audience" (7) beside "Lunch
 * slots" (5), the slot-engine preview (7) beside the Publish note (5), then
 * the buttons. The app's extra fields are kept: dates and venue in the first
 * card, the rest (RSVP window, questions, amounts, tickets, owner, flyer)
 * under "More settings".
 */
export function EventBuilder({
  action,
  event,
  lunchRules,
  editable,
  canPublish,
}: {
  action: FormAction;
  event: BuilderEvent;
  lunchRules: LunchRules;
  editable: boolean;
  canPublish: boolean;
}) {
  const [audience, setAudience] = useState(event.audience);
  const [waitlist, setWaitlist] = useState(event.waitlist_enabled);
  const [commitOn, setCommitOn] = useState(event.commitments_enabled);
  const [perPerson, setPerPerson] = useState(dollars(event.commitment.per_person));
  const [lumpSum, setLumpSum] = useState(dollars(event.commitment.lump_sum));
  const [commitOpen, setCommitOpen] = useState(event.commitment.open ?? true);
  const [reminderOn, setReminderOn] = useState(event.confirmation_hours_before > 0);
  const [reminderHours, setReminderHours] = useState(String(event.confirmation_hours_before > 0 ? event.confirmation_hours_before : 24));
  const [lunchOn, setLunchOn] = useState(event.lunch_enabled);
  const [lunchStarts, setLunchStarts] = useState(event.lunch_starts_at);
  const [slot, setSlot] = useState(String(event.lunch_slot_minutes));
  const [seats, setSeats] = useState(event.lunch_seats_per_slot);
  const [flags, setFlags] = useState<string[]>(event.attendee_flags);
  const [paid, setPaid] = useState(event.is_paid);

  const slotOptions = useMemo(() => {
    const list = SLOT_CHOICES.includes(event.lunch_slot_minutes) ? SLOT_CHOICES : [...SLOT_CHOICES, event.lunch_slot_minutes].sort((a, b) => a - b);
    return list.map((m) => ({ value: String(m), label: `${m} min` }));
  }, [event.lunch_slot_minutes]);

  const commitNote = commitmentSummary({ per_person: parseList(perPerson), lump_sum: parseList(lumpSum), open: commitOpen }, money);
  const questionText = [
    flags.includes("child_under_12") ? "Child under 12" : null,
    flags.includes("senior") ? "Senior" : null,
    flags.includes("assistance") ? "Assistance required" : null,
    "Add guest",
    "Guest RSVP by phone without the app",
  ]
    .filter(Boolean)
    .join(" · ");
  const lunchMinutes = minutesOf(lunchStarts);
  const preview = slotPreview({
    lunchStartMinutes: lunchMinutes,
    slotMinutes: Number(slot) || 15,
    seatsPerSlot: seats.trim() ? Number(seats) : null,
    rules: lunchRules,
    formatMinutes: clock,
  });

  return (
    <ActionForm action={action} submitLabel="Save draft" hideSubmit>
      <fieldset disabled={!editable} className="contents">
        <div className="grid grid-cols-12 items-start gap-4">
          <Card span={7} title="Details and audience">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="ev-name" className="crm-label">
                  Event name
                </label>
                <input id="ev-name" name="name" required maxLength={200} defaultValue={event.name} className="crm-input" />
              </div>
              <div>
                <label htmlFor="ev-starts" className="crm-label">
                  Starts
                </label>
                <input id="ev-starts" type="datetime-local" name="starts_at" defaultValue={event.starts_at} className="crm-input" />
              </div>
              <div>
                <label htmlFor="ev-ends" className="crm-label">
                  Ends
                </label>
                <input id="ev-ends" type="datetime-local" name="ends_at" defaultValue={event.ends_at} className="crm-input" />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="ev-venue" className="crm-label">
                  Venue
                </label>
                <input id="ev-venue" name="venue" defaultValue={event.venue} className="crm-input" />
              </div>
              <div className="sm:col-span-2">
                <span className="crm-label">Who can RSVP</span>
                <ChipGroup name="audience" label="Who can RSVP" options={audienceChips(event.audience)} value={audience} onChange={setAudience} disabled={!editable} />
              </div>
              <div>
                <label htmlFor="ev-cap" className="crm-label">
                  Capacity
                </label>
                <input id="ev-cap" type="number" min={0} name="capacity" defaultValue={event.capacity} placeholder="No limit" className="crm-input" />
              </div>
              <div>
                <span className="crm-label">Waitlist</span>
                <Toggle name="waitlist_enabled" label="Waitlist" checked={waitlist} onChange={setWaitlist} onNote="On · auto-offer freed seats" offNote="Off" disabled={!editable} />
              </div>
              <div>
                <span className="crm-label">Donation commitment at RSVP</span>
                <Toggle
                  name="commitments_enabled"
                  label="Donation commitment at RSVP"
                  checked={commitOn}
                  onChange={setCommitOn}
                  onNote={commitNote}
                  offNote="Off"
                  disabled={!editable}
                />
              </div>
              <div>
                <span className="crm-label">Confirmation reminder</span>
                <Toggle
                  name="reminder_enabled"
                  label="Confirmation reminder"
                  checked={reminderOn}
                  onChange={setReminderOn}
                  onNote={`${reminderHours || "24"} hours before · push, SMS or WhatsApp for guests`}
                  offNote="Off"
                  disabled={!editable}
                />
              </div>
              <div className="sm:col-span-2">
                <span className="crm-label">Attendee questions</span>
                <InfoBox>{questionText}</InfoBox>
              </div>
            </div>
          </Card>

          <Card span={5} title="Lunch slots">
            <div className="flex flex-col gap-3">
              <div>
                <span className="crm-label">Assign lunch slots at check-in</span>
                <Toggle
                  name="lunch_enabled"
                  label="Assign lunch slots at check-in"
                  checked={lunchOn}
                  onChange={setLunchOn}
                  onNote="On"
                  offNote="Off · no lunch slots"
                  disabled={!editable}
                />
              </div>
              <div>
                <label htmlFor="ev-lunch" className="crm-label">
                  Lunch starts
                </label>
                <input
                  id="ev-lunch"
                  type="datetime-local"
                  name="lunch_starts_at"
                  value={lunchStarts}
                  onChange={(e) => setLunchStarts(e.target.value)}
                  className="crm-input"
                />
              </div>
              <div>
                <span className="crm-label">Slot length</span>
                <ChipGroup name="lunch_slot_minutes" label="Slot length" options={slotOptions} value={slot} onChange={setSlot} disabled={!editable} />
              </div>
              <div>
                <label htmlFor="ev-seats" className="crm-label">
                  Seats per slot
                </label>
                <input
                  id="ev-seats"
                  type="number"
                  min={1}
                  name="lunch_seats_per_slot"
                  value={seats}
                  onChange={(e) => setSeats(e.target.value)}
                  placeholder="Unlimited"
                  className="crm-input"
                />
              </div>
              <div>
                <span className="crm-label">Priority (from Settings › Rules)</span>
                <InfoBox>{lunchPriorityText(lunchRules)}</InfoBox>
              </div>
            </div>
          </Card>

          <Card span={7} title="Preview with these settings" description="Computed by the slot engine">
            <div className="rounded-[12px] bg-success-50 px-3.5 py-3">
              {lunchOn ? (
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  {preview.map((l) => (
                    <li
                      key={l.text}
                      className={l.tone === "ok" ? "font-bold text-success-900" : l.tone === "navy" ? "font-bold text-navy" : "font-medium text-muted"}
                    >
                      {l.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[13px] font-medium text-muted">Lunch slots are off for this event, so no one is given a lunch time at check-in.</p>
              )}
            </div>
          </Card>

          <Card span={5} title="Publish">
            <p className="text-[13px] leading-relaxed text-ink-2">
              {canPublish
                ? "Publishing opens RSVPs in the member app and guest web pages, schedules reminders, and creates the ops-app check-in list."
                : "Your role can view but not publish events."}
            </p>
          </Card>

          <Card span={12} title="More settings" description="RSVP window, attendee questions, amounts, tickets, owner and flyer">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label htmlFor="ev-ro" className="crm-label">
                  RSVP opens
                </label>
                <input id="ev-ro" type="datetime-local" name="rsvp_opens_at" defaultValue={event.rsvp_opens_at} className="crm-input" />
              </div>
              <div>
                <label htmlFor="ev-rc" className="crm-label">
                  RSVP closes
                </label>
                <input id="ev-rc" type="datetime-local" name="rsvp_closes_at" defaultValue={event.rsvp_closes_at} className="crm-input" />
              </div>
              <div>
                <label htmlFor="ev-rh" className="crm-label">
                  Confirmation reminder (hours before)
                </label>
                <input
                  id="ev-rh"
                  type="number"
                  min={1}
                  max={336}
                  name="confirmation_hours_before"
                  value={reminderHours}
                  onChange={(e) => setReminderHours(e.target.value)}
                  disabled={!reminderOn || !editable}
                  className="crm-input"
                />
              </div>
              <fieldset className="md:col-span-2 xl:col-span-3">
                <legend className="crm-label">Ask about each attendee</legend>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {[
                    ["child_under_12", "Child under 12"],
                    ["senior", "Senior"],
                    ["assistance", "Assistance required"],
                  ].map(([v, l]) => (
                    <label key={v} className="flex min-h-9 items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        name="attendee_flags"
                        value={v}
                        checked={flags.includes(v)}
                        onChange={(e) => setFlags((cur) => (e.target.checked ? [...cur, v] : cur.filter((x) => x !== v)))}
                        className="h-4 w-4 accent-navy"
                      />
                      {l}
                    </label>
                  ))}
                </div>
                <p className="crm-hint">Adding guests and guest RSVPs by phone are always available (RSVPs tab and the check-in walk-in desk).</p>
              </fieldset>
              <div>
                <label htmlFor="ev-pp" className="crm-label">
                  Commitment per person ($)
                </label>
                <input
                  id="ev-pp"
                  name="commit_per_person"
                  value={perPerson}
                  onChange={(e) => setPerPerson(e.target.value)}
                  placeholder="3, 5, 7"
                  disabled={!commitOn || !editable}
                  className="crm-input"
                />
              </div>
              <div>
                <label htmlFor="ev-ls" className="crm-label">
                  Commitment lump sum ($)
                </label>
                <input
                  id="ev-ls"
                  name="commit_lump_sum"
                  value={lumpSum}
                  onChange={(e) => setLumpSum(e.target.value)}
                  placeholder="10, 25, 50"
                  disabled={!commitOn || !editable}
                  className="crm-input"
                />
              </div>
              <div>
                <span className="crm-label">Open amount</span>
                <Toggle
                  name="commit_open"
                  label="Allow an open amount"
                  checked={commitOpen}
                  onChange={setCommitOpen}
                  onNote="Allowed"
                  offNote="Not offered"
                  disabled={!commitOn || !editable}
                />
              </div>
              <div>
                <span className="crm-label">Tickets</span>
                <Toggle name="is_paid" label="Paid event" checked={paid} onChange={setPaid} onNote="Paid event" offNote="Free" disabled={!editable} />
              </div>
              <div>
                <label htmlFor="ev-mp" className="crm-label">
                  Member price ($)
                </label>
                <input id="ev-mp" name="member_price" inputMode="decimal" defaultValue={event.member_price} disabled={!paid || !editable} className="crm-input" />
              </div>
              <div>
                <label htmlFor="ev-gp" className="crm-label">
                  Guest price ($)
                </label>
                <input id="ev-gp" name="guest_price" inputMode="decimal" defaultValue={event.guest_price} disabled={!paid || !editable} className="crm-input" />
              </div>
              <div>
                <label htmlFor="ev-py" className="crm-label">
                  Pathshala year
                </label>
                <input id="ev-py" name="program_year" defaultValue={event.program_year} placeholder="e.g. 2026-2027" className="crm-input" />
              </div>
              <div>
                <label htmlFor="ev-fl" className="crm-label">
                  Flyer
                </label>
                <input id="ev-fl" name="flyer_path" defaultValue={event.flyer_path} placeholder="https:// link or storage path" className="crm-input" />
              </div>
              <div>
                <PersonPicker name="owner_person_id" label="Owner (event lead)" initial={event.owner ? [event.owner] : []} />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label htmlFor="ev-desc" className="crm-label">
                  Description
                </label>
                <textarea id="ev-desc" name="description" rows={3} defaultValue={event.description} className="crm-input" />
              </div>
              <div>
                <span className="crm-label">Confidential</span>
                <Toggle
                  name="confidential"
                  label="Confidential (committee only)"
                  defaultChecked={event.confidential}
                  onNote="Committee only"
                  offNote="Visible to members once published"
                  disabled={!editable}
                />
              </div>
            </div>
          </Card>

          {editable ? (
            <Card span={12}>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="submit" name="intent" value="draft" data-variant="ghost" className={buttonClass("ghost")}>
                  {event.id && event.status !== "draft" ? "Save changes" : "Save draft"}
                </button>
                {canPublish && (!event.id || event.status === "draft") ? (
                  <button
                    type="submit"
                    name="intent"
                    value="publish"
                    data-variant="primary"
                    data-confirm="Publish this event? RSVPs open in the member app and guest web pages, and reminders are scheduled."
                    className={buttonClass("primary")}
                  >
                    Publish event
                  </button>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </fieldset>
    </ActionForm>
  );
}

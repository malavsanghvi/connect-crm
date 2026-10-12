"use client";

import Link from "next/link";
import { useState } from "react";

import { ChipGroup } from "@/components/controls";
import { toDateTimeLocal } from "@/lib/events/format";
import { lunchPriorityText, slotPreview } from "@/lib/events/report";
import { lunchRulesFromCenter } from "@/lib/events/rules";
import { formatClockText, formatDay, lessonsFor, mealSuggestion, shiftSuggestions, shiftTimes, STATION_LABEL } from "@/lib/event-creator/smart";
import type { CreatorCtx, CreatorExisting, EventDraft } from "@/lib/event-creator/types";

import type { CreatorApi } from "../api";
import { ErrorNote, Field, LessonNotes, Note, SuggestionButton, SwitchRow, UseSuggestion, linkClass, sectionLabel, softButton, type CardProps } from "../parts";

const SLOT_CHOICES = [15, 20, 30];

function minutesOf(local: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(local);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function clockOf(minutes: number, locale: string): string {
  const h = Math.floor(minutes / 60) % 24;
  return formatClockText(`${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`, locale);
}

function timeRange(startIso: string | null, endIso: string | null, ctx: CreatorCtx): string {
  if (!startIso) return "No time set";
  const s = toDateTimeLocal(startIso, ctx.tz);
  const e = endIso ? toDateTimeLocal(endIso, ctx.tz) : "";
  return `${formatDay(s.slice(0, 10), ctx.locale)} · ${formatClockText(s.slice(11, 16), ctx.locale)}${e ? `–${formatClockText(e.slice(11, 16), ctx.locale)}` : ""}`;
}

type Slots = { eventId: string | null; api: CreatorApi; existing: CreatorExisting; saveNow: () => Promise<boolean>; refresh: () => void; dirty: boolean };

/** Meals: the builder's "Lunch slots" card (the switch, start, slot length, seats, the priority from Settings › Rules, the slot engine's preview). */
export function MealFields({ draft, set, ctx, slots }: { draft: EventDraft; set: (p: Partial<EventDraft>) => void; ctx: CreatorCtx; slots?: Slots }) {
  const rules = lunchRulesFromCenter(ctx.rules);
  const meal = mealSuggestion(draft, ctx);
  const current = Number(draft.lunch_slot_minutes) || 15;
  const options = (SLOT_CHOICES.includes(current) ? SLOT_CHOICES : [...SLOT_CHOICES, current].sort((a, b) => a - b)).map((m) => ({ value: String(m), label: `${m} min` }));
  const preview = slotPreview({
    lunchStartMinutes: minutesOf(draft.lunch_starts_at),
    slotMinutes: current,
    seatsPerSlot: draft.lunch_seats_per_slot.trim() ? Number(draft.lunch_seats_per_slot) : null,
    rules,
    formatMinutes: (m) => clockOf(m, ctx.locale),
  });
  const [gen, setGen] = useState<{ busy: boolean; error: string | null; note: string | null }>({ busy: false, error: null, note: null });

  async function createSlots() {
    if (!slots?.eventId) return;
    setGen({ busy: true, error: null, note: null });
    // The slots are planned from the saved event, so save the times first.
    if (slots.dirty && !(await slots.saveNow())) return setGen({ busy: false, error: "Could not save the meal times first, so no slots were created. Fix the problem above, then try again.", note: null });
    const res = await slots.api.generateLunchSlots(slots.eventId, null, new FormData());
    if (!res.ok) return setGen({ busy: false, error: res.error, note: null });
    setGen({ busy: false, error: null, note: res.message ?? "Slots created." });
    slots.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label="Give people a meal time at check-in"
        sub="Timed seating, so the meal is served in turns."
        checked={draft.lunch_enabled}
        onChange={(v) => set({ lunch_enabled: v })}
        onNote="On"
        offNote="Off · no meal slots"
      />
      {meal && !draft.lunch_enabled ? (
        <UseSuggestion
          why={meal.why}
          source={meal.source}
          action={meal.label}
          used={false}
          onUse={() => set({ lunch_enabled: true, ...(meal.value.slot_minutes ? { lunch_slot_minutes: String(meal.value.slot_minutes) } : {}), ...(meal.value.seats ? { lunch_seats_per_slot: String(meal.value.seats) } : {}) })}
        />
      ) : null}
      {draft.lunch_enabled ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Meal starts">{(id) => <input id={id} type="datetime-local" className="crm-input" value={draft.lunch_starts_at} onChange={(e) => set({ lunch_starts_at: e.target.value })} />}</Field>
            <Field label="Seats per slot">
              {(id) => <input id={id} type="number" min={1} className="crm-input" placeholder="Unlimited" value={draft.lunch_seats_per_slot} onChange={(e) => set({ lunch_seats_per_slot: e.target.value })} />}
            </Field>
          </div>
          <div className="flex flex-col gap-1">
            <span className="crm-label">Slot length</span>
            <ChipGroup label="Slot length" options={options} value={String(current)} onChange={(v) => set({ lunch_slot_minutes: v })} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="crm-label">Priority (from Settings › Rules)</span>
            <Note>{lunchPriorityText(rules)}</Note>
          </div>
          <div className="rounded-[12px] bg-success-50 px-3.5 py-3">
            <p className="m-0 mb-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-success-900">Preview with these settings</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {preview.map((l) => (
                <li key={l.text} className={l.tone === "ok" ? "font-bold text-success-900" : l.tone === "navy" ? "font-bold text-navy" : "font-medium text-ink-2"}>
                  {l.text}
                </li>
              ))}
            </ul>
          </div>
          {slots?.eventId ? (
            slots.existing.lunchSlots > 0 ? (
              <Note tone="ok">
                {slots.existing.lunchSlots} meal slots are created. Change them on the event&apos;s{" "}
                <Link className={linkClass} href={`/events/${slots.eventId}?tab=lunch`}>
                  Lunch tab
                </Link>
                .
              </Note>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={softButton} disabled={gen.busy || !draft.lunch_starts_at} onClick={createSlots}>
                    {gen.busy ? "Creating the slots…" : "Create the meal slots now"}
                  </button>
                  <span className="crm-hint">{draft.lunch_starts_at ? "Nobody is seated until check-in." : "Set when the meal starts first."}</span>
                </div>
                {gen.error ? <ErrorNote onRetry={createSlots}>{gen.error}</ErrorNote> : null}
                {gen.note ? <Note tone="ok">{gen.note}</Note> : null}
              </div>
            )
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type ShiftRow = { key: string; station: string; role: string; capacity: number; starts_at: string; ends_at: string };

/** Volunteer shifts: last time's roles as open places, or one typed in. Created with createShift once the draft exists. */
function Shifts({ draft, ctx, api, existing, refresh, eventId }: { draft: EventDraft; ctx: CreatorCtx; api: CreatorApi; existing: CreatorExisting; refresh: () => void; eventId: string }) {
  const have = new Set(existing.shifts.map((s) => `${s.station}|${(s.notes ?? "").toLowerCase()}`));
  const suggested = shiftSuggestions(draft, ctx).filter((s) => !have.has(`${s.value.station}|${s.value.role.toLowerCase()}`));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(suggested.map((s) => s.label)));
  const [results, setResults] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const start = draft.starts_at.slice(0, 16);
  const defaultEnd = draft.ends_at.slice(0, 16);
  const [manual, setManual] = useState<ShiftRow>({ key: "manual", station: "entry", role: "", capacity: 2, starts_at: start, ends_at: defaultEnd });

  async function create(rows: ShiftRow[]) {
    setBusy(true);
    const next: Record<string, string | null> = { ...results };
    for (const r of rows) {
      const fd = new FormData();
      fd.set("station", r.station);
      fd.set("starts_at", r.starts_at);
      fd.set("ends_at", r.ends_at);
      fd.set("capacity", String(r.capacity));
      fd.set("notes", r.role);
      const res = await api.createShift(eventId, null, fd);
      next[r.key] = res.ok ? null : res.error;
    }
    setResults(next);
    setBusy(false);
    refresh();
  }

  const rows: ShiftRow[] = suggested
    .filter((s) => picked.has(s.label))
    .map((s) => {
      const t = shiftTimes(draft.starts_at, s.value);
      return { key: s.label, station: s.value.station, role: s.value.role, capacity: s.value.capacity, starts_at: t?.starts_at ?? "", ends_at: t?.ends_at ?? "" };
    });
  const failed = Object.entries(results).filter(([, e]) => e);

  return (
    <div className="flex flex-col gap-3">
      {existing.shifts.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {existing.shifts.map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2 rounded-[10px] border border-line bg-white px-3 py-2 text-[14px]">
              <span className="font-semibold text-ink">{s.notes?.trim() || STATION_LABEL[s.station] || s.station}</span>
              <span className="text-ink-2">
                {s.capacity ?? 1} {s.capacity === 1 ? "person" : "people"} · {timeRange(s.starts_at, s.ends_at, ctx)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {suggested.length ? (
        <>
          {suggested.map((s) => (
            <SuggestionButton
              key={s.label}
              label={s.label}
              why={s.why}
              source={s.source}
              meta={`${s.value.capacity} ${s.value.capacity === 1 ? "person" : "people"}`}
              pressed={picked.has(s.label)}
              onPick={() =>
                setPicked((cur) => {
                  const n = new Set(cur);
                  if (n.has(s.label)) n.delete(s.label);
                  else n.add(s.label);
                  return n;
                })
              }
            />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={softButton} disabled={busy || rows.length === 0 || !start} onClick={() => create(rows)}>
              {busy ? "Adding…" : `Add ${rows.length} shift${rows.length === 1 ? "" : "s"}`}
            </button>
            <span className="crm-hint">Open places only: nobody is asked until you assign people.</span>
          </div>
        </>
      ) : null}
      {failed.map(([key, error]) => (
        <ErrorNote key={key} onRetry={() => create([...rows, manual].filter((r) => r.key === key))}>
          {key === "manual" ? "The shift you typed" : key}: {error}
        </ErrorNote>
      ))}
      <details className="rounded-[12px] border border-line bg-ground px-3.5 py-2.5">
        <summary className="cursor-pointer text-[14px] font-semibold text-ink">Add a shift yourself</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Role" hint="Your own name for it, such as Greeters.">
            {(id) => <input id={id} className="crm-input" value={manual.role} onChange={(e) => setManual({ ...manual, role: e.target.value })} />}
          </Field>
          <Field label="Area">
            {(id) => (
              <select id={id} className="crm-input" value={manual.station} onChange={(e) => setManual({ ...manual, station: e.target.value })}>
                {Object.entries(STATION_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="People needed">{(id) => <input id={id} type="number" min={1} className="crm-input" value={manual.capacity} onChange={(e) => setManual({ ...manual, capacity: Number(e.target.value) || 1 })} />}</Field>
          <span />
          <Field label="Shift starts">{(id) => <input id={id} type="datetime-local" className="crm-input" value={manual.starts_at} onChange={(e) => setManual({ ...manual, starts_at: e.target.value })} />}</Field>
          <Field label="Shift ends">{(id) => <input id={id} type="datetime-local" className="crm-input" value={manual.ends_at} onChange={(e) => setManual({ ...manual, ends_at: e.target.value })} />}</Field>
          <div className="sm:col-span-2">
            <button type="button" className={softButton} disabled={busy || !manual.role.trim()} onClick={() => create([manual])}>
              Add this shift
            </button>
          </div>
        </div>
      </details>
      <p className="crm-hint m-0">
        Assign people, and give them check-in or kitchen access for the day, on the event&apos;s{" "}
        <Link className={linkClass} href={`/events/${eventId}?tab=volunteers`}>
          Volunteers tab
        </Link>
        .
      </p>
    </div>
  );
}

const PHASES = [
  { value: "pre", label: "Before" },
  { value: "during", label: "On the day" },
  { value: "after", label: "After" },
];

/** Checklist items for this event (addChecklistAction). */
function Checklist({ ctx, api, existing, refresh, eventId }: { ctx: CreatorCtx; api: CreatorApi; existing: CreatorExisting; refresh: () => void; eventId: string }) {
  const [name, setName] = useState("");
  const [phase, setPhase] = useState("pre");
  const [due, setDue] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  async function add() {
    setState({ busy: true, error: null });
    const fd = new FormData();
    fd.set("name", name);
    fd.set("phase", phase);
    if (phase !== "during" && due) fd.set("due_on", due);
    fd.set("priority", "medium");
    const res = await api.addChecklistAction(eventId, null, fd);
    if (!res.ok) return setState({ busy: false, error: res.error });
    setState({ busy: false, error: null });
    setName("");
    setDue("");
    refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {existing.checklist.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
          {existing.checklist.map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2 border-b border-line py-1.5 last:border-b-0">
              <span className="text-ink">{a.name}</span>
              <span className="text-ink-2">
                {PHASES.find((p) => p.value === a.phase)?.label ?? "Before"}
                {a.due_on ? ` · due ${formatDay(a.due_on, ctx.locale)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="crm-hint m-0">No checklist items yet.</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field label="Add an item">{(id) => <input id={id} className="crm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Book the sound system" />}</Field>
        {phase !== "during" ? <Field label="Due">{(id) => <input id={id} type="date" className="crm-input" value={due} onChange={(e) => setDue(e.target.value)} />}</Field> : <span />}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <ChipGroup label="When" options={PHASES} value={phase} onChange={setPhase} />
        <button type="button" className={softButton} disabled={state.busy || !name.trim()} onClick={add}>
          {state.busy ? "Adding…" : "Add to the checklist"}
        </button>
      </div>
      {state.error ? <ErrorNote onRetry={add}>{state.error}</ErrorNote> : null}
      <p className="crm-hint m-0">
        Tick items off, and write lessons learned after the event, on the event&apos;s{" "}
        <Link className={linkClass} href={`/events/${eventId}?tab=checklist`}>
          Checklist tab
        </Link>
        .
      </p>
    </div>
  );
}

/** Card 5, "Help": volunteer shifts, meals and the checklist. */
export function HelpCard(props: CardProps & { dirty: boolean }) {
  const { draft, set, ctx, api, existing, refresh, saveNow, dirty } = props;
  const eventId = draft.id;
  return (
    <div className="flex flex-col gap-5">
      <LessonNotes lessons={lessonsFor("help", draft, ctx)} />
      {existing.problems.map((p) => (
        <ErrorNote key={p}>{p}</ErrorNote>
      ))}
      <section className="flex flex-col gap-2" aria-label="Volunteer shifts">
        <p className={sectionLabel}>Volunteer shifts</p>
        {eventId ? <Shifts draft={draft} ctx={ctx} api={api} existing={existing} refresh={refresh} eventId={eventId} /> : <Note>Shifts can be added once card 1 is saved.</Note>}
      </section>
      <section className="flex flex-col gap-2" aria-label="Meals">
        <p className={sectionLabel}>Meals</p>
        <MealFields draft={draft} set={set} ctx={ctx} slots={{ eventId, api, existing, saveNow, refresh, dirty }} />
      </section>
      <section className="flex flex-col gap-2" aria-label="Checklist">
        <p className={sectionLabel}>Checklist</p>
        {eventId ? <Checklist ctx={ctx} api={api} existing={existing} refresh={refresh} eventId={eventId} /> : <Note>Checklist items can be added once card 1 is saved.</Note>}
      </section>
    </div>
  );
}

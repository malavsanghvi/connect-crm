"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useStepUp } from "@/components/step-up";
import { formatDateTime } from "@/lib/dates";
import {
  CONFIRM_YES,
  confirmQuestion,
  defaultChosen,
  personChoices,
  planAdd,
  sayNames,
  type AddToEventProps,
  type EventChoice,
} from "@/lib/people-v2/event-add";
import { NO_ACCESS_TEXT } from "@/lib/people-v2/slideover";

import { useFamilyActions } from "../family/actions";

// "Add to an event": a small panel in place (never a page) on the person slide-over's Events section and on the Family page's Events tab.
// Choose an upcoming event, choose who comes (the family's people; the person it was opened from is ticked), then one question: "Add
// Samira and Layla to Spring Picnic?" and "Yes, add them". It runs the Server Action behind useFamilyActions().eventAdd, which reuses the
// family's RSVP for that event when there is one, so a family never gets two. What it says after is what the server did: a failure is
// said in words next to what was done, with a way to try again, and the screen never says "Added" for a write that did not happen.
//
// The family is shown with its card line (number, ids, adults, place), never by its name alone. Children are listed compactly and can be
// chosen: this is the staff screen. Nothing here is sent to an assistant or an AI provider.

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; events: EventChoice[] }
  | { state: "failed"; kind: "access" | "other"; error: string };

type Failure = { kind: "access" | "full" | "busy" | "other"; error: string };

const BTN =
  "inline-flex min-h-11 items-center justify-center rounded-full px-6 text-[14.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)] disabled:opacity-60";
const LABEL = "block text-[12.5px] font-bold text-muted";

function seatsText(e: EventChoice): { text: string; tone: "ok" | "warn" | "muted" } {
  if (e.capacity === null) return { text: "No limit on places", tone: "muted" };
  if (e.seatsTaken === null) return { text: `${e.capacity} places`, tone: "muted" };
  const left = Math.max(0, e.capacity - e.seatsTaken);
  if (left > 0) return { text: `${left} of ${e.capacity} places left`, tone: "ok" };
  return { text: e.waitlist ? "Full · new RSVPs go on the waitlist" : "Full", tone: "warn" };
}

export function AddToEvent({ householdId, cardLine, people, openedFrom, timeZone }: AddToEventProps) {
  const actions = useFamilyActions();
  const stepUp = useStepUp();
  const router = useRouter();
  const uid = useId();
  const yes = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [eventId, setEventId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [step, setStep] = useState<"choose" | "ask" | "adding">("choose");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const r = await actions.eventAdd.load({ householdId });
      if (r.ok) {
        setLoad({ state: "ready", events: r.events });
        setEventId((cur) => (cur && r.events.some((e) => e.id === cur && !e.problem) ? cur : r.events.length === 1 && !r.events[0].problem ? r.events[0].id : null));
      } else {
        setLoad({ state: "failed", kind: r.kind, error: r.error });
      }
    } catch (error) {
      console.error("[event-add] the events could not be loaded:", error);
      setLoad({ state: "failed", kind: "other", error: "Could not load the events — the server did not respond. Try again." });
    }
  }, [actions, householdId]);

  function show() {
    setOpen(true);
    setDone(null);
    setFailure(null);
    setStep("choose");
    setConfirmed(false);
    setChosen(new Set(defaultChosen(personChoices(people, []), openedFrom)));
    void fetchEvents();
  }

  function close() {
    if (step === "adding") return;
    setOpen(false);
    setFailure(null);
    setStep("choose");
  }

  const events = load.state === "ready" ? load.events : [];
  const event = events.find((e) => e.id === eventId) ?? null;
  const onIt = new Set(event?.existing?.personIds ?? []);
  const choices = personChoices(people, onIt);
  const picked = choices.filter((c) => c.state === "free" && chosen.has(c.id));
  const plan = event
    ? planAdd({
        eventName: event.name,
        capacity: event.capacity,
        waitlist: event.waitlist,
        seatsTaken: event.seatsTaken,
        existingStatus: event.existing?.status ?? null,
        onIt,
        chosen: picked,
        confirmed,
      })
    : null;

  useEffect(() => {
    if (step === "ask") yes.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(t);
  }, [toast]);

  function toggle(id: string) {
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFailure(null);
    setStep("choose");
  }

  async function add() {
    if (busy.current || !event || !plan || plan.kind !== "add") return;
    busy.current = true;
    setStep("adding");
    setFailure(null);
    const call = () => actions.eventAdd.add({ householdId, eventId: event.id, personIds: plan.toAdd.map((c) => c.id), confirmed });
    try {
      const r = stepUp ? await stepUp.run(call, "add people to an event") : await call();
      if (r.ok) {
        setDone(r.message);
        setToast(r.toast);
        setOpen(false);
        setStep("choose");
        router.refresh();
      } else {
        setFailure({ kind: r.kind, error: r.error });
        // A refusal for places or a repeat click is settled by looking again; a half-finished add must show what is there.
        setStep(r.kind === "full" || r.kind === "busy" ? "choose" : "ask");
        if (r.kind === "full" || r.kind === "busy") void fetchEvents();
        if (r.partial) router.refresh();
      }
    } catch (error) {
      console.error("[event-add] adding did not complete:", error);
      setFailure({
        kind: "other",
        error: `Could not add ${sayNames(plan.toAdd)} to ${event.name} — the server did not respond, so it is not known whether it worked. Check this family's Events before trying again.`,
      });
      setStep("ask");
    }
    busy.current = false;
  }

  const adults = choices.filter((c) => !c.isChild);
  const children = choices.filter((c) => c.isChild);
  const everyoneFree = choices.filter((c) => c.state === "free");

  return (
    <div
      data-testid="add-to-event"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          close();
        }
      }}
    >
      {done ? (
        <div
          role="status"
          data-testid="add-to-event-done"
          className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[var(--v2-green-fill)] bg-[var(--v2-green-tint)] px-4 py-3 text-[14px] text-[var(--v2-green-ink)]"
        >
          <span dir="auto" className="font-semibold">
            {done}
          </span>
          <button type="button" onClick={show} className="font-bold underline">
            Add to another event
          </button>
        </div>
      ) : null}

      {!open ? (
        done ? null : (
          <button
            type="button"
            onClick={show}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-dashed border-[var(--v2-blue-border)] bg-transparent px-5 text-[14.5px] font-bold text-[var(--v2-blue)] hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
          >
            <span aria-hidden="true" className="text-[18px] leading-none">
              +
            </span>
            Add to an event
          </button>
        )
      ) : (
        <section aria-labelledby={`${uid}-h`} className="rounded-2xl border-2 border-[var(--v2-blue)] bg-white p-4 sm:p-[18px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 id={`${uid}-h`} className="m-0 text-[16px] font-semibold text-ink">
                Add to an event
              </h3>
              <p data-testid="add-to-event-family" dir="auto" className="m-0 mt-0.5 text-[13px] leading-snug text-muted">
                {cardLine.join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Cancel adding to an event"
              className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-[var(--v2-ground)] hover:text-ink"
            >
              <span aria-hidden="true" className="text-[22px] leading-none">
                ×
              </span>
            </button>
          </div>

          {load.state === "idle" || load.state === "loading" ? (
            <p role="status" className="m-0 mt-3 text-[14px] text-muted">
              Loading the upcoming events…
            </p>
          ) : null}

          {load.state === "failed" ? (
            load.kind === "access" ? (
              <p data-testid="add-to-event-no-access" className="m-0 mt-3 text-[14px] text-muted">
                {NO_ACCESS_TEXT}
              </p>
            ) : (
              <div role="alert" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
                {load.error}{" "}
                <button type="button" onClick={() => void fetchEvents()} className="font-bold underline">
                  Try again
                </button>
              </div>
            )
          ) : null}

          {load.state === "ready" && events.length === 0 ? (
            <p data-testid="add-to-event-none" className="m-0 mt-3 text-[14px] text-ink-2">
              There is no upcoming event you can add people to. An event shows here once it is published and has a date.
            </p>
          ) : null}

          {load.state === "ready" && events.length > 0 ? (
            <>
              <fieldset className="mt-3 min-w-0 border-0 p-0">
                <legend className={`${LABEL} mb-1.5`}>Which event</legend>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {events.map((e) => {
                    const seats = seatsText(e);
                    const selected = e.id === eventId;
                    return (
                      <li key={e.id}>
                        <label
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 ${
                            selected ? "border-[var(--v2-blue)] bg-[var(--v2-blue-tint)]" : "border-[var(--v2-line-input)] bg-white hover:border-[var(--v2-blue)]"
                          } ${e.problem ? "cursor-not-allowed opacity-70" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`${uid}-event`}
                            value={e.id}
                            checked={selected}
                            disabled={Boolean(e.problem) || step === "adding"}
                            onChange={() => {
                              setEventId(e.id);
                              setFailure(null);
                              setStep("choose");
                            }}
                            className="mt-1 size-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span dir="auto" className="block text-[15px] font-bold text-ink">
                              {e.name}
                            </span>
                            <span className="block text-[13px] text-ink-2">{formatDateTime(e.startsAt, timeZone)}</span>
                            <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
                              <span className={seats.tone === "ok" ? "font-semibold text-[var(--v2-green-ink)]" : seats.tone === "warn" ? "font-semibold text-[var(--v2-sun-ink)]" : "text-muted"}>
                                {seats.text}
                              </span>
                              {e.audience ? <span className="text-muted">{e.audience}</span> : null}
                              {e.existing ? <span className="font-semibold text-[var(--v2-blue)]">This family already has an RSVP</span> : null}
                            </span>
                            {e.note ? <span className="mt-0.5 block text-[12.5px] text-[var(--v2-sun-ink)]">{e.note}</span> : null}
                            {e.problem ? <span className="mt-0.5 block text-[12.5px] font-semibold text-danger">{e.problem}</span> : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <fieldset className="mt-4 min-w-0 border-0 p-0">
                <legend className={`${LABEL} mb-1.5`}>Who is coming</legend>
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {adults.map((c) => (
                    <PersonRow key={c.id} c={c} checked={chosen.has(c.id) && c.state === "free"} onToggle={toggle} disabled={step === "adding"} />
                  ))}
                </ul>
                {children.length > 0 ? (
                  <>
                    <p className="m-0 mt-2 text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-muted">Children · staff only</p>
                    <ul className="m-0 flex list-none flex-col p-0">
                      {children.map((c) => (
                        <PersonRow key={c.id} c={c} compact checked={chosen.has(c.id) && c.state === "free"} onToggle={toggle} disabled={step === "adding"} />
                      ))}
                    </ul>
                  </>
                ) : null}
                {everyoneFree.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setChosen(picked.length === everyoneFree.length ? new Set() : new Set(everyoneFree.map((c) => c.id)));
                      setFailure(null);
                      setStep("choose");
                    }}
                    className="mt-1 min-h-11 rounded-full px-1 text-[13.5px] font-bold text-[var(--v2-blue)] hover:underline md:min-h-9"
                  >
                    {picked.length === everyoneFree.length ? "Clear the choice" : "Choose the whole family"}
                  </button>
                ) : null}
              </fieldset>

              {event && !event.existing ? (
                <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-ink-2">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="size-4 shrink-0" />
                  <span>The family has already said yes (mark the RSVP confirmed)</span>
                </label>
              ) : null}

              {plan?.kind === "refuse" && plan.why !== "nobody" ? (
                <p role="status" data-testid="add-to-event-refusal" className="m-0 mt-3 rounded-[10px] bg-[var(--v2-sun-tint)] px-3 py-2 text-[13.5px] text-[var(--v2-sun-ink)]">
                  {plan.text}
                </p>
              ) : null}
              {plan?.kind === "unchanged" ? (
                <p role="status" className="m-0 mt-3 rounded-[10px] bg-[var(--v2-ground)] px-3 py-2 text-[13.5px] text-ink-2">
                  {plan.text}
                </p>
              ) : null}

              {failure ? (
                <div role="alert" data-testid="add-to-event-error" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
                  {failure.kind === "access" ? NO_ACCESS_TEXT : failure.error}
                </div>
              ) : null}

              {step === "choose" ? (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={plan?.kind !== "add"}
                    onClick={() => setStep("ask")}
                    className={`${BTN} bg-navy text-white hover:bg-navy-hover`}
                  >
                    {event ? `Add to ${event.name}` : "Choose an event"}
                  </button>
                  <span className="text-[12.5px] text-muted">Esc cancels.</span>
                </div>
              ) : null}

              {(step === "ask" || step === "adding") && plan?.kind === "add" && event ? (
                <div role="group" aria-labelledby={`${uid}-q`} data-testid="add-to-event-ask" className="mt-4 rounded-xl border border-[var(--v2-blue-border)] bg-[var(--v2-blue-tint)] p-3">
                  {plan.notes.map((n) => (
                    <p key={n} dir="auto" className="m-0 mb-1.5 text-[13.5px] text-ink-2">
                      {n}
                    </p>
                  ))}
                  <p id={`${uid}-q`} dir="auto" className="m-0 text-[15px] font-bold text-ink">
                    {confirmQuestion(plan.toAdd, event.name)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button ref={yes} type="button" onClick={() => void add()} disabled={step === "adding"} className={`${BTN} bg-navy text-white hover:bg-navy-hover`}>
                      {step === "adding" ? "Adding…" : failure ? "Try again" : CONFIRM_YES}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setStep("choose");
                        setFailure(null);
                      }}
                      disabled={step === "adding"}
                      className={`${BTN} border border-[var(--v2-line-input)] bg-white text-ink-2 hover:border-[var(--v2-blue)]`}
                    >
                      No, go back
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      )}
      <Toast text={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function PersonRow({
  c,
  checked,
  onToggle,
  disabled,
  compact = false,
}: {
  c: ReturnType<typeof personChoices>[number];
  checked: boolean;
  onToggle: (id: string) => void;
  disabled: boolean;
  compact?: boolean;
}) {
  const off = c.state !== "free";
  return (
    <li>
      <label className={`flex min-h-11 items-center gap-3 rounded-lg px-1 ${off ? "cursor-not-allowed text-muted" : "cursor-pointer"} ${compact ? "text-[14px]" : "text-[15px]"}`}>
        <input type="checkbox" checked={checked} disabled={off || disabled} onChange={() => onToggle(c.id)} className="size-4 shrink-0" />
        <span dir="auto" className={compact ? "min-w-0 flex-1" : "min-w-0 flex-1 font-semibold text-ink"}>
          {c.name}
          {compact && c.age !== null ? <span className="ml-1.5 text-[12.5px] font-normal text-muted">age {c.age}</span> : null}
        </span>
        {c.state === "on_it" ? <span className="shrink-0 rounded-full bg-[var(--v2-green-tint)] px-2.5 py-0.5 text-[12px] font-bold text-[var(--v2-green-ink)]">Already on it</span> : null}
        {c.state === "deceased" ? <span className="shrink-0 text-[12px] text-muted">In memory</span> : null}
      </label>
    </li>
  );
}

/** What happened, for a few seconds, above the phone's bottom bars (the same place as the Undo bar). */
function Toast({ text, onClose }: { text: string | null; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !text) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="add-to-event-toast"
      className="fixed bottom-[13rem] left-1/2 z-50 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[14px] bg-[var(--v2-ink)] text-white shadow-[0_10px_30px_rgba(18,32,58,0.35)] md:bottom-20 md:[html[data-slideover]_&]:left-[calc((100vw-520px)/2)] md:[html[data-slideover]_&]:w-[min(34rem,calc(100vw-560px))]"
    >
      <div className="flex items-center gap-3 px-4 py-3 text-[14px]">
        <span dir="auto" className="min-w-0 flex-1">
          {text}
        </span>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white">
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>,
    document.body,
  );
}

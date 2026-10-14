"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";
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
  type AddPlan,
  type AddToEventProps,
  type EventChoice,
  type PersonChoice,
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
//
// Two parts: AddToEventView draws a state (no hooks, so the tests and the previews can draw every state), and AddToEvent holds the state
// and talks to the server.

export type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; events: EventChoice[] }
  | { state: "failed"; kind: "access" | "other"; error: string };

export type Failure = { kind: "access" | "full" | "busy" | "other"; error: string };

export type PanelState = {
  open: boolean;
  load: Load;
  eventId: string | null;
  chosen: ReadonlySet<string>;
  confirmed: boolean;
  step: "choose" | "ask" | "adding";
  failure: Failure | null;
  /** The sentence for the last add that worked (kept above the button until the next one). */
  done: string | null;
};

export const CLOSED: PanelState = { open: false, load: { state: "idle" }, eventId: null, chosen: new Set(), confirmed: false, step: "choose", failure: null, done: null };

export type PanelHandlers = {
  show: () => void;
  close: () => void;
  retry: () => void;
  pickEvent: (id: string) => void;
  toggle: (id: string) => void;
  chooseEveryone: (ids: string[]) => void;
  setConfirmed: (v: boolean) => void;
  ask: () => void;
  back: () => void;
  submit: () => void;
};

const BTN =
  "inline-flex min-h-11 items-center justify-center rounded-full px-6 text-[14.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)] disabled:opacity-60";
const LABEL = "block text-[12.5px] font-bold text-muted";

export function seatsText(e: EventChoice): { text: string; tone: "ok" | "warn" | "muted" } {
  if (e.capacity === null) return { text: "No limit on places", tone: "muted" };
  if (e.seatsTaken === null) return { text: `${e.capacity} places`, tone: "muted" };
  const left = Math.max(0, e.capacity - e.seatsTaken);
  if (left > 0) return { text: `${left} of ${e.capacity} places left`, tone: "ok" };
  return { text: e.waitlist ? "Full · new RSVPs go on the waitlist" : "Full", tone: "warn" };
}

/** What follows from a state: the chosen event, who can be ticked, who is ticked, and what adding them would do. */
export function derive(props: Pick<AddToEventProps, "people">, state: PanelState): { events: EventChoice[]; event: EventChoice | null; choices: PersonChoice[]; picked: PersonChoice[]; plan: AddPlan | null } {
  const events = state.load.state === "ready" ? state.load.events : [];
  const event = events.find((e) => e.id === state.eventId) ?? null;
  const onIt = new Set(event?.existing?.personIds ?? []);
  const choices = personChoices(props.people, onIt);
  const picked = choices.filter((c) => c.state === "free" && state.chosen.has(c.id));
  const plan = event
    ? planAdd({
        eventName: event.name,
        capacity: event.capacity,
        waitlist: event.waitlist,
        seatsTaken: event.seatsTaken,
        existingStatus: event.existing?.status ?? null,
        onIt,
        chosen: picked,
        confirmed: state.confirmed,
      })
    : null;
  return { events, event, choices, picked, plan };
}

export function AddToEventView({ props, state, on, yesRef }: { props: AddToEventProps; state: PanelState; on: PanelHandlers; yesRef?: RefObject<HTMLButtonElement | null> }) {
  const uid = useId();
  const { load, step, failure, done, open, chosen, confirmed, eventId } = state;
  const { events, event, choices, picked, plan } = derive(props, state);
  const adults = choices.filter((c) => !c.isChild);
  const children = choices.filter((c) => c.isChild);
  const everyoneFree = choices.filter((c) => c.state === "free");
  const adding = step === "adding";

  return (
    <div
      data-testid="add-to-event"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          on.close();
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
          <button type="button" onClick={on.show} className="font-bold underline">
            Add to another event
          </button>
        </div>
      ) : null}

      {!open ? (
        done ? null : (
          <button
            type="button"
            onClick={on.show}
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
                {props.cardLine.join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={on.close}
              disabled={adding}
              aria-label="Cancel adding to an event"
              className="-mr-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-[var(--v2-ground)] hover:text-ink disabled:opacity-60"
            >
              <span aria-hidden="true" className="text-[22px] leading-none">
                ×
              </span>
            </button>
          </div>

          {load.state === "idle" || load.state === "loading" ? (
            <p role="status" data-testid="add-to-event-loading" className="m-0 mt-3 text-[14px] text-muted">
              Loading the upcoming events…
            </p>
          ) : null}

          {load.state === "failed" ? (
            load.kind === "access" ? (
              <p data-testid="add-to-event-no-access" className="m-0 mt-3 text-[14px] text-muted">
                {NO_ACCESS_TEXT}
              </p>
            ) : (
              <div role="alert" data-testid="add-to-event-load-error" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
                {load.error}{" "}
                <button type="button" onClick={on.retry} className="font-bold underline">
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
                            disabled={Boolean(e.problem) || adding}
                            onChange={() => on.pickEvent(e.id)}
                            className="mt-1 size-4 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span dir="auto" className="block text-[15px] font-bold text-ink">
                              {e.name}
                            </span>
                            <span className="block text-[13px] text-ink-2">{formatDateTime(e.startsAt, props.timeZone)}</span>
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
                    <PersonRow key={c.id} c={c} checked={chosen.has(c.id) && c.state === "free"} onToggle={on.toggle} disabled={adding} />
                  ))}
                </ul>
                {children.length > 0 ? (
                  <>
                    <p className="m-0 mt-2 text-[11.5px] font-bold uppercase tracking-[0.06em] text-muted">Children · staff only</p>
                    <ul className="m-0 flex list-none flex-col p-0">
                      {children.map((c) => (
                        <PersonRow key={c.id} c={c} compact checked={chosen.has(c.id) && c.state === "free"} onToggle={on.toggle} disabled={adding} />
                      ))}
                    </ul>
                  </>
                ) : null}
                {everyoneFree.length > 1 ? (
                  <button
                    type="button"
                    disabled={adding}
                    onClick={() => on.chooseEveryone(picked.length === everyoneFree.length ? [] : everyoneFree.map((c) => c.id))}
                    className="mt-1 min-h-11 rounded-full px-1 text-[13.5px] font-bold text-[var(--v2-blue)] hover:underline disabled:opacity-60 md:min-h-9"
                  >
                    {picked.length === everyoneFree.length ? "Clear the choice" : "Choose the whole family"}
                  </button>
                ) : null}
              </fieldset>

              {event && !event.existing ? (
                <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-ink-2">
                  <input type="checkbox" checked={confirmed} disabled={adding} onChange={(e) => on.setConfirmed(e.target.checked)} className="size-4 shrink-0" />
                  <span>The family has already said yes (mark the RSVP confirmed)</span>
                </label>
              ) : null}

              {plan?.kind === "refuse" && plan.why !== "nobody" ? (
                <p role="status" data-testid="add-to-event-refusal" className="m-0 mt-3 rounded-[10px] bg-[var(--v2-sun-tint)] px-3 py-2 text-[13.5px] text-[var(--v2-sun-ink)]">
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
                  <button type="button" disabled={plan?.kind !== "add"} onClick={on.ask} className={`${BTN} bg-navy text-white hover:bg-navy-hover`}>
                    {event ? `Add to ${event.name}` : "Choose an event"}
                  </button>
                  <span className="text-[12.5px] text-muted">Esc cancels.</span>
                </div>
              ) : null}

              {(step === "ask" || adding) && plan?.kind === "add" && event ? (
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
                    <button ref={yesRef} type="button" onClick={on.submit} disabled={adding} className={`${BTN} bg-navy text-white hover:bg-navy-hover`}>
                      {adding ? "Adding…" : failure ? "Try again" : CONFIRM_YES}
                    </button>
                    <button type="button" onClick={on.back} disabled={adding} className={`${BTN} border border-[var(--v2-line-input)] bg-white text-ink-2 hover:border-[var(--v2-blue)]`}>
                      No, go back
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

function PersonRow({ c, checked, onToggle, disabled, compact = false }: { c: PersonChoice; checked: boolean; onToggle: (id: string) => void; disabled: boolean; compact?: boolean }) {
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

export function AddToEvent(props: AddToEventProps) {
  const { householdId, people, openedFrom } = props;
  const actions = useFamilyActions();
  const stepUp = useStepUp();
  const router = useRouter();
  const yes = useRef<HTMLButtonElement>(null);
  const busy = useRef(false);
  const [state, setState] = useState<PanelState>(CLOSED);
  const [toast, setToast] = useState<string | null>(null);
  const patch = useCallback((p: Partial<PanelState>) => setState((s) => ({ ...s, ...p })), []);

  const fetchEvents = useCallback(async () => {
    patch({ load: { state: "loading" } });
    try {
      const r = await actions.eventAdd.load({ householdId });
      if (r.ok) {
        // Keep the chosen event if it is still there; with a single event, choose it.
        setState((s) => ({
          ...s,
          load: { state: "ready", events: r.events },
          eventId: s.eventId && r.events.some((e) => e.id === s.eventId && !e.problem) ? s.eventId : r.events.length === 1 && !r.events[0].problem ? r.events[0].id : null,
        }));
      } else {
        patch({ load: { state: "failed", kind: r.kind, error: r.error } });
      }
    } catch (error) {
      console.error("[event-add] the events could not be loaded:", error);
      patch({ load: { state: "failed", kind: "other", error: "Could not load the events — the server did not respond. Try again." } });
    }
  }, [actions, householdId, patch]);

  const show = useCallback(() => {
    setState({ ...CLOSED, open: true, load: { state: "loading" }, chosen: new Set(defaultChosen(personChoices(people, []), openedFrom)) });
    void fetchEvents();
  }, [fetchEvents, people, openedFrom]);

  useEffect(() => {
    if (state.step === "ask") yes.current?.focus();
  }, [state.step]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 7000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const submit = useCallback(async () => {
    const { event, plan } = derive({ people }, state);
    if (busy.current || !event || !plan || plan.kind !== "add") return;
    busy.current = true;
    patch({ step: "adding", failure: null });
    const call = () => actions.eventAdd.add({ householdId, eventId: event.id, personIds: plan.toAdd.map((c) => c.id), confirmed: state.confirmed });
    try {
      const r = stepUp ? await stepUp.run(call, "add people to an event") : await call();
      if (r.ok) {
        setState({ ...CLOSED, done: r.message });
        setToast(r.toast);
        router.refresh();
      } else {
        // A refusal for places or a repeat click is settled by looking again; a half-finished add must show what is there.
        const again = r.kind === "full" || r.kind === "busy";
        patch({ failure: { kind: r.kind, error: r.error }, step: again ? "choose" : "ask" });
        if (again) void fetchEvents();
        if (r.partial) router.refresh();
      }
    } catch (error) {
      console.error("[event-add] adding did not complete:", error);
      patch({
        failure: {
          kind: "other",
          error: `Could not add ${sayNames(plan.toAdd)} to ${event.name} — the server did not respond, so it is not known whether it worked. Check this family's Events before trying again.`,
        },
        step: "ask",
      });
    }
    busy.current = false;
  }, [actions, fetchEvents, householdId, patch, people, router, state, stepUp]);

  const on: PanelHandlers = {
    show,
    close: () => setState((s) => (s.step === "adding" ? s : { ...CLOSED, done: s.done })),
    retry: () => void fetchEvents(),
    pickEvent: (id) => patch({ eventId: id, failure: null, step: "choose" }),
    toggle: (id) =>
      setState((s) => {
        const next = new Set(s.chosen);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { ...s, chosen: next, failure: null, step: "choose" };
      }),
    chooseEveryone: (ids) => patch({ chosen: new Set(ids), failure: null, step: "choose" }),
    setConfirmed: (v) => patch({ confirmed: v }),
    ask: () => patch({ step: "ask" }),
    back: () => patch({ step: "choose", failure: null }),
    submit: () => void submit(),
  };

  return (
    <>
      <AddToEventView props={props} state={state} on={on} yesRef={yes} />
      <Toast text={toast} onClose={() => setToast(null)} />
    </>
  );
}

/** What happened, for a few seconds, above the phone's bottom bars (the same place as the Undo bar). */
export function Toast({ text, onClose }: { text: string | null; onClose: () => void }) {
  // The portal needs the page: false while the server draws and during hydration, true in the browser.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  if (!mounted || !text) return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="add-to-event-toast"
      className="fixed bottom-[13rem] left-1/2 z-50 w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-[14px] bg-[var(--v2-ink)] text-white shadow-toast md:bottom-20 md:[html[data-slideover]_&]:left-[calc((100vw-520px)/2)] md:[html[data-slideover]_&]:w-[min(34rem,calc(100vw-560px))]"
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

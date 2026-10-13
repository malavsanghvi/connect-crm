"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { useStepUp } from "@/components/step-up";
import type { FamilyCheck } from "@/lib/people-v2/family-model";
import { ADD_RELATIONSHIPS, EMPTY_ADD, addedSentence, checkAddPerson, isChildDraft, type AddPersonDraft } from "@/lib/people-v2/slideover";

import { useFamilyActions } from "./actions";
import { INPUT, Problem } from "./inline-ui";

// "Add person" on the Family page: a card at the end of the people list, never a form page. First name, last name and the relationship
// are enough ("More" holds the birth date, mobile and email); Enter adds. It runs the SAME people.add_person command the classic drawer
// does (through the Server Action behind useFamilyActions().addPerson). A mistake shows under its field before anything is sent; a
// refusal from the server is said in words next to the button with what was typed still there. A child has no mobile or email
// ("contact via parents"), so the card does not offer them.

type Slot = { register: (open: (() => void) | null) => void; request: () => boolean };
const SlotCtx = createContext<Slot | null>(null);

/** Lets the header's "+ Add person" button open and focus the card. */
export function AddPersonProvider({ children }: { children: ReactNode }) {
  const open = useRef<(() => void) | null>(null);
  const api = useMemo<Slot>(
    () => ({
      register: (fn) => {
        open.current = fn;
      },
      request: () => {
        if (!open.current) return false;
        open.current();
        return true;
      },
    }),
    [],
  );
  return <SlotCtx.Provider value={api}>{children}</SlotCtx.Provider>;
}

/** Asks the card to open. True when there is a card to open; false means the caller should follow its link instead. */
export function useRequestAddPerson(): () => boolean {
  const slot = useContext(SlotCtx);
  return () => slot?.request() ?? false;
}

const LABEL = "block text-[12.5px] font-bold text-muted";

export function AddPersonCard({
  householdId,
  householdName,
  householdNumber,
  lastName,
  check,
  detailsHref,
}: {
  householdId: string;
  householdName: string;
  /** The household number, so the family is not named alone ("No. 0301"). */
  householdNumber: string | null;
  /** The primary member's last name, as stored: the card starts with it. */
  lastName: string;
  check: Pick<FamilyCheck, "today" | "majority">;
  /** Where "Open details" for the person just added goes (their id replaces __ID__). */
  detailsHref: string;
}) {
  const slot = useContext(SlotCtx);
  const actions = useFamilyActions();
  const stepUp = useStepUp();
  const router = useRouter();
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);
  /** Moves focus to one of the card's fields (by its id: the card is the only one on the page). */
  const focusField = useCallback((field: keyof AddPersonDraft) => document.getElementById(`${uid}-${field}`)?.focus(), [uid]);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState<AddPersonDraft>({ ...EMPTY_ADD, last: lastName });
  const [problem, setProblem] = useState<{ field: keyof AddPersonDraft; error: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving">("idle");
  const [added, setAdded] = useState<{ sentence: string; personId: string | null } | null>(null);
  const child = isChildDraft(draft, check);

  const show = useCallback(() => {
    setOpen(true);
    setAdded(null);
    window.setTimeout(() => {
      root.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      focusField("first");
    }, 0);
  }, [focusField]);

  useEffect(() => {
    if (!slot) return;
    slot.register(show);
    return () => slot.register(null);
  }, [slot, show]);

  const set = (patch: Partial<AddPersonDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
    setFailure(null);
  };

  function close() {
    setOpen(false);
    setMore(false);
    setProblem(null);
    setFailure(null);
    setDraft({ ...EMPTY_ADD, last: lastName });
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (phase === "saving") return;
    const checked = checkAddPerson(draft, householdId, check);
    if (!checked.ok) {
      setProblem({ field: checked.field, error: checked.error });
      if (checked.field === "dob" || checked.field === "phone" || checked.field === "email") setMore(true);
      window.setTimeout(() => focusField(checked.field), 0);
      return;
    }
    const name = `${draft.first.trim()} ${draft.last.trim()}`;
    setProblem(null);
    setFailure(null);
    setPhase("saving");
    try {
      const result = stepUp ? await stepUp.run(() => actions.addPerson(checked.input), "add a person") : await actions.addPerson(checked.input);
      if (result.ok) {
        setAdded({ sentence: addedSentence(name, draft.role), personId: result.personId });
        setOpen(false);
        setMore(false);
        setDraft({ ...EMPTY_ADD, last: draft.last, role: draft.role });
        setPhase("idle");
        router.refresh();
        return;
      }
      setFailure(result.error);
    } catch (error) {
      console.error("[family] adding a person did not complete:", error);
      setFailure(`Could not add ${name} — the server did not respond. Nothing was added. Try again.`);
    }
    setPhase("idle");
  }

  /** The sentence for a mistake, right under the field it is about. */
  const under = (field: keyof AddPersonDraft) => (problem?.field === field ? <Problem id={`${uid}-problem`}>{problem.error}</Problem> : null);
  const invalid = (field: keyof AddPersonDraft) => (problem?.field === field ? { "aria-invalid": true as const, "aria-describedby": `${uid}-problem` } : {});

  return (
    <div ref={root} id="add-person" data-testid="add-person" className="order-2">
      {added ? (
        <div role="status" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[var(--v2-green-fill)] bg-[var(--v2-green-tint)] px-4 py-3 text-[14px] text-[var(--v2-green-ink)]">
          <span dir="auto" className="font-semibold">
            {added.sentence}.
          </span>
          {added.personId ? (
            <Link href={detailsHref.replace("__ID__", added.personId)} scroll={false} className="font-bold underline">
              Open details
            </Link>
          ) : null}
          <button type="button" onClick={show} className="font-bold underline">
            Add another
          </button>
        </div>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={show}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--v2-blue-border)] bg-transparent text-[15px] font-bold text-[var(--v2-blue)] hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
        >
          <span aria-hidden="true" className="text-[20px] leading-none">
            +
          </span>
          Add a person
        </button>
      ) : (
        <form
          onSubmit={submit}
          noValidate
          aria-labelledby={`${uid}-h`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          className="rounded-2xl border-2 border-[var(--v2-blue)] bg-white p-[18px]"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 id={`${uid}-h`} dir="auto" className="m-0 text-[16px] font-semibold text-ink">
              Add a person to {householdName}
              {householdNumber ? <span className="ml-2 font-mono text-[13px] font-normal text-muted">No. {householdNumber}</span> : null}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Cancel adding a person"
              className="-mr-2 -mt-2 grid size-11 place-items-center rounded-full text-muted hover:bg-[var(--v2-ground)] hover:text-ink"
            >
              <span aria-hidden="true" className="text-[22px] leading-none">
                ×
              </span>
            </button>
          </div>

          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-first`} className={LABEL}>
                First name
              </label>
              <input
                id={`${uid}-first`}
                value={draft.first}
                onChange={(e) => set({ first: e.target.value })}
                dir="auto"
                autoComplete="off"
                className={INPUT}
                {...invalid("first")}
              />
              {under("first")}
            </div>
            <div>
              <label htmlFor={`${uid}-last`} className={LABEL}>
                Last name
              </label>
              <input
                id={`${uid}-last`}
                value={draft.last}
                onChange={(e) => set({ last: e.target.value })}
                dir="auto"
                autoComplete="off"
                className={INPUT}
                {...invalid("last")}
              />
              {under("last")}
            </div>
          </div>

          <div className="mt-3" role="group" aria-labelledby={`${uid}-rel`}>
            <p id={`${uid}-rel`} className={`${LABEL} mb-1.5`}>
              Relationship to the family
            </p>
            <div className="flex flex-wrap gap-2">
              {ADD_RELATIONSHIPS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={draft.role === o.value}
                  onClick={() => set({ role: o.value })}
                  className={`min-h-11 rounded-full border px-4 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] md:min-h-10 ${
                    draft.role === o.value
                      ? "border-[var(--v2-blue)] bg-[var(--v2-blue-tint)] font-bold text-[var(--v2-blue)]"
                      : "border-[var(--v2-line-input)] bg-white text-ink-2 hover:border-[var(--v2-blue)]"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {under("role")}
          </div>

          <button
            type="button"
            onClick={() => setMore((v) => !v)}
            aria-expanded={more}
            aria-controls={`${uid}-more`}
            className="mt-3 min-h-11 rounded-full px-1 text-[13.5px] font-bold text-[var(--v2-blue)] hover:underline md:min-h-9"
          >
            {more ? "Fewer details" : child ? "More details: birth date" : "More details: birth date, mobile, email"}
          </button>
          {more ? (
            <div id={`${uid}-more`} className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`${uid}-dob`} className={LABEL}>
                  Birth date
                </label>
                <input
                  id={`${uid}-dob`}
                  value={draft.dob}
                  onChange={(e) => set({ dob: e.target.value })}
                  inputMode="numeric"
                  placeholder="MM/DD/YYYY"
                  autoComplete="off"
                  className={INPUT}
                  {...invalid("dob")}
                />
                {under("dob")}
              </div>
              {child ? (
                <p className="m-0 self-end pb-2 text-[12.5px] text-muted">Children are contacted through their parents, so there is no mobile or email.</p>
              ) : (
                <>
                  <div>
                    <label htmlFor={`${uid}-phone`} className={LABEL}>
                      Mobile
                    </label>
                    <input
                      id={`${uid}-phone`}
                      type="tel"
                      value={draft.phone}
                      onChange={(e) => set({ phone: e.target.value })}
                      inputMode="tel"
                      autoComplete="off"
                      className={INPUT}
                      {...invalid("phone")}
                    />
                    {under("phone")}
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor={`${uid}-email`} className={LABEL}>
                      Email
                    </label>
                    <input
                      id={`${uid}-email`}
                      type="email"
                      value={draft.email}
                      onChange={(e) => set({ email: e.target.value })}
                      inputMode="email"
                      autoComplete="off"
                      className={INPUT}
                      {...invalid("email")}
                    />
                    {under("email")}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {failure ? (
            <div role="alert" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {failure}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={phase === "saving"}
              className="inline-flex min-h-11 items-center rounded-full bg-navy px-6 text-[14.5px] font-bold text-white hover:bg-navy-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
            >
              {phase === "saving" ? "Adding…" : failure ? "Try again" : "Add person"}
            </button>
            <span className="text-[12.5px] text-muted">Enter adds. Esc cancels.</span>
          </div>
        </form>
      )}
    </div>
  );
}

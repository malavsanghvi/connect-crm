"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { parseDeceasedForm } from "@/lib/deceased";

import { useFamilyActions } from "../family/actions";
import { INPUT, Problem } from "../family/inline-ui";

// "Mark as deceased" and its undo, as a small sheet from the ⋯ menu. The flow is the existing one: the same Server Actions the classic
// page's forms call (markDeceasedAction, undoDeceasedAction), so the database functions, the reason in the audit log and the message
// are unchanged. What is new is only where it is asked: the red button names the person, the boxes are checked before anything is
// sent (with the same sentences), and a failed attempt keeps what was typed and says why next to the button.

export type DeceasedTarget = { id: string; name: string; firstName: string; dateOfBirth: string | null; householdIds: string[] };

const LABEL = "block text-[12.5px] font-bold text-muted";

export function DeceasedSheet({ mode, person, today, onClose }: { mode: "mark" | "undo"; person: DeceasedTarget; today: string; onClose: () => void }) {
  const actions = useFamilyActions();
  const toast = useToast();
  const stepUp = useStepUp();
  const router = useRouter();
  const uid = useId();
  const [on, setOn] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const opener = useRef<Element | null>(null);
  const marking = mode === "mark";

  useEffect(() => {
    opener.current = document.activeElement;
    firstField.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener.current instanceof HTMLElement && document.contains(opener.current)) opener.current.focus({ preventScroll: true });
    };
    // Opened once: running again would steal focus from what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (phase === "saving") return;
    const doing = marking ? `mark ${person.firstName} as deceased` : `undo "deceased" for ${person.firstName}`;
    if (marking) {
      const checked = parseDeceasedForm({ deceased_on: on, note, reason, confirm: confirmed ? "on" : null }, today, person.dateOfBirth);
      if (!checked.ok) return setError(`Could not ${doing} — ${checked.error}.`);
    } else if (!reason.trim()) {
      return setError(`Could not ${doing} — give a reason. It goes in the audit log.`);
    }
    const fd = new FormData();
    fd.set("id", person.id);
    fd.set("name", person.name);
    fd.set("household_ids", person.householdIds.join(","));
    fd.set("reason", reason);
    if (marking) {
      fd.set("date_of_birth", person.dateOfBirth ?? "");
      fd.set("deceased_on", on);
      fd.set("note", note);
      if (confirmed) fd.set("confirm", "on");
    }
    const run = marking ? actions.deceased.mark : actions.deceased.undo;
    setError(null);
    setPhase("saving");
    try {
      const result = stepUp ? await stepUp.run(() => run(null, fd), marking ? "Mark as deceased" : "Undo deceased") : await run(null, fd);
      if (result.ok) {
        if (result.message) toast?.show(result.message, "ok");
        router.refresh();
        onClose();
        return;
      }
      setError(result.error);
    } catch (err) {
      console.error("[slideover] the deceased form did not complete:", err);
      setError(`Could not ${doing} — the server did not respond. Nothing was changed. Try again.`);
    }
    setPhase("idle");
  }

  return createPortal(
    <div className="fixed inset-0 z-[48] grid place-items-center overflow-y-auto bg-ink/50 p-3" data-testid="deceased-sheet">
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-window">
        <h2 id={`${uid}-t`} className="m-0 font-display text-[21px] font-semibold text-ink" dir="auto">
          {marking ? `Mark ${person.name} as deceased` : `Undo “deceased” for ${person.name}`}
        </h2>
        <p className="m-0 mt-1 text-[13.5px] text-muted">
          {marking
            ? "Their giving history and family records are kept. No messages are sent to them, they leave the directory and active counts, and memberships they hold end. It can be undone."
            : "They come back in the directory, lists and messages. Memberships ended by the mark are restored."}
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3" noValidate>
          {marking ? (
            <>
              <div>
                <label htmlFor={`${uid}-on`} className={LABEL}>
                  Date of death
                </label>
                <input
                  id={`${uid}-on`}
                  ref={(el) => {
                    firstField.current = el;
                  }}
                  type="date"
                  max={today}
                  value={on}
                  onChange={(e) => setOn(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label htmlFor={`${uid}-note`} className={LABEL}>
                  Note (optional)
                </label>
                <textarea
                  id={`${uid}-note`}
                  value={note}
                  maxLength={2000}
                  onChange={(e) => setNote(e.target.value)}
                  dir="auto"
                  placeholder="For example: date approximate."
                  className={`${INPUT} min-h-16 py-2`}
                />
              </div>
            </>
          ) : null}
          <div>
            <label htmlFor={`${uid}-why`} className={LABEL}>
              Reason (goes in the audit log)
            </label>
            <textarea
              id={`${uid}-why`}
              ref={
                marking
                  ? undefined
                  : (el) => {
                      firstField.current = el;
                    }
              }
              value={reason}
              maxLength={1000}
              onChange={(e) => setReason(e.target.value)}
              dir="auto"
              placeholder={marking ? "For example: their son called the office." : "For example: recorded by mistake."}
              className={`${INPUT} min-h-16 py-2`}
            />
          </div>
          {marking ? (
            <label className="flex items-start gap-2 text-[13.5px] text-ink">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 size-4" />
              <span dir="auto">
                I confirm {person.name} has passed away. No messages of any kind will be sent to them; their pledges and payments stay on record.
              </span>
            </label>
          ) : null}
          {error ? <Problem>{error}</Problem> : null}
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-11 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-5 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={phase === "saving"}
              className={`inline-flex min-h-11 items-center rounded-full px-5 text-[14px] font-bold text-white disabled:opacity-60 ${marking ? "bg-danger hover:bg-danger-900" : "bg-navy hover:bg-navy-hover"}`}
            >
              {phase === "saving" ? "Working…" : error ? "Try again" : marking ? `Mark ${person.firstName} as deceased` : `Undo for ${person.firstName}`}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

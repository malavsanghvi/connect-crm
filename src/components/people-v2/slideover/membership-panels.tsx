"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";

import type { AssignCall, AssignSave, EditCall, MembershipSave, TierCall } from "@/app/(app)/households/[id]/membership-actions";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { formatDate } from "@/lib/dates";
import { tierLabel } from "@/lib/people";
import {
  MEMBERSHIP_NOTE_MAX,
  MEMBERSHIP_REASON_MAX,
  assignDraftOf,
  assignSentence,
  assignedMessage,
  checkAssign,
  checkEdit,
  checkTierChange,
  defaultEndsOn,
  editChanges,
  editDraftOf,
  feeOffered,
  householdPhrase,
  tierChoices,
  tierSentence,
  type AssignContext,
  type AssignDraft,
  type EditDraft,
  type MembershipRow,
  type TierDraft,
} from "@/lib/people-v2/memberships";

import { INPUT, Problem } from "../family/inline-ui";

// The three inline panels of the Memberships section: edit the dates and note of a membership, change a family's tier, and assign a
// new membership. Each one checks the draft with the same pure rules as the database (src/lib/people-v2/memberships.ts), asks for
// a reason (it goes in the audit log), says in words what will happen, and shows a failure next to what was done with a retry.
// Assign and Change tier end in ONE confirmation sentence. An assigned membership is ACTIVE AT ONCE and does NOT wait for the
// Executive Committee: the panel says so before and in the confirmation.

export type MembershipActions = {
  edit: (input: EditCall) => Promise<MembershipSave>;
  assign: (input: AssignCall) => Promise<AssignSave>;
  tier: (input: TierCall) => Promise<MembershipSave>;
};

/** Where a panel starts: the dev preview and the tests open a panel in a given state; the page opens each one empty. */
export type EditStart = { draft?: Partial<EditDraft>; problem?: { field: string; error: string }; failure?: string };
export type TierStart = { draft?: Partial<TierDraft>; step?: "form" | "confirm"; failure?: string };
export type AssignStart = { draft?: Partial<AssignDraft>; step?: "form" | "confirm"; problem?: { field: string; error: string }; failure?: string };

const LABEL = "block text-[12.5px] font-bold text-muted";
const PRIMARY = "inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]";
const SECONDARY = "inline-flex min-h-11 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-5 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]";

type Issue = { field: string; error: string } | null;

function Field({ id, label, hint, problem, field, children }: { id: string; label: string; hint?: ReactNode; problem: Issue; field: string; children: ReactNode }) {
  const mine = problem && problem.field === field ? problem.error : null;
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 mt-1 text-[12px] text-muted">{hint}</p> : null}
      {mine ? <Problem id={`${id}-problem`}>{mine}</Problem> : null}
    </div>
  );
}

function Failure({ children }: { children: ReactNode }) {
  return (
    <div role="alert" data-testid="membership-failure" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      {children}
    </div>
  );
}

function Shell({ label, children, onSubmit, testId }: { label: string; children: ReactNode; onSubmit?: (e: FormEvent) => void; testId: string }) {
  return (
    <form onSubmit={onSubmit} noValidate aria-label={label} data-testid={testId} className="mt-2 rounded-2xl border-2 border-[var(--v2-blue)] bg-white p-3.5">
      {children}
    </form>
  );
}

/** What every panel does after the server answers: tell the person, refresh the page's data, close. */
function useFinish() {
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  return {
    run: async <R extends { ok: boolean; error?: string; stepUp?: boolean }>(call: () => Promise<R>, what: string): Promise<R> => (stepUp ? stepUp.run(call, what) : call()),
    done(message: string) {
      toast?.show(message, "ok");
      router.refresh();
    },
  };
}

const SERVER_DOWN = (what: string) => `Could not ${what} — the server did not respond. Nothing was changed. Try again.`;

// ---------------------------------------------------------------------------
// Edit the dates and note
// ---------------------------------------------------------------------------
export function EditPanel({
  row,
  siblings,
  today,
  timeZone,
  actions,
  onClose,
  start,
}: {
  row: MembershipRow;
  siblings: readonly MembershipRow[];
  today: string;
  timeZone: string;
  actions: MembershipActions;
  onClose: () => void;
  start?: EditStart;
}) {
  const uid = useId();
  const finish = useFinish();
  const [draft, setDraft] = useState<EditDraft>({ ...editDraftOf(row), ...start?.draft });
  const [problem, setProblem] = useState<Issue>(start?.problem ?? null);
  const [failure, setFailure] = useState<string | null>(start?.failure ?? null);
  const [phase, setPhase] = useState<"idle" | "saving">("idle");
  const change = (patch: Partial<EditDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
    setFailure(null);
  };
  const changes = editChanges(row, draft, timeZone);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (phase === "saving") return;
    const checked = checkEdit(row, draft, today, siblings);
    if (!checked.ok) {
      setProblem({ field: checked.field, error: checked.error });
      return;
    }
    setProblem(null);
    setFailure(null);
    setPhase("saving");
    try {
      const result = await finish.run(() => actions.edit({ ...checked.input, householdId: row.householdId }), "Edit a membership");
      if (result.ok) {
        finish.done(result.message);
        onClose();
        return;
      }
      setFailure(result.error);
    } catch (err) {
      console.error("[slideover] editing a membership did not complete:", err);
      setFailure(SERVER_DOWN("save the membership"));
    }
    setPhase("idle");
  }

  const description = row.fixedTerm
    ? "This kind of membership runs for a set period, so it needs an end date."
    : row.status === "active"
      ? "To end it today, choose today. Leave this empty for no end date."
      : "Leave this empty for no end date.";
  return (
    <Shell
      label="Edit dates and notes"
      testId="membership-edit"
      onSubmit={submit}
    >
      <p className="m-0 mb-3 text-[13.5px] font-semibold text-ink">
        Edit dates and notes · <span dir="auto">{tierLabel(row.tier)} · {row.typeName}</span>
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${uid}-start`} label="Starts on" problem={problem} field="startsOn">
          <input
            id={`${uid}-start`}
            type="date"
            value={draft.startsOn}
            max={row.status === "active" ? today : undefined}
            onChange={(e) => change({ startsOn: e.target.value })}
            aria-invalid={problem?.field === "startsOn" ? true : undefined}
            aria-describedby={problem?.field === "startsOn" ? `${uid}-start-problem` : undefined}
            className={INPUT}
          />
        </Field>
        <Field id={`${uid}-end`} label="Ends on" hint={description} problem={problem} field="endsOn">
          <input
            id={`${uid}-end`}
            type="date"
            value={draft.endsOn}
            onChange={(e) => change({ endsOn: e.target.value })}
            aria-invalid={problem?.field === "endsOn" ? true : undefined}
            aria-describedby={problem?.field === "endsOn" ? `${uid}-end-problem` : undefined}
            className={INPUT}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id={`${uid}-notes`} label="Note" problem={problem} field="notes">
            <textarea
              id={`${uid}-notes`}
              value={draft.notes}
              rows={3}
              maxLength={MEMBERSHIP_NOTE_MAX + 200}
              dir="auto"
              onChange={(e) => change({ notes: e.target.value })}
              className={`${INPUT} min-h-20 py-2`}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id={`${uid}-reason`} label="Why? It goes in the audit log." problem={problem} field="reason">
            <input
              id={`${uid}-reason`}
              type="text"
              value={draft.reason}
              maxLength={MEMBERSHIP_REASON_MAX + 100}
              autoComplete="off"
              dir="auto"
              onChange={(e) => change({ reason: e.target.value })}
              aria-invalid={problem?.field === "reason" ? true : undefined}
              aria-describedby={problem?.field === "reason" ? `${uid}-reason-problem` : undefined}
              className={INPUT}
            />
          </Field>
        </div>
      </div>
      {changes.length > 0 ? (
        <ul data-testid="membership-changes" className="m-0 mt-3 list-none rounded-[10px] bg-[var(--v2-ground)] px-3 py-2 text-[13px] text-ink-2">
          {changes.map((c) => (
            <li key={c} dir="auto">
              {c}
            </li>
          ))}
        </ul>
      ) : null}
      {problem && !["startsOn", "endsOn", "notes", "reason"].includes(problem.field) ? <Problem>{problem.error}</Problem> : null}
      {failure ? <Failure>{failure}</Failure> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={phase === "saving"} className={PRIMARY}>
          {phase === "saving" ? "Saving…" : failure ? "Try again" : "Save changes"}
        </button>
        <button type="button" onClick={onClose} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Change tier
// ---------------------------------------------------------------------------
export function TierPanel({
  live,
  ctx,
  actions,
  onClose,
  start,
}: {
  live: MembershipRow;
  ctx: AssignContext;
  actions: MembershipActions;
  onClose: () => void;
  start?: TierStart;
}) {
  const uid = useId();
  const finish = useFinish();
  const choices = tierChoices(ctx.types, live.tier);
  const [draft, setDraft] = useState<TierDraft>({ tier: choices[0] ?? "", reason: "", ...start?.draft });
  const [step, setStep] = useState<"form" | "confirm">(start?.step ?? "form");
  const [problem, setProblem] = useState<Issue>(null);
  const [failure, setFailure] = useState<string | null>(start?.failure ?? null);
  const [phase, setPhase] = useState<"idle" | "saving">("idle");
  const checked = checkTierChange({ householdId: ctx.householdId, currentTier: live.tier, choices }, draft);

  function review(e?: FormEvent) {
    e?.preventDefault();
    if (!checked.ok) {
      setProblem({ field: checked.field, error: checked.error });
      return;
    }
    setProblem(null);
    setFailure(null);
    setStep("confirm");
  }

  async function confirm() {
    if (phase === "saving" || !checked.ok) return;
    setFailure(null);
    setPhase("saving");
    try {
      const result = await finish.run(() => actions.tier(checked.input), "Change the membership tier");
      if (result.ok) {
        finish.done(result.message);
        onClose();
        return;
      }
      setFailure(result.error);
    } catch (err) {
      console.error("[slideover] changing the tier did not complete:", err);
      setFailure(SERVER_DOWN("change the membership tier"));
    }
    setPhase("idle");
  }

  if (choices.length === 0) {
    return (
      <Shell label="Change tier" testId="membership-tier">
        <p className="m-0 text-[13.5px] text-ink-2">This community offers no other tier to change to.</p>
        <div className="mt-3">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Close
          </button>
        </div>
      </Shell>
    );
  }

  if (step === "confirm" && checked.ok) {
    return (
      <Shell label="Change tier" testId="membership-tier">
        <div role="group" aria-label="Confirm the tier change" data-testid="membership-confirm" className="rounded-[10px] bg-[var(--v2-ground)] px-3 py-2.5 text-[14px] leading-relaxed text-ink" dir="auto">
          <p className="m-0">{tierSentence({ household: ctx.household, from: live.tier, to: checked.input.tier })}</p>
          <p className="m-0 mt-1.5 text-[13px] text-ink-2">Reason: {checked.input.reason}</p>
        </div>
        {failure ? <Failure>{failure}</Failure> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={confirm} disabled={phase === "saving"} className={PRIMARY}>
            {phase === "saving" ? "Changing…" : failure ? "Try again" : "Yes, change the tier"}
          </button>
          <button type="button" onClick={() => setStep("form")} disabled={phase === "saving"} className={SECONDARY}>
            Back
          </button>
          <button type="button" onClick={onClose} disabled={phase === "saving"} className={SECONDARY}>
            Cancel
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell label="Change tier" testId="membership-tier" onSubmit={review}>
      <p className="m-0 mb-3 text-[13.5px] font-semibold text-ink">
        Change tier · now {tierLabel(live.tier)}
      </p>
      <div className="grid gap-3">
        <Field id={`${uid}-tier`} label="Change to" problem={problem} field="tier">
          <select
            id={`${uid}-tier`}
            value={draft.tier}
            onChange={(e) => {
              setDraft((d) => ({ ...d, tier: e.target.value }));
              setProblem(null);
            }}
            className={INPUT}
          >
            {choices.map((t) => (
              <option key={t} value={t}>
                {tierLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`${uid}-reason`} label="Why? It goes in the audit log." problem={problem} field="reason">
          <input
            id={`${uid}-reason`}
            type="text"
            value={draft.reason}
            maxLength={MEMBERSHIP_REASON_MAX + 100}
            autoComplete="off"
            dir="auto"
            onChange={(e) => {
              setDraft((d) => ({ ...d, reason: e.target.value }));
              setProblem(null);
            }}
            className={INPUT}
          />
        </Field>
      </div>
      {failure ? <Failure>{failure}</Failure> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" className={PRIMARY}>
          Review
        </button>
        <button type="button" onClick={onClose} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Assign a membership
// ---------------------------------------------------------------------------
export function AssignPanel({
  ctx,
  today,
  timeZone,
  actions,
  onClose,
  start,
}: {
  ctx: AssignContext;
  today: string;
  timeZone: string;
  actions: MembershipActions;
  onClose: () => void;
  start?: AssignStart;
}) {
  const uid = useId();
  const finish = useFinish();
  const [draft, setDraft] = useState<AssignDraft>({ ...assignDraftOf(ctx, today), ...start?.draft });
  const [step, setStep] = useState<"form" | "confirm">(start?.step ?? "form");
  const [problem, setProblem] = useState<Issue>(start?.problem ?? null);
  const [failure, setFailure] = useState<string | null>(start?.failure ?? null);
  const [phase, setPhase] = useState<"idle" | "saving">("idle");
  const type = ctx.types.find((t) => t.id === draft.typeId);
  const offered = feeOffered(ctx, type);
  const checked = checkAssign(ctx, draft, today);
  const change = (patch: Partial<AssignDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
    setFailure(null);
  };

  function review(e?: FormEvent) {
    e?.preventDefault();
    if (!checked.ok) {
      setProblem({ field: checked.field, error: checked.error });
      return;
    }
    setProblem(null);
    setFailure(null);
    setStep("confirm");
  }

  async function confirm() {
    if (phase === "saving" || !checked.ok) return;
    const { request, type: chosen } = checked.input;
    setFailure(null);
    setPhase("saving");
    try {
      const result = await finish.run(() => actions.assign(request), "Assign a membership");
      if (result.ok) {
        finish.done(assignedMessage({ typeName: chosen.name, tier: chosen.tier, feeRecorded: result.feeRecorded, wantedFee: request.recordFee }));
        onClose();
        return;
      }
      setFailure(result.error);
    } catch (err) {
      console.error("[slideover] assigning a membership did not complete:", err);
      setFailure(SERVER_DOWN("assign the membership"));
    }
    setPhase("idle");
  }

  if (step === "confirm" && checked.ok) {
    return (
      <Shell label="Assign a membership" testId="membership-assign">
        <div role="group" aria-label="Confirm the new membership" data-testid="membership-confirm" className="rounded-[10px] bg-[var(--v2-ground)] px-3 py-2.5 text-[14px] leading-relaxed text-ink" dir="auto">
          <p className="m-0">{assignSentence(ctx, checked.input, timeZone)}</p>
          <p className="m-0 mt-1.5 text-[13px] text-ink-2">Reason: {checked.input.request.reason}</p>
        </div>
        {failure ? <Failure>{failure}</Failure> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={confirm} disabled={phase === "saving"} className={PRIMARY}>
            {phase === "saving" ? "Assigning…" : failure ? "Try again" : "Yes, assign it"}
          </button>
          <button type="button" onClick={() => setStep("form")} disabled={phase === "saving"} className={SECONDARY}>
            Back
          </button>
          <button type="button" onClick={onClose} disabled={phase === "saving"} className={SECONDARY}>
            Cancel
          </button>
        </div>
      </Shell>
    );
  }

  const earliestEnd = type ? defaultEndsOn(draft.startsOn.trim(), type.periodMonths) : null;
  return (
    <Shell label="Assign a membership" testId="membership-assign" onSubmit={review}>
      <p className="m-0 text-[13.5px] font-semibold text-ink">Assign a membership</p>
      <p className="m-0 mb-3 mt-1 text-[12.5px] text-ink-2" dir="auto">
        For {householdPhrase(ctx.household)}. It is active at once and does not wait for the Executive Committee.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field id={`${uid}-type`} label="Membership type" problem={problem} field="typeId">
            <select
              id={`${uid}-type`}
              value={draft.typeId}
              onChange={(e) => change({ typeId: e.target.value, recordFee: false })}
              aria-invalid={problem?.field === "typeId" ? true : undefined}
              aria-describedby={problem?.field === "typeId" ? `${uid}-type-problem` : undefined}
              className={INPUT}
            >
              <option value="">Choose a type…</option>
              {ctx.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · {tierLabel(t.tier)} · {t.feeLabel ?? "no fee"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id={`${uid}-start`} label="Starts on" problem={problem} field="startsOn">
          <input
            id={`${uid}-start`}
            type="date"
            value={draft.startsOn}
            max={today}
            onChange={(e) => change({ startsOn: e.target.value })}
            aria-invalid={problem?.field === "startsOn" ? true : undefined}
            aria-describedby={problem?.field === "startsOn" ? `${uid}-start-problem` : undefined}
            className={INPUT}
          />
        </Field>
        <Field
          id={`${uid}-end`}
          label="Ends on (optional)"
          hint={type ? (earliestEnd ? `Leave empty to end on ${formatDate(earliestEnd, timeZone)}.` : "Leave empty for no end date.") : "Choose a type to see when it ends."}
          problem={problem}
          field="endsOn"
        >
          <input
            id={`${uid}-end`}
            type="date"
            value={draft.endsOn}
            onChange={(e) => change({ endsOn: e.target.value })}
            aria-invalid={problem?.field === "endsOn" ? true : undefined}
            aria-describedby={problem?.field === "endsOn" ? `${uid}-end-problem` : undefined}
            className={INPUT}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id={`${uid}-holder`} label="Holder" hint="Adults of the family only." problem={problem} field="holderId">
            <select id={`${uid}-holder`} value={draft.holderId} onChange={(e) => change({ holderId: e.target.value })} className={INPUT} dir="auto">
              {ctx.holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
              <option value="">No holder named</option>
            </select>
          </Field>
        </div>
        {type && type.feeCents > 0 ? (
          <div className="sm:col-span-2">
            {offered ? (
              <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-ink">
                <input type="checkbox" checked={draft.recordFee} onChange={(e) => change({ recordFee: e.target.checked })} className="size-5 accent-[var(--v2-blue)]" />
                <span>Record the {type.feeLabel} fee as an open pledge</span>
              </label>
            ) : (
              <p className="m-0 text-[12.5px] text-muted">Pledges & donations is switched off, so the {type.feeLabel} fee cannot be recorded.</p>
            )}
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Field id={`${uid}-reason`} label="Why? It goes in the audit log." problem={problem} field="reason">
            <input
              id={`${uid}-reason`}
              type="text"
              value={draft.reason}
              maxLength={MEMBERSHIP_REASON_MAX + 100}
              autoComplete="off"
              dir="auto"
              onChange={(e) => change({ reason: e.target.value })}
              aria-invalid={problem?.field === "reason" ? true : undefined}
              aria-describedby={problem?.field === "reason" ? `${uid}-reason-problem` : undefined}
              className={INPUT}
            />
          </Field>
        </div>
      </div>
      {failure ? <Failure>{failure}</Failure> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" className={PRIMARY}>
          Review
        </button>
        <button type="button" onClick={onClose} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </Shell>
  );
}

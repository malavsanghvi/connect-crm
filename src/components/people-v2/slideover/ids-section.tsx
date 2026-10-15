"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { padOrgId } from "@/lib/identifiers";
import { groupIds, retiredIds, type DetailId, type IdsFacts, type PersonDetailModel } from "@/lib/people-v2/slideover";

import { useFamilyActions } from "../family/actions";
import { INPUT, Problem } from "../family/inline-ui";

// A person's IDs as chips, grouped by kind: the member number Weaver issued, the organization's own member ID, old system IDs, and
// (only for people who may read finance) the accounting, bank and payment-provider ones. "+ Add ID" opens a small panel; each chip
// has its own Retire. Both go through useFamilyActions().ids, the one seam (src/app/(app)/identifiers/person-id-seam.ts) that the
// More-menu slice swaps for commands, so nothing here changes then. Retiring asks to confirm; it stops the ID matching from today
// and keeps it in the history.

const LABEL = "block text-[12.5px] font-bold text-muted";

export function IdsSection({ detail, facts }: { detail: PersonDetailModel; facts: IdsFacts }) {
  const groups = groupIds(facts.rows);
  const retired = retiredIds(facts.rows);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const visible = groups.map((g) => ({ ...g, items: g.items.filter((i) => !gone.has(i.id)) })).filter((g) => g.items.length > 0);

  return (
    <div data-testid="ids-section">
      {visible.length === 0 ? <p className="m-0 py-1 text-[14px] text-muted">No IDs recorded for {detail.person.firstName}.</p> : null}
      {visible.map((g) => (
        <div key={g.kind} className="py-1.5" data-kind={g.kind}>
          <p className="m-0 mb-1 text-[13px] text-muted">{g.label}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {g.items.map((i) => (
              <IdChip key={i.id} id={i} detail={detail} onGone={() => setGone((s) => new Set(s).add(i.id))} />
            ))}
          </ul>
        </div>
      ))}

      {retired.length > 0 ? (
        <details className="mt-1 text-[13px] text-muted">
          <summary className="min-h-9 cursor-pointer py-1.5">Retired ({retired.length})</summary>
          <ul className="m-0 list-none p-0">
            {retired.map((i) => (
              <li key={i.id} className="py-0.5">
                {i.label} <span className="font-mono text-[13px] text-ink-2">{i.value}</span> · stays in the history
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {facts.hiddenKinds.length > 0 ? (
        <p className="m-0 mt-1 text-[12px] text-muted">{facts.hiddenKinds.join(", ")} {facts.hiddenKinds.length === 1 ? "is" : "are"} only visible with a giving permission.</p>
      ) : null}

      {facts.addKinds.length > 0 ? (
        adding ? (
          <AddIdPanel
            detail={detail}
            facts={facts}
            onClose={() => {
              setAdding(false);
              window.setTimeout(() => addButton.current?.focus(), 0);
            }}
          />
        ) : (
          <button
            ref={addButton}
            type="button"
            onClick={() => setAdding(true)}
            className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)]"
          >
            <span aria-hidden="true" className="text-[18px] leading-none">
              +
            </span>
            Add ID
          </button>
        )
      ) : null}
      <p className="m-0 mt-2 text-[12px] text-muted">Every one of these finds {detail.person.firstName} in the search box.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One chip, with its Retire
// ---------------------------------------------------------------------------
function IdChip({ id, detail, onGone }: { id: DetailId; detail: PersonDetailModel; onGone: () => void }) {
  const actions = useFamilyActions();
  const stepUp = useStepUp();
  const toast = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [phase, setPhase] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const retireButton = useRef<HTMLButtonElement>(null);

  async function retire() {
    if (phase === "working") return;
    // A reason is required (it goes in the audit log): ask before anything is sent, and keep what was typed.
    if (!reason.trim()) {
      setError("Give a reason: it goes in the audit log.");
      return;
    }
    setPhase("working");
    setError(null);
    const call = () => actions.ids.retire({ id: id.id, personId: detail.person.id, householdId: detail.household?.id ?? null, reason: reason.trim() });
    try {
      const result = stepUp ? await stepUp.run(call, "Retire an ID") : await call();
      if (result.ok) {
        if (result.message) toast?.show(result.message, "ok");
        onGone();
        router.refresh();
        return;
      }
      setError(result.error);
    } catch (e) {
      console.error("[slideover] retiring an ID did not complete:", e);
      setError(`Could not retire the ${id.label} — the server did not respond. Nothing was changed. Try again.`);
    }
    setPhase("idle");
  }

  return (
    <li className="max-w-full">
      <span className="inline-flex min-h-9 max-w-full items-center gap-1 rounded-full border border-[var(--v2-line-input)] bg-white pl-3 pr-1 text-[13px] text-ink-2">
        <span className="min-w-0 break-all font-mono text-[13px] font-semibold text-ink" dir="auto" title={id.system ? `${id.label} · ${id.system}` : id.label}>
          {id.value}
        </span>
        {id.canRetire ? (
          <button
            ref={retireButton}
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Retire ${id.label} ${id.value}`}
            aria-expanded={confirming}
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-danger-50 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
          >
            <span aria-hidden="true" className="text-[17px] leading-none">
              ×
            </span>
          </button>
        ) : (
          <span className="w-2" />
        )}
      </span>
      {confirming ? (
        <div role="group" aria-label={`Retire ${id.label} ${id.value}`} className="mt-1.5 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-ink">
          <p className="m-0">
            Retire {id.label} <span className="font-mono font-semibold">{id.value}</span>? It stops matching from today but stays in the history.
          </p>
          <label className="mt-2 flex flex-col gap-1 text-[13px] font-semibold text-ink">
            Why? It goes in the audit log.
            <input
              type="text"
              value={reason}
              maxLength={1000}
              autoComplete="off"
              disabled={phase === "working"}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void retire();
                }
              }}
              className="min-h-10 w-full rounded-field border border-[var(--v2-line-input)] bg-white px-3 text-[14px] font-normal text-ink outline-none focus:border-[var(--v2-blue)]"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={retire}
              disabled={phase === "working"}
              className="inline-flex min-h-10 items-center rounded-full bg-danger px-4 text-[13.5px] font-bold text-white hover:bg-danger-900 disabled:opacity-60"
            >
              {phase === "working" ? "Retiring…" : error ? "Try again" : "Yes, retire it"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setError(null);
                setReason("");
                window.setTimeout(() => retireButton.current?.focus(), 0);
              }}
              className="inline-flex min-h-10 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[13.5px] font-bold text-ink"
            >
              Keep it
            </button>
          </div>
          {error ? <Problem>{error}</Problem> : null}
        </div>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// + Add ID
// ---------------------------------------------------------------------------
function AddIdPanel({ detail, facts, onClose }: { detail: PersonDetailModel; facts: IdsFacts; onClose: () => void }) {
  const actions = useFamilyActions();
  const stepUp = useStepUp();
  const toast = useToast();
  const router = useRouter();
  const uid = useId();
  const [kind, setKind] = useState(facts.addKinds[0]?.kind ?? "");
  const current = facts.addKinds.find((k) => k.kind === kind);
  const [system, setSystem] = useState(current?.systems[0]?.system ?? "");
  const [label, setLabel] = useState(current?.systems[0]?.label ?? "");
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "saving">("idle");
  const digits = kind === "org_member" ? facts.orgMemberDigits : null;

  function chooseKind(next: string) {
    setKind(next);
    const k = facts.addKinds.find((x) => x.kind === next);
    setSystem(k?.systems[0]?.system ?? "");
    setLabel(k?.systems[0]?.label ?? "");
    setProblem(null);
    setFailure(null);
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (phase === "saving") return;
    const v = value.trim();
    if (!v) return setProblem(`Enter the ${current?.label ?? "ID"} exactly as the other system shows it`);
    if (!system.trim()) return setProblem("Say which system it comes from (for example neon or quickbooks)");
    setProblem(null);
    setFailure(null);
    setPhase("saving");
    const call = () =>
      actions.ids.add({ personId: detail.person.id, householdId: detail.household?.id ?? null, kind, system: system.trim(), value: v, label: label.trim() || undefined });
    try {
      const result = stepUp ? await stepUp.run(call, "Add an ID") : await call();
      if (result.ok) {
        if (result.message) toast?.show(result.message, "ok");
        router.refresh();
        onClose();
        return;
      }
      setFailure(result.error);
    } catch (err) {
      console.error("[slideover] adding an ID did not complete:", err);
      setFailure("Could not add the ID — the server did not respond. Nothing was added. Try again.");
    }
    setPhase("idle");
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Add an ID"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="mt-2 rounded-2xl border-2 border-[var(--v2-blue)] bg-white p-3.5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-kind`} className={LABEL}>
            Kind of ID
          </label>
          <select id={`${uid}-kind`} value={kind} onChange={(e) => chooseKind(e.target.value)} className={INPUT}>
            {facts.addKinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          {current?.hint ? <p className="m-0 mt-1 text-[12px] text-muted">{current.hint}</p> : null}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-value`} className={LABEL}>
            Value, exactly as the other system shows it
          </label>
          <input
            id={`${uid}-value`}
            autoFocus
            value={value}
            maxLength={200}
            onChange={(e) => {
              setValue(e.target.value);
              setProblem(null);
              setFailure(null);
            }}
            autoComplete="off"
            spellCheck={false}
            dir="auto"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${uid}-problem` : undefined}
            className={`${INPUT} font-mono`}
          />
          {digits ? (
            <p className="m-0 mt-1 text-[12px] text-muted">
              Numbers are kept at {digits} digits with leading zeros: 417 is saved as {padOrgId("417", digits)}.
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={`${uid}-system`} className={LABEL}>
            System
          </label>
          {current && current.systems.length > 1 ? (
            <select id={`${uid}-system`} value={system} onChange={(e) => setSystem(e.target.value)} className={INPUT}>
              {current.systems.map((s) => (
                <option key={s.system} value={s.system}>
                  {s.label ? `${s.label} — ${s.system}` : s.system}
                </option>
              ))}
            </select>
          ) : (
            <input id={`${uid}-system`} value={system} onChange={(e) => setSystem(e.target.value)} autoComplete="off" spellCheck={false} className={INPUT} />
          )}
        </div>
        <div>
          <label htmlFor={`${uid}-label`} className={LABEL}>
            Label (optional)
          </label>
          <input id={`${uid}-label`} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} autoComplete="off" className={INPUT} />
        </div>
      </div>
      {problem ? <Problem id={`${uid}-problem`}>{problem}</Problem> : null}
      {failure ? (
        <div role="alert" className="mt-3 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {failure}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={phase === "saving"}
          className="inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover disabled:opacity-60"
        >
          {phase === "saving" ? "Adding…" : failure ? "Try again" : "Add ID"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-5 text-[14px] font-bold text-ink hover:border-[var(--v2-blue)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

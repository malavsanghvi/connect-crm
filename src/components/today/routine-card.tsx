"use client";

import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/brand/icons";
import { AskNiva } from "@/components/niva/ask-niva";
import { Card, EmptyState, Tag, buttonClass } from "@/components/ui";
import { isHandTickable, nextStep, routineProgress, stepIsDone, type ResolvedRoutine, type ResolvedStep } from "@/lib/routines/resolve";

const LATER_SHOWN = 6;

/** The roles every community has a starting routine for (a school's principal is added when the community has a school). */
const STARTING_ROLES = ["administrators", "treasurers", "membership coordinators", "event leads"];

function listOf(parts: readonly string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * "Your routine": the steps due today, grouped by when, the next undone one highlighted. A step with a counter ticks itself when the
 * data says it is done; every other step is ticked by the person here. Those ticks are NOT saved (remembering them needs a small
 * table, a later step), so the card says so instead of pretending.
 */
export function RoutineCard({ routine }: { routine: ResolvedRoutine }) {
  const [ticked, setTicked] = useState<string[]>([]);
  const set = new Set(ticked);
  const progress = routineProgress(routine, ticked);
  const next = nextStep(routine, ticked);
  const manyRoles = routine.roles.length > 1;
  const toggle = (key: string) => setTicked((t) => (t.includes(key) ? t.filter((k) => k !== key) : [...t, key]));

  const description =
    routine.roles.length === 0
      ? "Starting routines are written for each role"
      : `${routine.roles.map((r) => r.title).join(" and ")}${progress.total > 0 ? ` · ${progress.done} of ${progress.total} done` : ""}`;

  return (
    <Card span={7} title="Your routine" description={description}>
      {progress.total > 0 ? (
        <div
          role="progressbar"
          aria-label="Routine progress"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.done}
          aria-valuetext={`${progress.done} of ${progress.total} done`}
          className="mb-3 h-2 overflow-hidden rounded-full bg-line-soft"
        >
          <div className="h-2 rounded-full bg-success" style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
        </div>
      ) : null}

      {routine.roles.length === 0 ? (
        <EmptyState title="No routine for your role yet">
          Weaver has starting routines for {listOf(routine.startingRoles ?? STARTING_ROLES)}. Your tasks are below.
        </EmptyState>
      ) : routine.groups.length === 0 ? (
        <EmptyState title="Nothing in your routine is due today" />
      ) : (
        <>
          {progress.left === 0 ? (
            <p role="status" className="mb-2 text-[14px] font-bold text-success">
              Your routine is done for today.
            </p>
          ) : null}
          {routine.groups.map((g) => (
            <section key={g.when} aria-label={g.label} className="mb-3 last:mb-0">
              <h3 className="px-2 pb-1 pt-2 text-[12px] font-bold uppercase tracking-[0.04em] text-navy">{g.label}</h3>
              <ul className="m-0 list-none p-0">
                {g.steps.map((s) => (
                  <StepRow
                    key={s.key}
                    step={s}
                    done={stepIsDone(s, set)}
                    isNext={next?.key === s.key}
                    showRole={manyRoles}
                    onToggle={() => toggle(s.key)}
                  />
                ))}
              </ul>
            </section>
          ))}
          <p className="mt-3 text-[12px] text-muted">
            Steps marked “You do this” are ticked by you. Those ticks are not saved yet, so they clear when you leave this page.
          </p>
        </>
      )}

      {routine.later.length > 0 ? (
        <section aria-label="Coming up" className="mt-4 border-t border-line-soft pt-3">
          <h3 className="pb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted">Coming up</h3>
          <ul className="m-0 list-none p-0 text-[13px] text-muted">
            {routine.later.slice(0, LATER_SHOWN).map((l) => (
              <li key={l.key} className="py-0.5">
                {l.title} <span className="text-faint">· {l.dueText}</span>
              </li>
            ))}
            {routine.later.length > LATER_SHOWN ? <li className="py-0.5 text-faint">and {routine.later.length - LATER_SHOWN} more</li> : null}
          </ul>
        </section>
      ) : null}
    </Card>
  );
}

function StepRow({
  step,
  done,
  isNext,
  showRole,
  onToggle,
}: {
  step: ResolvedStep;
  done: boolean;
  isNext: boolean;
  showRole: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      aria-current={isNext ? "step" : undefined}
      className={`flex flex-wrap items-start gap-3 rounded-xl px-2 py-2.5 ${isNext ? "border border-navy/30 bg-highlight" : "border border-transparent"}`}
    >
      <StepBox step={step} done={done} onToggle={onToggle} />
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-bold leading-snug ${done ? "text-muted line-through" : "text-ink"}`}>
          {step.title}
          {showRole ? <span className="ml-2 align-middle text-[11px] font-bold uppercase tracking-wide text-faint">{step.roleTitles.join(" · ")}</span> : null}
        </p>
        <p className="text-[13px] leading-snug text-muted">{step.why}</p>
        {step.eventNote ? <p className="text-[13px] font-bold leading-snug text-ink">{step.eventNote}</p> : null}
        <p className={`text-[13px] leading-snug ${step.state === "unknown" ? "text-danger" : step.state === "open" ? "font-bold text-brown" : "text-muted"}`}>
          {step.detail}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tag color={step.tag === "Auto-checked" ? "navy" : "muted"}>{step.tag}</Tag>
        <Link href={step.href} className={buttonClass(isNext ? "primary" : "ghost", "sm")}>
          {isNext ? "Do this next" : "Open"}
        </Link>
        {step.ask ? <AskNiva prompt={step.ask} /> : null}
      </div>
    </li>
  );
}

/** A tick the data owns (a round mark you cannot press) or one the person owns (a button). */
function StepBox({ step, done, onToggle }: { step: ResolvedStep; done: boolean; onToggle: () => void }) {
  const look = `mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-success bg-success text-white" : "border-line bg-white text-transparent"}`;
  const tick = (
    <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />
  );
  if (isHandTickable(step)) {
    return (
      <button type="button" role="checkbox" aria-checked={done} aria-label={`Mark done: ${step.title}`} onClick={onToggle} className={`${look} cursor-pointer`}>
        {tick}
      </button>
    );
  }
  return (
    <span role="img" aria-label={done ? "Done" : "Not done yet"} className={look}>
      {tick}
    </span>
  );
}

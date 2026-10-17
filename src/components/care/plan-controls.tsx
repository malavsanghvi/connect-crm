"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { approvePlanAction, draftPlanAction, savePlanAction, setMemberAskAction, setNivaAction } from "@/app/(app)/care/plan/actions";
import { buttonClass } from "@/components/ui";
import { MAX_MOMENTS, PLAN_GROUPS, PLAN_GROUP_LABEL, checkPlan, type PlanInput, type PlanItemInput } from "@/lib/care/plan";
import { STEP_KINDS, STEP_KIND_LABEL } from "@/lib/care/playbooks";

// The care plan's controls (DonorDelight slice 8; care.manage): draft the year from the mission and calendar, edit the moments, approve, and the organization's
// tick for Niva. Each says what happened in words next to the button; a refusal keeps what was typed. A plan is never paired with an ask.

type Say = { ok: boolean; text: string } | null;
function SayLine({ say }: { say: Say }) {
  if (!say) return null;
  return (
    <p role={say.ok ? "status" : "alert"} className={`m-0 text-[13px] ${say.ok ? "text-success" : "text-danger"}`}>
      {say.text}
    </p>
  );
}

export function DraftPlan({ year, label, replace }: { year: number; label: string; replace: boolean }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  const [sure, setSure] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      {replace && !sure ? (
        <button type="button" className={buttonClass("plain", "sm")} onClick={() => setSure(true)}>
          Start again from the mission and calendar
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          className={buttonClass(replace ? "bad" : "primary", "sm")}
          onClick={() => {
            setSay(null);
            start(async () => {
              const r = await draftPlanAction({ year, replace });
              setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            });
          }}
        >
          {pending ? "Drafting…" : replace ? `Replace the ${year} moments with a new draft` : `Draft the ${year} plan`}
        </button>
      )}
      <span className="text-[12.5px] text-muted">From your mission, your calendar, your fiscal year and your quiet periods. {label} edits it, then approves it.</span>
      <SayLine say={say} />
    </div>
  );
}

export function ApprovePlan({ year }: { year: number }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className={buttonClass("primary", "sm")}
        onClick={() => {
          setSay(null);
          start(async () => {
            const r = await approvePlanAction({ year });
            setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          });
        }}
      >
        {pending ? "Approving…" : `Approve the ${year} plan`}
      </button>
      <SayLine say={say} />
    </div>
  );
}

export function PlanEditor({ year, initial }: { year: number; initial: PlanInput }) {
  const router = useRouter();
  const [p, setP] = useState<PlanInput>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const summaryId = useId();
  const setItem = (i: number, patch: Partial<PlanItemInput>) => setP((cur) => ({ ...cur, items: cur.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) }));

  function save() {
    setError(null);
    const checked = checkPlan(year, p);
    if (!checked.ok) return setError(`Could not save the plan — ${checked.error} Nothing was changed.`);
    start(async () => {
      const r = await savePlanAction({ year, plan: p });
      if (!r.ok) return setError(r.error);
      router.push(`/care/plan?year=${year}`);
      router.refresh();
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <p className="m-0 text-[13px] text-muted">A moment is a touch to make for a group of households on a day. It never asks for money. Saving makes the plan a draft until you approve it.</p>
      <div>
        <label htmlFor={summaryId} className="crm-label">
          Summary
        </label>
        <textarea id={summaryId} value={p.summary} onChange={(e) => setP({ ...p, summary: e.target.value })} rows={3} maxLength={1000} className="crm-input" />
      </div>
      <div className="flex flex-col gap-2.5">
        {p.items.map((it, i) => (
          <fieldset key={it.id ?? `new-${i}`} className="rounded-field border border-line px-3 py-2.5">
            <legend className="px-1 text-[12.5px] font-bold text-ink">Moment {i + 1}</legend>
            <div className="grid gap-2.5 md:grid-cols-[150px_1fr_220px_190px]">
              <input type="date" value={it.on} onChange={(e) => setItem(i, { on: e.target.value })} className="crm-input" aria-label={`Moment ${i + 1}: day`} />
              <input value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} maxLength={120} className="crm-input" aria-label={`Moment ${i + 1}: title`} />
              <select value={it.group} onChange={(e) => setItem(i, { group: e.target.value as PlanItemInput["group"] })} className="crm-input" aria-label={`Moment ${i + 1}: for whom`}>
                {PLAN_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {PLAN_GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
              <select value={it.kind} onChange={(e) => setItem(i, { kind: e.target.value as PlanItemInput["kind"] })} className="crm-input" aria-label={`Moment ${i + 1}: the touch`}>
                {STEP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {STEP_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <input value={it.note} onChange={(e) => setItem(i, { note: e.target.value })} maxLength={400} placeholder="A note (optional)" className="crm-input mt-2" aria-label={`Moment ${i + 1}: note`} />
            <div className="mt-1.5">
              <button type="button" onClick={() => setP({ ...p, items: p.items.filter((_, j) => j !== i) })} className={buttonClass("plain", "xs")}>
                Remove this moment
              </button>
            </div>
          </fieldset>
        ))}
        <div>
          <button
            type="button"
            disabled={p.items.length >= MAX_MOMENTS}
            onClick={() => setP({ ...p, items: [...p.items, { id: null, on: `${year}-01-15`, title: "", group: "all", kind: "greeting", note: "" }] })}
            className={buttonClass("ghost", "sm")}
          >
            Add a moment
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Saving…" : "Save the plan"}
        </button>
        <Link href={`/care/plan?year=${year}`} className={buttonClass("plain")}>
          Cancel
        </Link>
        {error ? (
          <p role="alert" className="m-0 text-[13.5px] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

export function NivaTick({ enabled, ai, canManage }: { enabled: boolean; ai: boolean; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  const [on, setOn] = useState(enabled);
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13.5px] text-ink-2">
        With this on, Niva can brief a person before a call, show their week, draft a personal note and talk through the yearly care plan, and, when the person confirms, record a touch. It sees only what that person may
        see: adults only, no amounts, no notes, never why a household is not to be asked. It drafts; a person sends.
      </p>
      {ai ? null : <p className="m-0 text-[13px] font-semibold text-brown">iWeaver is not on for your organization, so Niva cannot help yet. Request it in Settings, Marketplace.</p>}
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2.5 text-[14px]">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-5 w-5" />
            <span className="font-semibold">Niva may help with relationship care</span>
          </label>
          <button
            type="button"
            disabled={pending || on === enabled}
            className={buttonClass("primary", "sm")}
            onClick={() => {
              setSay(null);
              start(async () => {
                const r = await setNivaAction({ enabled: on });
                setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
              });
            }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <SayLine say={say} />
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">{enabled ? "Niva may help with relationship care." : "Niva is not set up for relationship care."} Someone who manages this area can change that.</p>
      )}
    </div>
  );
}

export function MemberAskTick({ enabled, canManage }: { enabled: boolean; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  const [on, setOn] = useState(enabled);
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13.5px] text-ink-2">
        With this on, an adult in the member app is asked three things for their household: how they would like to be thanked, how they would like to be recognised, and how to reach them. They see only their own
        choices, never notes, signs or who looks after them; the answers become part of the household&apos;s care profile, seen by the people you gave care roles. Children are never asked.
      </p>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2.5 text-[14px]">
            <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-5 w-5" />
            <span className="font-semibold">Ask members how they would like to be thanked</span>
          </label>
          <button
            type="button"
            disabled={pending || on === enabled}
            className={buttonClass("primary", "sm")}
            onClick={() => {
              setSay(null);
              start(async () => {
                const r = await setMemberAskAction({ enabled: on });
                setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
              });
            }}
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <SayLine say={say} />
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">{enabled ? "Members are asked in the app." : "Members are not asked yet."} Someone who manages this area can change that.</p>
      )}
    </div>
  );
}

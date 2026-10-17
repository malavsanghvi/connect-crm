"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { savePlaybookAction } from "@/app/(app)/care/playbooks/actions";
import { buttonClass } from "@/components/ui";
import { CHANNEL_LABEL } from "@/lib/care/model";
import {
  COOLDOWN_TRIGGERS,
  DRAFT_HELP,
  MAX_STEPS,
  STEP_CHANNELS,
  STEP_KINDS,
  STEP_KIND_LABEL,
  TRIGGERS,
  TRIGGER_HELP,
  TRIGGER_LABEL,
  WINDOW_TRIGGERS,
  blankStep,
  checkPlaybook,
  type PlaybookInput,
  type StepInput,
  type TriggerKey,
} from "@/lib/care/playbooks";

// The playbook editor (DonorDelight slice 5; care.manage). Who the playbook is for, its window, and its steps: when (days after entering), what,
// why, how, and a draft in the organization's own words. A step is a touch to record; it never asks for money. Saving checks the same rules as the
// database in the same words; a refusal keeps what was typed and is said next to the button.

export function PlaybookEditor({ initial }: { initial: PlaybookInput }) {
  const router = useRouter();
  const [p, setP] = useState<PlaybookInput>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), summary: useId(), trigger: useId(), window: useId(), cooldown: useId() };

  const setStep = (i: number, patch: Partial<StepInput>) => setP((cur) => ({ ...cur, steps: cur.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: -1 | 1) =>
    setP((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.steps.length) return cur;
      const steps = [...cur.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...cur, steps };
    });
  const remove = (i: number) => setP((cur) => ({ ...cur, steps: cur.steps.filter((_, j) => j !== i) }));
  const add = () =>
    setP((cur) => (cur.steps.length >= MAX_STEPS ? cur : { ...cur, steps: [...cur.steps, blankStep(Math.min(365, (cur.steps.at(-1)?.afterDays ?? 0) + 7))] }));

  function save() {
    setError(null);
    const checked = checkPlaybook(p);
    if (!checked.ok) return setError(`Could not save the playbook — ${checked.error} Nothing was changed.`);
    start(async () => {
      const r = await savePlaybookAction(p);
      if (!r.ok) return setError(r.error);
      router.push("/care/playbooks");
      router.refresh();
    });
  }

  const windowLabel = WINDOW_TRIGGERS[p.trigger];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={ids.name} className="crm-label">
            Name
          </label>
          <input id={ids.name} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} maxLength={80} className="crm-input" placeholder="For example: Welcome a new family" />
        </div>
        <div>
          <label htmlFor={ids.trigger} className="crm-label">
            Who it is for
          </label>
          <select id={ids.trigger} value={p.trigger} onChange={(e) => setP({ ...p, trigger: e.target.value as TriggerKey })} className="crm-input">
            {TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABEL[t]}
              </option>
            ))}
          </select>
          <p className="m-0 mt-1 text-[12.5px] text-muted">{TRIGGER_HELP[p.trigger]}</p>
        </div>
      </div>
      <div>
        <label htmlFor={ids.summary} className="crm-label">
          What it is for (optional)
        </label>
        <input id={ids.summary} value={p.summary} onChange={(e) => setP({ ...p, summary: e.target.value })} maxLength={300} className="crm-input" />
      </div>
      <div className="flex flex-wrap gap-4">
        {windowLabel ? (
          <div>
            <label htmlFor={ids.window} className="crm-label">
              {windowLabel} (days)
            </label>
            <input id={ids.window} type="number" min={1} max={365} value={p.windowDays} onChange={(e) => setP({ ...p, windowDays: Number(e.target.value) })} className="crm-input w-28" />
          </div>
        ) : null}
        {COOLDOWN_TRIGGERS.includes(p.trigger) ? (
          <div>
            <label htmlFor={ids.cooldown} className="crm-label">
              Wait before it can start again (days)
            </label>
            <input id={ids.cooldown} type="number" min={30} max={1095} value={p.cooldownDays} onChange={(e) => setP({ ...p, cooldownDays: Number(e.target.value) })} className="crm-input w-28" />
          </div>
        ) : null}
        <label className="flex items-center gap-2.5 self-end text-[14px]">
          <input type="checkbox" checked={p.enabled} onChange={(e) => setP({ ...p, enabled: e.target.checked })} className="h-5 w-5" />
          <span className="font-semibold">On</span>
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-[15px] font-bold text-ink">Steps</h3>
        <p className="m-0 text-[13px] text-muted">
          Each step becomes a task for the household&apos;s relationship owner. A step is a touch to record; it never asks for money. {DRAFT_HELP}
        </p>
        {p.steps.map((s, i) => (
          <fieldset key={s.id ?? `new-${i}`} className="rounded-field border border-line px-3.5 py-3">
            <legend className="px-1 text-[13px] font-bold text-ink">Step {i + 1}</legend>
            <div className="grid gap-3 md:grid-cols-[110px_1fr_1fr]">
              <div>
                <label className="crm-label">Days after</label>
                <input type="number" min={0} max={365} value={s.afterDays} onChange={(e) => setStep(i, { afterDays: Number(e.target.value) })} className="crm-input" aria-label={`Step ${i + 1}: days after the household enters`} />
              </div>
              <div>
                <label className="crm-label">Title</label>
                <input value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} maxLength={120} className="crm-input" aria-label={`Step ${i + 1}: title`} />
              </div>
              <div>
                <label className="crm-label">Why</label>
                <input value={s.why} onChange={(e) => setStep(i, { why: e.target.value })} maxLength={300} className="crm-input" aria-label={`Step ${i + 1}: why`} />
              </div>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="crm-label">What it is</label>
                <select value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as StepInput["kind"] })} className="crm-input" aria-label={`Step ${i + 1}: kind of touch`}>
                  {STEP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {STEP_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="crm-label">How</label>
                <select value={s.channel ?? ""} onChange={(e) => setStep(i, { channel: e.target.value === "" ? null : (e.target.value as StepInput["channel"]) })} className="crm-input" aria-label={`Step ${i + 1}: how`}>
                  <option value="">The household&apos;s own way</option>
                  {STEP_CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className="crm-label">Draft (optional)</label>
              <textarea value={s.draft} onChange={(e) => setStep(i, { draft: e.target.value })} maxLength={1500} rows={3} className="crm-input" aria-label={`Step ${i + 1}: draft`} />
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={buttonClass("plain", "xs")}>
                Move up
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === p.steps.length - 1} className={buttonClass("plain", "xs")}>
                Move down
              </button>
              <button type="button" onClick={() => remove(i)} disabled={p.steps.length <= 1} className={buttonClass("plain", "xs")}>
                Remove this step
              </button>
            </div>
          </fieldset>
        ))}
        <div>
          <button type="button" onClick={add} disabled={p.steps.length >= MAX_STEPS} className={buttonClass("ghost", "sm")}>
            Add a step
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Saving…" : "Save the playbook"}
        </button>
        <Link href="/care/playbooks" className={buttonClass("plain")}>
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

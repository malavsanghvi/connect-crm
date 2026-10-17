"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { installGesturesAction, saveGestureAction, setGestureEnabledAction } from "@/app/(app)/care/gestures/actions";
import { buttonClass } from "@/components/ui";
import {
  COSTS,
  COST_LABEL,
  EFFORTS,
  EFFORT_LABEL,
  NEEDS,
  NEED_LABEL,
  RECOGNITION_SUIT_LABEL,
  SUIT_RECOGNITION,
  SUIT_THANKS,
  WHOS,
  WHO_LABEL,
  checkGesture,
  type GestureInput,
} from "@/lib/care/gestures";
import { CHANNEL_LABEL, THANKS_LABEL, TOUCH_CHANNELS, TOUCH_KINDS, TOUCH_KIND_LABEL } from "@/lib/care/model";
import { DRAFT_HELP } from "@/lib/care/playbooks";

// The small controls of the Gestures page (DonorDelight slice 6; care.manage): add the starters, pause or resume one, and the editor. A gesture is
// never paired with an ask: the form says so, and words that ask for a gift are refused with the database's own sentence. Each says what happened in
// words next to the button; a refusal keeps what was typed.

type Say = { ok: boolean; text: string } | null;
function SayLine({ say }: { say: Say }) {
  if (!say) return null;
  return (
    <p role={say.ok ? "status" : "alert"} className={`m-0 text-[13px] ${say.ok ? "text-success" : "text-danger"}`}>
      {say.text}
    </p>
  );
}

export function InstallGestures({ count, label }: { count: number; label: string }) {
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
            const r = await installGesturesAction();
            setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          });
        }}
      >
        {pending ? "Adding…" : `Add the ${count} starter ${count === 1 ? "gesture" : "gestures"}`}
      </button>
      <span className="text-[12.5px] text-muted">Written for {label.toLowerCase()}. You can change every word afterwards.</span>
      <SayLine say={say} />
    </div>
  );
}

export function PauseGesture({ id, enabled }: { id: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={buttonClass("plain", "xs")}
        onClick={() => {
          setSay(null);
          start(async () => {
            const r = await setGestureEnabledAction({ id, enabled: !enabled });
            if (!r.ok) setSay({ ok: false, text: r.error });
          });
        }}
      >
        {pending ? "Saving…" : enabled ? "Pause" : "Resume"}
      </button>
      <SayLine say={say} />
    </span>
  );
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function GestureEditor({ initial }: { initial: GestureInput }) {
  const router = useRouter();
  const [g, setG] = useState<GestureInput>(initial);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), desc: useId(), cost: useId(), effort: useId(), who: useId(), kind: useId(), channel: useId(), draft: useId() };

  function save() {
    setError(null);
    const checked = checkGesture(g);
    if (!checked.ok) return setError(`Could not save the gesture — ${checked.error} Nothing was changed.`);
    start(async () => {
      const r = await saveGestureAction(g);
      if (!r.ok) return setError(r.error);
      router.push("/care/gestures");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-4"
    >
      <p className="m-0 text-[13px] text-muted">A gesture is something you do for a supporter. It is never paired with an ask: the touch it records is always &ldquo;no ask&rdquo;, and words that ask for a gift, a donation or a pledge cannot be saved.</p>
      <div>
        <label htmlFor={ids.name} className="crm-label">
          Name
        </label>
        <input id={ids.name} value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} maxLength={80} className="crm-input" placeholder="For example: A handwritten card" />
      </div>
      <div>
        <label htmlFor={ids.desc} className="crm-label">
          What to do
        </label>
        <textarea id={ids.desc} value={g.description} onChange={(e) => setG({ ...g, description: e.target.value })} maxLength={400} rows={2} className="crm-input" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor={ids.cost} className="crm-label">
            Cost
          </label>
          <select id={ids.cost} value={g.cost} onChange={(e) => setG({ ...g, cost: e.target.value as GestureInput["cost"] })} className="crm-input">
            {COSTS.map((c) => (
              <option key={c} value={c}>
                {COST_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.effort} className="crm-label">
            Effort
          </label>
          <select id={ids.effort} value={g.effort} onChange={(e) => setG({ ...g, effort: e.target.value as GestureInput["effort"] })} className="crm-input">
            {EFFORTS.map((c) => (
              <option key={c} value={c}>
                {EFFORT_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.who} className="crm-label">
            Best done by
          </label>
          <select id={ids.who} value={g.who} onChange={(e) => setG({ ...g, who: e.target.value as GestureInput["who"] })} className="crm-input">
            {WHOS.map((c) => (
              <option key={c} value={c}>
                {WHO_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor={ids.kind} className="crm-label">
            The touch it records
          </label>
          <select id={ids.kind} value={g.kind} onChange={(e) => setG({ ...g, kind: e.target.value as GestureInput["kind"], suggest: e.target.value === "care_moment" ? false : g.suggest })} className="crm-input">
            {TOUCH_KINDS.map((k) => (
              <option key={k} value={k}>
                {TOUCH_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.channel} className="crm-label">
            How
          </label>
          <select id={ids.channel} value={g.channel ?? ""} onChange={(e) => setG({ ...g, channel: e.target.value === "" ? null : (e.target.value as GestureInput["channel"]) })} className="crm-input">
            <option value="">The household&apos;s own way</option>
            {TOUCH_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="rounded-field border border-line px-3.5 py-3">
        <legend className="px-1 text-[13px] font-bold text-ink">Which households it suits (leave all empty for any)</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
          <span className="w-full text-[12.5px] text-muted">They like to be thanked</span>
          {SUIT_THANKS.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="checkbox" checked={g.suitsThanks.includes(t)} onChange={() => setG({ ...g, suitsThanks: toggle(g.suitsThanks, t) })} className="h-4 w-4" />
              {THANKS_LABEL[t]}
            </label>
          ))}
          <span className="w-full pt-1 text-[12.5px] text-muted">They like to be recognised</span>
          {SUIT_RECOGNITION.map((t) => (
            <label key={t} className="flex items-center gap-2">
              <input type="checkbox" checked={g.suitsRecognition.includes(t)} onChange={() => setG({ ...g, suitsRecognition: toggle(g.suitsRecognition, t) })} className="h-4 w-4" />
              {RECOGNITION_SUIT_LABEL[t]}
            </label>
          ))}
          <span className="w-full pt-1 text-[12.5px] text-muted">Only if your own records hold</span>
          {NEEDS.map((n) => (
            <label key={n} className="flex items-center gap-2">
              <input type="checkbox" checked={g.needs.includes(n)} onChange={() => setG({ ...g, needs: toggle(g.needs, n) })} className="h-4 w-4" />
              {NEED_LABEL[n]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-2.5 text-[14px]">
        <input type="checkbox" checked={g.suggest && g.kind !== "care_moment"} disabled={g.kind === "care_moment"} onChange={(e) => setG({ ...g, suggest: e.target.checked })} className="mt-1 h-5 w-5" />
        <span>
          <span className="font-semibold">Offer it on its own</span>
          <span className="block text-[12.5px] text-muted">Off: it stays in the library and a person chooses it. A care moment is never offered on its own.</span>
        </span>
      </label>
      <div>
        <label htmlFor={ids.draft} className="crm-label">
          Draft (optional)
        </label>
        <textarea id={ids.draft} value={g.draft} onChange={(e) => setG({ ...g, draft: e.target.value })} maxLength={1500} rows={3} className="crm-input" />
        <p className="m-0 mt-1 text-[12.5px] text-muted">{DRAFT_HELP}</p>
      </div>
      <label className="flex items-center gap-2.5 text-[14px]">
        <input type="checkbox" checked={g.enabled} onChange={(e) => setG({ ...g, enabled: e.target.checked })} className="h-5 w-5" />
        <span className="font-semibold">On</span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass("primary")}>
          {pending ? "Saving…" : "Save the gesture"}
        </button>
        <Link href="/care/gestures" className={buttonClass("plain")}>
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

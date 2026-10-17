"use client";

import { useId, useState, useTransition } from "react";

import { saveApproachSettingsAction, saveQuietPeriodAction, setApproachEnabledAction } from "@/app/(app)/care/approach/actions";
import { buttonClass } from "@/components/ui";
import { DOES_NOT_USE, USES, WEIGHT_KEYS, WEIGHT_LABEL, checkQuiet, checkSettings, type ApproachSettings, type WeightKey } from "@/lib/care/approach";
import { formatDay } from "@/lib/care/model";

// The controls of "Who to approach" (DonorDelight slice 7; care.manage): turning the list on or off, the touch balance, the rest, the weights of the
// score, and the quiet periods. Each says what happened in words next to the button; a refusal keeps what was typed.

type Say = { ok: boolean; text: string } | null;
function SayLine({ say }: { say: Say }) {
  if (!say) return null;
  return (
    <p role={say.ok ? "status" : "alert"} className={`m-0 text-[13px] ${say.ok ? "text-success" : "text-danger"}`}>
      {say.text}
    </p>
  );
}

export function UsesAndDoesNotUse() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h3 className="m-0 mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">What it uses</h3>
        <ul className="m-0 list-disc pl-5 text-[13.5px] text-ink-2">
          {USES.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="m-0 mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">What it never uses</h3>
        <ul className="m-0 list-disc pl-5 text-[13.5px] text-ink-2">
          {DOES_NOT_USE.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function EnableApproach({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  const [read, setRead] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {enabled ? null : (
        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="mt-1 h-5 w-5" />
          <span className="font-semibold">I have read what it uses and what it never uses</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || (!enabled && !read)}
          className={buttonClass(enabled ? "plain" : "primary", "sm")}
          onClick={() => {
            setSay(null);
            start(async () => {
              const r = await setApproachEnabledAction({ enabled: !enabled });
              setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
            });
          }}
        >
          {pending ? "Saving…" : enabled ? "Turn off" : "Turn on who to approach"}
        </button>
        <SayLine say={say} />
      </div>
    </div>
  );
}

export function ApproachSettingsForm({ initial }: { initial: ApproachSettings }) {
  const [balance, setBalance] = useState(String(initial.touchBalance));
  const [rest, setRest] = useState(String(initial.restDays));
  const [weights, setWeights] = useState<Record<WeightKey, string>>(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, String(initial.weights[k])])) as Record<WeightKey, string>);
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  const ids = { balance: useId(), rest: useId() };

  function save() {
    setSay(null);
    const input = { touchBalance: Number(balance), restDays: Number(rest), weights: Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Number(weights[k])])) as Record<WeightKey, number> };
    const checked = checkSettings(input);
    if (!checked.ok) return setSay({ ok: false, text: `Could not save the settings — ${checked.error} Nothing was changed.` });
    start(async () => {
      const r = await saveApproachSettingsAction(input);
      setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (initial.canManage) save();
      }}
    >
      <div className="flex flex-wrap gap-4">
        <div>
          <label htmlFor={ids.balance} className="crm-label">
            Touches with no ask before an ask
          </label>
          <input id={ids.balance} type="number" min={1} max={10} value={balance} onChange={(e) => setBalance(e.target.value)} disabled={!initial.canManage} className="crm-input w-28" />
          <p className="m-0 mt-1 max-w-xs text-[12.5px] text-muted">A household is ready only after this many, counted since its last ask.</p>
        </div>
        <div>
          <label htmlFor={ids.rest} className="crm-label">
            Rest after an ask (days)
          </label>
          <input id={ids.rest} type="number" min={0} max={365} value={rest} onChange={(e) => setRest(e.target.value)} disabled={!initial.canManage} className="crm-input w-28" />
          <p className="m-0 mt-1 max-w-xs text-[12.5px] text-muted">0 means no rest.</p>
        </div>
      </div>
      <fieldset className="rounded-field border border-line px-3.5 py-3">
        <legend className="px-1 text-[13px] font-bold text-ink">How the score works (points)</legend>
        <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
          {WEIGHT_KEYS.map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 text-[13.5px]">
              <span>
                {WEIGHT_LABEL[k]} <span className="text-faint">(usually {initial.defaults[k]})</span>
              </span>
              <input
                type="number"
                min={0}
                max={k === "years_max" ? 100 : 50}
                value={weights[k]}
                onChange={(e) => setWeights({ ...weights, [k]: e.target.value })}
                disabled={!initial.canManage}
                className="crm-input w-20"
                aria-label={WEIGHT_LABEL[k]}
              />
            </label>
          ))}
        </div>
        <p className="m-0 mt-2 text-[12.5px] text-muted">The score only orders the list. Every row shows the points behind it. Nothing is sent or asked automatically.</p>
      </fieldset>
      {initial.canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
            {pending ? "Saving…" : "Save"}
          </button>
          <SayLine say={say} />
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">Someone who manages this area can change these.</p>
      )}
    </form>
  );
}

export function QuietPeriods({ initial }: { initial: ApproachSettings }) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [yearly, setYearly] = useState(false);
  const [pending, start] = useTransition();
  const [say, setSay] = useState<Say>(null);
  const ids = { name: useId(), from: useId(), to: useId() };

  function add() {
    setSay(null);
    const input = { name, startsOn: from, endsOn: to, yearly };
    const checked = checkQuiet(input);
    if (!checked.ok) return setSay({ ok: false, text: `Could not save the quiet period — ${checked.error} Nothing was changed.` });
    start(async () => {
      const r = await saveQuietPeriodAction(input);
      setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      if (r.ok) {
        setName("");
        setFrom("");
        setTo("");
        setYearly(false);
      }
    });
  }
  function remove(id: string, q: ApproachSettings["quietPeriods"][number]) {
    setSay(null);
    start(async () => {
      const r = await saveQuietPeriodAction({ id, name: q.name, startsOn: q.startsOn, endsOn: q.endsOn, yearly: q.yearly, archived: true });
      setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[13px] text-muted">A fast, a mourning period, a season: while one lasts, nobody is ready for an ask. Set them as dates; a yearly one repeats every year.</p>
      {initial.quietPeriods.length === 0 ? (
        <p className="m-0 text-[13.5px] text-ink-2">No quiet period is set.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {initial.quietPeriods.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-line-soft px-3 py-2 text-[13.5px]">
              <span>
                <span className="font-semibold">{q.name}</span> · {formatDay(q.startsOn)} to {formatDay(q.endsOn)}
                {q.yearly ? " · every year" : ""}
              </span>
              {initial.canManage ? (
                <button type="button" disabled={pending} onClick={() => remove(q.id, q)} className={buttonClass("plain", "xs")}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {initial.canManage ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="min-w-[180px] flex-1">
            <label htmlFor={ids.name} className="crm-label">
              Name
            </label>
            <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="crm-input" placeholder="For example: A season of fasting" />
          </div>
          <div>
            <label htmlFor={ids.from} className="crm-label">
              From
            </label>
            <input id={ids.from} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="crm-input" />
          </div>
          <div>
            <label htmlFor={ids.to} className="crm-label">
              To
            </label>
            <input id={ids.to} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="crm-input" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-[13.5px]">
            <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} className="h-4 w-4" />
            Every year
          </label>
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
            {pending ? "Saving…" : "Add"}
          </button>
        </form>
      ) : null}
      <SayLine say={say} />
    </div>
  );
}

"use client";

import { useId, useState, useTransition } from "react";

import { installStartersAction, saveWeekSettingsAction, setPlaybookEnabledAction } from "@/app/(app)/care/playbooks/actions";
import { buttonClass } from "@/components/ui";
import { WEEKDAYS, type WeekSettings } from "@/lib/care/week";

// The small controls of the Playbooks page (DonorDelight slice 5; care.manage): add the starter playbooks, pause or resume one, and the weekly
// reminder. Each says what happened in words next to the button; a refusal says why and nothing is changed.

function Say({ say }: { say: { ok: boolean; text: string } | null }) {
  if (!say) return null;
  return (
    <p role={say.ok ? "status" : "alert"} className={`m-0 text-[13px] ${say.ok ? "text-success" : "text-danger"}`}>
      {say.text}
    </p>
  );
}

export function InstallStarters({ count, label }: { count: number; label: string }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={pending}
        className={buttonClass("primary", "sm")}
        onClick={() => {
          setSay(null);
          start(async () => {
            const r = await installStartersAction();
            setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
          });
        }}
      >
        {pending ? "Adding…" : `Add the ${count} starter ${count === 1 ? "playbook" : "playbooks"}`}
      </button>
      <span className="text-[12.5px] text-muted">Written for {label.toLowerCase()}. You can change every word afterwards.</span>
      <Say say={say} />
    </div>
  );
}

export function PauseResume({ id, enabled }: { id: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const [say, setSay] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={buttonClass("plain", "xs")}
        onClick={() => {
          setSay(null);
          start(async () => {
            const r = await setPlaybookEnabledAction({ id, enabled: !enabled });
            if (!r.ok) setSay({ ok: false, text: r.error });
          });
        }}
      >
        {pending ? "Saving…" : enabled ? "Pause" : "Resume"}
      </button>
      <Say say={say} />
    </span>
  );
}

export function WeekReminderForm({ initial }: { initial: WeekSettings }) {
  const [notify, setNotify] = useState(initial.notify);
  const [dow, setDow] = useState(initial.dow);
  const [pending, start] = useTransition();
  const [say, setSay] = useState<{ ok: boolean; text: string } | null>(null);
  const dowId = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!initial.canManage) return;
        setSay(null);
        start(async () => {
          const r = await saveWeekSettingsAction({ notify, dow });
          setSay(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
        });
      }}
    >
      <label className="flex items-start gap-2.5 text-[14px]">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!initial.canManage} className="mt-1 h-5 w-5" />
        <span>
          <span className="font-semibold">Remind relationship owners once a week</span>
          <span className="block text-[12.5px] text-muted">
            An email with a number only (“4 to do this week, 1 overdue”): no names, no notes. It goes through your organization&apos;s usual email settings.
          </span>
        </span>
      </label>
      <div>
        <label htmlFor={dowId} className="crm-label">
          Send it on
        </label>
        <select id={dowId} value={dow} onChange={(e) => setDow(Number(e.target.value))} disabled={!initial.canManage || !notify} className="crm-input w-44">
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </div>
      {initial.canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
            {pending ? "Saving…" : "Save"}
          </button>
          <Say say={say} />
        </div>
      ) : (
        <p className="m-0 text-[13px] text-muted">Someone who manages this area can change this.</p>
      )}
    </form>
  );
}

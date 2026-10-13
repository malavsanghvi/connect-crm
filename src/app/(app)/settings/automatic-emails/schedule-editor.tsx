"use client";

import { useActionState, useMemo, useRef, useState } from "react";

import { ActionForm } from "@/components/action-form";
import { buttonClass } from "@/components/ui";
import { missingWords, sampleValues } from "@/lib/merge/build";
import { AUDIENCE_INFO, SCHEDULE_AUDIENCES, multilineNames, placeholderGroups, scheduleKey, type ScheduleAudience } from "@/lib/merge/catalogue";
import { brokenPlaceholders, mergeSegments, placeholdersIn, unknownPlaceholders } from "@/lib/merge/render";
import { FREQUENCIES, hourLabel, monthLabel, weekdayLabel, type Frequency } from "@/lib/merge/schedule";

import { previewScheduleAction, saveScheduleAction } from "./actions";
import { PlaceholderPicker, Segments } from "./email-card";

export type ScheduleFormData = {
  id: string | null;
  name: string;
  audience: ScheduleAudience;
  days: number;
  since: string;
  includeImported: boolean;
  frequency: Frequency;
  dayOfWeek: number;
  dayOfMonth: number;
  month: number;
  hour: number;
  language: string;
  subject: string;
  body: string;
};

const FREQUENCY_LABEL: Record<Frequency, string> = { daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" };

/** A suggested first wording for each audience (the community changes it before saving). */
export function suggestedWording(audience: ScheduleAudience): { subject: string; body: string } {
  if (audience === "gave_recently") {
    return {
      subject: "Thank you, {{recipient_first_name}}",
      body: "Dear {{recipient_first_name}},\n\nThank you for your gifts to {{center_name}} from {{gifts_period}}:\n\n{{gifts_list}}\n\nTotal: {{gifts_total}}.\n\nWith gratitude,\n{{center_name}}",
    };
  }
  if (audience === "pledges_past_due") {
    return {
      subject: "Your pledges to {{center_name}}",
      body: "Dear {{recipient_first_name}},\n\nOur records show these pledges are past their due date:\n\n{{pledges_list}}\n\nStill to pay: {{pledges_balance}}. If you have already paid, thank you, and please ignore this email.\n\n{{center_name}}",
    };
  }
  return {
    subject: "Your pledges due soon, {{recipient_first_name}}",
    body: "Dear {{recipient_first_name}},\n\nA reminder of your pledges to {{center_name}} that are due soon:\n\n{{pledges_list}}\n\nStill to pay: {{pledges_balance}}, first due {{next_due_date}}. Thank you!\n\n{{center_name}}",
  };
}

function DryRun({ audience, days, since, includeImported, frequency }: { audience: ScheduleAudience; days: number; since: string; includeImported: boolean; frequency: Frequency }) {
  const [state, action, pending] = useActionState(previewScheduleAction, null);
  const d = state?.ok ? state.data : null;
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
      <input type="hidden" name="audience" value={audience} />
      <input type="hidden" name="days" value={String(days)} />
      <input type="hidden" name="since" value={since} />
      <input type="hidden" name="include_imported" value={includeImported ? "on" : ""} />
      <input type="hidden" name="frequency" value={frequency} />
      <button type="submit" className={buttonClass("ghost", "sm")} disabled={pending}>
        {pending ? "Checking…" : "Who would get it now?"}
      </button>
      {d ? (
        <span role="status">
          {d.would_send} adult{d.would_send === 1 ? "" : "s"} in {d.households} household{d.households === 1 ? "" : "s"}
          {d.skipped.no_email || d.skipped.switched_off || d.skipped.unsubscribed
            ? ` · not sent: ${[
                d.skipped.no_email ? `${d.skipped.no_email} household${d.skipped.no_email === 1 ? "" : "s"} with no email address` : null,
                d.skipped.switched_off ? `${d.skipped.switched_off} switched giving emails off` : null,
                d.skipped.unsubscribed ? `${d.skipped.unsubscribed} unsubscribed or opted out` : null,
              ]
                .filter(Boolean)
                .join(", ")}`
            : ""}
        </span>
      ) : state && !state.ok ? (
        <span role="alert" className="text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function ScheduleEditor({
  initial,
  languages,
  locale,
  canEdit,
  realValues,
  submitLabel,
}: {
  initial: ScheduleFormData;
  languages: { code: string; label: string }[];
  locale: string;
  canEdit: boolean;
  /** The preview's values from a real household of this schedule's audience; null = made-up values. */
  realValues: Record<string, string | null> | null;
  submitLabel: string;
}) {
  const [f, setF] = useState(initial);
  const [field, setField] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<ScheduleFormData>) => setF((x) => ({ ...x, ...patch }));

  const key = scheduleKey(f.audience);
  const groups = useMemo(() => placeholderGroups(key), [key]);
  const allowed = useMemo(() => groups.flatMap((g) => g.items.map((p) => p.name)), [groups]);
  const lists = useMemo(() => multilineNames(key), [key]);
  const missing = useMemo(() => missingWords(key), [key]);
  const values = f.audience === initial.audience && realValues ? realValues : sampleValues(key);
  const unknown = unknownPlaceholders(`${f.subject}\n${f.body}`, allowed);
  const listInSubject = placeholdersIn(f.subject).filter((n) => lists.includes(n));
  const broken = brokenPlaceholders(`${f.subject}\n${f.body}`);

  function insert(name: string) {
    const token = `{{${name}}}`;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    const value = field === "subject" ? f.subject : f.body;
    const from = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? value.length;
    const next = value.slice(0, from) + token + value.slice(to);
    set(field === "subject" ? { subject: next } : { body: next });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from + token.length, from + token.length);
    });
  }

  const params = { days: f.days, since: f.since || null, include_imported: f.includeImported };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <ActionForm
          action={saveScheduleAction}
          submitLabel={submitLabel}
          pendingLabel="Saving…"
          size="sm"
          hideSubmit={!canEdit}
          submitDisabled={unknown.length > 0 || listInSubject.length > 0}
          onSuccess={initial.id ? undefined : () => setF(initial)}
          extraButtons={
            canEdit ? (
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => set(suggestedWording(f.audience))}>
                Start from the suggested wording
              </button>
            ) : null
          }
        >
          <input type="hidden" name="id" value={f.id ?? ""} />
          <fieldset disabled={!canEdit} className="grid gap-3">
            <label>
              <span className="crm-label">Name (only staff see it)</span>
              <input name="name" value={f.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} className="crm-input" />
            </label>
            <label>
              <span className="crm-label">Goes to</span>
              <select name="audience" value={f.audience} onChange={(e) => set({ audience: e.target.value as ScheduleAudience })} className="crm-input">
                {SCHEDULE_AUDIENCES.map((a) => (
                  <option key={a} value={a}>
                    {AUDIENCE_INFO[a].title}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[12px] text-muted">{AUDIENCE_INFO[f.audience].describe(params)} · adults only, one email each per run</span>
            </label>
            {f.audience !== "gave_recently" ? (
              <div className="flex flex-wrap items-end gap-3">
                {f.audience === "pledges_due_soon" ? (
                  <label>
                    <span className="crm-label">Days before the due date</span>
                    <input name="days" type="number" min={1} max={60} value={f.days} onChange={(e) => set({ days: Number(e.target.value) || 7 })} className="crm-input w-24" />
                  </label>
                ) : null}
                <label>
                  <span className="crm-label">Pledges made on or after (optional)</span>
                  <input name="since" type="date" value={f.since} onChange={(e) => set({ since: e.target.value })} className="crm-input" />
                </label>
                <label className="flex items-center gap-2 text-[13px]">
                  <input name="include_imported" type="checkbox" checked={f.includeImported} onChange={(e) => set({ includeImported: e.target.checked })} />
                  Include imported pledges
                </label>
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <label>
                <span className="crm-label">How often</span>
                <select name="frequency" value={f.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })} className="crm-input">
                  {FREQUENCIES.map((x) => (
                    <option key={x} value={x}>
                      {FREQUENCY_LABEL[x]}
                    </option>
                  ))}
                </select>
              </label>
              {f.frequency === "weekly" ? (
                <label>
                  <span className="crm-label">On</span>
                  <select name="day_of_week" value={f.dayOfWeek} onChange={(e) => set({ dayOfWeek: Number(e.target.value) })} className="crm-input">
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={d} value={d}>
                        {weekdayLabel(d, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {f.frequency === "yearly" ? (
                <label>
                  <span className="crm-label">Month</span>
                  <select name="month" value={f.month} onChange={(e) => set({ month: Number(e.target.value) })} className="crm-input">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>
                        {monthLabel(m, locale)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {f.frequency === "monthly" || f.frequency === "yearly" ? (
                <label>
                  <span className="crm-label">Day</span>
                  <select name="day_of_month" value={f.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} className="crm-input">
                    {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span className="crm-label">At</span>
                <select name="hour" value={f.hour} onChange={(e) => set({ hour: Number(e.target.value) })} className="crm-input">
                  {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h, locale)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {languages.length > 1 ? (
              <label>
                <span className="crm-label">Language of this wording</span>
                <select name="language" value={f.language} onChange={(e) => set({ language: e.target.value })} className="crm-input">
                  {languages.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="language" value={f.language} />
            )}
            <label>
              <span className="crm-label">Subject</span>
              <input ref={subjectRef} name="subject" value={f.subject} maxLength={200} onFocus={() => setField("subject")} onChange={(e) => set({ subject: e.target.value })} className="crm-input" />
            </label>
            <label>
              <span className="crm-label">Email</span>
              <textarea ref={bodyRef} name="body" value={f.body} rows={12} onFocus={() => setField("body")} onChange={(e) => set({ body: e.target.value })} className="crm-input font-mono text-[13px]" />
            </label>
          </fieldset>
          {unknown.length > 0 ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              This email has no {unknown.map((n) => `{{${n}}}`).join(", ")}. Choose from the placeholders below.
            </p>
          ) : null}
          {listInSubject.length > 0 ? (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {listInSubject.map((n) => `{{${n}}}`).join(", ")} is a list (one line each): put it in the email, not the subject.
            </p>
          ) : null}
          {broken.length > 0 ? (
            <p className="mt-2 text-[13px] text-brown-900">These look like placeholders but are not: {broken.join(", ")}.</p>
          ) : null}
        </ActionForm>
        {canEdit ? <PlaceholderPicker groups={groups} into={field} onInsert={insert} /> : null}
      </div>
      <div>
        <p className="crm-label">
          Preview · {f.audience === initial.audience && realValues ? "for a real household of this audience" : "made-up values"} ·{" "}
          <span className="rounded bg-saffron-50 px-1 text-brown-900">[marked]</span> = no value
        </p>
        <div className="rounded-lg border border-line bg-white p-3 text-[14px]">
          <p className="mb-2 font-semibold">
            <Segments segments={mergeSegments(f.subject, values, missing)} />
          </p>
          <div className="whitespace-pre-wrap">
            <Segments segments={mergeSegments(f.body, values, missing)} />
          </div>
        </div>
        <DryRun audience={f.audience} days={f.days} since={f.since} includeImported={f.includeImported} frequency={f.frequency} />
      </div>
    </div>
  );
}

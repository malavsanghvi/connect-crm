"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { InfoBox } from "@/components/ui";
import { utcToLocal } from "@/lib/local-time";

import { saveBoliAction } from "./actions";

export type BoliFormBoli = {
  id: string;
  name: string;
  kind: string;
  event_id: string | null;
  floor_cents: number;
  step_cents: number;
  opens_at: string | null;
  closes_at: string | null;
  soft_close_minutes: number;
  hall_display: boolean;
  explainer_video_url: string | null;
  description: string | null;
  explainer_md: string | null;
  keep_all_entries: boolean;
};

function dollars(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * The prototype's "New digital boli" form (4 columns): Type chips, Event,
 * Hall display, Name, Floor, Step, Ties, Soft close, Explainer video. The
 * app's extra fields (opening time, cutoff, description, explainer text,
 * keep every entry) sit under "More details".
 */
export function BoliForm({
  boli,
  events,
  timeZone,
  defaultStepCents,
  defaultSoftMinutes,
}: {
  boli: BoliFormBoli | null;
  events: { id: string; name: string }[];
  timeZone: string;
  defaultStepCents: number;
  defaultSoftMinutes: number;
}) {
  const [kind, setKind] = useState(boli?.kind ?? "digital");
  const [hall, setHall] = useState(boli?.hall_display ?? true);
  const [soft, setSoft] = useState(boli ? boli.soft_close_minutes > 0 : false);
  const [keepAll, setKeepAll] = useState(boli?.keep_all_entries ?? true);
  const softMinutes = boli && boli.soft_close_minutes > 0 ? boli.soft_close_minutes : defaultSoftMinutes;
  const p = boli ? `bf-${boli.id.slice(0, 6)}` : "bf-new";

  return (
    <ActionForm
      action={saveBoliAction.bind(null, boli?.id ?? null)}
      submitLabel={boli ? "Save boli" : "Create boli"}
      pendingLabel={boli ? "Saving…" : "Creating…"}
      resetOnSuccess={!boli}
    >
      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2">
          <span className="crm-label">Type</span>
          <ChipGroup
            name="kind"
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "digital", label: "Digital (pledge in app until cutoff)" },
              { value: "in_person", label: "In-person (listed with time it is called)" },
            ]}
          />
        </div>
        <div>
          <label htmlFor={`${p}-event`} className="crm-label">
            Event
          </label>
          <select id={`${p}-event`} name="event_id" defaultValue={boli?.event_id ?? ""} className="crm-input">
            <option value="">No event</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="crm-label">Hall display</span>
          <Toggle name="hall_display" label="Hall display" checked={hall} onChange={setHall} onNote="Show live amounts on the TV" offNote="Not on the TV" />
        </div>
        <div>
          <label htmlFor={`${p}-name`} className="crm-label">
            Name
          </label>
          <input id={`${p}-name`} name="name" required maxLength={160} defaultValue={boli?.name ?? ""} placeholder="Mangal divo, Diwali" className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-floor`} className="crm-label">
            Floor ($)
          </label>
          <input id={`${p}-floor`} name="floor" inputMode="decimal" defaultValue={boli ? dollars(boli.floor_cents) : "101"} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-step`} className="crm-label">
            Step ($)
          </label>
          <input
            id={`${p}-step`}
            name="step"
            inputMode="decimal"
            defaultValue={dollars(boli?.step_cents ?? defaultStepCents)}
            className="crm-input"
          />
        </div>
        <div>
          <span className="crm-label">Ties</span>
          <InfoBox>First recorded wins</InfoBox>
        </div>
        <div>
          <span className="crm-label">Soft close</span>
          <Toggle
            name="soft_close"
            label="Soft close"
            checked={soft}
            onChange={setSoft}
            onNote={`Extend ${softMinutes} min on late entries`}
            offNote="Off (hard close)"
          />
          <input type="hidden" name="soft_close_minutes" value={softMinutes} />
        </div>
        <div className="md:col-span-2">
          <label htmlFor={`${p}-video`} className="crm-label">
            Explainer video
          </label>
          <input
            id={`${p}-video`}
            name="explainer_video_url"
            type="url"
            defaultValue={boli?.explainer_video_url ?? ""}
            placeholder="Attach from Content — paste the video's link"
            className="crm-input"
          />
        </div>
        <div>
          <label htmlFor={`${p}-opens`} className="crm-label">
            Opens
          </label>
          <input id={`${p}-opens`} name="opens_at" type="datetime-local" defaultValue={utcToLocal(boli?.opens_at, timeZone)} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-closes`} className="crm-label">
            {kind === "in_person" ? "Called at" : "Cutoff"}
          </label>
          <input id={`${p}-closes`} name="closes_at" type="datetime-local" defaultValue={utcToLocal(boli?.closes_at, timeZone)} className="crm-input" />
        </div>
      </div>
      <details className="mb-3">
        <summary className="cursor-pointer text-[13px] font-bold text-navy">More details</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label htmlFor={`${p}-desc`} className="crm-label">
              Description
            </label>
            <textarea id={`${p}-desc`} name="description" rows={2} maxLength={2000} defaultValue={boli?.description ?? ""} className="crm-input min-h-16" />
          </div>
          <div>
            <label htmlFor={`${p}-explainer`} className="crm-label">
              Explainer (what this labh means)
            </label>
            <textarea id={`${p}-explainer`} name="explainer_md" rows={2} maxLength={4000} defaultValue={boli?.explainer_md ?? ""} className="crm-input min-h-16" />
          </div>
          <div className="md:col-span-2">
            <span className="crm-label">Entries</span>
            <Toggle
              name="keep_all_entries"
              label="Keep every entry"
              checked={keepAll}
              onChange={setKeepAll}
              onNote="Keep every pledge, so the center can accommodate all interested families"
              offNote="Keep only the winning pledge"
            />
          </div>
        </div>
      </details>
    </ActionForm>
  );
}

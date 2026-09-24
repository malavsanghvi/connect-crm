"use client";

import { useMemo, useState } from "react";

import { DEFAULT_RSVP_STATUSES, EMPTY_SELECTION, buildAudience, parseAudience, type AudienceSelection } from "@/lib/comms";

type Opt = { id: string; name: string };

/**
 * Audience chips for surveys and alerts (the same segments as newsletters,
 * combinable). Submits the audience JSON in a hidden "audience" field.
 */
export function AudienceChips({ zones, classes, events, initial }: { zones: Opt[]; classes: Opt[]; events: Opt[]; initial?: unknown }) {
  const [sel, setSel] = useState<AudienceSelection>(() => (initial ? parseAudience(initial) : { ...EMPTY_SELECTION, allMembers: true }));
  const built = useMemo(() => buildAudience(sel), [sel]);
  const allClassIds = classes.map((c) => c.id);
  const pathshalaOn = allClassIds.length > 0 && allClassIds.every((id) => sel.pathshalaClassIds.includes(id));
  const chip = (on: boolean, label: string, onClick: () => void, disabled = false) => (
    <button key={label} type="button" aria-pressed={on} disabled={disabled} onClick={onClick} className="cc-chip min-h-[34px]">
      {label}
    </button>
  );
  return (
    <div>
      <p className="crm-label">Audience (combine segments)</p>
      <input type="hidden" name="audience" value={built.ok ? JSON.stringify(built.audience) : "{}"} />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Audience segments">
        {chip(sel.allMembers, "All members", () => setSel((s) => ({ ...s, allMembers: !s.allMembers })))}
        {chip(sel.lifeMembers, "Life members", () => setSel((s) => ({ ...s, lifeMembers: !s.lifeMembers })))}
        {chip(pathshalaOn, "Pathshala parents", () => setSel((s) => ({ ...s, pathshalaClassIds: pathshalaOn ? [] : allClassIds })), allClassIds.length === 0)}
        {zones.map((z) =>
          chip(sel.zoneIds.includes(z.id), `${z.name} zone`, () =>
            setSel((s) => ({ ...s, zoneIds: s.zoneIds.includes(z.id) ? s.zoneIds.filter((x) => x !== z.id) : [...s.zoneIds, z.id] })),
          ),
        )}
        {chip(
          sel.eventId !== null,
          "Event attendees",
          () => setSel((s) => ({ ...s, eventId: s.eventId ? null : (events[0]?.id ?? null), rsvpStatuses: [...DEFAULT_RSVP_STATUSES] })),
          events.length === 0,
        )}
      </div>
      {sel.eventId !== null ? (
        <select aria-label="Which event" value={sel.eventId} onChange={(e) => setSel((s) => ({ ...s, eventId: e.target.value }))} className="crm-input mt-2">
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      ) : null}
      {!built.ok ? <p className="crm-hint text-brown">{built.error}</p> : null}
    </div>
  );
}

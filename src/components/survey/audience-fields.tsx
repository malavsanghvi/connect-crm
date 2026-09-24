"use client";

import { useState } from "react";
import { presetOf, type AudiencePreset } from "@/lib/survey/audience";

type Opt = { id: string; name: string };

/** Survey and message audience presets (moved from connect-admin comms): all members, zones, Pathshala parents by class, event RSVPs, or custom JSON. */
export function AudienceFields({
  zones,
  classes,
  events,
  initial,
}: {
  zones: Opt[];
  classes: Opt[];
  events: Opt[];
  initial: unknown;
}) {
  const [preset, setPreset] = useState<AudiencePreset>(presetOf(initial));
  const init = (initial ?? {}) as Record<string, unknown>;
  const initIds = (k: string) => (Array.isArray(init[k]) ? (init[k] as string[]) : []);
  const presets: { key: AudiencePreset; label: string; hint: string }[] = [
    { key: "all_members", label: "All members", hint: "Needs a second approver before it can be scheduled" },
    { key: "zone", label: "Zones", hint: "Families in the chosen zones" },
    { key: "pathshala_class", label: "Pathshala parents", hint: "Parents of students in the chosen classes" },
    { key: "event_rsvps", label: "Event RSVPs", hint: "Households who RSVP'd to an event" },
    { key: "custom", label: "Custom", hint: "A segment definition in JSON" },
  ];
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-bold">Audience</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map((p) => (
          <label
            key={p.key}
            className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border-2 p-3 ${preset === p.key ? "border-navy bg-navy-50" : "border-line bg-white"}`}
          >
            <input type="radio" name="audience_preset" value={p.key} checked={preset === p.key} onChange={() => setPreset(p.key)} className="mt-1 h-5 w-5 accent-navy" />
            <span>
              <span className="block text-[13px] font-bold">{p.label}</span>
              <span className="block text-xs text-muted">{p.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {preset === "zone" && (
        <div className="mt-3 grid gap-1 sm:grid-cols-2">
          {zones.map((z) => (
            <label key={z.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="zone_ids" value={z.id} defaultChecked={initIds("zone_ids").includes(z.id)} className="h-5 w-5 accent-navy" />
              {z.name}
            </label>
          ))}
        </div>
      )}
      {preset === "pathshala_class" && (
        <div className="mt-3 grid gap-1 sm:grid-cols-2">
          {classes.length === 0 && <p className="text-sm text-muted">No classes you can see.</p>}
          {classes.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="class_ids" value={c.id} defaultChecked={initIds("pathshala_class_ids").includes(c.id)} className="h-5 w-5 accent-navy" />
              {c.name}
            </label>
          ))}
        </div>
      )}
      {preset === "event_rsvps" && (
        <div className="mt-3 space-y-2">
          <select name="event_id" defaultValue={typeof init.event_id === "string" ? init.event_id : ""} className="crm-input" aria-label="Event">
            <option value="">Choose an event</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-x-4">
            {[
              ["rsvpd", "RSVP'd"],
              ["confirmed", "Confirmed"],
              ["attended", "Attended"],
              ["waitlisted", "Waitlisted"],
            ].map(([v, l]) => (
              <label key={v} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="rsvp_statuses"
                  value={v}
                  defaultChecked={Array.isArray(init.rsvp_statuses) ? (init.rsvp_statuses as string[]).includes(v) : v !== "waitlisted"}
                  className="h-5 w-5 accent-navy"
                />
                {l}
              </label>
            ))}
          </div>
        </div>
      )}
      {preset === "custom" && (
        <textarea
          name="custom_json"
          rows={4}
          defaultValue={presetOf(initial) === "custom" ? JSON.stringify(initial, null, 2) : '{\n  "life_members": true\n}'}
          className="crm-input mt-3 font-mono text-sm"
          aria-label="Custom audience JSON"
        />
      )}
    </fieldset>
  );
}

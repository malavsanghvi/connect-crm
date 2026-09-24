import { ActionForm } from "@/components/action-form";
import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { BlockGrid, Card, ChipLinks, EmptyState, KpiGrid, Stat } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { allRows, load, rows } from "@/lib/data/events";
import { householdsById } from "@/lib/data/lookups";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { formatDateTime, formatTime, humanize } from "@/lib/events/format";
import { eventReport } from "@/lib/events/report";
import type { CrmSession } from "@/lib/session";

import { addGuestRsvp, setRsvpStatus } from "../actions";

const STATUSES = ["rsvpd", "confirmed", "attended", "waitlisted", "no_show", "cancelled", "invited"];

function statusLabel(s: string) {
  return s === "rsvpd" ? "RSVP'd" : s === "no_show" ? "No-show" : humanize(s);
}

function statusClass(s: string) {
  if (s === "attended") return "cc-status-ok";
  if (s === "confirmed") return "font-bold text-navy";
  if (s === "cancelled" || s === "no_show") return "cc-status-bad";
  if (s === "waitlisted") return "cc-status-warn";
  return "font-semibold text-muted";
}

export async function RsvpsTab({ event, session, access, status }: { event: Tables<"events">; session: CrmSession; access: EventAccess; status: string | null }) {
  const { db, center } = session;
  const tz = center.time_zone;
  const res = await load(async () => {
    const [rsvps, attendees, slots] = await Promise.all([
      allRows<Tables<"rsvps">>((f, t) => db.from("rsvps").select("*").eq("event_id", event.id).order("created_at").range(f, t), "RSVPs"),
      allRows<Tables<"attendees">>((f, t) => db.from("attendees").select("*").eq("event_id", event.id).order("display_name").range(f, t), "attendees"),
      db.from("lunch_slots").select("id, starts_at").eq("event_id", event.id),
    ]);
    // Household names need people.view (or the household card); event leads see attendee names instead.
    const hh = await householdsById(
      db,
      rsvps.map((r) => r.household_id),
    );
    if (hh.error) console.error("[events] household names for RSVPs unavailable; showing attendee names:", hh.error);
    return { rsvps, attendees, slots: rows(slots, "lunch slots"), households: hh.map };
  });
  if (!res.ok) return <LoadProblem message={res.error} retryHref={`/events/${event.id}?tab=rsvps`} />;
  const { rsvps, attendees, slots, households } = res.data;
  const report = eventReport(rsvps, attendees);
  const canEdit = eventAreas.edit(access, event.id);
  const canChange = eventAreas.rsvps(access, event.id);
  const shown = status ? rsvps.filter((r) => r.status === status) : rsvps;
  const label = (r: (typeof rsvps)[number]) => {
    const hh = r.household_id ? households.get(r.household_id)?.display_name : null;
    if (hh) return hh;
    if (r.guest_name) return r.guest_name;
    const first = attendees.find((a) => a.rsvp_id === r.id);
    return first ? `${first.display_name}'s party` : "RSVP";
  };
  const base = `/events/${event.id}?tab=rsvps`;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <KpiGrid cols={4}>
          <Stat label="RSVP'd people" value={report.rsvpdPeople} hint={`${report.householdsTotal - (report.households.cancelled ?? 0)} households`} tone="maroon" />
          <Stat label="Confirmed" value={report.confirmedPeople} hint={`of ${report.rsvpdPeople} RSVP'd`} tone="navy" />
          <Stat label="Checked in" value={report.checkedIn} hint={`${report.walkIns} walk-ins`} tone="success" />
          <Stat
            label="Flags"
            value={report.flags.childUnder12 + report.flags.senior + report.flags.assistance}
            hint={`${report.flags.childUnder12} under 12 · ${report.flags.senior} seniors · ${report.flags.assistance} assistance`}
            tone="brown"
          />
        </KpiGrid>
      </Card>
      <ChipLinks
        label="RSVP status"
        active={status ?? ""}
        items={[
          { key: "", label: `All (${rsvps.length})`, href: base },
          ...STATUSES.filter((s) => report.households[s]).map((s) => ({ key: s, label: `${statusLabel(s)} (${report.households[s]})`, href: `${base}&rsvp=${s}` })),
        ]}
      />
      <BlockGrid>
        <div className={`col-span-12 ${canEdit ? "lg:col-span-8" : ""}`}>
          {shown.length === 0 ? (
            <Card>
              <EmptyState title="No RSVPs here yet" />
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((r) => {
                const people = attendees.filter((a) => a.rsvp_id === r.id);
                const flags = [
                  people.some((p) => p.is_child_under_12) && "child under 12",
                  people.some((p) => p.is_senior) && "senior",
                  people.some((p) => p.needs_assistance) && "assistance",
                ].filter(Boolean);
                return (
                  <li key={r.id} className="cc-card px-[18px] py-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-bold text-ink">{label(r)}</p>
                        <p className="text-xs text-muted">
                          {people.length} {people.length === 1 ? "person" : "people"}
                          {r.source !== "app" ? ` · via ${humanize(r.source)}` : ""}
                          {r.guest_phone_e164 ? ` · ${r.guest_phone_e164}` : ""}
                          {r.commitment_mode && r.commitment_mode !== "none" ? ` · commitment ${humanize(r.commitment_mode)}` : ""}
                          {r.confirmed_at ? ` · confirmed ${formatDateTime(r.confirmed_at, tz)}` : ""}
                        </p>
                        {flags.length > 0 ? <p className="mt-1 text-xs font-bold text-brown">Flags: {flags.join(", ")}</p> : null}
                      </div>
                      <span className={`text-[13px] ${statusClass(r.status)}`}>{statusLabel(r.status)}</span>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[13px] font-bold text-navy">People</summary>
                      <ul className="mt-1.5 flex flex-col gap-1 text-[13px]">
                        {people.map((p) => {
                          const slot = slots.find((s) => s.id === p.lunch_slot_id);
                          return (
                            <li key={p.id} className="flex flex-wrap justify-between gap-2">
                              <span>
                                {p.display_name}
                                {p.is_child_under_12 ? " · under 12" : ""}
                                {p.is_senior ? " · senior" : ""}
                                {p.needs_assistance ? ` · assistance${p.assistance_note ? ` (${p.assistance_note})` : ""}` : ""}
                              </span>
                              <span className="text-muted">
                                {p.checked_in_at ? `in ${formatTime(p.checked_in_at, tz)}` : "not in"}
                                {slot ? ` · lunch ${formatTime(slot.starts_at, tz)}` : ""}
                                {p.served_food_at ? " · served" : ""}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                    {canChange ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.status !== "confirmed" && r.status !== "attended" && r.status !== "cancelled" ? (
                          <ActionButton action={setRsvpStatus.bind(null, event.id, r.id)} fields={{ status: "confirmed" }} label="Confirm" variant="ok" />
                        ) : null}
                        {r.status === "waitlisted" ? (
                          <ActionButton action={setRsvpStatus.bind(null, event.id, r.id)} fields={{ status: "rsvpd" }} label="Offer a seat" variant="primary" />
                        ) : null}
                        {r.status !== "cancelled" && r.status !== "attended" ? (
                          <ActionButton
                            action={setRsvpStatus.bind(null, event.id, r.id)}
                            fields={{ status: "cancelled" }}
                            label="Cancel"
                            variant="bad"
                            confirm={`Cancel the RSVP for ${label(r)}?`}
                          />
                        ) : null}
                        {(r.status === "confirmed" || r.status === "rsvpd") && event.status !== "draft" ? (
                          <ActionButton action={setRsvpStatus.bind(null, event.id, r.id)} fields={{ status: "no_show" }} label="No-show" />
                        ) : null}
                        {r.status === "cancelled" || r.status === "no_show" ? (
                          <ActionButton action={setRsvpStatus.bind(null, event.id, r.id)} fields={{ status: "rsvpd" }} label="Reopen" />
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {canEdit ? (
          <Card span={4} title="Add a guest RSVP" description="For people without the app — added as an office RSVP.">
            <ActionForm action={addGuestRsvp.bind(null, event.id)} submitLabel="Add RSVP" resetOnSuccess>
              <div className="mb-3 flex flex-col gap-3">
                <div>
                  <label htmlFor="g-name" className="crm-label">
                    Party name
                  </label>
                  <input id="g-name" name="guest_name" className="crm-input" placeholder="e.g. Shah family" />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="g-phone" className="crm-label">
                      Mobile
                    </label>
                    <input id="g-phone" name="guest_phone" type="tel" className="crm-input" />
                  </div>
                  <div>
                    <label htmlFor="g-email" className="crm-label">
                      Email
                    </label>
                    <input id="g-email" name="guest_email" type="email" className="crm-input" />
                  </div>
                </div>
                <div>
                  <label htmlFor="g-party" className="crm-label">
                    People
                  </label>
                  <textarea id="g-party" name="party" rows={4} required className="crm-input" placeholder={"Priya Shah\nAnya Shah, child"} />
                  <p className="crm-hint">One per line. Add &ldquo;, child&rdquo;, &ldquo;, senior&rdquo; or &ldquo;, assistance&rdquo; after a name.</p>
                </div>
                <label className="flex min-h-9 items-center gap-2 text-[13px]">
                  <input type="checkbox" name="confirmed" className="h-4 w-4 accent-navy" /> Already confirmed
                </label>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </BlockGrid>
    </div>
  );
}

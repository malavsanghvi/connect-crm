import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { PersonPicker } from "@/components/events/person-picker";
import { Alert, BlockGrid, Card, EmptyState } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { load, resolvePeopleNames, rows } from "@/lib/data/events";
import { eventAreas, type EventAccess } from "@/lib/events/access";
import { formatTime, humanize, plural } from "@/lib/events/format";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import { assignVolunteer, createShift, deleteShift, grantEventRole, setAssignment } from "../actions";

const STATION_ROLE: Record<string, string | undefined> = { entry: "checkin_volunteer", food: "checkin_volunteer", gifts: "checkin_volunteer", kitchen: "kitchen_lead" };
const STATION_LABEL: Record<string, string> = {
  entry: "Entry (check-in)",
  food: "Food",
  gifts: "Gifts",
  kitchen: "Kitchen",
  parking: "Parking",
  app_seva: "App help desk",
};

function assignmentClass(s: string) {
  if (s === "confirmed" || s === "completed") return "cc-status-ok";
  if (s === "declined" || s === "no_show") return "cc-status-bad";
  return "font-semibold text-muted";
}

export async function VolunteersTab({ event, session, access }: { event: Tables<"events">; session: CrmSession; access: EventAccess }) {
  const { db, center } = session;
  const tz = center.time_zone;
  const res = await load(async () => {
    const shifts = rows(await db.from("volunteer_shifts").select("*").eq("event_id", event.id).order("station").order("starts_at"), "volunteer shifts");
    const assignments = shifts.length
      ? rows(await db.from("volunteer_assignments").select("*").in("shift_id", shifts.map((s) => s.id)), "volunteer assignments")
      : [];
    return { shifts, assignments, names: await resolvePeopleNames(db, assignments.map((a) => a.person_id)) };
  });
  if (!res.ok) return <LoadProblem message={res.error} retryHref={`/events/${event.id}?tab=volunteers`} />;
  const { shifts, assignments, names } = res.data;
  const canEdit = eventAreas.volunteers(access, event.id);
  const canGrant = eventAreas.grantRoles(access);
  const stations = [...new Set(shifts.map((s) => s.station))];
  const active = assignments.filter((a) => a.status !== "declined");
  const missingWaivers = active.filter((a) => !a.waiver_consent_id).length;

  return (
    <BlockGrid>
      <div className={`col-span-12 flex flex-col gap-4 ${canEdit ? "lg:col-span-8" : ""}`}>
        {!canGrant && canEdit ? (
          <Alert tone="info">
            Assigning a volunteer here doesn&apos;t open the check-in screen for them. A center admin grants that access (check-in volunteer, for this
            event).
          </Alert>
        ) : null}
        {active.length > 0 ? (
          <p className="text-[13px] text-muted">
            {plural(active.length, "volunteer")} assigned ·{" "}
            {missingWaivers ? <strong className="text-brown">{missingWaivers} missing signed waivers</strong> : <strong className="text-success">all waivers signed</strong>}
            {canAccess(session, "volunteers") ? (
              <>
                {" "}
                ·{" "}
                <Link href="/events/volunteers" className="crm-link">
                  Volunteer groups and background checks
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
        {shifts.length === 0 ? (
          <Card>
            <EmptyState title="No shifts yet">{canEdit ? "Add shifts for each station." : null}</EmptyState>
          </Card>
        ) : (
          stations.map((station) => (
            <Card key={station} title={STATION_LABEL[station] ?? humanize(station)}>
              <ul className="divide-y divide-line-soft">
                {shifts
                  .filter((s) => s.station === station)
                  .map((s) => {
                    const people = assignments.filter((a) => a.shift_id === s.id && a.status !== "declined");
                    const short = s.capacity !== null ? s.capacity - people.length : 0;
                    return (
                      <li key={s.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[13px] font-bold">
                            {s.starts_at ? formatTime(s.starts_at, tz) : "Any time"}
                            {s.ends_at ? `–${formatTime(s.ends_at, tz)}` : ""}{" "}
                            <span className="font-normal text-muted">
                              · {people.length}
                              {s.capacity !== null ? ` of ${s.capacity}` : ""} volunteers
                            </span>{" "}
                            {short > 0 ? <span className="cc-status-warn">Needs {short}</span> : null}
                          </p>
                          {canEdit ? (
                            <ActionButton
                              action={deleteShift.bind(null, event.id, s.id)}
                              label="Remove shift"
                              variant="bad"
                              confirm="Remove this shift and its assignments?"
                            />
                          ) : null}
                        </div>
                        {s.notes ? <p className="text-[13px] text-muted">{s.notes}</p> : null}
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {assignments
                            .filter((a) => a.shift_id === s.id)
                            .map((a) => (
                              <li key={a.id} className="cc-kv flex-col items-start sm:flex-row sm:items-center">
                                <span className="text-[13px]">
                                  <span className="font-bold">{names.get(a.person_id) ?? "Volunteer"}</span>{" "}
                                  <span className={assignmentClass(a.status)}>{humanize(a.status)}</span>
                                  {" · "}
                                  {a.waiver_consent_id ? <span className="cc-status-ok">Waiver signed</span> : <span className="cc-status-warn">No signed waiver</span>}
                                </span>
                                {canEdit ? (
                                  <span className="flex flex-wrap gap-1.5">
                                    {a.status === "assigned" ? (
                                      <ActionButton action={setAssignment.bind(null, event.id, a.id)} fields={{ status: "confirmed" }} label="Confirmed" variant="ok" />
                                    ) : null}
                                    {a.status !== "completed" && event.status === "live" ? (
                                      <ActionButton action={setAssignment.bind(null, event.id, a.id)} fields={{ status: "no_show" }} label="No-show" />
                                    ) : null}
                                    <ActionButton action={setAssignment.bind(null, event.id, a.id)} fields={{ status: "remove" }} label="Remove" variant="bad" />
                                    {canGrant && STATION_ROLE[s.station] ? (
                                      <ActionButton
                                        action={grantEventRole.bind(null, event.id, a.person_id)}
                                        fields={{ role: STATION_ROLE[s.station]! }}
                                        label={s.station === "kitchen" ? "Give kitchen access" : "Give check-in access"}
                                      />
                                    ) : null}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                        </ul>
                        {canEdit ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[13px] font-bold text-navy">Assign volunteers</summary>
                            <div className="mt-2">
                              <ActionForm action={assignVolunteer.bind(null, event.id, s.id)} submitLabel="Assign" size="sm" resetOnSuccess>
                                <div className="mb-2">
                                  <PersonPicker name="person_id" label="Volunteers" multiple />
                                </div>
                              </ActionForm>
                            </div>
                          </details>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </Card>
          ))
        )}
      </div>
      {canEdit ? (
        <Card span={4} title="Add a shift">
          <ActionForm action={createShift.bind(null, event.id)} submitLabel="Add shift" resetOnSuccess>
            <div className="mb-3 flex flex-col gap-3">
              <div>
                <label htmlFor="sh-station" className="crm-label">
                  Station
                </label>
                <select id="sh-station" name="station" defaultValue="entry" className="crm-input">
                  {Object.entries(STATION_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="sh-start" className="crm-label">
                    Starts
                  </label>
                  <input id="sh-start" type="datetime-local" name="starts_at" className="crm-input" />
                </div>
                <div>
                  <label htmlFor="sh-end" className="crm-label">
                    Ends
                  </label>
                  <input id="sh-end" type="datetime-local" name="ends_at" className="crm-input" />
                </div>
              </div>
              <div>
                <label htmlFor="sh-cap" className="crm-label">
                  Volunteers needed
                </label>
                <input id="sh-cap" type="number" name="capacity" min={1} className="crm-input" />
              </div>
              <div>
                <label htmlFor="sh-notes" className="crm-label">
                  Notes
                </label>
                <input id="sh-notes" name="notes" className="crm-input" />
              </div>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </BlockGrid>
  );
}

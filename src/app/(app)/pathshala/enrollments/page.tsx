import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, TableWrap } from "@/components/ui";
import { ageFrom, loadClasses, loadLevels, loadTerms, pickTerm } from "@/lib/data/pathshala";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDate, humanize, todayIso } from "@/lib/pathshala/format";
import { load, rows, viewerOf } from "@/lib/pathshala/server";
import { getSession } from "@/lib/session";

import { placeEnrollment, saveEnrollmentNote, setEnrollmentStatus, waitlistEnrollment } from "../actions";
import { ActionButton, Details, LoadProblemPage, PathshalaHeader, PNoAccessPage, TermSwitcher, ViewChips } from "../ui";

export const metadata: Metadata = { title: "Enrollments" };

const STATUSES = ["requested", "waitlisted", "placed", "active", "withdrawn", "completed"] as const;

export default async function EnrollmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.admin(v)) return <PNoAccessPage area="Pathshala enrollments" />;
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(String(sp.status)) ? String(sp.status) : "requested";
  const supabase = v.db;
  const canManage = pathshalaAreas.manage(v);
  const tz = v.center.time_zone;
  const today = todayIso(tz);

  const res = await load(async () => {
    const [terms, levels] = await Promise.all([loadTerms(supabase, v.center.id), loadLevels(supabase, v.center.id)]);
    const term = pickTerm(terms, typeof sp.term === "string" ? sp.term : null);
    if (!term) return { terms, levels, term: null, all: [], classes: [], people: [], households: [] };
    const [all, classes] = await Promise.all([
      supabase.from("pathshala_enrollments").select("*").eq("term_id", term.id).order("registered_at"),
      loadClasses(supabase, v.center.id, term.id),
    ]);
    const enr = rows(all, "enrollments");
    const shown = enr.filter((e) => e.status === status);
    const [people, households] = await Promise.all([
      shown.length
        ? supabase.from("people").select("id, first_name, last_name, preferred_name, date_of_birth").in("id", shown.map((e) => e.student_person_id))
        : Promise.resolve({ data: [], error: null }),
      shown.length
        ? supabase.from("households").select("id, display_name").in("id", shown.map((e) => e.household_id))
        : Promise.resolve({ data: [], error: null }),
    ]);
    // Household names need people.view; without it they are simply not shown.
    if (households.error) console.error("[enrollments] household names unavailable", households.error);
    return { terms, levels, term, all: enr, classes, people: rows(people, "student names"), households: households.data ?? [] };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  const { terms, levels, term, all, classes, people, households } = res.data;

  const counts = Object.fromEntries(STATUSES.map((s) => [s, all.filter((e) => e.status === s).length]));
  const seats = new Map(classes.map((c) => [c.id, all.filter((e) => e.class_id === c.id && (e.status === "placed" || e.status === "active")).length]));
  const shown = all.filter((e) => e.status === status);
  const levelName = (id: string | null) => levels.find((l) => l.id === id)?.name ?? "No level chosen";
  const classLabel = (c: (typeof classes)[number]) =>
    `${c.name} — ${seats.get(c.id) ?? 0}${c.capacity !== null ? `/${c.capacity}` : ""}${c.capacity !== null && (seats.get(c.id) ?? 0) >= c.capacity ? " (full)" : ""}`;

  return (
    <>
      <PathshalaHeader
        description={
          term
            ? `Enrollments · Term: ${term.name} · place each request into a class, waitlist or withdraw`
            : "Enrollments · no Pathshala term yet"
        }
      />
      <TermSwitcher terms={terms} activeId={term?.id ?? null} basePath="/pathshala/enrollments" />
      {!term ? (
        <Card>
          <EmptyState title="No Pathshala term yet" />
        </Card>
      ) : (
        <>
          <ViewChips
            active={status}
            tabs={STATUSES.map((s) => ({ key: s, label: humanize(s), count: counts[s], href: `/pathshala/enrollments?term=${term.id}&status=${s}` }))}
          />
          <Card title={`${humanize(status)} (${shown.length})`} padded={false}>
            {shown.length === 0 ? (
              <EmptyState title={`No ${status} enrollments`}>{status === "requested" ? "New registrations from families appear here." : ""}</EmptyState>
            ) : (
              <TableWrap>
                <table className="crm-table crm-table-first-bold min-w-[900px]">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Age</th>
                      <th>Household</th>
                      <th>Asked for</th>
                      <th>Registered</th>
                      <th>Class</th>
                      {canManage ? <th aria-label="Actions" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => {
                      const p = people.find((x) => x.id === e.student_person_id);
                      const name = p ? `${p.preferred_name || p.first_name} ${p.last_name}` : "Student (name hidden)";
                      const hh = households.find((h) => h.id === e.household_id)?.display_name;
                      const age = ageFrom(p?.date_of_birth ?? null, today);
                      const suggested = classes.filter((c) => c.level_id === e.requested_level_id);
                      const rest = classes.filter((c) => c.level_id !== e.requested_level_id);
                      const current = classes.find((c) => c.id === e.class_id);
                      const canPlace = e.status === "requested" || e.status === "waitlisted" || e.status === "placed";
                      return (
                        <tr key={e.id}>
                          <td>
                            {name}
                            {e.notes ? <div className="text-xs font-normal text-muted">Note: {e.notes}</div> : null}
                          </td>
                          <td>{age ?? "—"}</td>
                          <td>{hh ?? "—"}</td>
                          <td>{levelName(e.requested_level_id)}</td>
                          <td className="whitespace-nowrap">{formatDate(e.registered_at, tz)}</td>
                          <td>{current ? current.name : "—"}</td>
                          {canManage ? (
                            <td className="min-w-[320px]">
                              <div className="flex flex-col items-stretch gap-2">
                                {canPlace ? (
                                  <ActionForm
                                    action={placeEnrollment.bind(null, e.id)}
                                    submitLabel={e.status === "placed" ? "Move" : "Place"}
                                    size="xs"
                                    className="flex flex-wrap items-center gap-2"
                                  >
                                    <select
                                      name="class_id"
                                      required
                                      defaultValue={e.class_id ?? suggested[0]?.id ?? ""}
                                      className="crm-input min-h-[30px] w-auto max-w-[220px] text-[13px]"
                                      aria-label={`Class for ${name}`}
                                    >
                                      <option value="">Choose a class</option>
                                      {suggested.length > 0 ? (
                                        <optgroup label="Requested level">
                                          {suggested.map((c) => (
                                            <option key={c.id} value={c.id}>
                                              {classLabel(c)}
                                            </option>
                                          ))}
                                        </optgroup>
                                      ) : null}
                                      <optgroup label="Other classes">
                                        {rest.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {classLabel(c)}
                                          </option>
                                        ))}
                                      </optgroup>
                                    </select>
                                    <label className="flex items-center gap-1.5 text-xs text-muted">
                                      <input type="checkbox" name="over_capacity" className="h-4 w-4 accent-navy" /> Place even if full
                                    </label>
                                  </ActionForm>
                                ) : null}
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {canPlace && e.status !== "waitlisted" ? (
                                    <ActionButton action={waitlistEnrollment.bind(null, e.id)} fields={{ class_id: e.class_id ?? suggested[0]?.id ?? "" }} label="Waitlist" />
                                  ) : null}
                                  {canPlace ? (
                                    <ActionButton
                                      action={setEnrollmentStatus.bind(null, e.id)}
                                      fields={{ status: "withdrawn" }}
                                      label="Withdraw"
                                      variant="bad"
                                      confirm={`Withdraw ${name}'s enrollment?`}
                                    />
                                  ) : null}
                                  {e.status === "withdrawn" ? (
                                    <ActionButton action={setEnrollmentStatus.bind(null, e.id)} fields={{ status: "requested" }} label="Reopen request" />
                                  ) : null}
                                </div>
                                <Details summary={e.notes ? "Edit note" : "Add a note"}>
                                  <ActionForm action={saveEnrollmentNote.bind(null, e.id)} submitLabel="Save note" size="xs" buttonsClassName="mt-2">
                                    <textarea name="notes" rows={2} defaultValue={e.notes ?? ""} className="crm-input" aria-label={`Note for ${name}`} />
                                  </ActionForm>
                                </Details>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </>
  );
}

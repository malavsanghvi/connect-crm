import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { PersonPicker } from "@/components/person-picker";
import { MoreDetails } from "@/components/more-details";
import { HistoryButton } from "@/components/record-history";
import { buttonClass, Card, EmptyState, TableWrap } from "@/components/ui";
import { ageFrom, loadLevels, loadTerms } from "@/lib/data/pathshala";
import { formatRate, summarizeAttendance } from "@/lib/logic/attendance";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { classTimeLabel, formatDate, humanize, todayIso } from "@/lib/pathshala/format";
import { load, resolvePeopleNames, row, rows, viewerOf } from "@/lib/pathshala/server";
import { hasScopedRole } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { addTeacher, placeEnrollment, removeTeacher, setEnrollmentStatus, waitlistEnrollment } from "../../actions";
import { searchPeopleAction } from "../../actions";
import { ActionButton, Details, LoadProblemPage, PathshalaHeader, PBadge, PField, PNoAccessPage, Select } from "../../ui";
import { ClassForm } from "../class-form";

export const metadata: Metadata = { title: "Class" };

export default async function ClassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  const v = viewerOf(session);
  const isTeacher = hasScopedRole(v, id, "teacher");
  if (!pathshalaAreas.admin(v) && !isTeacher) return <PNoAccessPage area="this class" />;
  const canManage = pathshalaAreas.manage(v);
  const supabase = v.db;
  const today = todayIso(v.center.time_zone);

  const res = await load(async () => {
    const cls = row(await supabase.from("pathshala_classes").select("*").eq("id", id).maybeSingle(), "the class");
    if (!cls) return null;
    const [terms, levels, teachers, enrolled, levelQueue, sessions, siblings] = await Promise.all([
      loadTerms(supabase, v.center.id),
      loadLevels(supabase, v.center.id),
      supabase.from("pathshala_teachers").select("*").eq("class_id", id),
      supabase.from("pathshala_enrollments").select("*").eq("class_id", id).order("registered_at"),
      supabase
        .from("pathshala_enrollments")
        .select("*")
        .eq("term_id", cls.term_id)
        .eq("requested_level_id", cls.level_id)
        .is("class_id", null)
        .in("status", ["requested", "waitlisted"])
        .order("registered_at"),
      supabase.from("pathshala_sessions").select("id, held_on, topic").eq("class_id", id).order("held_on", { ascending: false }).limit(12),
      supabase.from("pathshala_classes").select("id, name, capacity").eq("term_id", cls.term_id).order("name"),
    ]);
    const t = rows(teachers, "teachers");
    const e = rows(enrolled, "the roster");
    const q = canManage ? rows(levelQueue, "the level waitlist") : [];
    const s = rows(sessions, "past sessions");
    const marks = s.length
      ? rows(await supabase.from("pathshala_attendance").select("session_id, enrollment_id, status").in("session_id", s.map((x) => x.id)), "attendance")
      : [];
    const studentIds = [...e, ...q].map((x) => x.student_person_id);
    const [names, students] = await Promise.all([
      resolvePeopleNames(supabase, t.map((x) => x.person_id)),
      studentIds.length
        ? supabase.from("people").select("id, first_name, last_name, preferred_name, date_of_birth").in("id", studentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const studentRows = rows(students, "student names");
    return { cls, terms, levels, teachers: t, enrolled: e, levelQueue: q, sessions: s, marks, names, students: studentRows, siblings: rows(siblings, "classes") };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  if (!res.data) notFound();
  const d = res.data;
  const { cls } = d;
  const level = d.levels.find((l) => l.id === cls.level_id);
  const term = d.terms.find((t) => t.id === cls.term_id);
  const student = (pid: string) => d.students.find((s) => s.id === pid);
  const studentName = (pid: string) => {
    const s = student(pid);
    return s ? `${s.preferred_name || s.first_name} ${s.last_name}` : "Student (name hidden)";
  };
  const roster = d.enrolled.filter((e) => e.status === "placed" || e.status === "active");
  const classWaitlist = d.enrolled.filter((e) => e.status === "waitlisted");
  const others = d.enrolled.filter((e) => !["placed", "active", "waitlisted"].includes(e.status));
  const classOptions = d.siblings.map((c) => ({ value: c.id, label: c.name + (c.capacity !== null ? ` (cap ${c.capacity})` : "") }));

  return (
    <>
      <PathshalaHeader
        title={cls.name}
        description={[level?.track_name, level?.name, term?.name ? `Term ${term.name}` : null, cls.room, classTimeLabel(cls.meets_on, cls.starts_time)]
          .filter(Boolean)
          .join(" · ")}
        back={pathshalaAreas.admin(v) ? { href: "/pathshala", label: "Pathshala" } : { href: "/pathshala/my-classes", label: "My classes" }}
        actions={
          <>
            <HistoryButton table="pathshala_classes" recordId={cls.id} title={cls.name} variant="ghost" size="md" />
            <Link href={`/pathshala/classes/${cls.id}/reports`} className={buttonClass("ghost")}>
              Progress reports
            </Link>
            {isTeacher || canManage ? (
              <Link href={`/pathshala/classes/${cls.id}/attendance`} className={buttonClass("primary")}>
                Take attendance
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-8">
          <Card
            title={`Roster (${roster.length}${cls.capacity !== null ? ` of ${cls.capacity}` : ""})`}
            description={cls.capacity !== null && roster.length >= cls.capacity ? "This class is full." : undefined}
          >
            {roster.length === 0 ? (
              <EmptyState title="No students placed yet">{canManage ? "Place students from the waitlist or the enrollment requests." : ""}</EmptyState>
            ) : (
              <TableWrap>
                <table className="crm-table crm-table-first-bold min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Age</th>
                      <th>Status</th>
                      {canManage && <th>Change</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {studentName(e.student_person_id)}
                          {e.notes && <div className="text-xs font-normal text-muted">{e.notes}</div>}
                        </td>
                        <td>{ageFrom(student(e.student_person_id)?.date_of_birth ?? null, today) ?? "—"}</td>
                        <td>
                          <PBadge tone={e.status === "active" ? "success" : "purple"}>{humanize(e.status)}</PBadge>
                          {e.placed_at && <div className="text-xs text-muted">since {formatDate(e.placed_at)}</div>}
                        </td>
                        {canManage && (
                          <td>
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {e.status === "placed" && (
                                <ActionButton action={setEnrollmentStatus.bind(null, e.id)} fields={{ status: "active" }} label="Mark active" />
                              )}
                              <ActionButton action={waitlistEnrollment.bind(null, e.id)} fields={{ class_id: cls.id }} label="Move to waitlist" />
                              <ActionButton
                                action={setEnrollmentStatus.bind(null, e.id)}
                                fields={{ status: "withdrawn" }}
                                label="Withdraw"
                                variant="bad"
                                confirm={`Withdraw ${studentName(e.student_person_id)} from Pathshala this term?`}
                              />
                            </div>
                            <Details summary="Move to another class">
                              <ActionForm buttonsClassName="mt-3" action={placeEnrollment.bind(null, e.id)} submitLabel="Move" variant="primary">
                                <Select name="class_id" required options={classOptions.filter((o) => o.value !== cls.id)} placeholder="Choose a class" />
                                <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
                                  <input type="checkbox" name="over_capacity" className="h-5 w-5 accent-navy" /> Place even if full
                                </label>
                              </ActionForm>
                            </Details>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          {(canManage || classWaitlist.length > 0) && (
            <Card title={`Waitlist (${classWaitlist.length + d.levelQueue.length})`} description="Students waiting for this class, then students who asked for this level and are not placed yet.">
              {classWaitlist.length + d.levelQueue.length === 0 ? (
                <EmptyState title="Nobody is waiting" />
              ) : (
                <ul className="divide-y divide-line">
                  {[...classWaitlist, ...d.levelQueue].map((e) => (
                    <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">{studentName(e.student_person_id)}</p>
                        <p className="text-xs text-muted">
                          {e.class_id ? "Waitlisted for this class" : e.status === "requested" ? "Requested this level" : "Waitlisted for this level"} · since{" "}
                          {formatDate(e.registered_at)}
                        </p>
                      </div>
                      {canManage && (
                        <div className="flex flex-wrap gap-2">
                          <ActionButton action={placeEnrollment.bind(null, e.id)} fields={{ class_id: cls.id }} label="Place in this class" variant="primary" />
                          {!e.class_id && (
                            <ActionButton action={waitlistEnrollment.bind(null, e.id)} fields={{ class_id: cls.id }} label="Waitlist for this class" />
                          )}
                          <ActionButton
                            action={setEnrollmentStatus.bind(null, e.id)}
                            fields={{ status: "withdrawn" }}
                            label="Withdraw"
                            variant="bad"
                            confirm="Withdraw this enrollment?"
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title="Recent class days">
            {d.sessions.length === 0 ? (
              <EmptyState title="No attendance taken yet" />
            ) : (
              <TableWrap>
                <table className="crm-table crm-table-first-bold min-w-[480px]">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Topic</th>
                      <th>Attendance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.sessions.map((s) => {
                      const sum = summarizeAttendance(roster.map((r) => r.id), d.marks.filter((m) => m.session_id === s.id));
                      return (
                        <tr key={s.id}>
                          <td>
                            <Link className="crm-link font-semibold" href={`/pathshala/classes/${cls.id}/attendance?date=${s.held_on}`}>
                              {formatDate(s.held_on)}
                            </Link>
                          </td>
                          <td>{s.topic ?? "—"}</td>
                          <td>
                            {sum.attended} of {sum.total} ({formatRate(sum.rate)}){sum.unmarked > 0 && <span className="text-muted"> · {sum.unmarked} unmarked</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          {others.length > 0 && (
            <Details summary={`Withdrawn or completed (${others.length})`}>
              <ul className="space-y-2 text-sm">
                {others.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {studentName(e.student_person_id)} · <PBadge tone="muted">{humanize(e.status)}</PBadge>
                    </span>
                    {canManage && e.status === "withdrawn" && (
                      <ActionButton action={setEnrollmentStatus.bind(null, e.id)} fields={{ status: "requested" }} label="Reopen request" />
                    )}
                  </li>
                ))}
              </ul>
            </Details>
          )}
        </div>

        <div className="space-y-4 lg:col-span-4">
          <Card title="Teachers">
            {d.teachers.length === 0 ? (
              <p className="text-sm text-muted">No teacher assigned yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {d.teachers.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-semibold">{d.names.get(t.person_id) ?? "Teacher"}</span>
                      <span className="ml-2">
                        <PBadge tone="purple">{humanize(t.role)}</PBadge>
                      </span>
                    </span>
                    {canManage && (
                      <ActionButton
                        action={removeTeacher.bind(null, t.id)}
                        label="Remove"
                        variant="bad"
                        confirm={`Remove ${d.names.get(t.person_id) ?? "this teacher"} from ${cls.name}?`}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="mt-4 border-t border-line pt-4">
                <ActionForm buttonsClassName="mt-3" action={addTeacher.bind(null, cls.id)} submitLabel="Add teacher" variant="primary" resetOnSuccess>
                  <div className="space-y-3">
                    <PersonPicker search={searchPeopleAction} name="person_id" label="Person" required hint="Only people your role can see appear in the search." />
                    <PField label="Role">
                      <Select
                        name="role"
                        defaultValue="teacher"
                        options={[
                          { value: "teacher", label: "Teacher" },
                          { value: "assistant", label: "Assistant" },
                          { value: "substitute", label: "Substitute" },
                        ]}
                      />
                    </PField>
                  </div>
                </ActionForm>
              </div>
            )}
          </Card>
          <MoreDetails session={session} entity="pathshala_classes" recordId={cls.id} custom={(cls as { custom?: unknown }).custom} editable={canManage} variant="card" />
          {canManage && (
            <Card title="Class details">
              <ClassForm cls={cls} terms={d.terms} levels={d.levels} defaultTermId={cls.term_id} cols={1} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

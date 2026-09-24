import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { startOfDayInTz } from "@/lib/dates";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDateTime, todayIso } from "@/lib/pathshala/format";
import { load, resolvePeopleNames, resolveUserNames, rows } from "@/lib/pathshala/server";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { decideSignoff } from "../actions";
import { LoadProblem, PNoAccess, PathshalaHeader, ViewChips } from "../ui";
import { NoteToggle } from "./note-toggle";

export const metadata: Metadata = { title: "Gyan Path sign-offs" };

const SUBTITLE = "Final Gyan Path levels need a teacher sign-off before completion counts toward class level";

/** Prototype status words: Waiting (amber), Practice more / Signed off (green). */
function StatusCell({ status }: { status: string }) {
  if (status === "approved") return <StatusText tone="ok">Signed off</StatusText>;
  if (status === "needs_work") return <StatusText tone="ok">Practice more</StatusText>;
  return <StatusText tone="warn">Waiting</StatusText>;
}

export default async function SignoffsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!pathshalaAreas.signoffs(session)) {
    return (
      <>
        <PathshalaHeader description={SUBTITLE} />
        <PNoAccess area="Gyan Path sign-offs (a Teacher role, pathshala.teach or pathshala.manage)" />
      </>
    );
  }
  const sp = await searchParams;
  const view = param(sp, "view") === "decided" ? "decided" : "waiting";
  const tz = session.center.time_zone;
  const db = session.db;

  const res = await load(async () => {
    let q = db.from("gyan_signoffs").select("*").eq("center_id", session.center.id);
    // Waiting keeps today's decisions on screen (with their new status), as the prototype does after a click.
    q =
      view === "waiting"
        ? q.or(`status.eq.requested,decided_at.gte."${startOfDayInTz(todayIso(tz), tz)}"`).order("requested_at")
        : q.neq("status", "requested").order("decided_at", { ascending: false }).limit(100);
    const signoffs = rows(await q, "sign-off requests");
    const levelIds = [...new Set(signoffs.map((s) => s.level_id))];
    const personIds = [...new Set(signoffs.map((s) => s.person_id))];
    const [levels, enrollments, names, deciders] = await Promise.all([
      levelIds.length ? db.from("gyan_levels").select("id, name, key, goal_id").in("id", levelIds) : Promise.resolve({ data: [], error: null }),
      personIds.length
        ? db.from("pathshala_enrollments").select("student_person_id, class_id").in("student_person_id", personIds).in("status", ["placed", "active"])
        : Promise.resolve({ data: [], error: null }),
      resolvePeopleNames(db, personIds),
      resolveUserNames(db, session.center.id, signoffs.map((s) => s.teacher_user)),
    ]);
    const lv = rows(levels, "Gyan Path levels");
    const en = rows(enrollments, "class placements");
    const goalIds = [...new Set(lv.map((l) => l.goal_id))];
    const classIds = [...new Set(en.map((e) => e.class_id).filter((x): x is string => Boolean(x)))];
    const [goals, classes, teachers] = await Promise.all([
      goalIds.length ? db.from("gyan_goals").select("id, name").in("id", goalIds) : Promise.resolve({ data: [], error: null }),
      classIds.length ? db.from("pathshala_classes").select("id, name, level_id").in("id", classIds) : Promise.resolve({ data: [], error: null }),
      classIds.length ? db.from("pathshala_teachers").select("class_id, person_id, role").in("class_id", classIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const cls = rows(classes, "classes");
    const tch = rows(teachers, "class teachers");
    const levelIdsP = [...new Set(cls.map((c) => c.level_id))];
    const [plevels, teacherNames] = await Promise.all([
      levelIdsP.length ? db.from("pathshala_levels").select("id, name").in("id", levelIdsP) : Promise.resolve({ data: [], error: null }),
      resolvePeopleNames(db, tch.map((t) => t.person_id)),
    ]);
    return {
      signoffs,
      levels: lv,
      goals: rows(goals, "Gyan Path goals"),
      enrollments: en,
      classes: cls,
      pathshalaLevels: rows(plevels, "Pathshala levels"),
      teachers: tch,
      teacherNames,
      names,
      deciders,
    };
  });

  const header = (
    <>
      <PathshalaHeader description={SUBTITLE} />
      <ViewChips
        active={view}
        tabs={[
          { key: "waiting", label: "Awaiting sign-off", href: "/pathshala/signoffs" },
          { key: "decided", label: "Decided", href: "/pathshala/signoffs?view=decided" },
        ]}
      />
    </>
  );
  if (!res.ok) {
    return (
      <>
        {header}
        <LoadProblem message={res.error} retryHref={view === "decided" ? "/pathshala/signoffs?view=decided" : "/pathshala/signoffs"} />
      </>
    );
  }
  const d = res.data;

  const studentClasses = (personId: string) =>
    d.enrollments
      .filter((e) => e.student_person_id === personId && e.class_id)
      .map((e) => d.classes.find((c) => c.id === e.class_id))
      .filter((c): c is (typeof d.classes)[number] => Boolean(c));

  return (
    <>
      {header}
      <Card title={view === "waiting" ? "Awaiting sign-off" : "Decided"} padded={false}>
        {d.signoffs.length === 0 ? (
          <EmptyState title={view === "waiting" ? "No sign-offs waiting" : "Nothing decided yet"}>
            {view === "waiting" ? "When a student finishes a final level that needs a teacher, it shows up here." : ""}
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table crm-table-first-bold min-w-[860px]">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Goal and level</th>
                  <th>Teacher</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {d.signoffs.map((s) => {
                  const level = d.levels.find((l) => l.id === s.level_id);
                  const goal = d.goals.find((g) => g.id === level?.goal_id);
                  const classes = studentClasses(s.person_id);
                  const classLabel = classes
                    .map((c) => d.pathshalaLevels.find((l) => l.id === c.level_id)?.name ?? c.name)
                    .join(", ");
                  const teacherLabel = [
                    ...new Set(
                      d.teachers
                        .filter((t) => classes.some((c) => c.id === t.class_id))
                        .sort((a, b) => (a.role === "teacher" ? 0 : 1) - (b.role === "teacher" ? 0 : 1))
                        .map((t) => d.teacherNames.get(t.person_id) ?? "Teacher"),
                    ),
                  ].join(", ");
                  const student = d.names.get(s.person_id) ?? "Student";
                  const decider = s.teacher_user ? (s.teacher_user === session.userId ? "you" : (d.deciders.get(s.teacher_user) ?? "a teacher")) : null;
                  return (
                    <tr key={s.id}>
                      <td>{student}</td>
                      <td title={classes.map((c) => c.name).join(", ") || undefined}>{classLabel || "—"}</td>
                      <td>
                        {[goal?.name, level?.name].filter(Boolean).join(" · ") || "Gyan Path"}
                        {s.note && s.status !== "requested" ? <div className="text-xs text-muted">Note: {s.note}</div> : null}
                      </td>
                      <td>{teacherLabel || "—"}</td>
                      <td>
                        <StatusCell status={s.status} />
                        {decider && s.decided_at ? (
                          <div className="text-xs text-muted">
                            by {decider} · {formatDateTime(s.decided_at, tz)}
                          </div>
                        ) : null}
                      </td>
                      <td className="row-actions">
                        {s.status === "requested" ? (
                          <ActionForm
                            action={decideSignoff.bind(null, s.id)}
                            submitLabel="Sign off"
                            hideSubmit
                            className="flex flex-wrap items-center justify-end gap-1.5"
                            buttonsClassName="justify-end gap-1.5"
                            extraButtons={
                              <>
                                <button type="submit" name="decision" value="needs_work" data-variant="bad" className={buttonClass("bad", "xs")}>
                                  Needs practice
                                </button>
                                <button type="submit" name="decision" value="approved" data-variant="ok" className={buttonClass("ok", "xs")}>
                                  Sign off
                                </button>
                              </>
                            }
                          >
                            <input type="hidden" name="student" value={student} />
                            <NoteToggle student={student} />
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

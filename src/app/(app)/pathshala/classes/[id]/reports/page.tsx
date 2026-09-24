import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { HistoryButton } from "@/components/record-history";
import { buttonClass, Card, EmptyState } from "@/components/ui";
import { loadLevels } from "@/lib/data/pathshala";
import { reportAttendance } from "@/lib/logic/attendance";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDateTime } from "@/lib/pathshala/format";
import { load, row, rows, viewerOf } from "@/lib/pathshala/server";
import { getSession } from "@/lib/session";

import { saveProgressReport } from "../../../actions";
import { LoadProblemPage, PathshalaHeader, PBadge, PField, PNoAccessPage } from "../../../ui";

export const metadata: Metadata = { title: "Progress reports" };

/**
 * Progress reports for one class (pathshala_progress_reports): the teacher writes
 * a comment and a recommended next level per student; attendance comes from the
 * class register. Families see a report in the member app once it is published.
 */
export default async function ProgressReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.takeAttendance(v, id) && !pathshalaAreas.admin(v)) return <PNoAccessPage area="progress reports for this class" />;
  const canWrite = pathshalaAreas.takeAttendance(v, id);
  const supabase = v.db;
  const tz = v.center.time_zone;

  const res = await load(async () => {
    const cls = row(await supabase.from("pathshala_classes").select("id, name, term_id, level_id").eq("id", id).maybeSingle(), "the class");
    if (!cls) return null;
    const [term, enrollments, sessions, levels] = await Promise.all([
      supabase.from("pathshala_terms").select("id, name").eq("id", cls.term_id).maybeSingle(),
      supabase.from("pathshala_enrollments").select("id, student_person_id, status").eq("class_id", id).in("status", ["placed", "active", "completed"]),
      supabase.from("pathshala_sessions").select("id").eq("class_id", id),
      loadLevels(supabase, v.center.id),
    ]);
    const enr = rows(enrollments, "the class roster");
    const sess = rows(sessions, "the class days");
    const ids = enr.map((e) => e.id);
    const [people, marks, reports] = await Promise.all([
      enr.length ? supabase.from("people").select("id, first_name, last_name, preferred_name").in("id", enr.map((e) => e.student_person_id)) : Promise.resolve({ data: [], error: null }),
      ids.length && sess.length
        ? supabase.from("pathshala_attendance").select("enrollment_id, status").in("enrollment_id", ids).in("session_id", sess.map((s) => s.id))
        : Promise.resolve({ data: [], error: null }),
      ids.length ? supabase.from("pathshala_progress_reports").select("*").in("enrollment_id", ids) : Promise.resolve({ data: [], error: null }),
    ]);
    return { cls, term: row(term, "the term"), enr, levels, people: rows(people, "student names"), marks: rows(marks, "attendance"), reports: rows(reports, "progress reports") };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  if (!res.data) notFound();
  const { cls, term, enr, levels, people, marks, reports } = res.data;
  const periods = [...new Set(reports.map((r) => r.period))];
  const period = typeof sp.period === "string" && sp.period.trim() ? sp.period.trim() : (periods[0] ?? term?.name ?? "This term");

  const students = enr
    .map((e) => {
      const p = people.find((x) => x.id === e.student_person_id);
      return { e, name: p ? `${p.preferred_name || p.first_name} ${p.last_name}` : "Student (name hidden)" };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PathshalaHeader
        title={`Progress reports · ${cls.name}`}
        description={`${period} · attendance comes from the class register; families see a report once it is published`}
        back={{ href: `/pathshala/classes/${cls.id}`, label: cls.name }}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <PField label="Report period" hint="For example Fall 2026 or Mid-term">
          <input name="period" defaultValue={period} className="crm-input" list="report-periods" />
          <datalist id="report-periods">
            {[...new Set([...(term ? [term.name] : []), ...periods])].map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </PField>
        <button type="submit" className={buttonClass("ghost", "sm")}>
          Show
        </button>
      </form>
      {students.length === 0 ? (
        <Card>
          <EmptyState title="No students are placed in this class yet" />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {students.map(({ e, name }) => {
            const rep = reports.find((r) => r.enrollment_id === e.id && r.period === period);
            const live = reportAttendance(marks.filter((m) => m.enrollment_id === e.id).map((m) => m.status));
            return (
              <Card key={e.id} title={name}>
                <p className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  {rep?.published_at ? (
                    <PBadge tone="success">Published {formatDateTime(rep.published_at, tz)}</PBadge>
                  ) : rep ? (
                    <PBadge tone="warning">Draft · not visible to the family</PBadge>
                  ) : (
                    <PBadge tone="muted">Not written yet</PBadge>
                  )}
                  <span className="text-muted">
                    Attendance so far: {live.present + live.late} of {live.total} class days{live.late ? ` (${live.late} late)` : ""}
                  </span>
                  {rep ? <HistoryButton table="pathshala_progress_reports" recordId={rep.id} title={`Progress report · ${name}`} size="xs" /> : null}
                </p>
                {canWrite ? (
                  <ActionForm
                    action={saveProgressReport.bind(null, cls.id, e.id)}
                    submitLabel="Save draft"
                    hideSubmit
                    resetOnSuccess={false}
                    buttonsClassName="mt-3"
                    extraButtons={
                      <>
                        <button type="submit" name="publish" value="no" data-variant="ghost" className={buttonClass("ghost", "sm")}>
                          Save draft
                        </button>
                        <button type="submit" name="publish" value="yes" data-variant="primary" className={buttonClass("primary", "sm")}>
                          {rep?.published_at ? "Update and keep published" : "Publish to family"}
                        </button>
                      </>
                    }
                  >
                    <input type="hidden" name="period" value={period} />
                    <div className="space-y-3">
                      <PField label="Teacher's comments">
                        <textarea name="teacher_comments" rows={3} defaultValue={rep?.teacher_comments ?? ""} className="crm-input" />
                      </PField>
                      <PField label="Recommended next level">
                        <select name="recommended_next_level_id" defaultValue={rep?.recommended_next_level_id ?? ""} className="crm-input">
                          <option value="">No recommendation yet</option>
                          {levels.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.track_name ? `${l.track_name} · ${l.name}` : l.name}
                            </option>
                          ))}
                        </select>
                      </PField>
                    </div>
                  </ActionForm>
                ) : rep?.teacher_comments ? (
                  <p className="text-sm">{rep.teacher_comments}</p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

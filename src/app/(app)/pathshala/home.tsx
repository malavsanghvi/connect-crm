import Link from "next/link";

import { Card, Stat, Tag, buttonClass } from "@/components/ui";
import { loadClassesOverview, loadTerms, pickTerm } from "@/lib/data/pathshala";
import { todayIso } from "@/lib/pathshala/format";
import { load } from "@/lib/pathshala/server";
import { pathshalaHomeTask, percent, type TermStats } from "@/lib/pathshala/stats";
import { can } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

// Pathshala on Home (prototype L505 task + L525 KPI), for holders of
// pathshala.manage. One read serves both; a failed read is said plainly.

export type PathshalaHome = { ok: true; termName: string; stats: TermStats } | { ok: false; error: string } | null;

export async function loadPathshalaHome(session: CrmSession): Promise<PathshalaHome> {
  if (!can(session, "pathshala.manage")) return null;
  const res = await load(async () => {
    const term = pickTerm(await loadTerms(session.db, session.center.id));
    if (!term) return null;
    const overview = await loadClassesOverview(session, term, todayIso(session.center.time_zone));
    return { termName: term.name, stats: overview.stats };
  });
  if (!res.ok) return { ok: false, error: res.error };
  return res.data ? { ok: true, ...res.data } : null;
}

/** Home KPI: "Pathshala students 420 · 88% attendance". */
export function PathshalaHomeKpi({ data }: { data: PathshalaHome }) {
  if (!data) return null;
  if (!data.ok) {
    return (
      <Stat
        label="Pathshala students"
        value={<span className="text-xl text-danger">Could not load</span>}
        hint={<span className="text-danger">{data.error} Reload to try again.</span>}
        tone="danger"
      />
    );
  }
  return (
    <Stat
      label="Pathshala students"
      value={data.stats.students.toLocaleString()}
      hint={`${percent(data.stats.attendanceRate)} attendance`}
      tone="purple"
      href="/pathshala"
    />
  );
}

/** Home task row: "17 Gyan Path sign-offs waiting on teachers · 3 background checks expire this month". */
export function PathshalaHomeTask({ data }: { data: PathshalaHome }) {
  if (!data) return null;
  const task = data.ok ? pathshalaHomeTask(data.stats) : null;
  if (data.ok && !task) return null;
  return (
    <Card title="My tasks" description="Pathshala" className="mt-4">
      <div className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line-soft bg-ground px-3.5 py-3">
        <Tag color="purple">Pathshala</Tag>
        <div className="min-w-0 flex-1">
          {data.ok && task ? (
            <>
              <p className="text-[14px] font-bold text-ink">{task.title}</p>
              {task.meta ? <p className="text-[12px] text-muted">{task.meta}</p> : null}
            </>
          ) : (
            <p role="alert" className="text-[13px] text-danger">
              {data.ok ? null : `${data.error} Reload to try again.`}
            </p>
          )}
        </div>
        <Link href="/pathshala" className={buttonClass("ghost", "xs")}>
          Open
        </Link>
      </div>
    </Card>
  );
}

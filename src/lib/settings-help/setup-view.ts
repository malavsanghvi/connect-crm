// "What is left before we can go live?" as plain facts (Settings and Setup, B90 phase 4). Takes the rows the Setup screens already
// read (app.setup_checklist, app.readiness) and says what is missing and where to fix it. Pure: no server imports.

import { NAV } from "@/lib/permissions";
import { checklistProgress, mergeReadiness, routeAvailable, SETUP_STAGES, stepStatusLabel, type ReadinessResult } from "@/lib/setup";

export type ChecklistRowIn = {
  step_key: string;
  stage: number;
  sort: number;
  title: string;
  description: string | null;
  status: string;
  required: boolean;
  route: string | null;
  detail: string | null;
  owner_name: string | null;
  owner_role: string | null;
  due_on: string | null;
};

export type FixAt = { label: string; href: string };

/** "Settings › Roles & entitlements" for a screen's path; null for a path this version has no screen for. */
export function whereLabel(path: string | null | undefined): FixAt | null {
  if (!path) return null;
  const clean = path.split("#")[0];
  for (const m of NAV) {
    const tab = m.tabs.find((t) => t.href === clean);
    if (tab) return { label: m.label === tab.label ? tab.label : `${m.label} › ${tab.label}`, href: clean };
  }
  // Screens that are not tabs (sub pages) the checklist links to.
  const SUB: Record<string, string> = {
    "/giving/bank": "Giving › Bank",
    "/giving/campaigns": "Giving › Campaigns",
  };
  return SUB[clean] ? { label: SUB[clean], href: clean } : null;
}

export type StepLeft = {
  stage: string;
  step: string;
  status: string;
  owner: string | null;
  due: string | null;
  overdue: boolean;
  required: boolean;
  /** What the checklist says about it now ("Texting registration submitted 3 days ago"). */
  note: string | null;
  fix_at: FixAt | null;
};

export type CheckLeft = { check: string; what_is_missing: string; owner: string; fix_at: FixAt | null };

export type SetupView = {
  summary: string;
  steps: { done: number; total: number; percent_done: number; waiting_on_a_provider: number; waiting_for_weaver_review: number; overdue: number };
  left: StepLeft[];
  /** Steps left beyond the ones listed. */
  more_steps: number;
  go_live_checks: { passing: number; failing: number; not_built_yet: number; total: number; failing_list: CheckLeft[] };
};

const MAX_STEPS = 25;

/** Required steps first, then by stage and the checklist's own order. */
function byImportance(a: ChecklistRowIn, b: ChecklistRowIn): number {
  return Number(b.required) - Number(a.required) || a.stage - b.stage || a.sort - b.sort;
}

export function buildSetupView(rows: readonly ChecklistRowIn[], readiness: readonly ReadinessResult[], today: string): SetupView {
  const all = checklistProgress(rows);
  const open = rows.filter((r) => r.status !== "done" && r.status !== "skipped");
  const overdue = open.filter((r) => r.due_on && r.due_on < today).length;
  const stageTitle = (n: number) => SETUP_STAGES.find((s) => s.stage === n)?.title ?? `Stage ${n}`;

  const left: StepLeft[] = [...open].sort(byImportance).slice(0, MAX_STEPS).map((r) => ({
    stage: `${r.stage} · ${stageTitle(r.stage)}`,
    step: r.title,
    status: stepStatusLabel(r.status),
    owner: r.owner_name ?? r.owner_role,
    due: r.due_on,
    overdue: Boolean(r.due_on && r.due_on < today),
    required: r.required,
    note: r.detail || null,
    // A route this version has no screen for yet is not offered as a link.
    fix_at: routeAvailable(r.route) ? whereLabel(r.route) : null,
  }));

  const merged = mergeReadiness(readiness);
  const failing = merged.filter((r) => r.state === "fail");
  const passing = merged.filter((r) => r.state === "pass").length;
  const notBuilt = merged.filter((r) => r.state === "not_built").length;

  const parts: string[] = [];
  parts.push(
    all.total === 0
      ? "The setup checklist has no steps yet."
      : open.length === 0
        ? `All ${all.total} setup steps are done.`
        : `${all.done} of ${all.total} setup steps are done (${all.pct}%); ${open.length} left${overdue > 0 ? `, ${overdue} past their due date` : ""}.`,
  );
  parts.push(
    failing.length === 0
      ? `${passing} of ${merged.length} go-live checks pass${notBuilt > 0 ? `; ${notBuilt} are not built yet and Weaver confirms them by hand` : ""}.`
      : `${failing.length} go-live ${failing.length === 1 ? "check does" : "checks do"} not pass yet.`,
  );

  return {
    summary: parts.join(" "),
    steps: {
      done: all.done,
      total: all.total,
      percent_done: all.pct,
      waiting_on_a_provider: rows.filter((r) => r.status === "waiting_on_provider").length,
      waiting_for_weaver_review: rows.filter((r) => r.status === "needs_review").length,
      overdue,
    },
    left,
    more_steps: Math.max(0, open.length - left.length),
    go_live_checks: {
      passing,
      failing: failing.length,
      not_built_yet: notBuilt,
      total: merged.length,
      failing_list: failing.map((r) => ({ check: r.title, what_is_missing: r.detail, owner: r.owner, fix_at: whereLabel(r.href ?? null) })),
    },
  };
}

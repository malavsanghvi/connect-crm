// Routines: the counters that come straight from the Home task list, so a routine adds no queries for them.
// Pure: it reads the tasks and failures Home already loaded (src/lib/data/home-tasks.ts loadHomeTasks).

import type { HomeTask, TaskFailure, TaskSourceKey } from "@/lib/tasks";

import type { CounterKey } from "./recipes";

/** Which Home task sources make up each task-based counter. */
export const TASK_COUNTERS: Partial<Record<CounterKey, readonly TaskSourceKey[]>> = {
  giving_approvals: ["refund", "writeoff", "payee"],
  voting_overrides: ["override"],
  credits: ["credit"],
  deposits: ["deposits"],
  quickbooks_problems: ["quickbooks"],
  role_requests: ["roles"],
  privacy_requests: ["privacy"],
  volunteer_waivers: ["waivers"],
};

export type TaskCounters = {
  counts: Partial<Record<CounterKey, number>>;
  failed: Partial<Record<CounterKey, string>>;
};

/**
 * `visible` is the list of task sources this person can act on (visibleTaskSources): a counter none of whose sources is visible
 * is left out, so the step reads "by hand" instead of claiming "nothing is waiting". A counter whose sources failed to load is
 * never reported as zero: it carries the reason instead (unless some of the sources did load a task, which still proves work is left).
 */
export function counterFromTasks(
  tasks: readonly Pick<HomeTask, "source">[],
  failures: readonly Pick<TaskFailure, "source" | "message">[],
  visible: readonly TaskSourceKey[],
): TaskCounters {
  const counts: TaskCounters["counts"] = {};
  const failed: TaskCounters["failed"] = {};
  for (const [counter, sources] of Object.entries(TASK_COUNTERS) as [CounterKey, readonly TaskSourceKey[]][]) {
    const mine = sources.filter((s) => visible.includes(s));
    if (mine.length === 0) continue;
    const n = tasks.filter((t) => mine.includes(t.source)).length;
    const broken = failures.find((f) => mine.includes(f.source));
    if (n === 0 && broken) failed[counter] = broken.message;
    else counts[counter] = n;
  }
  return { counts, failed };
}

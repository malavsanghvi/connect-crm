// One numbered import run of the guided onboarding's Create step, written so it can be stopped and carried on
// (pure: every call to the server comes in through `deps`, so the branches are tested with a fake import engine).
//
// A run has three outcomes: it finishes ("done"), or it stops for the owner ("stopped"): with rows that need a
// decision (a look-alike of a record that is already there: a name alone never merges two records) or with rows that
// have problems. Every change of state is handed to `record`, which the wizard saves, so a closed page or a second
// press of Create picks up exactly where it was:
//   * a finished run is skipped;
//   * a run that was stopped is looked at again: decisions owed -> still stopped; all made -> carry on importing it;
//   * a run that was started but never reached its preview is cancelled and started afresh (every ID in the files is
//     stable, so the fresh run matches what the old one might have made and adds nothing twice);
//   * a run someone finished from the import tool's own page is taken as done.

import { autoMap, type Mapping } from "@/lib/import/mapping";
import type { TableFile } from "./donations";
import { ROW_CHUNK, chunkRows, type RunKey, type RunRecord } from "./progress";

type Res<T> = { ok: true; data?: T } | { ok: false; error: string };

export type PreviewCounts = { create: number; update: number; skip: number; needs_decision: number; error: number; total: number };
export type RunStatusView = { status: string; preview: PreviewCounts | null; undecided: number };
export type CommitView = { remaining: number; counts: { created: number; updated: number; failed: number } };

export type RunDeps = {
  start: (i: { entity: string; fileName: string; fingerprint: string; fileSize: number }) => Promise<Res<{ runId: string; runNumber: number }>>;
  defineFields: (i: { runId: string; entity: string; mapping: Mapping }) => Promise<Res<Mapping>>;
  stage: (i: { runId: string; entity: string; headers: string[]; mapping: Mapping; rows: { rowNo: number; cells: string[] }[]; first: boolean }) => Promise<Res<unknown>>;
  preview: (runId: string) => Promise<Res<PreviewCounts>>;
  commit: (runId: string) => Promise<Res<CommitView>>;
  cancel: (runId: string) => Promise<Res<unknown>>;
  status: (runId: string) => Promise<Res<RunStatusView>>;
  fingerprint: (text: string) => Promise<string>;
  /** Progress words for the screen ("Households: checked 500 of 1,200"). */
  line: (prefix: string, text: string) => void;
  /** A run changed state: save it. */
  record: (key: RunKey, rec: RunRecord) => void;
  /** Something could not be done that a person may want to know, but that does not stop the run. */
  warn: (text: string) => void;
};

export const RUN_LABEL: Record<RunKey, string> = { households: "Households", people: "People", payments: "Donations" };

const n = (x: number) => x.toLocaleString("en-US");
const needs = (k: number) => `${n(k)} ${k === 1 ? "row needs" : "rows need"} your decision`;

function must<T>(res: Res<T>, what: string): T {
  if (!res.ok) throw new Error(res.error);
  if (res.data === undefined) throw new Error(`could not ${what}`);
  return res.data;
}

/** Import what is staged and previewed, batch by batch, until nothing remains. */
async function commitRun(deps: RunDeps, key: RunKey, rec: RunRecord): Promise<RunRecord> {
  const label = RUN_LABEL[key];
  let counts = { created: rec.created, updated: rec.updated, failed: rec.failed };
  for (let guard = 0; guard < 2000; guard++) {
    const step = must(await deps.commit(rec.runId), `import the ${label.toLowerCase()}`);
    counts = { created: step.counts.created, updated: step.counts.updated, failed: step.counts.failed };
    deps.line(`${label}: saved`, `${label}: saved ${n(counts.created + counts.updated)}`);
    if (step.remaining === 0) break;
  }
  const done: RunRecord = { runId: rec.runId, runNumber: rec.runNumber, state: "done", ...counts };
  deps.record(key, done);
  return done;
}

function stopRun(deps: RunDeps, key: RunKey, rec: RunRecord, kind: "decision" | "errors", text: string): RunRecord {
  const stopped: RunRecord = { ...rec, state: "stopped", stopKind: kind, stoppedFor: text };
  deps.record(key, stopped);
  return stopped;
}

/**
 * Bring one run to "done", or to "stopped" for the owner. `prior` is what an earlier attempt recorded for this run;
 * `table` builds the file only when a fresh run is needed.
 */
export async function runOne(deps: RunDeps, key: RunKey, entity: string, prior: RunRecord | undefined, table: () => TableFile): Promise<RunRecord> {
  const label = RUN_LABEL[key];
  if (prior?.state === "done") return prior;

  if (prior) {
    const s = must(await deps.status(prior.runId), `check import #${prior.runNumber}`);
    if (s.status === "committed" || s.status === "reconciled") {
      const done: RunRecord = { runId: prior.runId, runNumber: prior.runNumber, state: "done", created: prior.created, updated: prior.updated, failed: prior.failed };
      deps.record(key, done);
      return done;
    }
    if (s.status === "previewed" || s.status === "committing") {
      if (s.undecided > 0) return stopRun(deps, key, prior, "decision", needs(s.undecided));
      if (s.preview && s.preview.error > 0) return stopRun(deps, key, prior, "errors", `${n(s.preview.error)} rows have problems`);
      return commitRun(deps, key, prior);
    }
    // Never reached its preview (or was cancelled or undone): a fresh run of the same file carries on.
    if (s.status === "pending" || s.status === "staged") {
      const c = await deps.cancel(prior.runId);
      if (!c.ok) deps.warn(`Import #${prior.runNumber} was left unfinished and could not be cancelled: ${c.error}`);
    }
  }

  const t = table();
  deps.line(`${label}:`, `${label}: starting`);
  const body = JSON.stringify(t);
  const started = must(await deps.start({ entity, fileName: `onboarding-${entity}.csv`, fingerprint: await deps.fingerprint(body), fileSize: body.length }), "start the import");
  const rec: RunRecord = { runId: started.runId, runNumber: started.runNumber, state: "started", created: 0, updated: 0, failed: 0 };
  deps.record(key, rec);

  const mapping0 = autoMap(entity, t.headers, t.rows.slice(0, 200), null, { dateOrder: "mdy", crmSystem: "onboarding" });
  const mapping = must(await deps.defineFields({ runId: rec.runId, entity, mapping: mapping0 }), "keep the extra columns");
  const numbered = t.rows.map((cells, k) => ({ rowNo: k + 1, cells }));
  for (const [part, rows] of chunkRows(numbered, ROW_CHUNK).entries()) {
    must(await deps.stage({ runId: rec.runId, entity, headers: t.headers, mapping, rows, first: part === 0 }), "check the rows");
    deps.line(`${label}: checked`, `${label}: checked ${n(Math.min((part + 1) * ROW_CHUNK, t.rows.length))} of ${n(t.rows.length)}`);
  }
  const prev = must(await deps.preview(rec.runId), "preview the import");
  if (prev.needs_decision > 0) return stopRun(deps, key, rec, "decision", needs(prev.needs_decision));
  if (prev.error > 0) return stopRun(deps, key, { ...rec, failed: prev.error }, "errors", `${n(prev.error)} rows have problems`);
  return commitRun(deps, key, rec);
}

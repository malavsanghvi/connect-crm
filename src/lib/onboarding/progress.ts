// Guided onboarding: what is saved between visits, and the small pure rules around saving it (no I/O).
//
// The draft (app.onboarding_progress) holds where the wizard stands and facts that carry no personal values: the
// file name, the column choices, the row counts, the owner's merge / keep-separate answers and the numbered imports
// Create has made. The uploaded rows themselves (after validation) and the final household plan live in
// app.onboarding_rows, chunk by chunk. Everything here validates what comes back from the database before the
// wizard trusts it.

import type { ParsedDonation } from "./donations";
import type { ExistingRef, Group, Question } from "./match";
import type { ParsedPerson } from "./people";

export type Stage = "welcome" | "donations" | "members" | "family" | "review" | "confirm" | "done";
export const STAGES: readonly Stage[] = ["welcome", "donations", "members", "family", "review", "confirm", "done"];
export const STAGE_LABEL: Record<Stage, string> = {
  welcome: "Welcome",
  donations: "Past donations",
  members: "Members",
  family: "Rest of the family",
  review: "Households",
  confirm: "Create",
  done: "Done",
};

export type Dataset = "donations" | "members" | "family";
export const DATASETS: readonly Dataset[] = ["donations", "members", "family"];
/** The lists the database stores: the three uploads, and the final household plan once Create starts. */
export type StoredList = Dataset | "plan";
export const DATASET_LABEL: Record<Dataset, string> = { donations: "Past donations", members: "Members", family: "Rest of the family" };

/** Rows per call, as in the import tool (the database takes at most 300). */
export const ROW_CHUNK = 250;

export type DatasetMeta = {
  /** mapping: a file was chosen but its rows were not finished (not saved); loaded: checked rows are saved; skipped. */
  status: "mapping" | "loaded" | "skipped";
  fileName?: string;
  /** Data rows in the file (without the header). */
  fileRows?: number;
  /** The file's column names and what each was chosen to be: reused when the same file is uploaded again. */
  headers?: string[];
  choices?: string[];
  dateOrder?: "mdy" | "dmy";
  defaultMethod?: string;
  /** Checked rows saved, and rows left out because of errors. */
  rows?: number;
  badRows?: number;
  savedAt?: string;
};

export type ProgressState = {
  v?: number;
  datasets?: Partial<Record<Dataset, DatasetMeta>>;
  /** The question the owner was on. */
  qi?: number;
  /** false: the owner chose to go on without comparing with the households already in the records. */
  compareExisting?: boolean;
};

export type Decision = "merge" | "separate";

export type RunKey = "households" | "people" | "payments";
export type RunRecord = {
  runId: string;
  runNumber: number;
  /** started: begun, not finished; stopped: waiting for the owner (decisions) or for problems to be fixed; done. */
  state: "started" | "stopped" | "done";
  created: number;
  updated: number;
  failed: number;
  stopKind?: "decision" | "errors";
  stoppedFor?: string;
};
export type Outcomes = Partial<Record<RunKey, RunRecord>>;

export type ProgressView = {
  id: string;
  stage: Stage;
  version: number;
  state: ProgressState;
  /** Saved merge / keep-separate answers, by question key. */
  answers: Record<string, Decision>;
  outcomes: Outcomes;
  createdByName: string;
  updatedByName: string;
  createdAt: string;
  updatedAt: string;
  /** Rows stored in the database per list (what a resume must read back). */
  stored: Record<StoredList, number>;
  /** What the signed-in person may read back (a list they may not see comes back empty, which is not "no rows"). */
  can: Record<StoredList, boolean>;
};

export type LastFinished = { finishedAt: string | null; finishedBy: string; outcomes: Outcomes };
export type ProgressPayload = { draft: ProgressView | null; last: LastFinished | null };

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, d = ""): string => (typeof x === "string" ? x : d);
const num = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);

function parseOutcomes(x: unknown): Outcomes {
  const out: Outcomes = {};
  if (!isObject(x)) return out;
  for (const k of ["households", "people", "payments"] as const) {
    const r = x[k];
    if (!isObject(r) || typeof r.runId !== "string") continue;
    const state = r.state === "done" || r.state === "stopped" ? r.state : "started";
    out[k] = {
      runId: r.runId,
      runNumber: num(r.runNumber),
      state,
      created: num(r.created),
      updated: num(r.updated),
      failed: num(r.failed),
      ...(r.stopKind === "decision" || r.stopKind === "errors" ? { stopKind: r.stopKind } : {}),
      ...(typeof r.stoppedFor === "string" ? { stoppedFor: r.stoppedFor } : {}),
    };
  }
  return out;
}

function parseDraft(x: unknown): ProgressView | null {
  if (!isObject(x) || typeof x.id !== "string") return null;
  const stage = STAGES.includes(x.stage as Stage) ? (x.stage as Stage) : "donations";
  const answers: Record<string, Decision> = {};
  if (isObject(x.merge_answers)) for (const [k, v] of Object.entries(x.merge_answers)) if (v === "merge" || v === "separate") answers[k] = v;
  const stored = isObject(x.stored) ? x.stored : {};
  const can = isObject(x.can) ? x.can : {};
  const lists: StoredList[] = ["donations", "members", "family", "plan"];
  return {
    id: x.id,
    stage,
    version: num(x.version, 1),
    state: isObject(x.state) ? (x.state as ProgressState) : {},
    answers,
    outcomes: parseOutcomes(x.outcomes),
    createdByName: str(x.created_by_name, "Someone on your team"),
    updatedByName: str(x.updated_by_name, "Someone on your team"),
    createdAt: str(x.created_at),
    updatedAt: str(x.updated_at),
    stored: Object.fromEntries(lists.map((l) => [l, num(stored[l])])) as Record<StoredList, number>,
    can: Object.fromEntries(lists.map((l) => [l, can[l] === true])) as Record<StoredList, boolean>,
  };
}

/** What app.onboarding_current / onboarding_start return, checked. Null when it is not that shape. */
export function parseProgressPayload(json: unknown): ProgressPayload | null {
  if (!isObject(json)) return null;
  const draft = json.draft === null || json.draft === undefined ? null : parseDraft(json.draft);
  if (json.draft !== null && json.draft !== undefined && !draft) return null;
  const l = json.last;
  const last: LastFinished | null = isObject(l) ? { finishedAt: typeof l.finished_at === "string" ? l.finished_at : null, finishedBy: str(l.finished_by, "Someone on your team"), outcomes: parseOutcomes(l.outcomes) } : null;
  return { draft, last };
}

// ── Saved rows: check them before trusting them ─────────────────────────────────

export function isParsedDonation(x: unknown): x is ParsedDonation {
  return (
    isObject(x) &&
    typeof x.rowNo === "number" &&
    typeof x.name === "string" &&
    typeof x.amountCents === "number" &&
    Number.isInteger(x.amountCents) &&
    typeof x.receivedOn === "string" &&
    typeof x.method === "string" &&
    isObject(x.extras)
  );
}

export function isParsedPerson(x: unknown): x is ParsedPerson {
  return isObject(x) && typeof x.rowNo === "number" && typeof x.firstName === "string" && typeof x.lastName === "string" && isObject(x.extras);
}

const isExistingRef = (x: unknown): x is ExistingRef => isObject(x) && typeof x.householdId === "string" && typeof x.number === "string" && typeof x.label === "string";

/** A group of the final household plan. */
export function isStoredGroup(x: unknown): x is Group {
  return (
    isObject(x) &&
    typeof x.id === "number" &&
    Array.isArray(x.rows) &&
    x.rows.every((n) => typeof n === "number") &&
    typeof x.displayName === "string" &&
    Array.isArray(x.names) &&
    x.names.every((n) => typeof n === "string") &&
    (x.existing === null || isExistingRef(x.existing)) &&
    Array.isArray(x.alsoMatches) &&
    x.alsoMatches.every(isExistingRef)
  );
}

/** Split rows into the batches sent to the database. */
export function chunkRows<T>(rows: readonly T[], size = ROW_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

// ── Answers ────────────────────────────────────────────────────────────────────

/** Saved answers (by question key) for the questions this review has: question id -> answer. */
export function answersForQuestions(questions: readonly Question[], saved: Readonly<Record<string, Decision>>): Record<number, Decision> {
  const out: Record<number, Decision> = {};
  for (const q of questions) {
    const a = saved[q.key];
    if (a) out[q.id] = a;
  }
  return out;
}

/** The first question without an answer (or the number of questions when all are answered). */
export function firstUnanswered(questions: readonly Question[], answers: Readonly<Record<number, Decision>>): number {
  const i = questions.findIndex((q) => !answers[q.id]);
  return i < 0 ? questions.length : i;
}

// ── Saving ─────────────────────────────────────────────────────────────────────

/** What one save sends: the pieces that changed. The server merges `state`, `answers` and `outcomes` by key. */
export type SavePatch = {
  stage?: Stage;
  state?: ProgressState;
  /** question key -> answer; null takes an answer back. */
  answers?: Record<string, Decision | null>;
  outcomes?: Outcomes;
};

export function isEmptyPatch(p: SavePatch | null): boolean {
  return !p || (p.stage === undefined && !p.state && !p.answers && !p.outcomes);
}

/** Two patches in one: later values win. Lets a burst of quick answers go out as a single save. */
export function mergePatches(a: SavePatch | null, b: SavePatch): SavePatch {
  if (!a) return { ...b };
  return {
    ...(b.stage !== undefined ? { stage: b.stage } : a.stage !== undefined ? { stage: a.stage } : {}),
    ...(a.state || b.state ? { state: { ...a.state, ...b.state } } : {}),
    ...(a.answers || b.answers ? { answers: { ...a.answers, ...b.answers } } : {}),
    ...(a.outcomes || b.outcomes ? { outcomes: { ...a.outcomes, ...b.outcomes } } : {}),
  };
}

// ── Words for the "Continue where you left off" card ───────────────────────────────

const n = (x: number) => x.toLocaleString("en-US");

/** One plain line per list, without any personal value. */
export function describeDatasets(v: Pick<ProgressView, "state" | "stored" | "can">): { dataset: Dataset; text: string }[] {
  return DATASETS.map((d) => {
    const meta = v.state.datasets?.[d];
    const stored = v.stored[d] ?? 0;
    let text: string;
    if (stored > 0) {
      text = `${n(stored)} checked row${stored === 1 ? "" : "s"} saved${meta?.fileName ? ` from ${meta.fileName}` : ""}${v.can[d] ? "" : " (you do not have access to read them back)"}`;
    } else if (meta?.status === "skipped") text = "skipped";
    else if (meta?.status === "mapping") text = `${meta.fileName ?? "a file"} was chosen but not finished: upload it again to continue`;
    else text = "not started";
    return { dataset: d, text };
  });
}

/** The step a person is taken back to. */
export function resumeStage(v: Pick<ProgressView, "stage">): Stage {
  return v.stage === "welcome" ? "donations" : v.stage;
}

/** True when Create has started, so going back could disagree with what was already made. */
export function createStarted(outcomes: Outcomes): boolean {
  return Object.keys(outcomes).length > 0;
}

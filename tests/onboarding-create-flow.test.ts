import { describe, expect, it } from "vitest";

import { runOne, type PreviewCounts, type RunDeps } from "@/lib/onboarding/create-flow";
import type { RunKey, RunRecord } from "@/lib/onboarding/progress";

type FakeRun = { id: string; number: number; status: string; rows: number; staged: number; preview: PreviewCounts | null; undecided: number; left: number };

/**
 * A stand-in for the import engine with the states the real one moves through
 * (pending -> staged -> previewed -> committing -> committed, or cancelled), and every call recorded.
 */
function fake(opts: { preview?: Partial<PreviewCounts>; failAt?: "stage" | "commit" | "start"; cancelFails?: boolean } = {}) {
  const runs = new Map<string, FakeRun>();
  const calls: string[] = [];
  const records: { key: RunKey; rec: RunRecord }[] = [];
  const lines: string[] = [];
  const warnings: string[] = [];
  let seq = 0;
  const deps: RunDeps = {
    start: async () => {
      calls.push("start");
      if (opts.failAt === "start") return { ok: false, error: "Could not start the import — you don't have permission." };
      seq += 1;
      const r: FakeRun = { id: `run-${seq}`, number: 10 + seq, status: "pending", rows: 0, staged: 0, preview: null, undecided: 0, left: 0 };
      runs.set(r.id, r);
      return { ok: true, data: { runId: r.id, runNumber: r.number } };
    },
    defineFields: async (i) => {
      calls.push("defineFields");
      return { ok: true, data: i.mapping };
    },
    stage: async (i) => {
      calls.push(`stage:${i.rows.length}:${i.first ? "first" : "next"}`);
      if (opts.failAt === "stage") return { ok: false, error: "Could not check the rows — the database could not be reached." };
      const r = runs.get(i.runId)!;
      r.status = "staged";
      r.rows += i.rows.length;
      return { ok: true, data: { staged: i.rows.length } };
    },
    preview: async (id) => {
      calls.push("preview");
      const r = runs.get(id)!;
      const p: PreviewCounts = { create: r.rows, update: 0, skip: 0, needs_decision: 0, error: 0, total: r.rows, ...opts.preview };
      r.preview = p;
      r.undecided = p.needs_decision;
      r.status = "previewed";
      r.left = r.rows;
      return { ok: true, data: p };
    },
    commit: async (id) => {
      calls.push("commit");
      if (opts.failAt === "commit") return { ok: false, error: "Could not import the rows — something went wrong." };
      const r = runs.get(id)!;
      r.status = "committing";
      const take = Math.min(100, r.left);
      r.left -= take;
      r.staged += take;
      if (r.left === 0) r.status = "committed";
      return { ok: true, data: { remaining: r.left, counts: { created: r.rows - r.left, updated: 0, failed: 0 } } };
    },
    cancel: async (id) => {
      calls.push("cancel");
      if (opts.cancelFails) return { ok: false, error: "it is already running" };
      runs.get(id)!.status = "cancelled";
      return { ok: true };
    },
    status: async (id) => {
      calls.push("status");
      const r = runs.get(id);
      if (!r) return { ok: false, error: "That import was not found." };
      return { ok: true, data: { status: r.status, preview: r.preview, undecided: r.undecided } };
    },
    fingerprint: async () => "fp",
    line: (_p, t) => lines.push(t),
    record: (key, rec) => records.push({ key, rec }),
    warn: (t) => warnings.push(t),
  };
  return { runs, calls, records, lines, warnings, deps };
}

const table = (rows = 3) => ({
  headers: ["Household ID (old system)", "Household name"],
  rows: Array.from({ length: rows }, (_, i) => [`ONB-A-H-${String(i + 1).padStart(5, "0")}`, `Family ${i + 1}`]),
});
const last = (f: ReturnType<typeof fake>) => f.records.at(-1)!.rec;

describe("a fresh run", () => {
  it("starts, checks, previews, imports in batches and records every step", async () => {
    const f = fake();
    const rec = await runOne(f.deps, "households", "households", undefined, () => table(250));
    expect(rec).toMatchObject({ state: "done", created: 250, failed: 0, runNumber: 11 });
    expect(f.calls).toEqual(["start", "defineFields", "stage:250:first", "preview", "commit", "commit", "commit"]);
    // What the screen would save: started first, done last.
    expect(f.records.map((r) => r.rec.state)).toEqual(["started", "done"]);
    expect(f.records[0]!.rec).toMatchObject({ runId: "run-1", state: "started" });
    expect(last(f)).toMatchObject({ state: "done", runId: "run-1" });
    expect(f.lines).toContain("Households: starting");
    expect(f.lines).toContain("Households: checked 250 of 250");
    expect(f.lines.at(-1)).toBe("Households: saved 250");
  });

  it("sends the rows in batches of 250, only the first marked as first", async () => {
    const f = fake();
    await runOne(f.deps, "households", "households", undefined, () => table(601));
    expect(f.calls.filter((c) => c.startsWith("stage"))).toEqual(["stage:250:first", "stage:250:next", "stage:101:next"]);
  });

  it("stops for the owner when rows need a decision, and imports nothing", async () => {
    const f = fake({ preview: { needs_decision: 2, create: 1 } });
    const rec = await runOne(f.deps, "households", "households", undefined, () => table());
    expect(rec).toMatchObject({ state: "stopped", stopKind: "decision", stoppedFor: "2 rows need your decision", runId: "run-1" });
    expect(f.calls).not.toContain("commit");
    expect(last(f)).toEqual(rec);
  });

  it("a decision is asked about before problems are (decisions can be made without leaving the wizard)", async () => {
    const f = fake({ preview: { needs_decision: 1, error: 4 } });
    const rec = await runOne(f.deps, "people", "people", undefined, () => table());
    expect(rec.stopKind).toBe("decision");
    expect(rec.stoppedFor).toBe("1 row needs your decision");
  });

  it("stops and says so when rows have problems", async () => {
    const f = fake({ preview: { error: 3 } });
    const rec = await runOne(f.deps, "payments", "payments", undefined, () => table());
    expect(rec).toMatchObject({ state: "stopped", stopKind: "errors", stoppedFor: "3 rows have problems", failed: 3 });
    expect(f.calls).not.toContain("commit");
  });

  it("a failure names what the server said, and the run that was started stays on record so it can be picked up", async () => {
    const f = fake({ failAt: "stage" });
    await expect(runOne(f.deps, "households", "households", undefined, () => table())).rejects.toThrow("Could not check the rows — the database could not be reached.");
    expect(last(f)).toMatchObject({ state: "started", runId: "run-1" });
    const again = fake({ failAt: "start" });
    await expect(runOne(again.deps, "households", "households", undefined, () => table())).rejects.toThrow("you don't have permission");
    expect(again.records).toHaveLength(0);
  });
});

describe("carrying on after a stop, a failure or a closed page", () => {
  const stoppedFor = (f: ReturnType<typeof fake>) => last(f);

  it("a run that is finished is skipped without a single call", async () => {
    const f = fake();
    const done: RunRecord = { runId: "run-9", runNumber: 19, state: "done", created: 5, updated: 1, failed: 0 };
    expect(await runOne(f.deps, "people", "people", done, () => { throw new Error("must not build the file"); })).toBe(done);
    expect(f.calls).toEqual([]);
  });

  it("stays stopped while decisions are owed, and never starts a second run", async () => {
    const f = fake({ preview: { needs_decision: 2 } });
    const first = await runOne(f.deps, "people", "people", undefined, () => table(2));
    f.calls.length = 0;
    const again = await runOne(f.deps, "people", "people", stoppedFor(f), () => { throw new Error("must not build the file"); });
    expect(again).toMatchObject({ state: "stopped", stopKind: "decision", runId: first.runId });
    expect(f.calls).toEqual(["status"]);
  });

  it("imports the SAME run once every decision is made, without staging anything again", async () => {
    const f = fake({ preview: { needs_decision: 2 } });
    const first = await runOne(f.deps, "people", "people", undefined, () => table(2));
    f.runs.get(first.runId)!.undecided = 0; // the owner decided both rows in the wizard
    f.calls.length = 0;
    const done = await runOne(f.deps, "people", "people", stoppedFor(f), () => { throw new Error("must not build the file"); });
    expect(done).toMatchObject({ state: "done", runId: first.runId, runNumber: first.runNumber, created: 2 });
    expect(f.calls).toEqual(["status", "commit"]);
    expect(last(f)).toEqual(done);
  });

  it("a run that stopped for problems stays stopped until they are dealt with", async () => {
    const f = fake({ preview: { error: 2 } });
    const first = await runOne(f.deps, "payments", "payments", undefined, () => table(3));
    const again = await runOne(f.deps, "payments", "payments", stoppedFor(f), () => table());
    expect(again).toMatchObject({ state: "stopped", stopKind: "errors", runId: first.runId });
  });

  it("a run someone imported from the import tool's own page is taken as done (and not imported twice)", async () => {
    const f = fake({ preview: { error: 2 } });
    const first = await runOne(f.deps, "payments", "payments", undefined, () => table(3));
    f.runs.get(first.runId)!.status = "committed";
    f.calls.length = 0;
    const done = await runOne(f.deps, "payments", "payments", stoppedFor(f), () => table());
    expect(done).toMatchObject({ state: "done", runId: first.runId });
    expect(f.calls).toEqual(["status"]);
  });

  it("a run that was half imported when the page closed carries on where it was", async () => {
    const f = fake();
    // The page closed after one batch: the run is 'committing' with rows left.
    const run: FakeRun = { id: "run-1", number: 11, status: "committing", rows: 250, staged: 100, preview: { create: 250, update: 0, skip: 0, needs_decision: 0, error: 0, total: 250 }, undecided: 0, left: 150 };
    f.runs.set(run.id, run);
    const prior: RunRecord = { runId: "run-1", runNumber: 11, state: "started", created: 0, updated: 0, failed: 0 };
    const done = await runOne(f.deps, "households", "households", prior, () => { throw new Error("must not build the file"); });
    expect(done).toMatchObject({ state: "done", runId: "run-1", created: 250 });
    expect(f.calls).toEqual(["status", "commit", "commit"]);
  });

  it("a run that never reached its preview is cancelled and started fresh", async () => {
    const f = fake();
    f.runs.set("run-old", { id: "run-old", number: 5, status: "staged", rows: 10, staged: 10, preview: null, undecided: 0, left: 0 });
    const prior: RunRecord = { runId: "run-old", runNumber: 5, state: "started", created: 0, updated: 0, failed: 0 };
    const rec = await runOne(f.deps, "households", "households", prior, () => table(3));
    expect(f.calls.slice(0, 3)).toEqual(["status", "cancel", "start"]);
    expect(f.runs.get("run-old")!.status).toBe("cancelled");
    expect(rec).toMatchObject({ state: "done", created: 3 });
    expect(rec.runId).not.toBe("run-old");
  });

  it("if the old run cannot be cancelled that is said, and the fresh run goes ahead", async () => {
    const f = fake({ cancelFails: true });
    f.runs.set("run-old", { id: "run-old", number: 5, status: "staged", rows: 10, staged: 10, preview: null, undecided: 0, left: 0 });
    const prior: RunRecord = { runId: "run-old", runNumber: 5, state: "started", created: 0, updated: 0, failed: 0 };
    const rec = await runOne(f.deps, "households", "households", prior, () => table(3));
    expect(f.warnings).toEqual(["Import #5 was left unfinished and could not be cancelled: it is already running"]);
    expect(rec.state).toBe("done");
  });

  it("a run the database no longer knows is reported, not guessed at", async () => {
    const f = fake();
    const prior: RunRecord = { runId: "gone", runNumber: 3, state: "started", created: 0, updated: 0, failed: 0 };
    await expect(runOne(f.deps, "households", "households", prior, () => table())).rejects.toThrow("That import was not found.");
  });

  it("a failure while importing is named, and pressing Create again carries on with the same run", async () => {
    const f = fake({ failAt: "commit" });
    await expect(runOne(f.deps, "households", "households", undefined, () => table(3))).rejects.toThrow("Could not import the rows");
    const run = f.runs.get("run-1")!;
    expect(run.status).toBe("previewed");
    const ok = fake();
    ok.runs.set("run-1", { ...run });
    const done = await runOne(ok.deps, "households", "households", { runId: "run-1", runNumber: 11, state: "started", created: 0, updated: 0, failed: 0 }, () => table(3));
    expect(done).toMatchObject({ state: "done", runId: "run-1" });
    expect(ok.calls.filter((c) => c === "start")).toHaveLength(0);
  });
});

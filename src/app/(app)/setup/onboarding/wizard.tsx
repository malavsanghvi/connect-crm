"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert, Card, KpiGrid, Stat, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { RUN_LABEL, runOne, type RunDeps } from "@/lib/onboarding/create-flow";
import { buildHouseholdFile, buildPaymentFile, householdLegacyId, idPrefixOf, toPayerInputs, type ParsedDonation, type TableFile } from "@/lib/onboarding/donations";
import { existingToInputs, type ExistingHousehold } from "@/lib/onboarding/existing";
import { matchPayers, resolveMerges, type Group, type MatchResult, type Question } from "@/lib/onboarding/match";
import { buildPeopleFile, personToInput, type ParsedPerson } from "@/lib/onboarding/people";
import {
  DATASET_LABEL,
  ROW_CHUNK,
  STAGES,
  STAGE_LABEL,
  answersForQuestions,
  chunkRows,
  createStarted,
  describeDatasets,
  firstUnanswered,
  isParsedDonation,
  isParsedPerson,
  isStoredGroup,
  resumeStage,
  type Dataset,
  type DatasetMeta,
  type Decision,
  type LastFinished,
  type Outcomes,
  type ProgressPayload,
  type ProgressView,
  type RunKey,
  type RunRecord,
  type Stage,
  type StoredList,
} from "@/lib/onboarding/progress";

import { cancelImportAction, commitBatchAction, defineCustomFieldsAction, previewAction, startImportAction, stageRowsAction } from "../../settings/import/actions";
import { closeProgressAction, loadExistingHouseholdsAction, loadRowsAction, runStatusAction, saveRowsAction, startOnboardingAction } from "./actions";
import { DatasetStep, ROW_OFFSET, money, type Result } from "./dataset-step";
import { DecisionPanel } from "./decisions";
import { ReviewStep, type RowLine } from "./review-step";
import { useSaver } from "./use-saver";

const n = (x: number) => x.toLocaleString("en-US");

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const message = (err: unknown, fallback = "something went wrong") => (err instanceof Error && err.message ? err.message : fallback);

/** Read a saved list back, a few batches at a time, and check the count against what was saved. */
async function readList(id: string, list: StoredList, expected: number, label: string, progress: (t: string) => void): Promise<unknown[]> {
  const out: unknown[] = [];
  let from = 0;
  for (let guard = 0; guard < 1000; guard++) {
    progress(`Reading your saved ${label}… ${n(out.length)} of ${n(expected)}`);
    const res = await loadRowsAction({ id, list, from });
    if (!res.ok || !res.data) throw new Error(res.ok ? "the database sent nothing back" : res.error);
    out.push(...res.data.rows);
    if (res.data.next === null) break;
    from = res.data.next;
  }
  if (out.length !== expected) throw new Error(`only ${n(out.length)} of ${n(expected)} saved ${label} could be read back`);
  return out;
}

const buildMatch = (d: readonly ParsedDonation[], m: readonly ParsedPerson[], f: readonly ParsedPerson[], ex: readonly ExistingHousehold[]): MatchResult =>
  matchPayers([...toPayerInputs(d), ...[...m, ...f].map(personToInput), ...existingToInputs(ex)]);

const RUN_ENTITY: Record<RunKey, string> = { households: "households", people: "people", payments: "payments" };

export function OnboardingWizard({
  centerName,
  timeZone,
  initial,
  donationsBlocked,
  canCompareExisting,
}: {
  centerName: string;
  timeZone: string;
  initial: ProgressPayload;
  /** Why past donations cannot be loaded here (module off, missing permission), or null. */
  donationsBlocked: string | null;
  canCompareExisting: boolean;
}) {
  const { status: saveStatus, queue: saver } = useSaver();
  const [gate, setGate] = useState<ProgressView | null>(initial.draft);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("welcome");
  const [metas, setMetas] = useState<Partial<Record<Dataset, DatasetMeta>>>({});
  const [donations, setDonations] = useState<ParsedDonation[]>([]);
  const [members, setMembers] = useState<ParsedPerson[]>([]);
  const [family, setFamily] = useState<ParsedPerson[]>([]);
  const [existing, setExisting] = useState<ExistingHousehold[]>([]);
  const [existingNote, setExistingNote] = useState<string | null>(null);
  const [existingProblem, setExistingProblem] = useState<string | null>(null);
  const [compared, setCompared] = useState(false);
  const [compareOff, setCompareOff] = useState(false);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, Decision>>({});
  const [qi, setQi] = useState(0);
  const [plan, setPlan] = useState<Group[] | null>(null);
  const [outcomes, setOutcomes] = useState<Outcomes>({});
  const [decisionRound, setDecisionRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [confirmingOver, setConfirmingOver] = useState(false);

  // Values the async steps read after a state update would not have landed yet.
  const metasRef = useRef<Partial<Record<Dataset, DatasetMeta>>>({});
  const keyedRef = useRef<Record<string, Decision>>({});
  const outcomesRef = useRef<Outcomes>({});
  const existingRef = useRef<ExistingHousehold[] | null>(null);
  const storedRef = useRef<Record<StoredList, number>>({ donations: 0, members: 0, family: 0, plan: 0 });

  // After a step change the focus would be lost with the button that was pressed: move it to the new step's heading.
  const topRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    const h = topRef.current?.querySelector<HTMLElement>("h2");
    if (h) {
      h.tabIndex = -1;
      h.focus();
    }
  }, [stage, gate]);

  const people = useMemo(() => [...members, ...family], [members, family]);
  const existingById = useMemo(() => new Map(existing.map((h) => [h.id, h])), [existing]);

  const settled = useMemo(() => {
    if (!match) return { groups: [] as Group[], blocked: new Set<number>() };
    const merge = new Set(Object.entries(answers).filter(([, v]) => v === "merge").map(([k]) => Number(k)));
    return resolveMerges(match, merge);
  }, [match, answers]);
  const finalGroups = settled.groups;
  const groupsForCreate = plan ?? finalGroups;

  const rowLines = useMemo(
    () =>
      new Map<number, RowLine>([
        ...donations.map((r): [number, RowLine] => [r.rowNo, { label: r.name, detail: `${money(r.amountCents)} · ${r.receivedOn}${r.phone ? ` · ${r.phone}` : ""}${r.address1 ? ` · ${r.address1}` : ""}` }]),
        ...people.map((r): [number, RowLine] => [
          r.rowNo,
          { label: `${r.firstName} ${r.lastName}`.trim(), detail: `${r.relationship ?? "member"}${r.phone ? ` · ${r.phone}` : ""}${r.email ? ` · ${r.email}` : ""}${r.address1 ? ` · ${r.address1}` : ""}` },
        ]),
      ]),
    [donations, people],
  );

  // ── Small helpers ────────────────────────────────────────────────────────────

  const setMeta = (kind: Dataset, m: DatasetMeta | undefined, save = true) => {
    const next = { ...metasRef.current };
    if (m) next[kind] = m;
    else delete next[kind];
    metasRef.current = next;
    setMetas(next);
    if (save) void saver.save({ state: { datasets: next } });
  };

  const go = (s: Stage) => {
    setStage(s);
    setError(null);
    if (s !== "welcome") void saver.save({ stage: s });
  };

  const recordOutcome = (key: RunKey, rec: RunRecord) => {
    outcomesRef.current = { ...outcomesRef.current, [key]: rec };
    setOutcomes(outcomesRef.current);
    void saver.save({ outcomes: { [key]: rec } });
  };

  const resetAll = () => {
    saver.detach();
    setProgressId(null);
    setGate(null);
    setStage("welcome");
    metasRef.current = {};
    setMetas({});
    setDonations([]);
    setMembers([]);
    setFamily([]);
    setExisting([]);
    existingRef.current = null;
    setExistingNote(null);
    setExistingProblem(null);
    setCompared(false);
    setCompareOff(false);
    setMatch(null);
    setAnswers({});
    setQi(0);
    setPlan(null);
    outcomesRef.current = {};
    setOutcomes({});
    keyedRef.current = {};
    storedRef.current = { donations: 0, members: 0, family: 0, plan: 0 };
    setError(null);
    setLines([]);
    setConfirmingOver(false);
  };

  // ── Start, continue, start over ─────────────────────────────────────────────

  const begin = async () => {
    if (progressId) {
      go("donations");
      return;
    }
    setBusy("start");
    setError(null);
    const res = await startOnboardingAction();
    setBusy(null);
    if (!res.ok || !res.data) {
      setError(res.ok ? "Could not start the guided onboarding — the database did not answer. Try again." : res.error);
      return;
    }
    const view = res.data;
    const started = Object.keys(view.state.datasets ?? {}).length > 0 || view.stage !== "donations" || Object.values(view.stored).some((x) => x > 0);
    if (started) {
      // Someone else pressed Start a moment ago: their draft is the one to continue.
      setGate(view);
      return;
    }
    saver.attach(view.id, view.version);
    setProgressId(view.id);
    setStage("donations");
    void saver.save({ stage: "donations", state: { v: 1 } });
  };

  const resume = async (view: ProgressView) => {
    setBusy("resume");
    setError(null);
    setLines([]);
    const progress = (t: string) => setLines([t]);
    try {
      saver.attach(view.id, view.version);
      const datasets = view.state.datasets ?? {};
      metasRef.current = datasets;
      setMetas(datasets);
      outcomesRef.current = view.outcomes;
      setOutcomes(view.outcomes);
      keyedRef.current = { ...view.answers };
      storedRef.current = view.stored;
      setCompareOff(view.state.compareExisting === false);

      const read = async (list: Dataset) => {
        const expected = view.stored[list];
        if (expected === 0) return [] as unknown[];
        if (!view.can[list]) {
          throw new Error(`your role cannot read the saved ${DATASET_LABEL[list].toLowerCase()} rows back (that needs ${list === "donations" ? "giving.manage" : "people.manage"}). Ask a teammate who can continue, or start over`);
        }
        return readList(view.id, list, expected, DATASET_LABEL[list].toLowerCase(), progress);
      };
      const d = await read("donations");
      const m = await read("members");
      const f = await read("family");
      if (!d.every(isParsedDonation) || !m.every(isParsedPerson) || !f.every(isParsedPerson)) {
        throw new Error("some saved rows are not in the form this page expects. Start over and upload the files again");
      }
      const donationRows = d as ParsedDonation[];
      const memberRows = m as ParsedPerson[];
      const familyRows = f as ParsedPerson[];
      setDonations(donationRows);
      setMembers(memberRows);
      setFamily(familyRows);
      setProgressId(view.id);

      const stageNow = resumeStage(view);
      if (createStarted(view.outcomes) && view.stored.plan > 0 && view.can.plan) {
        // Create had started: the plan it saved is what the rest of Create builds its files from.
        const p = await readList(view.id, "plan", view.stored.plan, "household plan", progress);
        if (!p.every(isStoredGroup)) throw new Error("the saved household plan is not in the form this page expects. Start over");
        setPlan(p as Group[]);
        setStage("confirm");
        setGate(null);
        setLines([]);
        return;
      }
      if (stageNow === "review" || stageNow === "confirm" || stageNow === "done") {
        setLines([]);
        setGate(null);
        await openReview(donationRows, memberRows, familyRows, { want: stageNow === "review" ? "review" : "confirm", qi: view.state.qi });
        return;
      }
      setStage(stageNow);
      setGate(null);
      setLines([]);
    } catch (err) {
      console.error("[onboarding] could not continue:", message(err));
      saver.detach();
      setProgressId(null);
      setError(`Could not continue where you left off — ${message(err)}.`);
    } finally {
      setBusy(null);
    }
  };

  const startOver = async () => {
    const id = progressId ?? gate?.id ?? null;
    setBusy("over");
    setError(null);
    if (id) {
      const res = await closeProgressAction({ id, status: "abandoned" });
      if (!res.ok) {
        setBusy(null);
        setError(res.error);
        return;
      }
    }
    resetAll();
    setBusy(null);
  };

  // ── Comparing with the households already in the records ───────────────────────

  /**
   * Match the uploaded rows with each other and with the households already in the records, restore the saved
   * answers that still apply, and show the review. The records are read once per visit.
   */
  const openReview = async (d: ParsedDonation[], m: ParsedPerson[], f: ParsedPerson[], opts: { want?: "review" | "confirm"; qi?: number; skipCompare?: boolean } = {}) => {
    setError(null);
    setExistingProblem(null);
    setMatch(null);
    setStage("review");
    setBusy("compare");
    try {
      let list = existingRef.current;
      let note: string | null = null;
      let didCompare = true;
      const skip = opts.skipCompare || compareOff || !canCompareExisting;
      if (skip) {
        list = [];
        didCompare = false;
        note = !canCompareExisting
          ? "You don't have access to your existing households (that needs people.view or people.manage), so they were not compared."
          : "You chose to go on without comparing with the households you already have.";
      } else if (!list) {
        const res = await loadExistingHouseholdsAction();
        if (!res.ok || !res.data) {
          setExistingProblem(res.ok ? "Could not read the households you already have — the answer was empty." : res.error);
          return;
        }
        list = res.data.households;
        existingRef.current = list;
        const bits: string[] = [];
        if (res.data.truncated) bits.push("Your records hold more households or people than can be compared at once, so only the first ones were compared.");
        if (res.data.withoutNumber > 0) bits.push(`${n(res.data.withoutNumber)} households in your records have no Connect number and could not be compared.`);
        note = bits.length ? bits.join(" ") : null;
      }
      setExisting(list);
      setExistingNote(note);
      setCompared(didCompare);
      const result = buildMatch(d, m, f, list);
      const byId = answersForQuestions(result.questions, keyedRef.current);
      const first = firstUnanswered(result.questions, byId);
      const position = opts.qi !== undefined ? Math.max(0, Math.min(opts.qi, result.questions.length)) : first;
      setMatch(result);
      setAnswers(byId);
      setQi(position);
      const allAnswered = result.questions.every((q) => byId[q.id]);
      const target = opts.want === "confirm" && allAnswered ? "confirm" : "review";
      setStage(target);
      void saver.save({ stage: target, state: { qi: position } });
    } catch (err) {
      console.error("[onboarding] could not match:", message(err));
      setError(`Could not group the households — ${message(err)}.`);
    } finally {
      setBusy(null);
    }
  };

  const continueWithoutComparing = () => {
    setCompareOff(true);
    void saver.save({ state: { compareExisting: false } });
    void openReview(donations, members, family, { skipCompare: true });
  };

  // ── Saving the checked rows ─────────────────────────────────────────────────

  /** Save a checked list (in batches of 250 rows) and go on. Throws with a plain sentence when it cannot be saved. */
  const persist = async (kind: Dataset, r: Result, meta: DatasetMeta, progress: (t: string) => void) => {
    const parts = chunkRows<unknown>(r.rows as readonly unknown[], ROW_CHUNK);
    await saver.exclusive(async (id, setVersion) => {
      for (let k = 0; k < parts.length; k++) {
        progress(`Saving ${n(Math.min((k + 1) * ROW_CHUNK, r.rows.length))} of ${n(r.rows.length)} rows…`);
        const res = await saveRowsAction({ id, list: kind, chunk: k, rows: parts[k]!, first: k === 0 });
        if (!res.ok || !res.data) throw new Error(res.ok ? "Could not save your rows — the database did not confirm them." : res.error);
        setVersion(res.data.version);
      }
    });
    if (kind === "donations") setDonations(r.rows as ParsedDonation[]);
    if (kind === "members") setMembers(r.rows as ParsedPerson[]);
    if (kind === "family") setFamily(r.rows as ParsedPerson[]);
    storedRef.current = { ...storedRef.current, [kind]: r.rows.length, plan: 0 };
    // New rows: the old answers and the old plan were about other rows (the database forgot them too).
    keyedRef.current = {};
    setAnswers({});
    setMatch(null);
    setPlan(null);
    setMeta(kind, meta, false);
    const next: Stage = kind === "donations" ? "members" : kind === "members" ? "family" : "review";
    void saver.save({ state: { datasets: metasRef.current, qi: 0 }, stage: next });
    if (kind === "family") {
      await openReview(donations, members, r.rows as ParsedPerson[]);
    } else {
      setStage(next);
    }
  };

  const keep = (kind: Dataset) => {
    if (kind === "donations") go("members");
    else if (kind === "members") go("family");
    else void openReview(donations, members, family);
  };

  const skip = async (kind: Dataset) => {
    setError(null);
    if (kind === "family" && donations.length + members.length === 0) {
      setError("Upload donations or members first: there is nothing to group yet.");
      return;
    }
    try {
      if (storedRef.current[kind] > 0) {
        await saver.exclusive(async (id, setVersion) => {
          const res = await saveRowsAction({ id, list: kind, chunk: 0, rows: [], first: true });
          if (!res.ok || !res.data) throw new Error(res.ok ? "Could not clear the saved rows — the database did not confirm it." : res.error);
          setVersion(res.data.version);
        });
        storedRef.current = { ...storedRef.current, [kind]: 0, plan: 0 };
        keyedRef.current = {};
        setAnswers({});
        setMatch(null);
        setPlan(null);
      }
    } catch (err) {
      setError(message(err));
      return;
    }
    const rowsAfter = { donations: kind === "donations" ? [] : donations, members: kind === "members" ? [] : members, family: kind === "family" ? [] : family };
    if (kind === "donations") setDonations([]);
    if (kind === "members") setMembers([]);
    if (kind === "family") setFamily([]);
    setMeta(kind, { status: "skipped" }, false);
    const nextStage: Stage = kind === "donations" ? "members" : kind === "members" ? "family" : "review";
    void saver.save({ state: { datasets: metasRef.current }, stage: nextStage });
    if (kind === "family") await openReview(rowsAfter.donations, rowsAfter.members, rowsAfter.family);
    else setStage(nextStage);
  };

  // ── Questions ────────────────────────────────────────────────────────────────

  const answer = (q: Question, d: Decision) => {
    const total = match?.questions.length ?? 0;
    const next = Math.min(qi + 1, total);
    keyedRef.current = { ...keyedRef.current, [q.key]: d };
    setAnswers((a) => ({ ...a, [q.id]: d }));
    setQi(next);
    void saver.save({ answers: { [q.key]: d }, state: { qi: next } });
  };

  const gotoQuestion = (i: number) => {
    setQi(i);
    void saver.save({ state: { qi: i } });
  };

  // ── Create ──────────────────────────────────────────────────────────────────

  /** What a run needs from the server, and where it reports progress and state (see create-flow.ts). */
  const deps: RunDeps = {
    start: (i) => startImportAction({ ...i, source: "onboarding", crmSystem: "onboarding" }),
    defineFields: (i) => defineCustomFieldsAction(i),
    stage: (i) => stageRowsAction(i),
    preview: (id) => previewAction(id),
    commit: (id) => commitBatchAction(id),
    cancel: (id) => cancelImportAction(id),
    status: (id) => runStatusAction(id),
    fingerprint: sha256,
    line: (prefix, text) => setLines((p) => [...p.filter((x) => !x.startsWith(prefix)), text]),
    record: (key, rec) => {
      recordOutcome(key, rec);
      if (rec.state === "stopped" && rec.stopKind === "decision") setDecisionRound((r) => r + 1);
    },
    warn: (text) => {
      console.error("[onboarding]", text);
      setLines((p) => [...p, text]);
    },
  };

  /**
   * Create the households, people and donations as up to three numbered imports. It can be pressed again after a
   * failure, a closed page or a decision: what is finished is skipped, a run that is partly done carries on, and
   * every ID the files use is stable, so nothing is added twice.
   */
  const create = async () => {
    const id = progressId;
    if (!id) return;
    setBusy("create");
    setError(null);
    setLines([]);
    try {
      const groups = groupsForCreate;
      // The plan is saved before anything is made, so a resume builds the very same files.
      if (!plan) {
        const parts = chunkRows(groups, ROW_CHUNK);
        setLines(["Saving the plan…"]);
        await saver.exclusive(async (pid, setVersion) => {
          for (let k = 0; k < parts.length; k++) {
            const res = await saveRowsAction({ id: pid, list: "plan", chunk: k, rows: parts[k]!, first: k === 0 });
            if (!res.ok || !res.data) throw new Error(res.ok ? "Could not save the plan — the database did not confirm it." : res.error);
            setVersion(res.data.version);
          }
        });
        storedRef.current = { ...storedRef.current, plan: groups.length };
        setPlan(groups);
      }
      const prefix = idPrefixOf(id);
      const sources = [...donations, ...people];
      const newHouseholds = groups.some((g) => !g.existing);
      const steps: { key: RunKey; needed: boolean; table: () => TableFile }[] = [
        { key: "households", needed: newHouseholds, table: () => buildHouseholdFile(groups, sources, donations, prefix) },
        { key: "people", needed: people.length > 0, table: () => buildPeopleFile(groups, people, (g) => householdLegacyId(g, prefix), prefix) },
        { key: "payments", needed: donations.length > 0, table: () => buildPaymentFile(groups, donations, prefix) },
      ];
      for (const step of steps) {
        if (!step.needed) continue;
        const rec = await runOne(deps, step.key, RUN_ENTITY[step.key], outcomesRef.current[step.key], step.table);
        if (rec.state === "stopped") return;
      }
      // Everything queued is saved first, so nothing is sent to a draft that is already closed.
      if (!(await saver.retry())) throw new Error("your latest progress could not be saved");
      const res = await closeProgressAction({ id, status: "created", outcomes: outcomesRef.current });
      if (!res.ok) throw new Error(res.error);
      saver.detach();
      setStage("done");
    } catch (err) {
      console.error("[onboarding] create failed:", message(err));
      setError(`Could not finish creating everything — ${message(err)}. Nothing is hidden: each step is a numbered import you can open and undo under Settings › Data import. Press the button again to carry on where it stopped.`);
    } finally {
      setBusy(null);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const idx = STAGES.indexOf(stage);
  const started = createStarted(outcomes);
  const stoppedKey = (["households", "people", "payments"] as const).find((k) => outcomes[k]?.state === "stopped") ?? null;
  const stopped = stoppedKey ? outcomes[stoppedKey]! : null;
  const linked = groupsForCreate.filter((g) => g.existing).length;
  const donationOnly = groupsForCreate.filter((g) => g.rows.every((r) => r < ROW_OFFSET.members)).length;
  const peopleOnly = groupsForCreate.filter((g) => g.rows.every((r) => r >= ROW_OFFSET.members)).length;
  const at = (iso: string | null | undefined) => (iso ? formatDateTime(iso, timeZone) : "—");

  if (gate) {
    const view = gate;
    const answered = Object.keys(view.answers).length;
    const made = (["households", "people", "payments"] as const).filter((k) => view.outcomes[k]);
    return (
      <div ref={topRef} className="mx-auto max-w-3xl space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Card title="Continue where you left off" description={`Started by ${view.createdByName}. Last saved ${at(view.updatedAt)} by ${view.updatedByName}.`}>
          <p className="text-[14px]">
            You were at <strong>{STAGE_LABEL[resumeStage(view)]}</strong>.
          </p>
          <ul className="mt-2 space-y-0.5 text-[13px]">
            {describeDatasets(view).map((l) => (
              <li key={l.dataset}>
                <strong>{DATASET_LABEL[l.dataset]}:</strong> {l.text}
              </li>
            ))}
            {answered > 0 ? (
              <li>
                <strong>Your answers:</strong> {n(answered)} saved
              </li>
            ) : null}
            {made.map((k) => (
              <li key={k}>
                <strong>{RUN_LABEL[k]}:</strong> import #{view.outcomes[k]!.runNumber} {view.outcomes[k]!.state === "done" ? "is done" : view.outcomes[k]!.state === "stopped" ? `stopped — ${view.outcomes[k]!.stoppedFor ?? "it needs you"}` : "was started"}
              </li>
            ))}
          </ul>
          {busy === "resume" && lines.length > 0 ? (
            <p className="mt-3 text-[13px]" role="status" aria-live="polite">
              {lines[0]}
            </p>
          ) : null}
          {confirmingOver ? (
            <div className="mt-4">
              <Alert tone="warning" title="Start over?">
                This removes the rows and answers saved here. Nothing already created is changed: imports you have made stay under Settings › Data import, where you can undo them.
                <span className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className={buttonClass("warn", "sm")} disabled={busy === "over"} onClick={() => void startOver()}>
                    {busy === "over" ? "Starting over…" : "Yes, start over"}
                  </button>
                  <button type="button" className={buttonClass("ghost", "sm")} disabled={busy === "over"} onClick={() => setConfirmingOver(false)}>
                    Keep my progress
                  </button>
                </span>
              </Alert>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={buttonClass(busy ? "off" : "primary")} disabled={Boolean(busy)} aria-busy={busy === "resume"} onClick={() => void resume(view)}>
                {busy === "resume" ? "Opening…" : "Continue"}
              </button>
              <button type="button" className={buttonClass("ghost")} disabled={Boolean(busy)} onClick={() => setConfirmingOver(true)}>
                Start over
              </button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const last: LastFinished | null = initial.last;
  const saveLine =
    saveStatus.kind === "failed" ? (
      <Alert
        tone="danger"
        action={
          <button type="button" className={buttonClass("bad", "xs")} onClick={() => void saver.retry()}>
            Save again
          </button>
        }
      >
        {saveStatus.error} What you did on this screen is still here.
      </Alert>
    ) : saveStatus.kind === "conflict" ? (
      <Alert
        tone="warning"
        action={
          <button type="button" className={buttonClass("ghost", "xs")} onClick={() => window.location.reload()}>
            Reload the page
          </button>
        }
      >
        {saveStatus.error}
      </Alert>
    ) : saveStatus.kind === "saving" ? (
      <p className="text-[12px] text-muted" role="status" aria-live="polite">
        Saving your progress…
      </p>
    ) : saveStatus.kind === "saved" ? (
      <p className="text-[12px] text-muted" role="status" aria-live="polite">
        Progress saved at {saveStatus.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. You can leave and come back to continue.
      </p>
    ) : null;

  return (
    <div ref={topRef} className="mx-auto max-w-3xl space-y-4">
      <p className="sr-only" aria-live="polite">
        Step {idx + 1} of {STAGES.length}: {STAGE_LABEL[stage]}
      </p>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ol className="flex flex-wrap gap-1.5 text-[12px]" aria-label="Steps">
          {STAGES.map((s, i) => (
            <li key={s} className={`rounded-full px-2.5 py-1 ${i === idx ? "bg-navy font-semibold text-white" : i < idx ? "bg-line text-ink" : "bg-panel text-muted"}`} aria-current={i === idx ? "step" : undefined}>
              {i + 1}. {STAGE_LABEL[s]}
            </li>
          ))}
        </ol>
        {progressId && stage !== "done" ? (
          <button type="button" className={buttonClass("ghost", "xs")} disabled={Boolean(busy)} onClick={() => setConfirmingOver(true)}>
            Start over
          </button>
        ) : null}
      </div>
      {confirmingOver && progressId ? (
        <Alert tone="warning" title="Start over?">
          This removes the rows and answers saved here. Nothing already created is changed: imports you have made stay under Settings › Data import, where you can undo them.
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={buttonClass("warn", "sm")} disabled={busy === "over"} onClick={() => void startOver()}>
              {busy === "over" ? "Starting over…" : "Yes, start over"}
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} disabled={busy === "over"} onClick={() => setConfirmingOver(false)}>
              Keep my progress
            </button>
          </span>
        </Alert>
      ) : null}
      {saveLine}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {stage === "welcome" ? (
        <Card title={`Let's set up ${centerName}`} description="We go one step at a time. Nothing is created until you press Create at the end, your progress is saved as you go, and everything created can be undone.">
          {last && !progressId ? (
            <div className="mb-3">
              <Alert tone="info">
                Guided onboarding was finished on {at(last.finishedAt)} by {last.finishedBy}.{" "}
                {(["households", "people", "payments"] as const)
                  .filter((k) => last.outcomes[k])
                  .map((k, i, all) => (
                    <span key={k}>
                      <Link className="crm-link" href={`/settings/import/${last.outcomes[k]!.runId}`}>
                        {RUN_LABEL[k].toLowerCase()} import #{last.outcomes[k]!.runNumber}
                      </Link>
                      {i < all.length - 1 ? ", " : ""}
                    </span>
                  ))}
                {" "}You can start again to add more.
              </Alert>
            </div>
          ) : null}
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
            <li>Past donations (optional): they establish your households.</li>
            <li>Your member list, matched to those households, and to the households you already have, by phone, email and address.</li>
            <li>The rest of each family (optional).</li>
            <li>We group everyone into households and ask only when we are unsure.</li>
            <li>We create households, people and donation history. When a member first signs in, they add the rest of their own details.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={buttonClass(busy === "start" ? "off" : "primary")} disabled={busy === "start"} aria-busy={busy === "start"} onClick={() => void begin()}>
              {busy === "start" ? "Starting…" : progressId ? "Continue" : "Start"}
            </button>
          </div>
        </Card>
      ) : null}

      {(["donations", "members", "family"] as const).map((kind) =>
        stage === kind ? (
          <DatasetStep
            key={kind}
            kind={kind}
            initial={
              kind === "donations"
                ? donations.length
                  ? { kind: "donations", rows: donations }
                  : null
                : kind === "members"
                  ? members.length
                    ? { kind: "members", rows: members }
                    : null
                  : family.length
                    ? { kind: "family", rows: family }
                    : null
            }
            meta={metas[kind]}
            blocked={kind === "donations" ? donationsBlocked : null}
            onMeta={(m) => setMeta(kind, m)}
            onSave={(r, m, progress) => persist(kind, r, m, progress)}
            onKeep={() => keep(kind)}
            onBack={() => go(kind === "donations" ? "welcome" : kind === "members" ? "donations" : "members")}
            onSkip={kind === "members" ? (donations.length ? () => void skip("members") : null) : () => void skip(kind)}
          />
        ) : null,
      )}

      {stage === "review" ? (
        match ? (
          <ReviewStep
            match={match}
            finalGroups={finalGroups}
            answers={answers}
            qi={qi}
            donations={donations.length}
            people={people.length}
            existingById={existingById}
            compared={compared}
            existingNote={existingNote}
            rowLines={rowLines}
            blockedAnswers={settled.blocked.size}
            onAnswer={answer}
            onQuestion={gotoQuestion}
            onBack={() => go("family")}
            onContinue={() => go("confirm")}
          />
        ) : existingProblem ? (
          <Card title="Compare with the households you already have" description="Before anything is created we check whether the households in your files are already in your records.">
            <Alert
              tone="danger"
              action={
                <button type="button" className={buttonClass("bad", "xs")} disabled={busy === "compare"} onClick={() => void openReview(donations, members, family)}>
                  Try again
                </button>
              }
            >
              {existingProblem}
            </Alert>
            <p className="crm-hint mt-2">You can go on without comparing, but then a household you already have may be created a second time (Merge review can combine them afterwards).</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={buttonClass("ghost")} onClick={() => go("family")}>
                Back
              </button>
              <button type="button" className={buttonClass("ghost")} onClick={continueWithoutComparing}>
                Continue without comparing
              </button>
            </div>
          </Card>
        ) : (
          <Card title="Households">
            <p className="text-[14px]" role="status" aria-live="polite">
              {busy === "compare" ? "Comparing your files with the households you already have…" : "Grouping your households…"}
            </p>
          </Card>
        )
      ) : null}

      {stage === "confirm" ? (
        <>
          <Card
            title="Create households, people and donations"
            description="Up to three numbered imports are made. Each can be opened and undone under Settings › Data import. Donations are history: they never post to QuickBooks."
          >
            <KpiGrid cols={4}>
              <Stat label="New households" value={n(groupsForCreate.length - linked)} />
              <Stat label="Households you already have" value={n(linked)} />
              <Stat label="People" value={n(people.length)} />
              <Stat label="Donations" value={n(donations.length)} hint={money(donations.reduce((s, r) => s + r.amountCents, 0))} />
            </KpiGrid>
            {linked > 0 ? <p className="crm-hint mt-2">Nothing new is created for the {n(linked)} households you already have: their people and donations are added to them. People already on file (same email or mobile) are updated, not duplicated.</p> : null}
            {people.length > 0 && donations.length > 0 ? (
              <p className="crm-hint mt-2">
                {n(donationOnly)} households have donations but no member yet; {n(peopleOnly)} have members but no donation history.
              </p>
            ) : null}
            {(["households", "people", "payments"] as const).some((k) => outcomes[k]) ? (
              <ul className="mt-3 space-y-0.5 text-[13px]">
                {(["households", "people", "payments"] as const).map((k) => {
                  const o = outcomes[k];
                  return o ? (
                    <li key={k}>
                      {RUN_LABEL[k]}: {o.state === "done" ? `${n(o.created)} created${o.updated ? `, ${n(o.updated)} updated` : ""}${o.failed ? `, ${n(o.failed)} failed` : ""}` : o.state === "stopped" ? `stopped — ${o.stoppedFor ?? "it needs you"}` : "started"} ·{" "}
                      <Link className="crm-link" href={`/settings/import/${o.runId}`}>
                        import #{o.runNumber}
                      </Link>
                    </li>
                  ) : null;
                })}
              </ul>
            ) : null}
            {lines.length > 0 && busy === "create" ? (
              <ul className="mt-3 space-y-0.5 text-[13px]" aria-live="polite">
                {lines.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : null}
            {stopped && stopped.stopKind === "errors" ? (
              <div className="mt-3">
                <Alert
                  tone="warning"
                  title={`Import #${stopped.runNumber} stopped: ${stopped.stoppedFor ?? "some rows have problems"}`}
                  action={
                    <span className="flex flex-wrap gap-2">
                      <Link className={buttonClass("ghost", "xs")} href={`/settings/import/${stopped.runId}?view=error`}>
                        See the rows
                      </Link>
                      <button type="button" className={buttonClass("ghost", "xs")} disabled={Boolean(busy)} onClick={() => void create()}>
                        Check again
                      </button>
                    </span>
                  }
                >
                  Nothing was added by this import yet. Open it to see which rows have problems; when you import it from there, come back and press Check again to carry on.
                </Alert>
              </div>
            ) : null}
            {!(stopped && stopped.stopKind === "decision") ? (
              <div className="mt-4 flex gap-2">
                <button type="button" className={buttonClass("ghost")} disabled={Boolean(busy) || started} onClick={() => go("review")}>
                  Back
                </button>
                <button type="button" className={buttonClass(busy ? "off" : "primary")} disabled={Boolean(busy)} aria-busy={busy === "create"} onClick={() => void create()}>
                  {busy === "create" ? "Creating…" : started ? "Try again" : "Create"}
                </button>
              </div>
            ) : null}
          </Card>
          {stopped && stopped.stopKind === "decision" && stoppedKey && stoppedKey !== "payments" ? (
            <DecisionPanel key={`${stopped.runId}:${decisionRound}`} runId={stopped.runId} runNumber={stopped.runNumber} entity={stoppedKey} busy={busy === "create"} onContinue={() => void create()} />
          ) : null}
        </>
      ) : null}

      {stage === "done" ? (
        <Card title="Done" description="Open a run to see every row, reconcile or undo it.">
          <ul className="space-y-2 text-[14px]">
            {(["households", "people", "payments"] as const).map((k) => {
              const o = outcomes[k];
              return o ? (
                <li key={k}>
                  {RUN_LABEL[k]}: {n(o.created)} created
                  {o.updated ? `, ${n(o.updated)} updated` : ""}
                  {o.failed ? `, ${n(o.failed)} failed` : ""} ·{" "}
                  <Link className="crm-link" href={`/settings/import/${o.runId}`}>
                    import #{o.runNumber}
                  </Link>
                </li>
              ) : null;
            })}
            {linked > 0 ? <li>{n(linked)} households you already had received their people and donations; no household was created twice.</li> : null}
          </ul>
          <p className="crm-hint mt-3">Next: invite your members with the join link or QR code. When a member first signs in, the app asks them for the rest of their details, one question at a time.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className={buttonClass("primary")} href="/settings/member-app">
              Get the join link and QR
            </Link>
            <Link className={buttonClass("ghost")} href="/settings/import">
              See all imports
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

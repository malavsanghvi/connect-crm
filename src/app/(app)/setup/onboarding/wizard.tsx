"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";

import { Alert, Card, KpiGrid, Stat, buttonClass } from "@/components/ui";
import { parseCsv } from "@/lib/csv";
import { autoMap } from "@/lib/import/mapping";
import { toCsv } from "@/lib/import/templates";
import { cleanText } from "@/lib/import/transforms";
import {
  PAYER_FIELDS,
  autoMapColumns,
  buildHouseholdFile,
  buildPaymentFile,
  missingRequired,
  toPayerInputs,
  validateDonations,
  type ColumnChoice,
  type MethodValue,
  type TableFile,
} from "@/lib/onboarding/donations";
import { applyDecisions, matchPayers, type Group, type MatchResult } from "@/lib/onboarding/match";

import { commitBatchAction, defineCustomFieldsAction, previewAction, startImportAction, stageRowsAction } from "../../settings/import/actions";

const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK = 250;

type Step = "welcome" | "upload" | "map" | "check" | "review" | "confirm" | "done";
const STEP_LABEL: Record<Step, string> = { welcome: "Welcome", upload: "Upload", map: "Match columns", check: "Check", review: "Households", confirm: "Create", done: "Done" };
const FLOW: Step[] = ["welcome", "upload", "map", "check", "review", "confirm", "done"];

type Parsed = { fileName: string; size: number; headers: string[]; rows: string[][] };

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

async function readFile(file: File): Promise<Parsed> {
  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    const data = await readSheet(file, { parseNumber: (s: string) => s });
    table = data.map((r) => r.map(cellText));
  } else if (/\.xls$/i.test(file.name)) {
    throw new Error("Old .xls files cannot be read. Save it as .xlsx or .csv and upload that.");
  } else {
    table = parseCsv(new TextDecoder("utf-8").decode(await file.arrayBuffer()));
  }
  const nonEmpty = table.filter((r) => r.some((c) => cleanText(c) !== ""));
  if (nonEmpty.length === 0) throw new Error("The file is empty.");
  const headers = nonEmpty[0]!.map((h, i) => cleanText(h) || `Column ${i + 1}`);
  const width = Math.max(headers.length, ...nonEmpty.map((r) => r.length));
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  const rows = nonEmpty.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  return { fileName: file.name, size: file.size, headers, rows };
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type RunOutcome = { runId: string; runNumber: number; created: number; updated: number; failed: number; stoppedFor: string | null };

export function OnboardingWizard({ centerName }: { centerName: string }) {
  const [step, setStep] = useState<Step>("welcome");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [choices, setChoices] = useState<ColumnChoice[]>([]);
  const [dateOrder, setDateOrder] = useState<"mdy" | "dmy">("mdy");
  const [defaultMethod, setDefaultMethod] = useState<MethodValue>("check");
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, "merge" | "separate">>({});
  const [qi, setQi] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<{ households: RunOutcome; payments: RunOutcome } | null>(null);

  const validation = useMemo(
    () => (parsed && step !== "upload" && step !== "welcome" ? validateDonations(parsed.headers, parsed.rows, choices, { dateOrder, defaultMethod }) : null),
    [parsed, choices, dateOrder, defaultMethod, step],
  );
  const missing = useMemo(() => missingRequired(choices), [choices]);
  const methodMapped = choices.includes("method");

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("Could not read that file — it is larger than 20 MB. Split it into years and upload each.");
      return;
    }
    try {
      const p = await readFile(file);
      if (p.rows.length === 0) throw new Error("There is a header row but no donations under it.");
      setParsed(p);
      setChoices(autoMapColumns(p.headers, p.rows.slice(0, 200)));
      setStep("map");
    } catch (err) {
      console.error("[onboarding] could not read the file:", err);
      setError(`Could not read that file — ${err instanceof Error ? err.message : "it is not a CSV or Excel (.xlsx) file"}.`);
    }
  };

  const startReview = () => {
    if (!validation) return;
    setError(null);
    const m = matchPayers(toPayerInputs(validation.rows));
    setMatch(m);
    setAnswers({});
    setQi(0);
    setStep("review");
  };

  const finalGroups: Group[] = useMemo(() => {
    if (!match) return [];
    const merge = new Set(Object.entries(answers).filter(([, v]) => v === "merge").map(([k]) => Number(k)));
    return applyDecisions(match, merge);
  }, [match, answers]);

  const runImport = async (entity: "households" | "payments", table: TableFile, label: string): Promise<RunOutcome> => {
    setProgress((p) => [...p, `${label}: starting`]);
    const fileName = `onboarding-${entity}.csv`;
    const start = await startImportAction({ entity, source: "onboarding", fileName, fingerprint: await sha256(JSON.stringify(table)), fileSize: JSON.stringify(table).length, crmSystem: "onboarding" });
    if (!start.ok || !start.data) throw new Error(start.error ?? "could not start the import");
    const runId = start.data.runId;
    const mapping0 = autoMap(entity, table.headers, table.rows.slice(0, 200), null, { dateOrder: "mdy", crmSystem: "onboarding" });
    const defined = await defineCustomFieldsAction({ runId, entity, mapping: mapping0 });
    if (!defined.ok || !defined.data) throw new Error(defined.error ?? "could not keep the extra columns");
    const mapping = defined.data;
    for (let i = 0; i < table.rows.length; i += CHUNK) {
      const chunk = table.rows.slice(i, i + CHUNK).map((cells, k) => ({ rowNo: i + k + 1, cells }));
      const staged = await stageRowsAction({ runId, entity, headers: table.headers, mapping, rows: chunk, first: i === 0 });
      if (!staged.ok) throw new Error(staged.error ?? "could not check the rows");
      setProgress((p) => [...p.filter((x) => !x.startsWith(`${label}: checked`)), `${label}: checked ${Math.min(i + CHUNK, table.rows.length).toLocaleString("en-US")} of ${table.rows.length.toLocaleString("en-US")}`]);
    }
    const prev = await previewAction(runId);
    if (!prev.ok || !prev.data) throw new Error(prev.error ?? "could not preview the import");
    if (prev.data.error > 0 || prev.data.needs_decision > 0) {
      return { runId, runNumber: start.data.runNumber, created: 0, updated: 0, failed: prev.data.error, stoppedFor: prev.data.needs_decision > 0 ? `${prev.data.needs_decision} look like records you already have and need your decision` : `${prev.data.error} rows have problems` };
    }
    let counts = { created: 0, updated: 0, failed: 0 };
    for (let guard = 0; guard < 1000; guard++) {
      const step1 = await commitBatchAction(runId);
      if (!step1.ok || !step1.data) throw new Error(step1.error ?? "could not import the rows");
      counts = { created: step1.data.counts.created, updated: step1.data.counts.updated, failed: step1.data.counts.failed };
      setProgress((p) => [...p.filter((x) => !x.startsWith(`${label}: saved`)), `${label}: saved ${(counts.created + counts.updated).toLocaleString("en-US")}`]);
      if (step1.data.remaining === 0) break;
    }
    return { runId, runNumber: start.data.runNumber, ...counts, stoppedFor: null };
  };

  const create = async () => {
    if (!validation || !match) return;
    setBusy("create");
    setError(null);
    setProgress([]);
    try {
      const households = await runImport("households", buildHouseholdFile(finalGroups, validation.rows), "Households");
      if (households.stoppedFor) {
        setOutcomes({ households, payments: { runId: "", runNumber: 0, created: 0, updated: 0, failed: 0, stoppedFor: "not started" } });
        setStep("done");
        return;
      }
      const payments = await runImport("payments", buildPaymentFile(finalGroups, validation.rows), "Donations");
      setOutcomes({ households, payments });
      setStep("done");
    } catch (err) {
      console.error("[onboarding] create failed:", err);
      setError(`Could not create the households and donations — ${err instanceof Error ? err.message : "something went wrong"}. Nothing half-finished is hidden: each step is a numbered import you can open and undo under Settings › Data import.`);
    } finally {
      setBusy(null);
    }
  };

  const idx = FLOW.indexOf(step);
  const questions = match?.questions ?? [];
  const answered = questions.filter((q) => answers[q.id]).length;
  const current = questions[qi] ?? null;
  const groupOf = (id: number) => match?.groups.find((g) => g.id === id);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ol className="flex flex-wrap gap-1.5 text-[12px]" aria-label="Steps">
        {FLOW.map((s, i) => (
          <li key={s} className={`rounded-full px-2.5 py-1 ${i === idx ? "bg-navy font-semibold text-white" : i < idx ? "bg-line text-ink" : "bg-panel text-muted"}`} aria-current={i === idx ? "step" : undefined}>
            {i + 1}. {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {step === "welcome" ? (
        <Card title={`Let's set up ${centerName}`} description="We will go one step at a time. Nothing is saved until you press Create at the end, and everything created can be undone.">
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
            <li>Upload your past donations (optional): from QuickBooks, Neon, your bank or a spreadsheet.</li>
            <li>We group the payers into households, using phone, email and address as well as names, and ask only when we are unsure.</li>
            <li>We create the households and their donations as history.</li>
            <li>Next: your member list, matched to these households, then the rest of each family.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={buttonClass("primary")} onClick={() => setStep("upload")}>
              Start with past donations
            </button>
            <Link className={buttonClass("ghost")} href="/settings/import">
              Skip — go to the member import
            </Link>
          </div>
        </Card>
      ) : null}

      {step === "upload" ? (
        <Card title="Upload past donations" description="A CSV or Excel (.xlsx) file. Use our template, or upload your own export and match its columns in the next step.">
          <p className="text-[13px]">
            <a className="crm-link" href="/setup/onboarding/template?format=xlsx">
              Download the Excel template
            </a>{" "}
            ·{" "}
            <a className="crm-link" href="/setup/onboarding/template?format=csv">
              CSV template
            </a>
          </p>
          <p className="crm-hint mt-1">Required: payer name, amount, date. Phone, email and address are optional but let us match the same family without asking you. Any other column is kept as custom data.</p>
          <label htmlFor="ob-file" className="crm-label mt-3 block">
            File (.csv or .xlsx)
          </label>
          <input id="ob-file" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="crm-input py-2" />
          <div className="mt-4">
            <button type="button" className={buttonClass("ghost")} onClick={() => setStep("welcome")}>
              Back
            </button>
          </div>
        </Card>
      ) : null}

      {step === "map" && parsed ? (
        <Card title="Match your columns" description={`${parsed.fileName} · ${parsed.rows.length.toLocaleString("en-US")} rows. We matched what we could; change anything that is wrong.`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="text-muted">
                  <th className="py-1 pr-3">Your column</th>
                  <th className="py-1 pr-3">Example</th>
                  <th className="py-1">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((h, i) => (
                  <tr key={`${h}-${i}`} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-medium">{h}</td>
                    <td className="max-w-[14rem] truncate py-1.5 pr-3 text-muted">{parsed.rows.find((r) => cleanText(r[i] ?? ""))?.[i] ?? ""}</td>
                    <td className="py-1.5">
                      <select
                        aria-label={`Where "${h}" goes`}
                        className="crm-input"
                        value={choices[i]}
                        onChange={(e) => setChoices(choices.map((c, k) => (k === i ? (e.target.value as ColumnChoice) : c === e.target.value && e.target.value !== "custom" && e.target.value !== "skip" ? "custom" : c)))}
                      >
                        {PAYER_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " (required)" : ""}
                          </option>
                        ))}
                        <option value="custom">Keep as custom data</option>
                        <option value="skip">Ignore this column</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="crm-label">How dates are written</span>
              <select className="crm-input" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as "mdy" | "dmy")}>
                <option value="mdy">Month/Day/Year (03/04/2024 is 4 March)</option>
                <option value="dmy">Day/Month/Year (03/04/2024 is 3 April)</option>
              </select>
            </label>
            {!methodMapped ? (
              <label>
                <span className="crm-label">Method for every donation (no Method column)</span>
                <select className="crm-input" value={defaultMethod} onChange={(e) => setDefaultMethod(e.target.value as MethodValue)}>
                  {["check", "cash", "card", "ach", "zelle", "stock", "daf", "other"].map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase() === m ? m : m[0]!.toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {missing.length > 0 ? <p className="mt-3 text-[13px] text-danger">Still needed: {missing.map((f) => f.label).join(", ")}. Choose which column holds it.</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={() => setStep("upload")}>
              Back
            </button>
            <button type="button" className={buttonClass(missing.length ? "off" : "primary")} disabled={missing.length > 0} onClick={() => setStep("check")}>
              Check the rows
            </button>
          </div>
        </Card>
      ) : null}

      {step === "check" && parsed && validation ? (
        <Card title="Check" description="Each value is checked by what it is: amounts, dates, emails and phone numbers.">
          <KpiGrid cols={3}>
            <Stat label="Ready" value={validation.rows.length.toLocaleString("en-US")} tone="success" />
            <Stat label="Need fixing" value={validation.badRows.size.toLocaleString("en-US")} tone={validation.badRows.size ? "danger" : "navy"} />
            <Stat label="Total amount ready" value={money(validation.rows.reduce((s, r) => s + r.amountCents, 0))} />
          </KpiGrid>
          {validation.problems.length > 0 ? (
            <div className="mt-3">
              <p className="text-[13px] font-semibold">Problems (first 30)</p>
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {validation.problems.slice(0, 30).map((p, i) => (
                  <li key={i} className={p.level === "error" ? "text-danger" : "text-muted"}>
                    Row {p.rowNo} · {p.column} {p.message}
                    {p.level === "error" ? " — row not loaded" : ""}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`${buttonClass("ghost", "sm")} mt-2`}
                onClick={() =>
                  download(
                    "donation-problems.csv",
                    toCsv([["Row", "Column", "Problem", "Effect"], ...validation.problems.map((p) => [p.rowNo, p.column, p.message, p.level === "error" ? "Row not loaded" : "Value left out"])]),
                  )
                }
              >
                Download all problems
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-success">Every row passed.</p>
          )}
          {validation.badRows.size > 0 ? <p className="crm-hint mt-2">Rows with errors are left out. Fix them in your file and upload it again, or continue with the rest.</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={() => setStep("map")}>
              Back
            </button>
            <button type="button" className={buttonClass(validation.rows.length ? "primary" : "off")} disabled={validation.rows.length === 0} onClick={startReview}>
              Group into households
            </button>
          </div>
        </Card>
      ) : null}

      {step === "review" && match && validation ? (
        <Card title="Households" description={`${validation.rows.length.toLocaleString("en-US")} donations from ${finalGroups.length.toLocaleString("en-US")} households so far. ${match.autoLinks.toLocaleString("en-US")} links were made automatically from phone, email and address.`}>
          {current ? (
            <div>
              <p className="text-[13px] text-muted">
                Question {qi + 1} of {questions.length} · {answered} answered
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {[current.a, current.b].map((gid) => {
                  const g = groupOf(gid);
                  if (!g) return null;
                  const sample = validation.rows.filter((r) => g.rows.includes(r.rowNo)).slice(0, 3);
                  return (
                    <div key={gid} className="rounded-lg border border-line p-3 text-[13px]">
                      <p className="font-semibold">{g.displayName}</p>
                      {g.names.length > 1 ? <p className="text-muted">Also written as: {g.names.filter((n) => n !== g.displayName).join("; ")}</p> : null}
                      <ul className="mt-1.5 space-y-0.5 text-muted">
                        {sample.map((r) => (
                          <li key={r.rowNo}>
                            {money(r.amountCents)} · {r.receivedOn}
                            {r.phone ? ` · ${r.phone}` : ""}
                            {r.address1 ? ` · ${r.address1}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3 text-[14px]">
                <strong>Same household?</strong> Why we ask: {current.note}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass("primary")}
                  onClick={() => {
                    setAnswers({ ...answers, [current.id]: "merge" });
                    setQi(Math.min(qi + 1, questions.length));
                  }}
                >
                  Yes, merge them
                </button>
                <button
                  type="button"
                  className={buttonClass("ghost")}
                  onClick={() => {
                    setAnswers({ ...answers, [current.id]: "separate" });
                    setQi(Math.min(qi + 1, questions.length));
                  }}
                >
                  No, keep separate
                </button>
                {qi > 0 ? (
                  <button type="button" className={buttonClass("ghost")} onClick={() => setQi(qi - 1)}>
                    Previous question
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-[14px]">{questions.length === 0 ? "No questions: every household was clear from the file." : "All questions answered."}</p>
          )}
          <div className="mt-5 flex gap-2 border-t border-line pt-3">
            <button type="button" className={buttonClass("ghost")} onClick={() => setStep("check")}>
              Back
            </button>
            <button type="button" className={buttonClass(current ? "off" : "primary")} disabled={Boolean(current)} onClick={() => setStep("confirm")}>
              Continue
            </button>
          </div>
        </Card>
      ) : null}

      {step === "confirm" && validation ? (
        <Card title="Create households and donations" description="Two numbered imports are made. Each can be opened and undone under Settings › Data import. Donations are history: they never post to QuickBooks.">
          <KpiGrid cols={3}>
            <Stat label="Households" value={finalGroups.length.toLocaleString("en-US")} />
            <Stat label="Donations" value={validation.rows.length.toLocaleString("en-US")} />
            <Stat label="Total" value={money(validation.rows.reduce((s, r) => s + r.amountCents, 0))} />
          </KpiGrid>
          {progress.length > 0 ? (
            <ul className="mt-3 space-y-0.5 text-[13px]" aria-live="polite">
              {progress.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass("ghost")} disabled={Boolean(busy)} onClick={() => setStep("review")}>
              Back
            </button>
            <button type="button" className={buttonClass(busy ? "off" : "primary")} disabled={Boolean(busy)} onClick={() => void create()}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </Card>
      ) : null}

      {step === "done" && outcomes ? (
        <Card title={outcomes.households.stoppedFor ? "Paused for your decision" : "Done"} description="Open a run to see every row, reconcile or undo it.">
          <ul className="space-y-2 text-[14px]">
            <li>
              Households: {outcomes.households.created.toLocaleString("en-US")} created
              {outcomes.households.updated ? `, ${outcomes.households.updated} updated` : ""}
              {outcomes.households.failed ? `, ${outcomes.households.failed} failed` : ""}
              {outcomes.households.stoppedFor ? ` — stopped: ${outcomes.households.stoppedFor}` : ""} ·{" "}
              <Link className="crm-link" href={`/settings/import/${outcomes.households.runId}`}>
                import #{outcomes.households.runNumber}
              </Link>
            </li>
            {outcomes.payments.runId ? (
              <li>
                Donations: {outcomes.payments.created.toLocaleString("en-US")} created
                {outcomes.payments.failed ? `, ${outcomes.payments.failed} failed` : ""}
                {outcomes.payments.stoppedFor ? ` — stopped: ${outcomes.payments.stoppedFor}` : ""} ·{" "}
                <Link className="crm-link" href={`/settings/import/${outcomes.payments.runId}`}>
                  import #{outcomes.payments.runNumber}
                </Link>
              </li>
            ) : null}
          </ul>
          <p className="crm-hint mt-3">Next: your member list, matched to these households. Until that step is built here, use the member import under Settings › Data import; it matches on the household IDs these donations created (ONB-H-…).</p>
          <div className="mt-3">
            <Link className={buttonClass("primary")} href="/settings/import/new">
              Continue with the member import
            </Link>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

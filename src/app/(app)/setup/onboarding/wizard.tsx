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
  householdLegacyId,
  missingRequired,
  toPayerInputs,
  validateDonations,
  type AddressSource,
  type MethodValue,
  type ParsedDonation,
  type TableFile,
} from "@/lib/onboarding/donations";
import { applyDecisions, matchPayers, type Group, type MatchResult, type PayerInput } from "@/lib/onboarding/match";
import { PERSON_FIELDS, autoMapPersonColumns, buildPeopleFile, missingPersonFields, personToInput, validatePeople, type ParsedPerson } from "@/lib/onboarding/people";

import { commitBatchAction, defineCustomFieldsAction, previewAction, startImportAction, stageRowsAction } from "../../settings/import/actions";

const MAX_BYTES = 20 * 1024 * 1024;
const CHUNK = 250;

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

type Stage = "welcome" | "donations" | "members" | "family" | "review" | "confirm" | "done";
const STAGES: Stage[] = ["welcome", "donations", "members", "family", "review", "confirm", "done"];
const STAGE_LABEL: Record<Stage, string> = { welcome: "Welcome", donations: "Past donations", members: "Members", family: "Rest of the family", review: "Households", confirm: "Create", done: "Done" };

type Kind = "donations" | "members" | "family";
type Sub = "upload" | "map" | "check";

const ROW_OFFSET: Record<Kind, number> = { donations: 0, members: 1_000_000, family: 2_000_000 };

type Result = { kind: "donations"; rows: ParsedDonation[] } | { kind: "members" | "family"; rows: ParsedPerson[] };
type Problem = { rowNo: number; column: string; level: "error" | "warning"; message: string };

const KIND_TEXT: Record<Kind, { title: string; intro: string; templateKind: "donations" | "people"; hint: string }> = {
  donations: {
    title: "Past donations",
    intro: "Upload your past donations or invoices (optional): from QuickBooks, Neon, your bank or a spreadsheet. These establish your households.",
    templateKind: "donations",
    hint: "Required: payer name, amount, date. Phone, email and address are optional but let us match the same family without asking you.",
  },
  members: {
    title: "Members",
    intro: "Upload your member list. Each person is matched to the households from your donations by phone, email and address.",
    templateKind: "people",
    hint: "Required: a name. Put people of one family under the same Household or family ID, or let us match them by phone, email and address.",
  },
  family: {
    title: "Rest of the family",
    intro: "Upload spouses, children, parents and anyone else (optional). They join the household of the member they belong to.",
    templateKind: "people",
    hint: "Same template as members. Use the Household or family ID, or the same phone, email or address, so each person finds their household.",
  },
};

function DatasetStep({
  kind,
  initial,
  onDone,
  onSkip,
  onBack,
}: {
  kind: Kind;
  initial: Result | null;
  onDone: (r: Result) => void;
  onSkip: (() => void) | null;
  onBack: () => void;
}) {
  const t = KIND_TEXT[kind];
  const [sub, setSub] = useState<Sub>("upload");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [dateOrder, setDateOrder] = useState<"mdy" | "dmy">("mdy");
  const [defaultMethod, setDefaultMethod] = useState<MethodValue>("check");
  const [error, setError] = useState<string | null>(null);

  const fields = kind === "donations" ? PAYER_FIELDS : PERSON_FIELDS;
  const missing = kind === "donations" ? missingRequired(choices as never).map((f) => f.label) : missingPersonFields(choices as never);

  const result = useMemo(() => {
    if (!parsed || sub !== "check") return null;
    if (kind === "donations") {
      const v = validateDonations(parsed.headers, parsed.rows, choices as never, { dateOrder, defaultMethod });
      return { rows: v.rows, problems: v.problems as Problem[], badRows: v.badRows, total: v.rows.reduce((sum, r) => sum + r.amountCents, 0) };
    }
    const v = validatePeople(parsed.headers, parsed.rows, choices as never, { dateOrder, rowOffset: ROW_OFFSET[kind] });
    return { rows: v.rows, problems: v.problems as Problem[], badRows: v.badRows, total: 0 };
  }, [parsed, choices, dateOrder, defaultMethod, sub, kind]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("Could not read that file — it is larger than 20 MB. Split it and upload each part.");
      return;
    }
    try {
      const p = await readFile(file);
      if (p.rows.length === 0) throw new Error("There is a header row but nothing under it.");
      setParsed(p);
      setChoices(kind === "donations" ? autoMapColumns(p.headers, p.rows.slice(0, 200)) : autoMapPersonColumns(p.headers, p.rows.slice(0, 200)));
      setSub("map");
    } catch (err) {
      console.error("[onboarding] could not read the file:", err);
      setError(`Could not read that file — ${err instanceof Error ? err.message : "it is not a CSV or Excel (.xlsx) file"}.`);
    }
  };

  const methodMapped = choices.includes("method");

  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {sub === "upload" ? (
        <Card title={t.title} description={t.intro}>
          {initial && initial.rows.length > 0 ? (
            <Alert tone="success">
              {initial.rows.length.toLocaleString("en-US")} rows from an earlier upload are kept. Upload again to replace them, or continue.
            </Alert>
          ) : null}
          <p className="mt-2 text-[13px]">
            <a className="crm-link" href={`/setup/onboarding/template?kind=${t.templateKind}&format=xlsx`}>
              Download the Excel template
            </a>{" "}
            ·{" "}
            <a className="crm-link" href={`/setup/onboarding/template?kind=${t.templateKind}&format=csv`}>
              CSV template
            </a>
          </p>
          <p className="crm-hint mt-1">{t.hint} Any other column is kept as custom data.</p>
          <label htmlFor={`ob-file-${kind}`} className="crm-label mt-3 block">
            File (.csv or .xlsx)
          </label>
          <input id={`ob-file-${kind}`} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="crm-input py-2" />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={onBack}>
              Back
            </button>
            {initial && initial.rows.length > 0 ? (
              <button type="button" className={buttonClass("primary")} onClick={() => onDone(initial)}>
                Continue with the kept rows
              </button>
            ) : null}
            {onSkip ? (
              <button type="button" className={buttonClass("ghost")} onClick={onSkip}>
                Skip this step
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {sub === "map" && parsed ? (
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
                        onChange={(e) => setChoices(choices.map((c, k) => (k === i ? e.target.value : c === e.target.value && e.target.value !== "custom" && e.target.value !== "skip" ? "custom" : c)))}
                      >
                        {fields.map((f) => (
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
            {kind === "donations" && !methodMapped ? (
              <label>
                <span className="crm-label">Method for every donation (no Method column)</span>
                <select className="crm-input" value={defaultMethod} onChange={(e) => setDefaultMethod(e.target.value as MethodValue)}>
                  {["check", "cash", "card", "ach", "zelle", "stock", "daf", "other"].map((m) => (
                    <option key={m} value={m}>
                      {m.length <= 3 ? m.toUpperCase() : m[0]!.toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {missing.length > 0 ? <p className="mt-3 text-[13px] text-danger">Still needed: {missing.join(", ")}. Choose which column holds it.</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={() => setSub("upload")}>
              Back
            </button>
            <button type="button" className={buttonClass(missing.length ? "off" : "primary")} disabled={missing.length > 0} onClick={() => setSub("check")}>
              Check the rows
            </button>
          </div>
        </Card>
      ) : null}

      {sub === "check" && result ? (
        <Card title="Check" description="Each value is checked by what it is: names, amounts, dates, emails and phone numbers.">
          <KpiGrid cols={3}>
            <Stat label="Ready" value={result.rows.length.toLocaleString("en-US")} tone="success" />
            <Stat label="Need fixing" value={result.badRows.size.toLocaleString("en-US")} tone={result.badRows.size ? "danger" : "navy"} />
            {kind === "donations" ? <Stat label="Total amount ready" value={money(result.total)} /> : <Stat label="With an email or mobile" value={(result.rows as ParsedPerson[]).filter((r) => r.email || r.phone).length.toLocaleString("en-US")} />}
          </KpiGrid>
          {result.problems.length > 0 ? (
            <div className="mt-3">
              <p className="text-[13px] font-semibold">Problems (first 30)</p>
              <ul className="mt-1 space-y-0.5 text-[13px]">
                {result.problems.slice(0, 30).map((p, i) => (
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
                  download(`${kind}-problems.csv`, toCsv([["Row", "Column", "Problem", "Effect"], ...result.problems.map((p) => [p.rowNo, p.column, p.message, p.level === "error" ? "Row not loaded" : "Value left out"])]))
                }
              >
                Download all problems
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-success">Every row passed.</p>
          )}
          {result.badRows.size > 0 ? <p className="crm-hint mt-2">Rows with errors are left out. Fix them in your file and upload it again, or continue with the rest.</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass("ghost")} onClick={() => setSub("map")}>
              Back
            </button>
            <button
              type="button"
              className={buttonClass(result.rows.length ? "primary" : "off")}
              disabled={result.rows.length === 0}
              onClick={() => onDone(kind === "donations" ? { kind: "donations", rows: result.rows as ParsedDonation[] } : { kind, rows: result.rows as ParsedPerson[] })}
            >
              Continue
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

type RunOutcome = { runId: string; runNumber: number; created: number; updated: number; failed: number; stoppedFor: string | null };
type Outcomes = { households: RunOutcome; people: RunOutcome | null; payments: RunOutcome | null };

export function OnboardingWizard({ centerName }: { centerName: string }) {
  const [stage, setStage] = useState<Stage>("welcome");
  const [donations, setDonations] = useState<ParsedDonation[]>([]);
  const [members, setMembers] = useState<ParsedPerson[]>([]);
  const [family, setFamily] = useState<ParsedPerson[]>([]);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [answers, setAnswers] = useState<Record<number, "merge" | "separate">>({});
  const [qi, setQi] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<Outcomes | null>(null);

  const people = useMemo(() => [...members, ...family], [members, family]);

  const startReview = () => {
    setError(null);
    const inputs: PayerInput[] = [...toPayerInputs(donations), ...people.map(personToInput)];
    setMatch(matchPayers(inputs));
    setAnswers({});
    setQi(0);
    setStage("review");
  };

  const finalGroups: Group[] = useMemo(() => {
    if (!match) return [];
    const merge = new Set(Object.entries(answers).filter(([, v]) => v === "merge").map(([k]) => Number(k)));
    return applyDecisions(match, merge);
  }, [match, answers]);

  const runImport = async (entity: "households" | "people" | "payments", table: TableFile, label: string): Promise<RunOutcome> => {
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
      return {
        runId,
        runNumber: start.data.runNumber,
        created: 0,
        updated: 0,
        failed: prev.data.error,
        stoppedFor: prev.data.needs_decision > 0 ? `${prev.data.needs_decision} look like records you already have and need your decision` : `${prev.data.error} rows have problems`,
      };
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
    setBusy("create");
    setError(null);
    setProgress([]);
    try {
      const sources: AddressSource[] = [...donations, ...people];
      const households = await runImport("households", buildHouseholdFile(finalGroups, sources, donations), "Households");
      if (households.stoppedFor) {
        setOutcomes({ households, people: null, payments: null });
        setStage("done");
        return;
      }
      const peopleOut = people.length ? await runImport("people", buildPeopleFile(finalGroups, people, householdLegacyId), "People") : null;
      const payments = donations.length && !peopleOut?.stoppedFor ? await runImport("payments", buildPaymentFile(finalGroups, donations), "Donations") : null;
      setOutcomes({ households, people: peopleOut, payments });
      setStage("done");
    } catch (err) {
      console.error("[onboarding] create failed:", err);
      setError(`Could not finish creating everything — ${err instanceof Error ? err.message : "something went wrong"}. Nothing is hidden: each step is a numbered import you can open and undo under Settings › Data import.`);
    } finally {
      setBusy(null);
    }
  };

  const idx = STAGES.indexOf(stage);
  const questions = match?.questions ?? [];
  const answered = questions.filter((q) => answers[q.id]).length;
  const current = questions[qi] ?? null;
  const groupOf = (id: number) => match?.groups.find((g) => g.id === id);
  const allRows = useMemo(() => new Map<number, { label: string; detail: string }>([
    ...donations.map((r): [number, { label: string; detail: string }] => [r.rowNo, { label: r.name, detail: `${money(r.amountCents)} · ${r.receivedOn}${r.phone ? ` · ${r.phone}` : ""}${r.address1 ? ` · ${r.address1}` : ""}` }]),
    ...people.map((r): [number, { label: string; detail: string }] => [r.rowNo, { label: `${r.firstName} ${r.lastName}`.trim(), detail: `${r.relationship ?? "member"}${r.phone ? ` · ${r.phone}` : ""}${r.email ? ` · ${r.email}` : ""}${r.address1 ? ` · ${r.address1}` : ""}` }]),
  ]), [donations, people]);
  const donationOnly = finalGroups.filter((g) => g.rows.every((n) => n < ROW_OFFSET.members)).length;
  const peopleOnly = finalGroups.filter((g) => g.rows.every((n) => n >= ROW_OFFSET.members)).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <ol className="flex flex-wrap gap-1.5 text-[12px]" aria-label="Steps">
        {STAGES.map((s, i) => (
          <li key={s} className={`rounded-full px-2.5 py-1 ${i === idx ? "bg-navy font-semibold text-white" : i < idx ? "bg-line text-ink" : "bg-panel text-muted"}`} aria-current={i === idx ? "step" : undefined}>
            {i + 1}. {STAGE_LABEL[s]}
          </li>
        ))}
      </ol>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      {stage === "welcome" ? (
        <Card title={`Let's set up ${centerName}`} description="We go one step at a time. Nothing is saved until you press Create at the end, and everything created can be undone.">
          <ol className="list-decimal space-y-1.5 pl-5 text-[14px]">
            <li>Past donations (optional): they establish your households.</li>
            <li>Your member list, matched to those households by phone, email and address.</li>
            <li>The rest of each family (optional).</li>
            <li>We group everyone into households and ask only when we are unsure.</li>
            <li>We create households, people and donation history. When a member first signs in, they add the rest of their own details.</li>
          </ol>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={buttonClass("primary")} onClick={() => setStage("donations")}>
              Start
            </button>
          </div>
        </Card>
      ) : null}

      {stage === "donations" ? (
        <DatasetStep
          key="donations"
          kind="donations"
          initial={donations.length ? { kind: "donations", rows: donations } : null}
          onBack={() => setStage("welcome")}
          onSkip={() => setStage("members")}
          onDone={(r) => {
            if (r.kind === "donations") setDonations(r.rows);
            setStage("members");
          }}
        />
      ) : null}

      {stage === "members" ? (
        <DatasetStep
          key="members"
          kind="members"
          initial={members.length ? { kind: "members", rows: members } : null}
          onBack={() => setStage("donations")}
          onSkip={donations.length ? () => setStage("family") : null}
          onDone={(r) => {
            if (r.kind !== "donations") setMembers(r.rows);
            setStage("family");
          }}
        />
      ) : null}

      {stage === "family" ? (
        <DatasetStep
          key="family"
          kind="family"
          initial={family.length ? { kind: "family", rows: family } : null}
          onBack={() => setStage("members")}
          onSkip={() => (donations.length + members.length > 0 ? startReview() : setError("Upload donations or members first."))}
          onDone={(r) => {
            if (r.kind !== "donations") setFamily(r.rows);
            // React applies the state after this handler, so build the match from the rows just uploaded.
            const fam = r.kind !== "donations" ? r.rows : [];
            setError(null);
            setMatch(matchPayers([...toPayerInputs(donations), ...[...members, ...fam].map(personToInput)]));
            setAnswers({});
            setQi(0);
            setStage("review");
          }}
        />
      ) : null}

      {stage === "review" && match ? (
        <Card
          title="Households"
          description={`${donations.length.toLocaleString("en-US")} donations and ${people.length.toLocaleString("en-US")} people are in ${finalGroups.length.toLocaleString("en-US")} households so far. ${match.autoLinks.toLocaleString("en-US")} links were made automatically from phone, email, address and family IDs.`}
        >
          {current ? (
            <div>
              <p className="text-[13px] text-muted">
                Question {qi + 1} of {questions.length} · {answered} answered
              </p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {[current.a, current.b].map((gid) => {
                  const g = groupOf(gid);
                  if (!g) return null;
                  return (
                    <div key={gid} className="rounded-lg border border-line p-3 text-[13px]">
                      <p className="font-semibold">{g.displayName}</p>
                      {g.names.length > 1 ? <p className="text-muted">Also written as: {g.names.filter((n) => n !== g.displayName).join("; ")}</p> : null}
                      <ul className="mt-1.5 space-y-0.5 text-muted">
                        {g.rows.slice(0, 3).map((n) => (
                          <li key={n}>
                            {allRows.get(n)?.label} · {allRows.get(n)?.detail}
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
            <p className="text-[14px]">{questions.length === 0 ? "No questions: every household was clear from your files." : "All questions answered."}</p>
          )}
          <div className="mt-5 flex gap-2 border-t border-line pt-3">
            <button type="button" className={buttonClass("ghost")} onClick={() => setStage("family")}>
              Back
            </button>
            <button type="button" className={buttonClass(current ? "off" : "primary")} disabled={Boolean(current)} onClick={() => setStage("confirm")}>
              Continue
            </button>
          </div>
        </Card>
      ) : null}

      {stage === "confirm" ? (
        <Card title="Create households, people and donations" description="Up to three numbered imports are made. Each can be opened and undone under Settings › Data import. Donations are history: they never post to QuickBooks.">
          <KpiGrid cols={4}>
            <Stat label="Households" value={finalGroups.length.toLocaleString("en-US")} />
            <Stat label="People" value={people.length.toLocaleString("en-US")} />
            <Stat label="Donations" value={donations.length.toLocaleString("en-US")} />
            <Stat label="Total given" value={money(donations.reduce((s, r) => s + r.amountCents, 0))} />
          </KpiGrid>
          {people.length > 0 && donations.length > 0 ? (
            <p className="crm-hint mt-2">
              {donationOnly.toLocaleString("en-US")} households have donations but no member yet; {peopleOnly.toLocaleString("en-US")} have members but no donation history.
            </p>
          ) : null}
          {progress.length > 0 ? (
            <ul className="mt-3 space-y-0.5 text-[13px]" aria-live="polite">
              {progress.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass("ghost")} disabled={Boolean(busy)} onClick={() => setStage("review")}>
              Back
            </button>
            <button type="button" className={buttonClass(busy ? "off" : "primary")} disabled={Boolean(busy)} onClick={() => void create()}>
              {busy ? "Creating…" : "Create"}
            </button>
          </div>
        </Card>
      ) : null}

      {stage === "done" && outcomes ? (
        <Card title={outcomes.households.stoppedFor || outcomes.people?.stoppedFor ? "Paused for your decision" : "Done"} description="Open a run to see every row, reconcile or undo it.">
          <ul className="space-y-2 text-[14px]">
            {([["Households", outcomes.households], ["People", outcomes.people], ["Donations", outcomes.payments]] as const).map(([label, o]) =>
              o ? (
                <li key={label}>
                  {label}: {o.created.toLocaleString("en-US")} created
                  {o.updated ? `, ${o.updated} updated` : ""}
                  {o.failed ? `, ${o.failed} failed` : ""}
                  {o.stoppedFor ? ` — stopped: ${o.stoppedFor}` : ""} ·{" "}
                  <Link className="crm-link" href={`/settings/import/${o.runId}`}>
                    import #{o.runNumber}
                  </Link>
                </li>
              ) : null,
            )}
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

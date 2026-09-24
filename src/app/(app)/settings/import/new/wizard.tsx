"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type ChangeEvent } from "react";

import { useToast } from "@/components/toast";
import { Alert, Card, KpiGrid, Stat, buttonClass } from "@/components/ui";
import { parseCsv } from "@/lib/csv";
import {
  CUSTOM_TYPES,
  autoMap,
  buildRow,
  duplicateKeys,
  missingRequired,
  summarize,
  type ColumnTarget,
  type CustomType,
  type Mapping,
  type StagedRow,
} from "@/lib/import/mapping";
import { ENTITIES, TIER_LABEL, entityDef, type EntityDef, type Tier } from "@/lib/import/registry";
import { problemRowsCsv } from "@/lib/import/templates";
import { cleanText, toEnum } from "@/lib/import/transforms";

import {
  aiMappingResultAction,
  defineCustomFieldsAction,
  previewAction,
  requestAiMappingAction,
  saveMappingAction,
  stageRowsAction,
  startImportAction,
  type AiState,
  type AiSuggestion,
  type StartResult,
} from "../actions";
import { ImportSteps, type ImportStep } from "../steps";

export type SavedMapping = { source: string; entity: string; mapping: { columns: Record<string, ColumnTarget>; valueMaps?: Record<string, Record<string, string>>; options?: Partial<Mapping["options"]> } };

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ROWS = 50000;
const CHUNK = 250;

type Parsed = { fileName: string; size: number; fingerprint: string; headers: string[]; rows: string[][] };

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readFile(file: File): Promise<Parsed> {
  const buf = await file.arrayBuffer();
  const fingerprint = await sha256(buf);
  let table: string[][];
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    // Numbers come back as the text Excel stored, so nothing is rounded.
    const data = await readSheet(file, { parseNumber: (s: string) => s });
    table = data.map((r) => r.map(cellText));
  } else if (/\.xls$/i.test(file.name)) {
    throw new Error("Old .xls files cannot be read. Save it as .xlsx or .csv and upload that.");
  } else {
    table = parseCsv(new TextDecoder("utf-8").decode(buf));
  }
  const nonEmpty = table.filter((r) => r.some((c) => cleanText(c) !== ""));
  if (nonEmpty.length === 0) throw new Error("The file is empty.");
  const headers = nonEmpty[0].map((h, i) => cleanText(h) || `Column ${i + 1}`);
  const width = Math.max(headers.length, ...nonEmpty.map((r) => r.length));
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  const rows = nonEmpty.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  return { fileName: file.name, size: file.size, fingerprint, headers, rows };
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const TIERS: Tier[] = ["setup", "records", "history"];

export function ImportWizard({
  allowed,
  initialEntity,
  saved,
  today,
  legacySystems,
}: {
  allowed: string[];
  initialEntity: string | null;
  saved: SavedMapping[];
  today: string;
  legacySystems: { system: string; label: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState<ImportStep>("Upload");
  const [entityKey, setEntityKey] = useState<string>(initialEntity && allowed.includes(initialEntity) ? initialEntity : "");
  const [source, setSource] = useState("");
  const [crmSystem, setCrmSystem] = useState(legacySystems[0]?.system ?? "");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<StartResult | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [saveMapping, setSaveMapping] = useState(true);
  const [ai, setAi] = useState<AiState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const entity = entityKey ? entityDef(entityKey) : undefined;
  const sources = useMemo(() => saved.filter((s) => s.entity === entityKey), [saved, entityKey]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setError(null);
    setParsed(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 20 MB. Split it into smaller files (a top-up import of the rest is safe).");
      return;
    }
    setReading(true);
    try {
      const p = await readFile(file);
      if (p.rows.length > MAX_ROWS) throw new Error(`The file has ${p.rows.length.toLocaleString()} rows; split it into files of at most ${MAX_ROWS.toLocaleString()}.`);
      if (p.rows.length === 0) throw new Error("The file has a header row but no data rows.");
      setParsed(p);
    } catch (err) {
      console.error("[import] reading the file failed:", err);
      setError(`Could not read that file — ${err instanceof Error ? err.message : "it is not a CSV or Excel (.xlsx) file"}.`);
    } finally {
      setReading(false);
    }
  }

  async function startMapping() {
    if (!entity || !parsed) return;
    setError(null);
    setBusy("Starting…");
    try {
      const res = await startImportAction({
        entity: entity.key,
        source: source.trim() || "csv",
        fileName: parsed.fileName,
        fingerprint: parsed.fingerprint,
        fileSize: parsed.size,
        crmSystem,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRun(res.data!);
      const savedFor = sources.find((s) => s.source.toLowerCase() === source.trim().toLowerCase());
      setMapping(autoMap(entity.key, parsed.headers, parsed.rows.slice(0, 200), savedFor?.mapping ?? null, { crmSystem }));
      setAi(null);
      setStep("Map");
    } catch (err) {
      console.error("[import] start failed:", err);
      setError("Could not start the import — the server did not respond. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function setColumn(i: number, t: ColumnTarget) {
    if (!mapping) return;
    const columns = mapping.columns.map((c, j) => {
      if (j === i) return t;
      // A field is used by one column only.
      if (t.kind === "field" && c.kind === "field" && c.field === t.field) return { kind: "skip" } as ColumnTarget;
      return c;
    });
    setMapping({ ...mapping, columns });
  }

  async function askAi() {
    if (!entity || !parsed || !run || !mapping) return;
    setBusy("Asking for suggestions…");
    setAi(null);
    try {
      const unmapped = parsed.headers.filter((_, i) => mapping.columns[i]?.kind !== "field");
      const res = await requestAiMappingAction({ runId: run.runId, entity: entity.key, headers: parsed.headers, sampleRows: parsed.rows.slice(0, 20), unmapped });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      let state = res.data!;
      // Poll the background job for up to a minute.
      for (let i = 0; i < 30 && (state.status === "queued" || state.status === "running"); i++) {
        setAi(state);
        await new Promise((r) => setTimeout(r, 2000));
        const next = await aiMappingResultAction({ runId: run.runId, entity: entity.key });
        if (!next.ok) {
          setError(next.error);
          return;
        }
        state = next.data!;
      }
      if (state.status === "queued" || state.status === "running") {
        state = { status: "failed", reason: "The background service has not answered within a minute. Map the columns by hand, or ask again later." };
      }
      setAi(state);
    } catch (err) {
      console.error("[import] AI suggestion failed:", err);
      setAi({ status: "failed", reason: "The server did not respond." });
    } finally {
      setBusy(null);
    }
  }

  function applySuggestion(s: AiSuggestion) {
    if (!parsed || !s.field) return;
    const i = parsed.headers.findIndex((h) => h === s.header);
    if (i >= 0) setColumn(i, { kind: "field", field: s.field });
  }

  const checked: StagedRow[] = useMemo(() => {
    if (step !== "Check" || !entity || !parsed || !mapping) return [];
    return parsed.rows.map((r, i) => buildRow(entity.key, mapping, parsed.headers, r, i + 2, today));
  }, [step, entity, parsed, mapping, today]);

  async function stageAll() {
    if (!entity || !parsed || !mapping || !run) return;
    setError(null);
    setBusy("Keeping extra columns…");
    try {
      const def = await defineCustomFieldsAction({ runId: run.runId, entity: entity.key, mapping });
      if (!def.ok) {
        setError(def.error);
        return;
      }
      const m = def.data!;
      setMapping(m);
      const total = parsed.rows.length;
      setProgress({ done: 0, total });
      setBusy("Checking rows on the server…");
      for (let start = 0; start < total; start += CHUNK) {
        const rows = parsed.rows.slice(start, start + CHUNK).map((cells, j) => ({ rowNo: start + j + 2, cells }));
        const res = await stageRowsAction({ runId: run.runId, entity: entity.key, headers: parsed.headers, mapping: m, rows, first: start === 0 });
        if (!res.ok) {
          setError(`${res.error} (rows ${start + 2}–${start + rows.length + 1}; nothing has been imported yet — fix it and continue).`);
          return;
        }
        setProgress({ done: Math.min(total, start + CHUNK), total });
      }
      if (saveMapping && source.trim()) {
        const s = await saveMappingAction({ entity: entity.key, source: source.trim(), headers: parsed.headers, mapping: m });
        if (!s.ok) toast?.show(s.error, "bad");
      }
      setBusy("Building the preview…");
      const p = await previewAction(run.runId);
      if (!p.ok) {
        setError(p.error);
        return;
      }
      router.push(`/settings/import/${run.runId}`);
    } catch (err) {
      console.error("[import] staging failed:", err);
      setError("Could not check the rows — the server did not respond. Nothing has been imported; try again.");
    } finally {
      setBusy(null);
    }
  }

  const header = <ImportSteps current={step} />;
  const errorBox = error ? (
    <div className="mb-3">
      <Alert tone="danger">{error}</Alert>
    </div>
  ) : null;

  // ── Upload ────────────────────────────────────────────────────────────────
  if (step === "Upload") {
    return (
      <>
        {header}
        {errorBox}
        <Card title="Upload a file" description="A CSV or Excel (.xlsx) file: your own export, or one of the templates. Nothing is imported until you confirm the preview.">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="imp-entity" className="crm-label">
                What is in the file?
              </label>
              <select id="imp-entity" className="crm-input" value={entityKey} onChange={(e) => setEntityKey(e.target.value)}>
                <option value="">Choose the kind of data…</option>
                {TIERS.map((t) => (
                  <optgroup key={t} label={TIER_LABEL[t]}>
                    {[...ENTITIES]
                      .filter((e) => e.tier === t && allowed.includes(e.key))
                      .sort((a, b) => a.order - b.order)
                      .map((e) => (
                        <option key={e.key} value={e.key}>
                          {e.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              {entity ? <p className="crm-hint">{entity.description}</p> : null}
            </div>
            <div>
              <label htmlFor="imp-source" className="crm-label">
                Where it came from
              </label>
              <input
                id="imp-source"
                className="crm-input"
                list="imp-sources"
                placeholder="For example: Neon export"
                value={source}
                maxLength={80}
                onChange={(e) => setSource(e.target.value)}
              />
              <datalist id="imp-sources">
                {sources.map((s) => (
                  <option key={s.source} value={s.source} />
                ))}
              </datalist>
              <p className="crm-hint">A saved mapping for this source is used automatically next time.</p>
            </div>
            {entity && (entity.key === "people" || entity.key === "households") ? (
              <div>
                <label htmlFor="imp-crm" className="crm-label">
                  Legacy CRM system (for the “Legacy CRM ID” column)
                </label>
                <input id="imp-crm" className="crm-input" list="imp-crms" value={crmSystem} onChange={(e) => setCrmSystem(e.target.value)} placeholder="neon" />
                <datalist id="imp-crms">
                  {legacySystems.map((s) => (
                    <option key={s.system} value={s.system}>
                      {s.label}
                    </option>
                  ))}
                </datalist>
              </div>
            ) : null}
            <div>
              <label htmlFor="imp-file" className="crm-label">
                File (.csv or .xlsx)
              </label>
              <input id="imp-file" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="crm-input py-2" />
              {entity ? (
                <p className="crm-hint">
                  Templates:{" "}
                  <a className="crm-link" href={`/settings/import/template/${entity.key}?format=csv`}>
                    CSV
                  </a>{" "}
                  ·{" "}
                  <a className="crm-link" href={`/settings/import/template/${entity.key}?format=xlsx`}>
                    Excel
                  </a>{" "}
                  ·{" "}
                  <a className="crm-link" href={`/settings/import/template/${entity.key}?format=dictionary`}>
                    column dictionary
                  </a>
                </p>
              ) : null}
            </div>
          </div>
          {reading ? <p className="mt-3 text-[13px] text-muted">Reading the file…</p> : null}
          {parsed ? (
            <p className="mt-3 text-[13px]">
              <strong>{parsed.fileName}</strong>: {parsed.rows.length.toLocaleString()} rows, {parsed.headers.length} columns.
            </p>
          ) : null}
          {entity?.note ? (
            <div className="mt-3">
              <Alert tone="info">{entity.note}</Alert>
            </div>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass(entity && parsed && !busy ? "primary" : "off")} disabled={!entity || !parsed || Boolean(busy)} onClick={startMapping}>
              {busy ?? "Next: map the columns"}
            </button>
          </div>
        </Card>
      </>
    );
  }

  if (!entity || !parsed || !mapping || !run) return null;

  // ── Map ───────────────────────────────────────────────────────────────────
  if (step === "Map") {
    const missing = missingRequired(entity, mapping);
    const enumIssues = enumProblems(entity, parsed, mapping);
    return (
      <>
        {header}
        {errorBox}
        <p className="mb-3 text-[13px] text-muted">
          Import #{run.runNumber} · {parsed.fileName}
          {run.previousRunNumber ? ` · a top-up of import #${run.previousRunNumber} (same source): existing records update, nothing is added twice` : ""}
          {run.sameFileRunNumber ? ` · this exact file was imported before as #${run.sameFileRunNumber}` : ""}
        </p>
        <Card
          title="Map the columns"
          description="Columns are matched by name first. Confirm every match. A column with no match is kept as a custom field, so nothing is silently dropped."
          actions={
            <button type="button" className={buttonClass("ghost", "sm")} onClick={askAi} disabled={Boolean(busy)}>
              {busy === "Asking for suggestions…" ? busy : "Suggest matches with AI"}
            </button>
          }
          padded={false}
        >
          <div className="px-[18px] pb-2">
            <AiNotice ai={ai} entity={entity} onUse={applySuggestion} />
          </div>
          <div className="overflow-x-auto">
            <table className="crm-table">
              <thead>
                <tr>
                  <th scope="col">Column in your file</th>
                  <th scope="col">Sample values</th>
                  <th scope="col">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((h, i) => {
                  const t = mapping.columns[i];
                  const samples = [...new Set(parsed.rows.map((r) => cleanText(r[i])).filter(Boolean))].slice(0, 3);
                  const value = t.kind === "field" ? `field:${t.field}` : t.kind;
                  return (
                    <tr key={`${h}-${i}`}>
                      <td className="font-semibold">{h}</td>
                      <td className="max-w-[280px] truncate text-muted">{samples.join(" · ") || "(empty)"}</td>
                      <td>
                        <select
                          aria-label={`Where "${h}" goes`}
                          className="crm-input"
                          value={value}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "skip") setColumn(i, { kind: "skip" });
                            else if (v === "custom") setColumn(i, { kind: "custom", label: h, type: "text" });
                            else setColumn(i, { kind: "field", field: v.slice(6) });
                          }}
                        >
                          <optgroup label={entity.label}>
                            {entity.fields.map((f) => (
                              <option key={f.key} value={`field:${f.key}`}>
                                {f.label}
                                {f.required ? " (required)" : ""}
                              </option>
                            ))}
                          </optgroup>
                          <option value="custom">Keep as a custom field</option>
                          <option value="skip">Skip this column</option>
                        </select>
                        {t.kind === "custom" ? (
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            <input
                              aria-label={`Custom field name for "${h}"`}
                              className="crm-input max-w-[200px]"
                              value={t.label}
                              maxLength={120}
                              onChange={(e) => setColumn(i, { ...t, label: e.target.value, key: undefined })}
                            />
                            <select
                              aria-label={`Custom field type for "${h}"`}
                              className="crm-input max-w-[160px]"
                              value={t.type}
                              onChange={(e) => {
                                const type = e.target.value as CustomType;
                                const choices = type === "choice" ? [...new Set(parsed.rows.map((r) => cleanText(r[i])).filter(Boolean))].slice(0, 50) : undefined;
                                setColumn(i, { ...t, type, choices });
                              }}
                            >
                              {CUSTOM_TYPES.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                            <span className="self-center text-[12px] text-muted">Staff-only until reviewed in Settings › Custom fields</span>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 px-[18px] pb-4 pt-3">
            {enumIssues.map((p) => (
              <div key={p.field} className="rounded-[10px] border border-line p-3">
                <p className="text-[13px] font-bold">Translate your words for {p.label}</p>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {p.values.map((v) => (
                    <label key={v} className="flex items-center gap-2 text-[13px]">
                      <span className="min-w-[140px]">“{v}” means</span>
                      <select
                        className="crm-input"
                        value={mapping.valueMaps[p.field]?.[v] ?? ""}
                        onChange={(e) =>
                          setMapping({
                            ...mapping,
                            valueMaps: { ...mapping.valueMaps, [p.field]: { ...(mapping.valueMaps[p.field] ?? {}), [v]: e.target.value } },
                          })
                        }
                      >
                        <option value="">(not recognised — the row gets a problem)</option>
                        {p.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label htmlFor="imp-dates" className="crm-label">
                  Dates like 03/04/2020 are
                </label>
                <select
                  id="imp-dates"
                  className="crm-input"
                  value={mapping.options.dateOrder}
                  onChange={(e) => setMapping({ ...mapping, options: { ...mapping.options, dateOrder: e.target.value === "dmy" ? "dmy" : "mdy" } })}
                >
                  <option value="mdy">month/day/year (US)</option>
                  <option value="dmy">day/month/year</option>
                </select>
              </div>
              <label className="flex min-h-11 items-center gap-2 text-[13px]">
                <input type="checkbox" className="h-5 w-5" checked={saveMapping} onChange={(e) => setSaveMapping(e.target.checked)} />
                Save this mapping for “{source.trim() || "this source"}”
              </label>
            </div>
            {missing.length > 0 ? (
              <Alert tone="warning">Map a column to each required field first: {missing.map((f) => f.label).join(", ")}.</Alert>
            ) : null}
            <div className="flex gap-2">
              <button type="button" className={buttonClass("ghost")} onClick={() => setStep("Upload")}>
                Back
              </button>
              <button type="button" className={buttonClass(missing.length ? "off" : "primary")} disabled={missing.length > 0} onClick={() => setStep("Check")}>
                Next: check every row
              </button>
            </div>
          </div>
        </Card>
      </>
    );
  }

  // ── Check ─────────────────────────────────────────────────────────────────
  const sum = summarize(checked);
  const dups = duplicateKeys(checked);
  const problems = checked.filter((r) => r.problems.length > 0);
  const customCount = mapping.columns.filter((c) => c.kind === "custom").length;
  return (
    <>
      {header}
      {errorBox}
      <Card title="Check every row" description="Errors stop a row; warnings don't. Fix problem rows in your file and upload it again, or continue without them.">
        <KpiGrid cols={4}>
          <Stat label="Rows in the file" value={sum.rows.toLocaleString()} />
          <Stat label="Ready" value={sum.ready.toLocaleString()} tone="success" />
          <Stat label="Blocked by an error" value={sum.blocked.toLocaleString()} tone={sum.blocked ? "danger" : "ink"} />
          <Stat label="Warnings" value={sum.warnings.toLocaleString()} tone={sum.warnings ? "brown" : "ink"} />
        </KpiGrid>
        {customCount > 0 ? (
          <p className="mt-3 text-[13px]">
            {customCount} column{customCount === 1 ? "" : "s"} will be kept as custom field{customCount === 1 ? "" : "s"} on {entity.label.toLowerCase()} (staff-only until reviewed).
          </p>
        ) : null}
        {dups.size > 0 ? (
          <p className="mt-2 text-[13px] text-brown">
            {dups.size} ID{dups.size === 1 ? " appears" : "s appear"} more than once in the file; the later row updates the earlier one (e.g. rows {[...dups.values()][0].join(", ")}).
          </p>
        ) : null}
        {problems.length > 0 ? (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonClass("ghost", "sm")}
                onClick={() => download(`${parsed.fileName.replace(/\.[^.]+$/, "")}-problem-rows.csv`, problemRowsCsv(parsed.headers, problems))}
              >
                Download the problem rows
              </button>
              <span className="text-[12px] text-muted">The original rows with what is wrong, to fix and upload again.</span>
            </div>
            <div className="mt-2 max-h-[360px] overflow-auto">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Column</th>
                    <th scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.slice(0, 300).flatMap((r) =>
                    r.problems.map((p, j) => (
                      <tr key={`${r.row_no}-${j}`}>
                        <td className="font-mono">{r.row_no}</td>
                        <td>{p.column ?? "—"}</td>
                        <td>
                          <span className={p.level === "error" ? "cc-status-bad" : "cc-status-warn"}>{p.level === "error" ? "Error" : "Warning"}</span> {p.message}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-3 text-[13px] text-success">No problems found.</p>
        )}
        {progress ? (
          <div className="mt-3" role="status">
            <progress className="w-full" max={progress.total} value={progress.done} />
            <p className="text-[12px] text-muted">
              {progress.done.toLocaleString()} of {progress.total.toLocaleString()} rows checked on the server
            </p>
          </div>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button type="button" className={buttonClass("ghost")} onClick={() => setStep("Map")} disabled={Boolean(busy)}>
            Back
          </button>
          <button type="button" className={buttonClass(sum.ready && !busy ? "primary" : "off")} disabled={!sum.ready || Boolean(busy)} onClick={stageAll}>
            {busy ?? `Next: preview ${sum.ready.toLocaleString()} row${sum.ready === 1 ? "" : "s"}`}
          </button>
        </div>
      </Card>
    </>
  );
}

/** Enum columns whose values don't translate on their own: the person says what each means. */
function enumProblems(entity: EntityDef, parsed: Parsed, mapping: Mapping) {
  const out: { field: string; label: string; values: string[]; options: readonly { value: string; label: string }[] }[] = [];
  mapping.columns.forEach((t, i) => {
    if (t.kind !== "field") return;
    const f = entity.fields.find((x) => x.key === t.field);
    if (!f || f.type !== "enum" || !f.options) return;
    const values = [...new Set(parsed.rows.map((r) => cleanText(r[i])).filter(Boolean))];
    const unknown = values.filter((v) => !toEnum(v, f.options!, f.valueMap ?? {}).ok);
    if (unknown.length) out.push({ field: f.key, label: f.label, values: unknown.slice(0, 20), options: f.options });
  });
  return out;
}

function AiNotice({ ai, entity, onUse }: { ai: AiState | null; entity: EntityDef; onUse: (s: AiSuggestion) => void }) {
  if (!ai || ai.status === "none") return null;
  if (ai.status === "unavailable") {
    return <Alert tone="info">AI suggestions are not available: {ai.reason} Only name-based matching ran; confirm the columns by hand.</Alert>;
  }
  if (ai.status === "failed") return <Alert tone="warning">No AI suggestions this time — {ai.reason} Only name-based matching ran.</Alert>;
  if (ai.status === "queued" || ai.status === "running") return <p className="text-[13px] text-muted">Waiting for suggestions (headers and masked samples only)…</p>;
  if (ai.status !== "done") return null;
  const useful = ai.suggestions.filter((s) => s.field && entity.fields.some((f) => f.key === s.field));
  if (useful.length === 0) return <Alert tone="info">The AI found no further matches. Unmatched columns stay custom fields.</Alert>;
  return (
    <div className="rounded-[10px] border border-line p-3">
      <p className="text-[13px] font-bold">Suggested matches — confirm each one</p>
      <ul className="mt-2 space-y-1.5 text-[13px]">
        {useful.map((s) => (
          <li key={s.header} className="flex flex-wrap items-center gap-2">
            <span>
              “{s.header}” → <strong>{entity.fields.find((f) => f.key === s.field)?.label ?? s.field}</strong> ({Math.round(s.confidence * 100)}%) — {s.reason}
            </span>
            <button type="button" className={buttonClass("ghost", "xs")} onClick={() => onUse(s)}>
              Use
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}


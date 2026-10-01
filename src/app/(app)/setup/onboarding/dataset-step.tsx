"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import { Alert, Card, KpiGrid, Stat, buttonClass } from "@/components/ui";
import { parseCsv } from "@/lib/csv";
import { toCsv } from "@/lib/import/templates";
import { cleanText } from "@/lib/import/transforms";
import { PAYER_FIELDS, autoMapColumns, missingRequired, validateDonations, type MethodValue, type ParsedDonation } from "@/lib/onboarding/donations";
import { normHeader } from "@/lib/import/mapping";
import { PERSON_FIELDS, autoMapPersonColumns, missingPersonFields, validatePeople, type ParsedPerson } from "@/lib/onboarding/people";
import type { Dataset, DatasetMeta } from "@/lib/onboarding/progress";

const MAX_BYTES = 20 * 1024 * 1024;

export type Parsed = { fileName: string; size: number; headers: string[]; rows: string[][] };

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

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Row numbers of each list are kept apart so a household's rows can come from several files. */
export const ROW_OFFSET: Record<Dataset, number> = { donations: 0, members: 1_000_000, family: 2_000_000 };

export type Result = { kind: "donations"; rows: ParsedDonation[] } | { kind: "members" | "family"; rows: ParsedPerson[] };
type Problem = { rowNo: number; column: string; level: "error" | "warning"; message: string };
type Sub = "upload" | "map" | "check";

const KIND_TEXT: Record<Dataset, { title: string; intro: string; templateKind: "donations" | "people"; hint: string }> = {
  donations: {
    title: "Past donations",
    intro: "Upload your past donations or invoices (optional): from QuickBooks, Neon, your bank or a spreadsheet. These establish your households.",
    templateKind: "donations",
    hint: "Required: payer name, amount, date. Phone, email and address are optional but let us match the same family without asking you.",
  },
  members: {
    title: "Members",
    intro: "Upload your member list. Each person is matched to the households from your donations, and to the households you already have, by phone, email and address.",
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

/** The same columns as last time: reuse the saved choices when the file has exactly those headers. */
function sameHeaders(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return Boolean(a) && a!.length === b.length && a!.every((h, i) => normHeader(h) === normHeader(b[i]!));
}

export function DatasetStep({
  kind,
  initial,
  meta,
  blocked,
  onMeta,
  onSave,
  onKeep,
  onSkip,
  onBack,
}: {
  kind: Dataset;
  /** Checked rows already saved (from an earlier visit or upload). */
  initial: Result | null;
  /** What was saved about this list: its file, its column choices, whether it was skipped. */
  meta: DatasetMeta | undefined;
  /** Why this list cannot be loaded at all (switched-off module, missing permission); null when it can. */
  blocked: string | null;
  /** The file chosen and the column choices so far (kept, so a return visit remembers them). */
  onMeta: (m: DatasetMeta) => void;
  /** Save the checked rows and go on. Throws when they could not be saved. */
  onSave: (r: Result, m: DatasetMeta, progress: (text: string) => void) => Promise<void>;
  /** Go on with the rows that are already saved. */
  onKeep: () => void;
  onSkip: (() => void) | null;
  onBack: () => void;
}) {
  const t = KIND_TEXT[kind];
  const [sub, setSub] = useState<Sub>("upload");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [dateOrder, setDateOrder] = useState<"mdy" | "dmy">(meta?.dateOrder ?? "mdy");
  const [defaultMethod, setDefaultMethod] = useState<MethodValue>((meta?.defaultMethod as MethodValue | undefined) ?? "check");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Moving from upload to mapping to checking replaces the card: keep the keyboard with the new heading.
  const top = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);
  useEffect(() => {
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    const h = top.current?.querySelector<HTMLElement>("h2");
    if (h) {
      h.tabIndex = -1;
      h.focus();
    }
  }, [sub]);

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

  const metaOf = (p: Parsed, c: string[], order: "mdy" | "dmy", method: MethodValue): DatasetMeta => ({
    status: "mapping",
    fileName: p.fileName,
    fileRows: p.rows.length,
    headers: p.headers,
    choices: c,
    dateOrder: order,
    ...(kind === "donations" ? { defaultMethod: method } : {}),
  });

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
      // The same columns as before: the choices made last time are reused (and can still be changed).
      const again = sameHeaders(meta?.headers, p.headers) && meta?.choices?.length === p.headers.length;
      const c = again ? [...meta!.choices!] : kind === "donations" ? autoMapColumns(p.headers, p.rows.slice(0, 200)) : autoMapPersonColumns(p.headers, p.rows.slice(0, 200));
      const order = again && meta?.dateOrder ? meta.dateOrder : dateOrder;
      const method = again && meta?.defaultMethod ? (meta.defaultMethod as MethodValue) : defaultMethod;
      setParsed(p);
      setChoices(c);
      setDateOrder(order);
      setDefaultMethod(method);
      setSub("map");
      onMeta(metaOf(p, c, order, method));
    } catch (err) {
      console.error("[onboarding] could not read the file:", err instanceof Error ? err.message : "unreadable file");
      setError(`Could not read that file — ${err instanceof Error ? err.message : "it is not a CSV or Excel (.xlsx) file"}.`);
    }
  };

  const methodMapped = choices.includes("method");

  const save = async (r: Result) => {
    if (!parsed) return;
    setError(null);
    setSaving("Saving your rows…");
    try {
      await onSave(r, { ...metaOf(parsed, choices, dateOrder, defaultMethod), status: "loaded", rows: r.rows.length, badRows: result?.badRows.size ?? 0 }, setSaving);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your rows — something went wrong.");
    } finally {
      setSaving(null);
    }
  };

  if (blocked) {
    return (
      <Card title={t.title} description={t.intro}>
        <Alert tone="warning">{blocked}</Alert>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={buttonClass("ghost")} onClick={onBack}>
            Back
          </button>
          {onSkip ? (
            <button type="button" className={buttonClass("primary")} onClick={onSkip}>
              Skip this step
            </button>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <div ref={top} className="space-y-3">
      {error ? (
        <Alert
          tone="danger"
          action={
            sub === "check" && result ? (
              <button type="button" className={buttonClass("bad", "xs")} disabled={Boolean(saving)} onClick={() => void save(kind === "donations" ? { kind: "donations", rows: result.rows as ParsedDonation[] } : { kind, rows: result.rows as ParsedPerson[] })}>
                Try again
              </button>
            ) : null
          }
        >
          {error}
        </Alert>
      ) : null}
      {sub === "upload" ? (
        <Card title={t.title} description={t.intro}>
          {initial && initial.rows.length > 0 ? (
            <Alert tone="success">
              {initial.rows.length.toLocaleString("en-US")} checked rows{meta?.fileName ? ` from ${meta.fileName}` : ""} are saved. Upload a file again to replace them, or continue with them.
            </Alert>
          ) : meta?.status === "mapping" ? (
            <Alert tone="info">
              Last time you chose {meta.fileName ?? "a file"}
              {meta.fileRows ? ` (${meta.fileRows.toLocaleString("en-US")} rows)` : ""} but did not finish checking it. Upload it again and your column choices are reused.
            </Alert>
          ) : meta?.status === "skipped" ? (
            <Alert tone="info">You skipped this step last time. Upload a file if you want it after all.</Alert>
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
              <button type="button" className={buttonClass("primary")} onClick={onKeep}>
                Continue with the saved rows
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
            <button
              type="button"
              className={buttonClass(missing.length ? "off" : "primary")}
              disabled={missing.length > 0}
              onClick={() => {
                onMeta(metaOf(parsed, choices, dateOrder, defaultMethod));
                setSub("check");
              }}
            >
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
          {saving ? (
            <p className="mt-3 text-[13px]" role="status" aria-live="polite">
              {saving}
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button type="button" className={buttonClass("ghost")} disabled={Boolean(saving)} onClick={() => setSub("map")}>
              Back
            </button>
            <button
              type="button"
              className={buttonClass(result.rows.length && !saving ? "primary" : "off")}
              disabled={result.rows.length === 0 || Boolean(saving)}
              aria-busy={Boolean(saving)}
              onClick={() => void save(kind === "donations" ? { kind: "donations", rows: result.rows as ParsedDonation[] } : { kind, rows: result.rows as ParsedPerson[] })}
            >
              {saving ? "Saving…" : "Continue"}
            </button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

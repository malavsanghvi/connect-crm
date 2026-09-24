"use client";

import { useState, useTransition, type ChangeEvent } from "react";

import { buttonClass } from "@/components/ui";
import { parseBankStatementCsv, type BankCsvParse } from "@/lib/csv";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";

import { importBankLinesAction, type ImportResult } from "./actions";

const FORMAT_LABEL = { chase_csv: "Chase checking CSV", generic_csv: "Generic CSV (date, amount, description)" };

export function BankImport({
  bankAccountId,
  accountName,
  expectedFormat,
  currency,
}: {
  bankAccountId: string;
  accountName: string;
  expectedFormat: string;
  currency: string;
}) {
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [includeDebits, setIncludeDebits] = useState(false);
  const [parsed, setParsed] = useState<BankCsvParse | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ message: string; data: ImportResult } | null>(null);
  const [pending, startTransition] = useTransition();

  function reparse(content: string, debits: boolean) {
    setParsed(parseBankStatementCsv(content, { includeDebits: debits }));
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    setReadError(null);
    setError(null);
    setResult(null);
    setParsed(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setReadError("That file is larger than 10 MB. Export a shorter date range from the bank.");
      return;
    }
    try {
      const content = await file.text();
      setFileName(file.name);
      setText(content);
      reparse(content, includeDebits);
    } catch (err) {
      console.error("[bank import] reading the file failed:", err);
      setReadError("Could not read that file. Make sure it is the CSV downloaded from the bank.");
    }
  }

  function submit() {
    if (!parsed || parsed.rows.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await importBankLinesAction({ bankAccountId, fileName, lines: parsed.rows });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setResult({ message: res.message ?? "Imported.", data: res.data! });
        setParsed(null);
        setText(null);
      } catch (err) {
        console.error("[bank import] import failed:", err);
        setError("Could not import the statement — the server did not respond. Import the same file again; lines already saved are skipped.");
      }
    });
  }

  const credits = parsed ? parsed.rows.filter((r) => r.amount_cents > 0) : [];
  const debits = parsed ? parsed.rows.filter((r) => r.amount_cents < 0) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="stmt-file" className="crm-label">
            Statement file (.csv) for {accountName}
          </label>
          <input id="stmt-file" type="file" accept=".csv,text/csv" onChange={onFile} className="crm-input py-2" />
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDebits}
            onChange={(e) => {
              setIncludeDebits(e.target.checked);
              if (text) reparse(text, e.target.checked);
            }}
            className="h-5 w-5"
          />
          Also import money out (debits)
        </label>
      </div>
      {readError ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
          {readError}
        </p>
      ) : null}

      {parsed ? (
        <div className="rounded-lg border border-line bg-subtle/50 px-4 py-3 text-sm">
          <p>
            <span className="font-semibold">Detected format:</span> {FORMAT_LABEL[parsed.format]}
            {expectedFormat && expectedFormat !== parsed.format ? (
              <span className="ml-2 text-brown">
                (this account is set up for {FORMAT_LABEL[expectedFormat as keyof typeof FORMAT_LABEL] ?? expectedFormat} — check you picked the right file)
              </span>
            ) : null}
          </p>
          <p className="mt-1">
            {parsed.rows.length} line{parsed.rows.length === 1 ? "" : "s"} ready
            {parsed.rows.length > 0 ? ` — ${credits.length} money in (${formatCents(credits.reduce((s, r) => s + r.amount_cents, 0), currency)})` : ""}
            {debits.length > 0 ? `, ${debits.length} money out` : ""}
            {parsed.periodStart ? `, ${formatDate(parsed.periodStart, "UTC")} to ${formatDate(parsed.periodEnd, "UTC")}` : ""}.
            {parsed.skippedDebits > 0 && !includeDebits ? ` ${parsed.skippedDebits} money-out line${parsed.skippedDebits === 1 ? "" : "s"} left out.` : ""}
          </p>
          {parsed.errors.length > 0 ? (
            <div className="mt-2 text-danger" role="alert">
              <p className="font-semibold">
                {parsed.errors.length} line{parsed.errors.length === 1 ? "" : "s"} could not be read and will be skipped:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {parsed.errors.slice(0, 8).map((e) => (
                  <li key={`${e.row}-${e.message}`}>{e.row > 0 ? `Row ${e.row}: ${e.message}` : e.message}</li>
                ))}
                {parsed.errors.length > 8 ? <li>…and {parsed.errors.length - 8} more</li> : null}
              </ul>
            </div>
          ) : null}
          {parsed.rows.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-semibold text-navy">Preview the first lines</summary>
              <table className="crm-table mt-2">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">Amount</th>
                    <th>Description</th>
                    {parsed.format === "chase_csv" ? <th>Type</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 10).map((r) => (
                    <tr key={r.row}>
                      <td>{formatDate(r.posted_on, "UTC")}</td>
                      <td className="num">{formatCents(r.amount_cents, currency)}</td>
                      <td className="max-w-md truncate">{r.description}</td>
                      {parsed.format === "chase_csv" ? <td className="font-mono text-xs">{r.bank_type ?? "—"}</td> : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
          <button type="button" onClick={submit} disabled={pending || parsed.rows.length === 0} className={`${buttonClass("primary")} mt-3`}>
            {pending ? "Importing…" : `Import ${parsed.rows.length} line${parsed.rows.length === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {result ? (
        <div role="status" className="rounded-lg border border-success/30 bg-success-50 px-3 py-2 text-sm text-success">
          <p className="font-semibold">{result.message}</p>
          {result.data.duplicates > 0 ? (
            <p>{result.data.duplicates} line{result.data.duplicates === 1 ? " was" : "s were"} already imported from an earlier statement and skipped.</p>
          ) : null}
          {result.data.failed.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-danger">
              {result.data.failed.slice(0, 8).map((f) => (
                <li key={`${f.row}-${f.reason}`}>
                  Row {f.row}: {f.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";

import { useToast } from "@/components/toast";
import { buttonClass, Card, EmptyState, StatusText, TableWrap } from "@/components/ui";
import { parseBoliUploadCsv, uploadTemplateCsv, type CheckedRow } from "@/lib/bolis";
import { formatCents } from "@/lib/money";

import { importBoliUploadAction, validateBoliUploadAction, type ImportOutcome } from "../actions";

const STEPS = ["1 · Upload file", "2 · Validate", "3 · Import"];

/**
 * Bolis → In-person upload: Upload → Validate → Import, as in the prototype
 * (AdminPortal L613-615). The server re-checks every row before importing.
 */
export function BoliUpload({ canUpload, currency, templateExample }: { canUpload: boolean; currency: string; templateExample?: { boli: string; event: string } }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CheckedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = rows?.filter((r) => r.ok) ?? [];
  const step = outcome ? 3 : rows ? 2 : 1;

  function downloadTemplate() {
    try {
      const blob = new Blob([uploadTemplateCsv(templateExample)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "in-person-bolis.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("[bolis upload] template download failed:", err);
      setError("Could not download the template in this browser. The columns are: Boli name, Event, Household ID or name, Amount, Called at.");
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setRows(null);
    setOutcome(null);
    if (file.size > 2 * 1024 * 1024) {
      setError("That file is larger than 2 MB. Upload one event's results at a time.");
      return;
    }
    let content: string;
    try {
      content = await file.text();
    } catch (err) {
      console.error("[bolis upload] reading the file failed:", err);
      setError("Could not read that file. Save it as CSV (comma separated) and upload it again.");
      return;
    }
    const parsed = parseBoliUploadCsv(content);
    if (parsed.errors.length > 0) {
      setError(`Could not read ${file.name} — ${parsed.errors.join(" ")}`);
      return;
    }
    setFileName(file.name);
    startTransition(async () => {
      try {
        const res = await validateBoliUploadAction(parsed.rows);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setRows(res.data ?? []);
      } catch (err) {
        console.error("[bolis upload] validation failed:", err);
        setError("Could not check the file — the server did not respond. Upload it again.");
      }
    });
  }

  function runImport() {
    if (!rows || valid.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await importBoliUploadAction(
          rows.map(({ row, boli, event, household, amountText, calledAt }) => ({ row, boli, event, household, amountText, calledAt })),
          fileName,
        );
        if (!res.ok) {
          setError(res.error);
          toast?.show(res.error, "bad");
          return;
        }
        setOutcome(res.data ?? { created: 0, skipped: 0, failed: [] });
        if (res.message) toast?.show(res.message, "ok");
      } catch (err) {
        console.error("[bolis upload] import failed:", err);
        setError("Could not import — the server did not respond. Check the Digital bolis and In-person lists before uploading again: rows that went through are closed and would be skipped.");
      }
    });
  }

  const actions = !canUpload ? null : rows && !outcome ? (
    <>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={pending} className={buttonClass("ghost", "sm")}>
        Upload another file
      </button>
      <button type="button" onClick={runImport} disabled={pending || valid.length === 0} className={buttonClass("primary", "sm")}>
        {pending ? "Importing…" : `Import ${valid.length} valid ${valid.length === 1 ? "row" : "rows"}`}
      </button>
    </>
  ) : (
    <>
      <button type="button" onClick={downloadTemplate} className={buttonClass("ghost", "sm")}>
        Download template
      </button>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={pending} className={buttonClass("primary", "sm")}>
        {pending ? "Checking…" : "Upload in-person-bolis.csv"}
      </button>
    </>
  );

  return (
    <>
      <Card span={12}>
        <div className="flex gap-1.5" aria-label="Steps">
          {STEPS.map((label, i) => (
            <div
              key={label}
              aria-current={step === i + 1 ? "step" : undefined}
              className={`flex-1 border-t-4 px-1 pt-2 text-xs font-bold text-navy ${step > i ? "border-navy" : "border-line"}`}
            >
              {label}
            </div>
          ))}
        </div>
      </Card>
      <Card span={12} title="Template columns">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Boli name, event, household ID or name, amount, called at (time). Download the template, fill it after the event, and upload. Each valid row
          becomes a pledge on the household.
        </p>
        <p className="mt-1 text-xs text-muted">
          List each in-person boli first (Digital bolis → New digital boli → Type: In-person). A household name must match exactly one family; use the
          household ID when two families share a name.
        </p>
      </Card>
      <Card
        span={12}
        padded={false}
        title={rows ? `Validation results · ${rows.length} ${rows.length === 1 ? "row" : "rows"}` : "No file uploaded yet"}
        description={rows ? `${fileName} · ${valid.length} valid · ${rows.length - valid.length} with a problem` : undefined}
        actions={actions}
      >
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="In-person bolis CSV file" onChange={onFile} tabIndex={-1} />
        {!canUpload ? (
          <p className="px-2.5 pb-2 text-[13px] text-muted">Uploading results needs bolis.manage (religious coordinator).</p>
        ) : null}
        {error ? (
          <div className="px-2.5 pb-2">
            <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {error}
            </p>
          </div>
        ) : null}
        {outcome ? (
          <div className="px-2.5 pb-2" role="status">
            <p className="rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900">
              {outcome.created} {outcome.created === 1 ? "pledge" : "pledges"} created · {outcome.skipped} {outcome.skipped === 1 ? "row" : "rows"} skipped.
              Each winner is now a pledge on the household (Giving → Pledges).
            </p>
            {outcome.failed.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-[13px] text-danger">
                {outcome.failed.map((f) => (
                  <li key={f.row}>
                    Row {f.row}: {f.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {!rows ? (
          <EmptyState title="Upload in-person-bolis.csv to validate" />
        ) : (
          <TableWrap>
            <table className="crm-table min-w-[760px]">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Boli</th>
                  <th>Event</th>
                  <th>Household</th>
                  <th className="num">Amount</th>
                  <th>Check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.row}>
                    <td className="text-xs text-muted">{r.row}</td>
                    <td className="font-semibold">{r.boli_name ?? r.boli}</td>
                    <td>{r.event_name ?? (r.event || "—")}</td>
                    <td>
                      {r.household_label ?? r.household}
                      {r.household_label && r.household_label !== r.household ? <div className="text-xs text-muted">file: {r.household}</div> : null}
                    </td>
                    <td className="num">{r.amount_cents !== null ? formatCents(r.amount_cents, currency) : r.amountText || "—"}</td>
                    <td>
                      <StatusText tone={r.ok ? (r.check === "OK" ? "ok" : "warn") : "bad"}>{r.check}</StatusText>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}

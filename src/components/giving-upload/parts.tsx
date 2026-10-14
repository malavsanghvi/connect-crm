"use client";

// Pieces every Giving upload shares (GV-U): choosing the file, the note for a phone, the reason, and the list of earlier uploads
// (with Cancel for a pledge upload while nothing is paid against it). Errors are said next to what the person did.

import { useId, useRef, useState, useTransition, type ReactNode } from "react";

import { Alert, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import type { EarlierUpload } from "@/lib/giving-upload/sheet";
import { formatCents } from "@/lib/money";

export type { EarlierUpload };

export const CHIP = "inline-flex min-h-[40px] items-center rounded-full border px-3 text-[13.5px] font-semibold";
export const chipTone = (on: boolean) => (on ? "border-navy bg-navy-50 text-navy" : "border-line bg-white text-ink-2 hover:border-navy-300");

/** On a phone the page still works; it says where it works best. */
export function PhoneNote() {
  return (
    <p className="m-0 rounded-field bg-ground px-3 py-2 text-[13px] text-muted sm:hidden">
      Uploading works best on a computer, where the whole file fits on the screen.
    </p>
  );
}

export function FileChooser({
  title,
  templateCsv,
  templateXlsx,
  busy,
  error,
  onFile,
  children,
}: {
  title: string;
  templateCsv: string;
  templateXlsx: string;
  busy: string | null;
  error: string | null;
  onFile: (file: File) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="cc-card flex flex-col gap-3 px-4 py-4">
      <h2 className="m-0 text-[17px] font-bold text-ink">{title}</h2>
      <div className="flex flex-wrap items-center gap-2 text-[14px]">
        <span className="text-muted">1. Download the template:</span>
        <a href={templateCsv} className={`${buttonClass("ghost", "sm")} min-h-[44px]`} download>
          CSV
        </a>
        <a href={templateXlsx} className={`${buttonClass("ghost", "sm")} min-h-[44px]`} download>
          Excel
        </a>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[14px] text-muted">
          2. Fill it in (or use your own file with the same columns), then choose it:
        </label>
        <input
          id={id}
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy !== null}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            if (input.current) input.current.value = "";
          }}
          className="block w-full max-w-md text-[14px] file:mr-3 file:min-h-[44px] file:rounded-full file:border file:border-line file:bg-white file:px-4 file:font-semibold"
        />
      </div>
      {children}
      {busy ? (
        <p className="m-0 text-[14px] font-semibold text-navy" role="status">
          {busy}
        </p>
      ) : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </section>
  );
}

export function ReasonInput({
  value,
  onChange,
  label,
  hint,
  quick,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  hint: string;
  quick: readonly string[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-bold text-ink">
        {label}
      </label>
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} maxLength={500} className="crm-input min-h-[44px]" aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="m-0 text-[12.5px] text-muted">
        {hint}
      </p>
      <div className="flex flex-wrap gap-2">
        {quick.map((r) => (
          <button key={r} type="button" aria-pressed={value === r} onClick={() => onChange(r)} className={`${CHIP} ${chipTone(value === r)}`}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}


export function EarlierUploads({
  uploads,
  what,
  currency,
  locale,
  timeZone,
  cancel,
}: {
  uploads: EarlierUpload[];
  what: string;
  currency: string;
  locale: string;
  timeZone: string;
  cancel?: (input: { uploadId: string; reason: string }) => Promise<ActionResult<{ cancelled: number }>>;
}) {
  if (uploads.length === 0) return null;
  return (
    <section className="cc-card flex flex-col gap-2 px-4 py-4">
      <h2 className="m-0 text-[17px] font-bold text-ink">Earlier uploads</h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {uploads.map((u) => (
          <li key={u.id} className="rounded-field border border-line bg-white px-3 py-2.5">
            <p className="m-0 text-[14px] font-bold text-ink">
              {u.rowCount} {u.rowCount === 1 ? what : `${what}s`}, {formatCents(u.totalCents, currency, locale)}
              <span className="font-normal text-muted"> · {formatDateTime(u.createdAt, timeZone)}</span>
            </p>
            <p className="m-0 text-[13px] text-muted">
              {u.fileName ? `${u.fileName} · ` : ""}“{u.reason}”
            </p>
            {u.cancelledAt ? (
              <p className="m-0 mt-1 text-[13px] font-semibold text-muted">
                Cancelled {formatDateTime(u.cancelledAt, timeZone)}
                {u.cancelReason ? `: “${u.cancelReason}”` : ""}
              </p>
            ) : u.note ? (
              <p className="m-0 mt-1 text-[13px] text-muted">{u.note}</p>
            ) : null}
            {cancel && !u.cancelledAt && u.cancellable ? <CancelUpload upload={u} what={what} cancel={cancel} /> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CancelUpload({
  upload,
  what,
  cancel,
}: {
  upload: EarlierUpload;
  what: string;
  cancel: (input: { uploadId: string; reason: string }) => Promise<ActionResult<{ cancelled: number }>>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  if (done) {
    return (
      <p className="m-0 mt-1 text-[13px] font-semibold text-success" role="status">
        {done}
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className={`${buttonClass("ghost", "sm")} mt-2 min-h-[44px]`} onClick={() => setOpen(true)}>
        Cancel this upload…
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-field bg-ground px-3 py-2.5">
      <p className="m-0 text-[13px] text-ink">
        Every {what} of this upload is cancelled together; nothing is deleted. Each family&apos;s History shows the reason.
      </p>
      <label htmlFor={id} className="text-[13px] font-bold text-ink">
        Why it is cancelled
      </label>
      <input id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="crm-input min-h-[44px]" />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || reason.trim().length < 3}
          className={`${buttonClass("danger", "sm")} min-h-[44px]`}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                const res = await cancel({ uploadId: upload.id, reason: reason.trim() });
                if (!res.ok) setError(res.error);
                else setDone(res.message ?? "Cancelled.");
              } catch (err) {
                console.error("[giving upload] cancelling failed:", err);
                setError("Could not cancel the upload: the server did not respond. Reload the page to see whether it went through before trying again.");
              }
            });
          }}
        >
          {pending ? "Cancelling…" : `Cancel ${upload.rowCount} ${upload.rowCount === 1 ? what : `${what}s`}`}
        </button>
        <button type="button" className={`${buttonClass("ghost", "sm")} min-h-[44px]`} onClick={() => setOpen(false)} disabled={pending}>
          Keep them
        </button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

"use client";

// Giving › Payments › Upload (GV-U slice C; NEEDS OWNER OK: a bulk way to record money). Choose a file, see every row with its
// household card and what it pays ("Pays PL-0455 in full"; "a general gift"), pick the household where an ID is shared or only a
// name was given, look at what may be a repeat, give one reason, and record the ticked rows with one button that names how many
// and how much ("Record 40 payments, $8,120.00"). There is no <form>: Enter never records. One confirmation records once. There is
// no undo: a wrong row is fixed with a refund a second person approves. No receipt is emailed by the upload.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import type { FileForReview } from "@/app/(app)/giving/pledges/upload/actions";
import type { PreparedDonations, RecordDonationUploadInput, RecordedDonationUpload } from "@/app/(app)/giving/payments/upload/actions";
import { FamilyCard } from "@/components/giving-actions/sheet";
import type { CardLabels } from "@/components/household-card";
import { Alert, buttonClass } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import {
  DONATION_REASONS,
  DONATION_UPLOAD_NO_UNDO,
  NO_DONATION_CHOICES,
  donationButtonLabel,
  donationSummary,
  donationUploadRows,
  reviewDonations,
  type DonationChoices,
  type DonationRow,
  type DonationStatus,
} from "@/lib/giving-upload/donations";
import { familyLine, familyRef } from "@/lib/giving-today/queue";
import { readUploadFile } from "@/lib/giving-upload/read";
import { MAX_UPLOAD_ROWS, newUploadKey, rowsWord, type EarlierUpload } from "@/lib/giving-upload/sheet";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

import { CHIP, EarlierUploads, FileChooser, PhoneNote, ReasonInput, chipTone } from "./parts";

export type DonationUploadBackend = {
  prepare: (input: FileForReview) => Promise<ActionResult<PreparedDonations>>;
  record: (input: RecordDonationUploadInput) => Promise<ActionResult<RecordedDonationUpload>>;
};

export type DonationUploadSetting = {
  currency: string;
  locale: string;
  timeZone: string;
  labels: CardLabels;
  household: string;
  dateExample: string;
  canAllocate: boolean;
  templateCsv: string;
  templateXlsx: string;
  /** Where past years' history and opening balances come in (Settings › Import), when the person may use it. */
  importHref: string | null;
};

type Loaded = { fileName: string; sha256: string | null; prepared: PreparedDonations; key: string };

const STATUS_WORD: Record<DonationStatus, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "bg-success-50 text-success-900" },
  pick: { label: "Pick the household", tone: "bg-saffron-50 text-brown-900" },
  check: { label: "Check it", tone: "bg-saffron-50 text-brown-900" },
  repeat: { label: "Possible repeat", tone: "bg-saffron-50 text-brown-900" },
  problem: { label: "Problem", tone: "bg-danger-50 text-danger" },
};

type Show = "all" | "attention" | "problem";

export function DonationUpload({
  setting,
  backend,
  earlier,
  initial = null,
}: {
  setting: DonationUploadSetting;
  backend: DonationUploadBackend;
  earlier: EarlierUpload[];
  initial?: { fileName: string; prepared: PreparedDonations } | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(() =>
    initial ? { fileName: initial.fileName, sha256: null, prepared: initial.prepared, key: newUploadKey("donations") } : null,
  );
  const [choices, setChoices] = useState<DonationChoices>(NO_DONATION_CHOICES);
  const [reason, setReason] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: RecordedDonationUpload; message: string } | null>(null);
  const [pending, start] = useTransition();

  const review = useMemo(() => (loaded ? reviewDonations(loaded.prepared.read, loaded.prepared.lookups, choices) : null), [loaded, choices]);
  const money = (c: number) => formatCents(c, setting.currency, setting.locale);

  async function choose(file: File) {
    setFileError(null);
    setError(null);
    setDone(null);
    setLoaded(null);
    setBusy(`Reading ${file.name}…`);
    try {
      const r = await readUploadFile(file);
      if (!r.ok) {
        setFileError(r.error);
        return;
      }
      setBusy(`Checking ${rowsWord(r.table.rows.length)}…`);
      const res = await backend.prepare({ fileName: r.table.fileName, source: r.table.source, sha256: r.sha256, headers: r.table.headers, rows: r.table.rows });
      if (!res.ok || !res.data) {
        setFileError(res.ok ? "Could not check the file: the server did not say. Choose it again." : res.error);
        return;
      }
      setChoices(NO_DONATION_CHOICES);
      setShow("all");
      setLoaded({ fileName: file.name, sha256: r.sha256, prepared: res.data, key: newUploadKey("donations") });
    } catch (err) {
      console.error("[donation upload] checking the file failed:", err);
      setFileError("Could not check the file: the server did not respond. Choose it again.");
    } finally {
      setBusy(null);
    }
  }

  function record() {
    if (!loaded || !review) return;
    setError(null);
    const rows = donationUploadRows(review);
    if (rows.length === 0) return setError("Tick at least one row to record.");
    if (reason.trim().length < 3) return setError('Say why these payments are recorded (for example "Sunday collection checks").');
    start(async () => {
      try {
        const res = await backend.record({ key: loaded.key, fileName: loaded.fileName, sha256: loaded.sha256, reason: reason.trim(), rows });
        if (!res.ok || !res.data) {
          setError(res.ok ? "The payments may not have been recorded: the server did not say. Open Payments to check before trying again." : res.error);
          return;
        }
        setDone({ result: res.data, message: res.message ?? "Recorded." });
      } catch (err) {
        console.error("[donation upload] recording failed:", err);
        setError("Could not record the payments: the server did not respond. Open Payments to see whether they were recorded before trying again; pressing the button again never records them twice.");
      }
    });
  }

  if (done && loaded) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success" title={done.message}>
          {loaded.fileName}. {done.result.receipts}
        </Alert>
        <section className="cc-card px-4 py-4">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
            {done.result.payments.map((p) => {
              const row = review?.rows.find((r) => r.line === p.row);
              return (
                <li key={p.paymentId}>
                  <strong>{p.receiptNumber ?? "Payment"}</strong> · {row?.family ? familyRef(row.family) : "household"} · {money(p.amountCents)}
                  {p.appliedCents > 0 ? ` · ${money(p.appliedCents)} applied` : " · not applied"}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="flex flex-wrap gap-2">
          <Link href="/giving/payments" className={`${buttonClass("primary", "sm")} min-h-[44px]`}>
            Open Payments
          </Link>
          <button
            type="button"
            className={`${buttonClass("ghost", "sm")} min-h-[44px]`}
            onClick={() => {
              setDone(null);
              setLoaded(null);
              setReason("");
            }}
          >
            Upload another file
          </button>
        </div>
      </div>
    );
  }

  const fileProblems = loaded?.prepared.read.fileProblems ?? [];
  const visible = (review?.rows ?? []).filter((r) => (show === "all" ? true : show === "problem" ? r.status === "problem" : r.status !== "ready" && r.status !== "problem"));
  const attention = review ? review.counts.pick + review.counts.check + review.counts.repeat : 0;

  return (
    <div className="flex flex-col gap-4">
      <PhoneNote />
      <FileChooser
        title={loaded ? "Choose another file" : "Upload donations from a spreadsheet"}
        templateCsv={setting.templateCsv}
        templateXlsx={setting.templateXlsx}
        busy={busy}
        error={fileError}
        onFile={(f) => void choose(f)}
      >
        <p className="m-0 text-[13px] text-muted">
          One row per payment received (check, cash, ACH, Zelle or stock), at most {MAX_UPLOAD_ROWS}. The {setting.household} is found by any of its
          IDs; a name alone is never enough, so you pick the {setting.household} for those rows. Dates like {setting.dateExample}.{" "}
          {setting.canAllocate
            ? "Each payment pays the household's open pledges as the Record payment sheet does, unless a row names a pledge or says none."
            : "You can record payments but not apply them: every row is recorded and a treasurer applies it."}{" "}
          The file stays on this computer: only its rows are sent to be checked.
        </p>
        <p className="m-0 text-[13px] text-muted">
          Past years&apos; history and opening balances come in through{" "}
          {setting.importHref ? (
            <Link href={setting.importHref} className="font-semibold text-navy">
              Settings › Import
            </Link>
          ) : (
            "Settings › Import"
          )}
          , which never posts to the books.
        </p>
      </FileChooser>

      {loaded && fileProblems.length > 0 ? (
        <Alert tone="danger" title={`${loaded.fileName} cannot be uploaded as it is`}>
          <ul className="m-0 list-disc pl-5">
            {fileProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {loaded && review && fileProblems.length === 0 ? (
        <section className="cc-card flex flex-col gap-3 px-4 py-4" aria-label="Review the payments">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[17px] font-bold text-ink">
              {loaded.fileName}: {rowsWord(review.rows.length)}
            </h2>
            <p className="m-0 text-[14px] text-muted">{donationSummary(review)}</p>
            {loaded.prepared.read.columns.ignored.length > 0 ? (
              <p className="m-0 text-[13px] text-muted">Columns not used: {loaded.prepared.read.columns.ignored.join(", ")}.</p>
            ) : null}
          </div>
          {loaded.prepared.sameFile ? (
            <Alert tone="warning" title="This file was uploaded before">
              The same file was recorded on {formatDateTime(loaded.prepared.sameFile.createdAt, setting.timeZone)} ({rowsWord(loaded.prepared.sameFile.rowCount)}).
              Its rows show below as possible repeats; record them again only if they are new payments.
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Rows to show">
            {(
              [
                ["all", `All ${review.rows.length}`],
                ["attention", `Need you ${attention}`],
                ["problem", `Problems ${review.counts.problem}`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`${CHIP} ${chipTone(show === k)}`}>
                {label}
              </button>
            ))}
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {visible.map((r) => (
              <DonationRowCard
                key={r.line}
                row={r}
                setting={setting}
                onTick={(on) => setChoices((c) => ({ ...c, ticks: { ...c.ticks, [r.line]: on } }))}
                onPick={(id) => setChoices((c) => ({ picks: { ...c.picks, [r.line]: id }, ticks: { ...c.ticks, [r.line]: true } }))}
              />
            ))}
            {visible.length === 0 ? <li className="rounded-[12px] bg-ground px-3 py-3 text-center text-[14px] text-muted">Nothing here.</li> : null}
          </ul>
          {review.tickedCount > 0 ? (
            <p className="m-0 text-[14px] text-ink">
              {setting.canAllocate
                ? `${money(review.appliedCents)} goes to pledges; ${money(review.tickedCents - review.appliedCents)} stays as general gifts.`
                : `${money(review.tickedCents)} is recorded and not applied: a treasurer applies it.`}
            </p>
          ) : null}
          <ReasonInput
            value={reason}
            onChange={setReason}
            label="Why these payments are recorded"
            hint="Each payment's history shows it, with the row's note."
            quick={DONATION_REASONS}
          />
          <p className="m-0 text-[13px] text-muted">{DONATION_UPLOAD_NO_UNDO}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`${buttonClass("primary", "md")} min-h-[44px] self-start`}
              disabled={pending || review.tickedCount === 0 || reason.trim().length < 3}
              onClick={record}
            >
              {pending ? "Recording…" : donationButtonLabel(review, setting.currency, setting.locale)}
            </button>
            {review.tickedCount > 0 && reason.trim().length < 3 ? <p className="m-0 text-[13px] text-muted">Give the reason first.</p> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </div>
        </section>
      ) : null}

      <EarlierUploads uploads={earlier} what="payment" currency={setting.currency} locale={setting.locale} timeZone={setting.timeZone} />
    </div>
  );
}

function DonationRowCard({
  row,
  setting,
  onTick,
  onPick,
}: {
  row: DonationRow;
  setting: DonationUploadSetting;
  onTick: (on: boolean) => void;
  onPick: (householdId: string) => void;
}) {
  const money = row.amountCents !== null ? formatCents(row.amountCents, setting.currency, setting.locale) : "—";
  const tickable = row.status !== "problem" && row.status !== "pick";
  const word = STATUS_WORD[row.status];
  const tickId = `donation-row-${row.line}`;
  const method = row.method ? (PAYMENT_METHOD_LABEL[row.method] ?? row.method) : null;
  return (
    <li className={`rounded-[12px] border px-3 py-2.5 ${row.ticked ? "border-navy-300 bg-white" : "border-line bg-ground"}`}>
      <div className="flex items-start gap-3">
        {tickable ? (
          <input
            id={tickId}
            type="checkbox"
            checked={row.ticked}
            onChange={(e) => onTick(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0"
            aria-label={`Record line ${row.line}: ${money}${row.family ? ` from ${familyRef(row.family)}` : ""}`}
          />
        ) : (
          <span className="mt-1 h-5 w-5 shrink-0" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-muted">Line {row.line}</span>
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${word.tone}`}>{word.label}</span>
            <span className="text-[15px] font-bold text-ink">{money}</span>
            {method ? <span className="text-[13.5px] text-ink-2">{method}</span> : null}
            {row.receivedOn ? <span className="text-[13px] text-muted">received {formatDate(row.receivedOn, setting.timeZone)}</span> : null}
          </div>
          {row.family ? (
            <FamilyCard family={row.family} labels={setting.labels}>
              {row.via ? <p className="m-0 text-[12.5px] text-muted">Found by {row.via}</p> : null}
            </FamilyCard>
          ) : null}
          {row.status === "pick" || (row.candidates.length > 1 && row.via === "Picked by you") ? (
            <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
              <legend className="mb-1 text-[13px] font-bold text-ink">Which {setting.household}?</legend>
              {row.candidates.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="radio"
                    name={`dpick-${row.line}`}
                    checked={row.family?.id === c.id}
                    onChange={() => onPick(c.id)}
                    aria-label={`${familyRef(c)}: ${familyLine(c, setting.labels)}`}
                    className="mt-3 h-5 w-5"
                  />
                  <span className="min-w-0 flex-1">
                    <FamilyCard family={c} labels={setting.labels} />
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          {row.checkNumber || row.envelope || row.memo ? (
            <p className="m-0 text-[13px] text-muted">
              {[row.checkNumber ? `Check ${row.checkNumber}` : null, row.envelope ? `envelope ${row.envelope}` : null, row.memo ? `memo: ${row.memo}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {row.after.map((a) => (
            <p key={a} className="m-0 text-[13px] text-ink-2">
              {a}
            </p>
          ))}
          {row.problems.map((p) => (
            <p key={p} className="m-0 text-[13px] font-semibold text-danger">
              {p}
            </p>
          ))}
          {row.warnings.map((w) => (
            <p key={w} className="m-0 text-[13px] text-brown-900">
              {w}
            </p>
          ))}
          {row.repeatOf && tickable ? (
            <label htmlFor={tickId} className="text-[13px] font-semibold text-navy">
              {row.ticked ? "Recorded anyway (a second payment)" : "Tick the box to record it anyway"}
            </label>
          ) : null}
        </div>
      </div>
    </li>
  );
}

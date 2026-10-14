"use client";

// Giving › Pledges › Upload (GV-U slice B; NEEDS OWNER OK). Choose a file, see every row with its household card, pick the household
// where an ID is shared or only a name was given, look at what may be a repeat, give one reason, and record the ticked rows with one
// button that names how many and how much ("Record 18 pledges, $24,500.00"). There is no <form>: Enter never records. One
// confirmation records once (the review's key). No money moves; the upload can be cancelled while nothing is paid against it.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import { FamilyCard } from "@/components/giving-actions/sheet";
import type { CardLabels } from "@/components/household-card";
import { Alert, buttonClass } from "@/components/ui";
import type { RecordedPledgeUpload, RecordPledgeUploadInput, FileForReview, PreparedPledges } from "@/app/(app)/giving/pledges/upload/actions";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { familyLine, familyRef } from "@/lib/giving-today/queue";
import {
  NO_CHOICES,
  PLEDGE_UPLOAD_NO_UNDO,
  UPLOAD_REASONS,
  recordButtonLabel,
  reviewPledges,
  reviewSummary,
  uploadRows,
  type ReviewChoices,
  type ReviewRow,
  type RowStatus,
} from "@/lib/giving-upload/pledges";
import { readUploadFile } from "@/lib/giving-upload/read";
import { MAX_UPLOAD_ROWS, newUploadKey, rowsWord } from "@/lib/giving-upload/sheet";
import { formatCents } from "@/lib/money";
import type { PledgeEmailStatus } from "@/lib/pledge-email/bulk";

import { PledgeEmailResult } from "./pledge-email-result";
import { CHIP, EarlierUploads, FileChooser, PhoneNote, ReasonInput, chipTone, type EarlierUpload } from "./parts";

export type PledgeUploadBackend = {
  prepare: (input: FileForReview) => Promise<ActionResult<PreparedPledges>>;
  record: (input: RecordPledgeUploadInput) => Promise<ActionResult<RecordedPledgeUpload>>;
  cancel: (input: { uploadId: string; reason: string }) => Promise<ActionResult<{ cancelled: number }>>;
  /** What became of each pledge's email (0793): the result asks until nothing is waiting. */
  emailStatus: (pledgeIds: string[]) => Promise<ActionResult<PledgeEmailStatus[]>>;
};

export type PledgeUploadSetting = {
  currency: string;
  locale: string;
  timeZone: string;
  labels: CardLabels;
  household: string;
  dueSentence: string;
  dateExample: string;
  templateCsv: string;
  templateXlsx: string;
};

type Loaded = { fileName: string; sha256: string | null; prepared: PreparedPledges; key: string };

const STATUS_WORD: Record<RowStatus, { label: string; tone: string }> = {
  ready: { label: "Ready", tone: "bg-success-50 text-success-900" },
  pick: { label: "Pick the household", tone: "bg-saffron-50 text-brown-900" },
  check: { label: "Check it", tone: "bg-saffron-50 text-brown-900" },
  repeat: { label: "Possible repeat", tone: "bg-saffron-50 text-brown-900" },
  problem: { label: "Problem", tone: "bg-danger-50 text-danger" },
};

type Show = "all" | "attention" | "problem";

export function PledgeUpload({
  setting,
  backend,
  earlier,
  initial = null,
}: {
  setting: PledgeUploadSetting;
  backend: PledgeUploadBackend;
  earlier: EarlierUpload[];
  /** The dev preview opens on a review already checked. */
  initial?: { fileName: string; prepared: PreparedPledges } | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(() =>
    initial ? { fileName: initial.fileName, sha256: null, prepared: initial.prepared, key: newUploadKey("pledges") } : null,
  );
  const [choices, setChoices] = useState<ReviewChoices>(NO_CHOICES);
  const [reason, setReason] = useState("");
  // "Email each family their pledge" (0793): on unless the person unticks it.
  const [sendEmails, setSendEmails] = useState(true);
  const [show, setShow] = useState<Show>("all");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ result: RecordedPledgeUpload; message: string } | null>(null);
  const [pending, start] = useTransition();

  const review = useMemo(() => (loaded ? reviewPledges(loaded.prepared.read, loaded.prepared.lookups, choices) : null), [loaded, choices]);
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
      setChoices(NO_CHOICES);
      setShow("all");
      setLoaded({ fileName: file.name, sha256: r.sha256, prepared: res.data, key: newUploadKey("pledges") });
    } catch (err) {
      console.error("[pledge upload] checking the file failed:", err);
      setFileError("Could not check the file: the server did not respond. Choose it again.");
    } finally {
      setBusy(null);
    }
  }

  function record() {
    if (!loaded || !review) return;
    setError(null);
    const rows = uploadRows(review);
    if (rows.length === 0) return setError("Tick at least one row to record.");
    if (reason.trim().length < 3) return setError('Say why these pledges are recorded (for example "Pledge cards from the annual dinner").');
    start(async () => {
      try {
        const res = await backend.record({ key: loaded.key, fileName: loaded.fileName, sha256: loaded.sha256, reason: reason.trim(), rows, sendEmails });
        if (!res.ok || !res.data) {
          setError(res.ok ? "The pledges may not have been recorded: the server did not say. Open Pledges to check before trying again." : res.error);
          return;
        }
        setDone({ result: res.data, message: res.message ?? "Recorded." });
      } catch (err) {
        console.error("[pledge upload] recording failed:", err);
        setError("Could not record the pledges: the server did not respond. Open Pledges to see whether they were recorded before trying again; pressing the button again never records them twice.");
      }
    });
  }

  if (done && loaded) {
    return (
      <div className="flex flex-col gap-3">
        <Alert tone="success" title={done.message}>
          {loaded.fileName}. Each family&apos;s History shows the reason. {done.result.replayed ? "" : "Every pledge is open until it is paid."}
        </Alert>
        {done.result.replayed ? null : (
          <PledgeEmailResult
            requested={done.result.emails}
            pledges={done.result.pledges.map((p) => {
              const row = review?.rows.find((r) => r.line === p.row);
              return { pledgeId: p.pledgeId, number: p.pledgeNumber, label: row?.family ? familyRef(row.family) : "" };
            })}
            status={backend.emailStatus}
          />
        )}
        <section className="cc-card px-4 py-4">
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
            {done.result.pledges.map((p) => {
              const row = review?.rows.find((r) => r.line === p.row);
              return (
                <li key={p.pledgeId}>
                  <strong>{p.pledgeNumber ?? "Pledge"}</strong> · {row?.family ? familyRef(row.family) : "household"} · {money(p.amountCents)}
                  {p.dueOn ? ` · due ${formatDate(p.dueOn, setting.timeZone)}` : ""}
                </li>
              );
            })}
          </ul>
        </section>
        <div className="flex flex-wrap gap-2">
          <Link href="/giving/pledges" className={`${buttonClass("primary", "sm")} min-h-[44px]`}>
            Open Pledges
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
        title={loaded ? "Choose another file" : "Upload pledges from a spreadsheet"}
        templateCsv={setting.templateCsv}
        templateXlsx={setting.templateXlsx}
        busy={busy}
        error={fileError}
        onFile={(f) => void choose(f)}
      >
        <p className="m-0 text-[13px] text-muted">
          One row per pledge, at most {MAX_UPLOAD_ROWS}. The {setting.household} is found by any of its IDs; a name alone is never enough, so you pick the{" "}
          {setting.household} for those rows. Dates like {setting.dateExample}. {setting.dueSentence} The file stays on this computer: only its rows are
          sent to be checked.
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
        <section className="cc-card flex flex-col gap-3 px-4 py-4" aria-label="Review the pledges">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[17px] font-bold text-ink">
              {loaded.fileName}: {rowsWord(review.rows.length)}
            </h2>
            <p className="m-0 text-[14px] text-muted">{reviewSummary(review)}</p>
            {loaded.prepared.read.columns.ignored.length > 0 ? (
              <p className="m-0 text-[13px] text-muted">Columns not used: {loaded.prepared.read.columns.ignored.join(", ")}.</p>
            ) : null}
          </div>
          {loaded.prepared.sameFile ? (
            <Alert tone="warning" title="This file was uploaded before">
              The same file was recorded on {formatDateTime(loaded.prepared.sameFile.createdAt, setting.timeZone)} ({rowsWord(loaded.prepared.sameFile.rowCount)}).
              Its rows show below as possible repeats; record them again only if they are new pledges.
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
              <PledgeRowCard
                key={r.line}
                row={r}
                setting={setting}
                onTick={(on) => setChoices((c) => ({ ...c, ticks: { ...c.ticks, [r.line]: on } }))}
                onPick={(id) => setChoices((c) => ({ picks: { ...c.picks, [r.line]: id }, ticks: { ...c.ticks, [r.line]: true } }))}
              />
            ))}
            {visible.length === 0 ? <li className="rounded-[12px] bg-ground px-3 py-3 text-center text-[14px] text-muted">Nothing here.</li> : null}
          </ul>
          <ReasonInput
            value={reason}
            onChange={setReason}
            label="Why these pledges are recorded"
            hint={`Each ${setting.household}'s History shows it, with the row's note.`}
            quick={UPLOAD_REASONS}
          />
          <label className="flex cursor-pointer items-start gap-3 rounded-[12px] border border-line bg-white px-3 py-2.5" htmlFor="pledge-upload-email">
            <input
              id="pledge-upload-email"
              type="checkbox"
              checked={sendEmails}
              onChange={(e) => setSendEmails(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0"
            />
            <span className="text-[14px] text-ink">
              <strong>Email each family their pledge</strong>
              <span className="block text-[13px] text-muted">
                Each family&apos;s primary member gets the pledge email with the pledge as a PDF attached, once. Rows dated more than 30 days ago count as history and are not
                emailed. A family with no email address on file is listed after recording. Untick to record the pledges without emailing anyone.
              </span>
            </span>
          </label>
          <p className="m-0 text-[13px] text-muted">{PLEDGE_UPLOAD_NO_UNDO}</p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className={`${buttonClass("primary", "md")} min-h-[44px] self-start`}
              disabled={pending || review.tickedCount === 0 || reason.trim().length < 3}
              onClick={record}
            >
              {pending ? "Recording…" : recordButtonLabel(review, setting.currency, setting.locale)}
            </button>
            {review.tickedCount > 0 && reason.trim().length < 3 ? <p className="m-0 text-[13px] text-muted">Give the reason first.</p> : null}
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </div>
        </section>
      ) : null}

      <EarlierUploads uploads={earlier} what="pledge" currency={setting.currency} locale={setting.locale} timeZone={setting.timeZone} cancel={backend.cancel} />
    </div>
  );
}

function PledgeRowCard({
  row,
  setting,
  onTick,
  onPick,
}: {
  row: ReviewRow;
  setting: PledgeUploadSetting;
  onTick: (on: boolean) => void;
  onPick: (householdId: string) => void;
}) {
  const money = row.amountCents !== null ? formatCents(row.amountCents, setting.currency, setting.locale) : "—";
  const tickable = row.status !== "problem" && row.status !== "pick";
  const word = STATUS_WORD[row.status];
  const tickId = `pledge-row-${row.line}`;
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
            aria-label={`Record line ${row.line}: ${money}${row.family ? ` for ${familyRef(row.family)}` : ""}`}
          />
        ) : (
          <span className="mt-1 h-5 w-5 shrink-0" aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12.5px] font-semibold text-muted">Line {row.line}</span>
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${word.tone}`}>{word.label}</span>
            <span className="text-[15px] font-bold text-ink">{money}</span>
            <span className="text-[13.5px] text-ink-2">{row.forLabel}</span>
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
                    name={`pick-${row.line}`}
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
          <p className="m-0 text-[13px] text-muted">
            Pledged {formatDate(row.pledgedOn, setting.timeZone)} · due {formatDate(row.dueOn, setting.timeZone)}
            {row.dueIsDefault ? " (the community's default)" : ""}
            {row.pledgedBy ? ` · by ${row.pledgedBy.name}` : ` · for the ${setting.household}`}
            {row.dedication ? ` · “${row.dedication}”` : ""}
            {row.note ? ` · note: ${row.note}` : ""}
          </p>
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
              {row.ticked ? "Recorded anyway (a second pledge)" : "Tick the box to record it anyway"}
            </label>
          ) : null}
        </div>
      </div>
    </li>
  );
}

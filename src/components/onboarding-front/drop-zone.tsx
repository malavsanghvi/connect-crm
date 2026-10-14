"use client";

// The front door's drop zone with recognition (board 1, "Drop your files"). A dropped or chosen file is looked at here in
// the browser only — its name, type, size and, for CSV and Excel, the heading row and the number of rows — and the card
// says what it most likely is and where it can go. Nothing is uploaded, nothing is saved, no server is called.

import Link from "next/link";
import { useId, useRef, useState, type DragEvent } from "react";

import { readFileFacts } from "@/lib/onboarding-front/read-file";
import { droppedSummary, plural, recogniseFile, unreadableFile, type DroppedFile, type Recognition, type RecogniseContext } from "@/lib/onboarding-front/recognise";

import { btn, card, ComingNext, Pill } from "./parts";

export type { DroppedFile };

export type DropLinks = {
  /** Guided onboarding (members and past donations). */
  guided: string;
  /** Data import (any kind of record). */
  dataImport: string;
  /** Bank matching, when the community has giving; null otherwise. */
  bank: string | null;
};

const ACCEPT = ".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.pdf,application/pdf,image/*";

function Next({ name, rec, links }: { name: string; rec: Recognition; links: DropLinks }) {
  const to = (href: string, label: string) => (
    <Link href={href} className={btn.outline}>
      {label}
      <span className="sr-only">: {name}</span>
    </Link>
  );
  switch (rec.goes) {
    case "guided":
      return to(links.guided, "Load it in Guided onboarding");
    case "data_import":
      return to(links.dataImport, "Open Data import");
    case "bank":
      return links.bank ? to(links.bank, "Open bank matching") : null;
    case "coming_next":
      return <ComingNext />;
    case "none":
      return null;
  }
}

export function FileRow({ file, links }: { file: DroppedFile; links: DropLinks }) {
  const { rec } = file;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-[10px] rounded-[12px] border border-line bg-white px-4 py-[14px]">
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-[13px] text-ink">{file.name}</span>
          <span className="text-[12px] text-muted">{rec.sizeLine}</span>
          <Pill tone={rec.tone}>{rec.tag}</Pill>
        </div>
        <div className="text-[14px] leading-[1.5] text-ink-2">
          {rec.sentence} {rec.next}
        </div>
      </div>
      <Next name={file.name} rec={rec} links={links} />
    </li>
  );
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export function DropZone({ context, links, initial = [] }: { context: RecogniseContext; links: DropLinks; initial?: readonly DroppedFile[] }) {
  const [files, setFiles] = useState<DroppedFile[]>(() => [...initial]);
  const [reading, setReading] = useState(0);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const titleId = useId();
  const hintId = useId();
  const noteId = useId();

  async function take(list: readonly File[]) {
    if (list.length === 0) return;
    setReading((n) => n + list.length);
    for (const file of list) {
      let rec: Recognition;
      try {
        const res = await readFileFacts(file);
        rec = res.ok ? recogniseFile(res.facts, context) : unreadableFile(res.facts, res.error);
      } catch (e) {
        rec = unreadableFile(file, e instanceof Error ? e.message : "");
      }
      seq.current += 1;
      const item: DroppedFile = { id: `file-${seq.current}`, name: file.name, rec };
      setFiles((prev) => [...prev, item]);
      setReading((n) => n - 1);
    }
  }

  const status = reading > 0 ? `Looking at ${plural(reading, "file")}…` : droppedSummary(files.map((f) => f.rec));

  return (
    <section aria-label="Drop your files" className={`${card} flex flex-col gap-4`}>
      <div
        role="group"
        aria-labelledby={titleId}
        aria-describedby={`${hintId} ${noteId}`}
        onDragEnter={(e) => {
          if (hasFiles(e)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragOver={(e) => {
          if (hasFiles(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setOver(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(Array.from(e.dataTransfer.files));
        }}
        className={`flex flex-col items-center gap-3 rounded-[14px] border-2 border-dashed px-5 py-7 text-center transition-colors ${over ? "border-navy bg-navy-50" : "border-navy-300 bg-ground"}`}
      >
        <svg aria-hidden="true" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-navy">
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
        </svg>
        <div id={titleId} className="text-[18px] font-bold text-ink">
          Drop spreadsheets, exports or PDFs here
        </div>
        <div id={hintId} className="max-w-[600px] text-[14px] leading-[1.5] text-muted">
          Excel, CSV, photos, and exports from Neon, QuickBooks, Zeffy, PayPal, Google Contacts or your bank.
        </div>
        <div className="flex flex-wrap items-center justify-center gap-[10px]">
          <button type="button" className={btn.primary} onClick={() => input.current?.click()}>
            Choose files
          </button>
          <span className="inline-flex flex-wrap items-center justify-center gap-2">
            <button type="button" disabled className={btn.offLarge}>
              Paste a Google Sheets link
            </button>
            <ComingNext />
          </span>
          {files.length > 0 ? (
            <button type="button" className={btn.outlineLarge} onClick={() => setFiles([])}>
              Clear the list
            </button>
          ) : null}
        </div>
        <p id={noteId} className="m-0 max-w-[600px] text-[12px] leading-[1.5] text-muted">
          Weaver only looks at each file here in your browser, to say what it is. Nothing is uploaded or saved.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => {
            const list = Array.from(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            void take(list);
          }}
        />
      </div>
      <div role="status" aria-live="polite" className={status ? "text-[15px] font-bold text-ink" : "sr-only"}>
        {status}
      </div>
      {files.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
          {files.map((f) => (
            <FileRow key={f.id} file={f} links={links} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

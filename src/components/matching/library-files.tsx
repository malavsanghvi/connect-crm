"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { uploadToSignedUrl } from "@/app/(app)/content/media/upload";
import { addLibraryFileAction, prepareLibraryUploadAction, removeLibraryFileAction } from "@/app/(app)/platform/matching/actions";
import { buttonClass } from "@/components/ui";
import {
  FILE_KINDS,
  FILE_KIND_LABEL,
  LIBRARY_FILE_TYPES,
  LIBRARY_MAX_FILES,
  checkLibraryFile,
  fileLine,
  type FileKind,
  type ProcessFile,
} from "@/lib/matching/files";

type Busy = { kind: "uploading"; name: string; pct: number } | { kind: "saving"; name: string } | null;

/** The file's SHA-256 as hex, so the same file added twice is noticed. null when the browser cannot compute it (the file is still added). */
async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.error("[platform/matching] could not fingerprint the file; adding it without:", err);
    return null;
  }
}

/**
 * Platform › Gift matching directory › an entry's files (0928): a form or a screenshot that shows the way. Weaver's team adds up to six; the file
 * goes straight from this browser to storage, then is kept with the entry under a reason that goes in the library's history. Every error shows
 * here, in words, next to what was done.
 */
export function LibraryFiles({ programId, files, filesNotice }: { programId: string; files: ProcessFile[]; filesNotice: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<FileKind>("form");
  const [caption, setCaption] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  async function add() {
    setProblem(null);
    setDone(null);
    const file = input.current?.files?.[0];
    if (!file) {
      setProblem("Could not add the file — choose a file first.");
      return;
    }
    const checked = checkLibraryFile(file, files.length);
    if (!checked.ok) {
      setProblem(`Could not add the file — ${checked.error}`);
      return;
    }
    if (!caption.trim()) {
      setProblem("Could not add the file — give it a short caption: what it shows.");
      return;
    }
    if (!reason.trim()) {
      setProblem("Could not add the file — say why you are adding it. It goes in the library's history.");
      return;
    }
    setBusy({ kind: "uploading", name: file.name, pct: 0 });
    try {
      const ticket = await prepareLibraryUploadAction({ programId, fileName: file.name, type: file.type, size: file.size });
      if (!ticket.ok || !ticket.data) {
        setProblem(ticket.ok ? "Could not start the upload — the server gave no upload address. Try again." : ticket.error);
        return;
      }
      const { path, signedUrl, contentType, apiKey } = ticket.data;
      const sent = await uploadToSignedUrl({
        signedUrl,
        file,
        contentType,
        apiKey,
        signal: new AbortController().signal,
        onProgress: (p) => setBusy({ kind: "uploading", name: file.name, pct: p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0 }),
      });
      if (!sent.ok) {
        setProblem(`Could not upload the file — ${sent.error}.`);
        return;
      }
      setBusy({ kind: "saving", name: file.name });
      const sha256 = await sha256Hex(file);
      const saved = await addLibraryFileAction({ programId, path, contentType, bytes: file.size, sha256, kind, caption, reason });
      if (!saved.ok) {
        setProblem(saved.error);
        return;
      }
      setDone(saved.message ?? "File added.");
      setCaption("");
      setReason("");
      router.refresh();
    } catch (err) {
      console.error("[platform/matching] adding a file failed:", err);
      setProblem("Could not add the file — the server did not respond. Check the connection and try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!removing) return;
    setProblem(null);
    setDone(null);
    setRemoveBusy(true);
    try {
      const r = await removeLibraryFileAction({ fileId: removing.id, programId, reason: removing.reason });
      if (!r.ok) {
        setProblem(r.error);
        return;
      }
      setRemoving(null);
      setDone(r.message ?? "File removed.");
      router.refresh();
    } catch (err) {
      console.error("[platform/matching] removing a file failed:", err);
      setProblem("Could not remove the file — the server did not respond. Try again.");
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="library-files">
      {filesNotice ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          {filesNotice}
        </p>
      ) : null}
      {files.length === 0 ? (
        <p className="m-0 text-[13.5px] text-muted">No file yet. Add the employer&apos;s form or a screenshot of the portal&apos;s screen.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13.5px]">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="crm-link">
                    {f.caption}
                  </a>
                ) : (
                  f.caption
                )}{" "}
                <span className="text-muted">({fileLine(f)})</span>
              </span>
              {removing?.id === f.id ? (
                <span className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`rm-${f.id}`}>
                    Why remove it
                  </label>
                  <input
                    id={`rm-${f.id}`}
                    className="crm-input"
                    placeholder="Why (goes in the history)"
                    maxLength={500}
                    value={removing.reason}
                    onChange={(e) => setRemoving({ id: f.id, reason: e.target.value })}
                  />
                  <button type="button" className={buttonClass("bad", "xs")} disabled={removeBusy || !removing.reason.trim()} onClick={remove}>
                    {removeBusy ? "Removing" : "Remove the file"}
                  </button>
                  <button type="button" className={buttonClass("ghost", "xs")} disabled={removeBusy} onClick={() => setRemoving(null)}>
                    Keep it
                  </button>
                </span>
              ) : (
                <button type="button" className={buttonClass("ghost", "xs")} onClick={() => setRemoving({ id: f.id, reason: "" })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {files.length < LIBRARY_MAX_FILES ? (
        <details>
          <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Add a file</summary>
          <div className="mt-3 flex max-w-xl flex-col gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              File (JPEG, PNG, WebP or PDF, at most 10 MB)
              <input ref={input} type="file" accept={LIBRARY_FILE_TYPES.join(",")} className="crm-input" disabled={busy !== null} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              What it is
              <select className="crm-input" value={kind} onChange={(e) => setKind(e.target.value as FileKind)} disabled={busy !== null}>
                {FILE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FILE_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Caption (what it shows)
              <input className="crm-input" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} disabled={busy !== null} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Why you are adding it (goes in the library&apos;s history)
              <input className="crm-input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy !== null} />
            </label>
            <div>
              <button type="button" className={buttonClass("primary", "sm")} disabled={busy !== null} onClick={add}>
                {busy?.kind === "uploading" ? `Uploading ${busy.pct}%` : busy?.kind === "saving" ? "Saving" : "Add the file"}
              </button>
            </div>
          </div>
        </details>
      ) : (
        <p className="m-0 text-[13px] text-muted">An entry holds {LIBRARY_MAX_FILES} files at most. Remove one to add another.</p>
      )}
      {problem ? (
        <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {problem}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="m-0 rounded-field border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900">
          {done}
        </p>
      ) : null}
    </div>
  );
}

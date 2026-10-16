"use client";

import { useRef, useState } from "react";

import { uploadToSignedUrl } from "@/app/(app)/content/media/upload";
import {
  attachEvidenceAction,
  loadPaymentEvidenceAction,
  prepareEvidenceUploadAction,
  removeEvidenceFileAction,
  type PaymentEvidenceView,
} from "@/app/(app)/giving/payments/evidence-actions";
import { buttonClass } from "@/components/ui";
import { checkEvidenceFile, evidenceFileLine, liveStaffFiles, STAFF_FILES_PER_PAYMENT } from "@/lib/payment-proofs/evidence-files";

type Loaded = { state: "idle" } | { state: "loading" } | { state: "error"; error: string } | { state: "ok"; view: PaymentEvidenceView };
type Busy = { kind: "uploading"; name: string; pct: number } | { kind: "saving"; name: string } | null;

const NO_ACCESS = "You don't have access to this area.";

/** The file's SHA-256 as hex, so the same photo sent twice is noticed. null when the browser cannot compute it (the file is still attached). */
async function sha256Hex(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (err) {
    console.error("[giving/payments] could not fingerprint the file; attaching it without:", err);
    return null;
  }
}

/**
 * The Evidence of one recorded payment, opened on demand: the files the family sent with its proof and the photos staff attached
 * (a check, a cash receipt), each with a link that lasts 10 minutes, made when the section opens (every staff view is logged). Staff
 * who record payments can attach a photo or file: it goes straight from this browser to storage, then is kept with the payment. Files
 * staff attach are never shown to the family. Only giving.manage removes one, with a reason.
 */
export function PaymentEvidence({
  paymentId,
  reference,
  timeZone,
  canAttach,
  canRemove,
}: {
  paymentId: string;
  reference: string;
  timeZone: string;
  canAttach: boolean;
  canRemove: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; reason: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function load(keep?: PaymentEvidenceView) {
    if (!keep) setLoaded({ state: "loading" });
    try {
      const r = await loadPaymentEvidenceAction(paymentId);
      if (r.ok && r.data) setLoaded({ state: "ok", view: r.data });
      else setLoaded({ state: "error", error: r.ok ? "Could not load the evidence — nothing came back." : r.error });
    } catch (err) {
      console.error("[giving/payments] loading the evidence failed:", err);
      setLoaded({ state: "error", error: "Could not load the evidence — the server did not respond. Try again." });
    }
  }

  async function attach(file: File, view: PaymentEvidenceView) {
    setProblem(null);
    setDone(null);
    const checked = checkEvidenceFile(file, liveStaffFiles(view.files));
    if (!checked.ok) {
      setProblem(`Could not attach the file — ${checked.error}`);
      return;
    }
    setBusy({ kind: "uploading", name: file.name, pct: 0 });
    try {
      const ticket = await prepareEvidenceUploadAction({ paymentId, fileName: file.name, type: file.type, size: file.size });
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
      const saved = await attachEvidenceAction({ paymentId, path, contentType, bytes: file.size, sha256 });
      if (!saved.ok) {
        setProblem(saved.error);
        return;
      }
      setDone(`${file.name} is attached to ${reference}.`);
      await load(view);
    } catch (err) {
      console.error("[giving/payments] attaching a file failed:", err);
      setProblem("Could not attach the file — the server did not respond. Check the connection and try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(view: PaymentEvidenceView) {
    if (!removing) return;
    setProblem(null);
    setDone(null);
    setRemoveBusy(true);
    try {
      const r = await removeEvidenceFileAction({ fileId: removing.id, reason: removing.reason });
      if (!r.ok) {
        setProblem(r.error);
        return;
      }
      setRemoving(null);
      setDone(r.message ?? "File removed from the payment.");
      await load(view);
    } catch (err) {
      console.error("[giving/payments] removing a file failed:", err);
      setProblem("Could not remove the file — the server did not respond. Try again.");
    } finally {
      setRemoveBusy(false);
    }
  }

  const view = loaded.state === "ok" ? loaded.view : null;
  const staffLive = view ? liveStaffFiles(view.files) : 0;

  return (
    <details
      className="mt-1"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && (loaded.state === "idle" || loaded.state === "error")) void load();
      }}
    >
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-navy">
        Evidence<span className="sr-only"> for {reference}</span>
      </summary>
      <div className="mt-2 w-[min(32rem,80vw)] space-y-2 whitespace-normal rounded-lg border border-line bg-white p-3 text-sm font-normal">
        {loaded.state === "loading" || loaded.state === "idle" ? <p className="m-0 text-muted">Loading the evidence…</p> : null}
        {loaded.state === "error" ? (
          <div role="alert" className="text-danger">
            <p className="m-0">{loaded.error}</p>
            {loaded.error !== NO_ACCESS ? (
              <button type="button" onClick={() => void load()} className={`${buttonClass("ghost", "xs")} mt-1 min-h-[36px]`}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {view?.notice ? (
          <p role="alert" className="m-0 text-danger">
            {view.notice}
          </p>
        ) : null}
        {view && view.files.length === 0 ? (
          <p className="m-0 text-muted">No file is kept with this payment. {canAttach ? "Attach a photo of the check or a receipt below." : ""}</p>
        ) : null}
        {view && view.files.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {view.files.map((f) => (
              <li key={f.id} className="space-y-1 rounded-lg border border-line px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={f.removed ? "text-muted" : ""}>{evidenceFileLine(f, timeZone)}</span>
                  {f.url ? (
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className={`${buttonClass("ghost", "xs")} min-h-[36px]`}>
                      Open<span className="sr-only"> {f.name ?? "the file"}</span>
                    </a>
                  ) : null}
                  {!f.removed && !f.url ? <span className="text-xs text-muted">No link could be made. Reload to try again.</span> : null}
                  {canRemove && f.source === "staff" && !f.removed && removing?.id !== f.id ? (
                    <button type="button" onClick={() => setRemoving({ id: f.id, reason: "" })} className={`${buttonClass("ghost", "xs")} min-h-[36px]`}>
                      Remove<span className="sr-only"> {f.name ?? "the file"}</span>
                    </button>
                  ) : null}
                </div>
                {removing?.id === f.id ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-ink">
                      Why is it being removed?
                      <input
                        type="text"
                        value={removing.reason}
                        maxLength={300}
                        onChange={(e) => setRemoving({ id: f.id, reason: e.target.value })}
                        className="min-h-[36px] rounded-field border border-line px-2 text-sm font-normal"
                      />
                    </label>
                    <button type="button" disabled={removeBusy} onClick={() => void remove(view)} className={`${buttonClass("primary", "xs")} min-h-[36px]`}>
                      {removeBusy ? "Removing…" : "Remove file"}
                    </button>
                    <button type="button" disabled={removeBusy} onClick={() => setRemoving(null)} className={`${buttonClass("ghost", "xs")} min-h-[36px]`}>
                      Keep it
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {view && canAttach ? (
          staffLive >= STAFF_FILES_PER_PAYMENT ? (
            <p className="m-0 text-xs text-muted">This payment has {STAFF_FILES_PER_PAYMENT} files attached by staff, the most it can hold.</p>
          ) : (
            <div className="space-y-1">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink">
                Attach a photo or file
                <input
                  ref={input}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.heic,.heif"
                  disabled={busy !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void attach(file, view);
                  }}
                  className="text-sm font-normal"
                />
              </label>
              <p className="m-0 text-xs text-muted">A photo (JPEG, PNG, WebP, HEIC) or a PDF, up to 10 MB. Staff only: the family never sees it.</p>
            </div>
          )
        ) : null}
        {busy ? (
          <p role="status" aria-live="polite" className="m-0 text-muted">
            {busy.kind === "uploading" ? `Uploading ${busy.name}… ${busy.pct}%` : `Keeping ${busy.name} with the payment…`}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="m-0 text-success">
            {done}
          </p>
        ) : null}
        {problem ? (
          <p role="alert" className="m-0 text-danger">
            {problem}
          </p>
        ) : null}
        <p className="m-0 text-xs text-muted">
          Photos open for the household&apos;s adults (their own confirmations) and for staff who record or view payments. Every staff view is logged. Nothing here is in an
          export, a search, an e-mail or a push.
        </p>
      </div>
    </details>
  );
}

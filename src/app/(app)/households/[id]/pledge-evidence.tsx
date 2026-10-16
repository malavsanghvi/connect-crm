"use client";

import { useState, useTransition } from "react";

import { Badge, buttonClass } from "@/components/ui";
import { evidenceState, evidenceTitle, evidenceWhen, fileLine, keptUntilText } from "@/lib/pledge-evidence";

import { loadPledgeEvidenceAction, openEvidenceFileAction, type EvidenceItemView } from "./evidence-actions";

type Loaded = { state: "idle" } | { state: "loading" } | { state: "error"; error: string } | { state: "ok"; items: EvidenceItemView[] };

const TONE = { ok: "success", warn: "warning", bad: "danger", info: "navy", muted: "neutral" } as const;

/**
 * The Evidence of one pledge, opened on demand: every proof and file connected to it, in any status (app.pledge_evidence). Staff see
 * everything, including the record of a removed file. A file opens through a link that lasts 10 minutes and is made at the click, so
 * every open is the person's own and is noted. Nothing here can change a pledge, a proof or a payment.
 */
export function PledgeEvidence({ pledgeId, reference, currency, locale, timeZone }: { pledgeId: string; reference: string; currency: string; locale?: string; timeZone: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "idle" });
  const [opening, setOpening] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function load() {
    setLoaded({ state: "loading" });
    startTransition(async () => {
      try {
        const r = await loadPledgeEvidenceAction(pledgeId);
        setLoaded(r.ok ? { state: "ok", items: r.data ?? [] } : { state: "error", error: r.error });
      } catch (err) {
        console.error("[household] loading the evidence failed:", err);
        setLoaded({ state: "error", error: "Could not load the evidence — the server did not respond. Try again." });
      }
    });
  }

  function open(fileId: string) {
    setFileError(null);
    setOpening(fileId);
    startTransition(async () => {
      try {
        const r = await openEvidenceFileAction(pledgeId, fileId);
        if (!r.ok || !r.data) setFileError(r.ok ? "Could not open the file — no link came back." : r.error);
        else window.open(r.data.url, "_blank", "noopener,noreferrer");
      } catch (err) {
        console.error("[household] opening an evidence file failed:", err);
        setFileError("Could not open the file — the server did not respond. Try again.");
      } finally {
        setOpening(null);
      }
    });
  }

  return (
    <details
      className="mt-1"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && (loaded.state === "idle" || loaded.state === "error")) load();
      }}
    >
      <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-navy">
        Evidence<span className="sr-only"> for {reference}</span>
      </summary>
      <div className="mt-2 w-[min(32rem,80vw)] space-y-2 whitespace-normal rounded-lg border border-line bg-white p-3 text-sm">
        {loaded.state === "loading" || loaded.state === "idle" ? <p className="text-muted">Loading the evidence…</p> : null}
        {loaded.state === "error" ? (
          <div role="alert" className="text-danger">
            <p>{loaded.error}</p>
            {loaded.error !== "You don't have access to this area." ? (
              <button type="button" onClick={load} className={`${buttonClass("ghost", "xs")} mt-1 min-h-[36px]`}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {loaded.state === "ok" && loaded.items.length === 0 ? (
          <p className="text-muted">No confirmation or file is connected to this pledge. Evidence appears here when a family sends a payment confirmation, or when staff attach a photo of a check or receipt to a payment.</p>
        ) : null}
        {loaded.state === "ok"
          ? loaded.items.map((item, i) => {
              const st = evidenceState(item);
              const when = evidenceWhen({ ...item, files: [] }, timeZone);
              return (
                <div key={`${item.proofId ?? item.paymentId ?? "x"}-${i}`} className="space-y-1 rounded-lg border border-line px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <strong>{evidenceTitle({ ...item, files: [] }, currency, locale)}</strong>
                    <Badge tone={TONE[st.tone]}>{st.label}</Badge>
                  </div>
                  {when ? <p className="m-0 text-muted">{when}</p> : null}
                  {item.reason ? <p className="m-0 text-muted">Reason given: {item.reason}</p> : null}
                  {item.files.length === 0 ? <p className="m-0 text-muted">No file was attached.</p> : null}
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {item.files.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2">
                        <span className={f.removed ? "text-muted" : ""}>{fileLine({ ...f, storagePath: "" }, timeZone)}</span>
                        {f.removed ? null : (
                          <button type="button" onClick={() => open(f.id)} disabled={opening === f.id} className={`${buttonClass("ghost", "xs")} min-h-[36px]`}>
                            {opening === f.id ? "Opening…" : "Open"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-xs text-muted">{keptUntilText(item, timeZone)}. The family can open it until then, from every pledge it credited.</p>
                </div>
              );
            })
          : null}
        {fileError ? (
          <p role="alert" className="text-danger">
            {fileError}
          </p>
        ) : null}
        <p className="m-0 text-xs text-muted">
          Photos open for the household&apos;s adults and for staff who verify payments. Every staff view is logged. Nothing here is in an
          export, a search, an e-mail or a push.
        </p>
      </div>
    </details>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { verifyStepUpAction } from "@/app/security-actions";
import { Alert, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import {
  codeFailed,
  dialogNote,
  needMark,
  platformRow,
  requestedLine,
  switchDoneMessage,
  switchFormProblem,
  type PlatformChip,
  type Product,
} from "@/lib/marketplace";

import { setProductAction } from "./actions";

export type AuditLine = { at: string; what: string; why: string };

const CHIP_CLASS: Record<PlatformChip["tone"], string> = {
  core: "border-navy-50 bg-navy-50 text-navy",
  on: "border-success-50 bg-success-50 text-success",
  off: "border-line bg-white text-ink-2",
  coming: "border-line-soft bg-highlight text-muted",
};

type Open = { key: string; turningOn: boolean };

export function ProductsClient({
  centerId,
  centerName,
  products,
  audit,
  auditError,
  timeZone,
}: {
  centerId: string;
  centerName: string;
  products: Product[];
  audit: AuditLine[] | null;
  auditError: string | null;
  timeZone: string;
}) {
  const router = useRouter();
  const reasonId = useId();
  const codeId = useId();
  const [open, setOpen] = useState<Open | null>(null);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [working, startTransition] = useTransition();
  const requests = products.filter((p) => p.state === "requested");

  function start(p: Product, turningOn: boolean, presetReason = "") {
    setOpen({ key: p.key, turningOn });
    setReason(presetReason);
    setCode("");
    setError(null);
    setDone(null);
  }

  function confirm(p: Product, turningOn: boolean) {
    const problem = switchFormProblem(reason, code);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        // A fresh code for every change: the step-up flow's own check, which upgrades the session for the change below.
        const verified = await verifyStepUpAction(code.trim());
        if (!verified.ok) {
          setError(codeFailed(verified.error));
          return;
        }
        const res = await setProductAction(centerId, p.key, p.name, turningOn, reason);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(null);
        setReason("");
        setCode("");
        setDone(switchDoneMessage(p.name, centerName, turningOn, res.data?.emailed === true, res.data?.emailStatus ?? null));
        router.refresh();
      } catch (err) {
        console.error("[platform/products] the switch failed:", err);
        setError(`Could not turn ${turningOn ? "on" : "off"} ${p.name} — the server did not respond. Nothing was changed. Try again.`);
      }
    });
  }

  return (
    <div className="space-y-4">
      {done ? (
        <Alert tone="success">
          <span role="status">{done}</span>
        </Alert>
      ) : null}

      <div className="grid grid-cols-12 items-start gap-4">
        <section aria-label="Products" className="cc-card col-span-12 p-[18px] lg:col-span-7">
          <h2 className="cc-card-title">Products</h2>
          <ul className="mt-3 divide-y divide-line-soft">
            {products.map((p) => {
              const row = platformRow(p, timeZone);
              const isOpen = open?.key === p.key;
              const turningOn = isOpen ? open.turningOn : row.action === "on";
              const checks = turningOn ? p.needs : [];
              return (
                <li key={p.key} data-product={p.key} className="py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span aria-hidden="true" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-navy text-[13px] font-bold text-white">
                      {p.mark}
                    </span>
                    <div className="min-w-[12rem] flex-1">
                      <p className="text-[13px] font-bold text-ink">{p.name}</p>
                      <p className="text-[12px] text-muted">{row.source}</p>
                    </div>
                    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${CHIP_CLASS[row.chip.tone]}`}>
                      {row.chip.label}
                    </span>
                    {row.action ? (
                      <button
                        type="button"
                        className={buttonClass(row.action === "on" ? "primary" : "bad", "xs")}
                        disabled={working}
                        onClick={() => start(p, row.action === "on")}
                      >
                        {row.action === "on" ? "Turn on" : "Turn off"}
                      </button>
                    ) : null}
                  </div>

                  {isOpen ? (
                    <div role="group" aria-label={`${turningOn ? "Turn on" : "Turn off"} ${p.name} for ${centerName}`} className="mt-3 space-y-3 rounded-[12px] border border-line bg-highlight p-3">
                      <h3 className="text-[13px] font-bold text-ink">
                        {turningOn ? "Turn on" : "Turn off"} {p.name} for {centerName}
                      </h3>
                      {checks.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Checks</p>
                          {checks.map((n) => (
                            <div key={n.module} className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                              <span className="text-ink-2">{n.label}</span>
                              <span className={`font-bold ${n.on ? "text-success" : "text-danger"}`}>{needMark(n)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <p className="rounded-[10px] border border-line bg-white px-3 py-2 text-[13px] text-ink-2">{dialogNote(p, turningOn)}</p>
                      <div className="space-y-1">
                        <label htmlFor={reasonId} className="block text-[13px] font-bold text-ink">
                          Reason (saved in the audit log)
                        </label>
                        <textarea
                          id={reasonId}
                          rows={2}
                          className="crm-input w-full"
                          value={reason}
                          maxLength={500}
                          placeholder="For example: request from the community's admin, reviewed"
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor={codeId} className="block text-[13px] font-bold text-ink">
                          Code from your authenticator app
                        </label>
                        <input
                          id={codeId}
                          className="crm-input w-36 font-mono tracking-widest"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          placeholder="6 digits"
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                        />
                        <p className="text-[12px] text-muted">A fresh code is needed for every change, even if you signed in a minute ago.</p>
                      </div>
                      {error ? <Alert tone="danger">{error}</Alert> : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass(turningOn ? "primary" : "bad-solid", "sm")}
                          disabled={working}
                          onClick={() => confirm(p, turningOn)}
                        >
                          {working ? "Checking…" : `${turningOn ? "Turn on" : "Turn off"} ${p.name}`}
                        </button>
                        <button type="button" className={buttonClass("ghost", "sm")} disabled={working} onClick={() => setOpen(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="col-span-12 space-y-4 lg:col-span-5">
          <section aria-label="Requests" className="cc-card p-[18px]">
            <h2 className="cc-card-title">Requests</h2>
            {requests.length === 0 ? (
              <p className="cc-empty mt-2">No open requests.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {requests.map((p) => (
                  <li key={p.key} className="space-y-1 rounded-[12px] border border-line p-3 text-[13px]" data-request={p.key}>
                    <strong className="block text-ink">{p.name}</strong>
                    <span className="block text-muted">{requestedLine(p, timeZone, " (community admin)")}</span>
                    {p.requestNote ? <span className="block italic text-ink-2">“{p.requestNote}”</span> : null}
                    <button
                      type="button"
                      className={buttonClass("primary", "xs")}
                      disabled={working}
                      onClick={() =>
                        start(
                          p,
                          true,
                          `Request from ${p.requestedByName ?? "the community"}${p.requestedAt ? ` (${formatDate(p.requestedAt, timeZone)})` : ""}, reviewed`,
                        )
                      }
                    >
                      Review and turn on
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Audit log" className="cc-card p-[18px]">
            <h2 className="cc-card-title">Audit log</h2>
            {auditError ? (
              <div className="mt-2">
                <Alert tone="danger">{auditError}</Alert>
              </div>
            ) : !audit || audit.length === 0 ? (
              <p className="cc-empty mt-2">No product changes yet.</p>
            ) : (
              <ol className="mt-3 space-y-2.5">
                {audit.map((a, i) => (
                  <li key={`${a.at}-${i}`} className="grid grid-cols-[4.5rem_1fr] gap-x-3 text-[13px]">
                    <span className="text-muted">{formatDate(a.at, timeZone)}</span>
                    <span className="text-ink">{a.what}</span>
                    {a.why ? <span className="col-start-2 text-[12px] text-muted">{a.why}</span> : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

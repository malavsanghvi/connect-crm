"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { KindPicker } from "@/components/kind-picker";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { StatusText, buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/errors";
import type { Experience } from "@/lib/experiences";
import { ownerEmailText, type KindPreview } from "@/lib/kind-change";

import { changeKindAction, previewKindChangeAction } from "./actions";

/**
 * Platform › the organization › Kind of organization: the current kind, and "Change…" with a preview of what
 * will be hidden or become available, a reason, and a fresh 2FA check (app.set_center_category). Nothing is
 * deleted: the modules a kind does not have are hidden, and changing back restores them.
 */
export function KindPanel({
  centerId,
  centerName,
  currentKey,
  experiences,
  sandbox,
}: {
  centerId: string;
  centerName: string;
  currentKey: string;
  experiences: Experience[];
  /** A live organization may only change to an active kind; a sandbox may preview any. */
  sandbox: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const toast = useToast();
  const stepUp = useStepUp();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Experience | null>(null);
  const [preview, setPreview] = useState<KindPreview | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<KindPreview | null>(null);
  const [working, start] = useTransition();
  const current = experiences.find((e) => e.key === currentKey);
  const target = picked && picked.key !== currentKey ? picked : null;
  const previewIsCurrent = Boolean(target && preview && preview.to.key === target.key);

  function pick(kind: Experience | null) {
    setPicked(kind);
    setPreview(null);
    setError(null);
  }

  function runPreview() {
    if (!target) return;
    setError(null);
    start(async () => {
      try {
        const res = await previewKindChangeAction(centerId, target.key);
        if (!res.ok || !res.data) {
          const msg = res.ok ? "Could not preview the change — nothing came back. Try again." : res.error;
          setError(msg);
          toast?.show(msg, "bad");
          return;
        }
        setPreview(res.data);
      } catch (err) {
        console.error("[platform/kind] preview failed:", err);
        setError("Could not preview the change — the server did not respond. Try again.");
      }
    });
  }

  function confirm() {
    if (!target || !previewIsCurrent) return;
    if (!reason.trim()) {
      setError("Say why — the reason goes in the audit log and in the email to the owner.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        const call = (): Promise<ActionResult<KindPreview>> => changeKindAction(centerId, target.key, reason);
        const res = stepUp ? await stepUp.run(call, "Changing the kind of organization") : await call();
        if (!res.ok) {
          setError(res.error);
          toast?.show(res.error, "bad");
          return;
        }
        toast?.show(res.message ?? "Kind of organization changed", "ok");
        setDone(res.data ?? null);
        setOpen(false);
        setPicked(null);
        setPreview(null);
        setReason("");
        router.refresh();
      } catch (err) {
        console.error("[platform/kind] change failed:", err);
        setError("Could not change the kind of organization — the server did not respond. Reload this page to see whether it changed before trying again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 text-[13px]" data-testid="kind-panel">
      <p>
        <span className="font-display text-[18px] font-semibold text-ink" data-testid="current-kind">
          {current?.label ?? currentKey}
        </span>
        {current?.familyLabel && current.faithBased ? <span className="ml-2 text-muted">{current.familyLabel}</span> : null}
        {current && !current.active ? <span className="ml-2 font-semibold text-brown">Preview only</span> : null}
      </p>
      {current?.description ? <p className="text-muted">{current.description}</p> : null}
      <p className="text-muted">
        The kind sets which modules {centerName} has, the words its screens and member app use, and its Setup checklist. It is chosen when the organization is created; changing it is a
        Weaver-only step that needs a reason and a fresh 2FA check. Nothing is deleted, and changing back restores everything.
      </p>

      {done ? (
        <div role="status" className="rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-success-900" data-testid="kind-changed">
          <p className="font-bold">Changed to {done.to.label}.</p>
          {done.summary.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {done.summary.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1">
            <StatusText tone={ownerEmailText(done.emailStatus).tone}>{ownerEmailText(done.emailStatus).text}</StatusText>
          </p>
        </div>
      ) : null}

      {!open ? (
        <div>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => (setOpen(true), setDone(null))}>
            Change…
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[12px] border border-line bg-canvas p-3">
          <KindPicker experiences={experiences} includeInactive={sandbox} name="kind" defaultKey={currentKey} label="Change to" onChange={pick} />
          {target ? (
            <div>
              <button type="button" className={buttonClass("ghost", "sm")} disabled={working} onClick={runPreview}>
                {working && !previewIsCurrent ? "Checking…" : `Preview what changes for ${target.label}`}
              </button>
            </div>
          ) : picked ? (
            <p className="text-muted">That is the current kind. Choose a different one to change it.</p>
          ) : null}

          {previewIsCurrent && preview ? (
            <div data-testid="kind-preview" className="rounded-[10px] border border-navy/20 bg-navy-50 px-3 py-2 text-navy">
              <p className="font-bold">
                {preview.from.label} → {preview.to.label}
              </p>
              <ul className="mt-1 list-disc pl-5">
                {preview.summary.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              {preview.summary.length === 0 ? <p className="mt-1">Nothing is hidden and nothing new becomes available.</p> : null}
            </div>
          ) : null}

          {previewIsCurrent && target ? (
            <div>
              <label htmlFor={`${id}-reason`} className="crm-label">
                Reason (goes in the audit log and in the email to the owner)
              </label>
              <textarea
                id={`${id}-reason`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
                className="crm-input w-full"
                placeholder="For example: the church applied as a Neutral organization by mistake"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={buttonClass("warn", "sm")} disabled={working} onClick={confirm}>
                  {working ? "Changing…" : `Change to ${target.label}`}
                </button>
                <button type="button" className={buttonClass("ghost", "sm")} disabled={working} onClick={() => (setOpen(false), pick(null))}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => (setOpen(false), pick(null))}>
                Cancel
              </button>
            </div>
          )}
          {error ? (
            <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-danger">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

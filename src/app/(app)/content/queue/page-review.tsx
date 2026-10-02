"use client";

import { createContext, useContext, useId, useState, useTransition, type ReactNode } from "react";

import { ActionMessage, type FormAction } from "@/components/action-form";
import { Drawer } from "@/components/drawer";
import { Modal } from "@/components/modal";
import { useStepUp } from "@/components/step-up";
import { useToast } from "@/components/toast";
import { Alert, buttonClass, InfoBox, StatusText, type ButtonVariant } from "@/components/ui";
import { refCode } from "@/lib/comms";
import { splitConfirmMessage } from "@/lib/confirm";
import type { ActionResult } from "@/lib/errors";
import { displayUrl, isNivaRetryFailure, nivaBodyLength, NIVA_SOURCE_MAX_CHARS, publishPageConfirm, publishSourceConfirm, sectionCount } from "@/lib/niva-queue";

import { decideContentAction, decideNivaPageAction, retryNivaQuestionsAction } from "../actions";

// Content › Approval queue: the decisions taken from a row or from the Review drawer. A decision
// that succeeds takes its row off the page (the queue reloads), which would take its message with
// it, so every outcome is also kept in the banner above the queue until the next one.

type Report = (r: ActionResult) => void;
const ResultContext = createContext<Report | null>(null);

/**
 * Wraps the queue: the latest decision's outcome stays on screen above it, green or red. When a source
 * was published but its unanswered questions could not be queued again, the banner offers that again.
 */
export function QueueResults({ children }: { children: ReactNode }) {
  const [last, setLast] = useState<ActionResult | null>(null);
  return (
    <ResultContext.Provider value={setLast}>
      {last ? (
        <div className="mb-3">
          <Alert
            tone={last.ok ? "success" : "danger"}
            action={
              <div className="flex flex-wrap items-center gap-2">
                {!last.ok && isNivaRetryFailure(last.error) ? <RetryQuestionsButton /> : null}
                <button type="button" onClick={() => setLast(null)} className={buttonClass(last.ok ? "ghost" : "bad", "xs")}>
                  Dismiss
                </button>
              </div>
            }
          >
            {last.ok ? last.message : last.error}
          </Alert>
        </div>
      ) : null}
      {children}
    </ResultContext.Provider>
  );
}

/** Queue Niva's unanswered questions again (the sources stay published); the outcome replaces the banner. */
function RetryQuestionsButton() {
  const d = useDecision("try Niva's unanswered questions again");
  return (
    <button type="button" disabled={d.pending} onClick={() => d.run(retryNivaQuestionsAction, {})} className={buttonClass("ok", "xs")}>
      {d.pending ? "Trying…" : "Try the questions again"}
    </button>
  );
}

/** Run a queue decision: asks for a fresh 2FA check if the database wants one, then reports the outcome. */
function useDecision(label: string) {
  const report = useContext(ResultContext);
  const toast = useToast();
  const stepUp = useStepUp();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  function run(action: FormAction, fields: Record<string, string>, onDone?: (r: ActionResult) => void) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    setResult(null);
    startTransition(async () => {
      const call = () => action(null, fd) as Promise<ActionResult>;
      const r = stepUp ? await stepUp.run(call, label) : await call();
      setResult(r);
      report?.(r);
      if (r.ok) {
        if (r.message) toast?.show(r.message, "ok");
      } else toast?.show(r.error, "bad");
      onDone?.(r);
    });
  }
  return { run, pending, result };
}

function ConfirmModal({ message, confirmLabel, tone, onConfirm, onCancel }: { message: string | null; confirmLabel: string; tone: "ok" | "bad"; onConfirm: () => void; onCancel: () => void }) {
  const parts = message ? splitConfirmMessage(message) : null;
  return (
    <Modal open={parts !== null} kicker="Please confirm" title={parts?.title ?? ""} confirmLabel={confirmLabel} tone={tone} onCancel={onCancel} onConfirm={onConfirm}>
      {parts?.body ?? undefined}
    </Modal>
  );
}

/** A decision button that asks first (the question becomes the modal's title). */
function ConfirmButton({
  label,
  pendingLabel,
  confirm,
  variant,
  size = "xs",
  pending,
  onConfirm,
}: {
  label: string;
  pendingLabel: string;
  confirm: string | null;
  variant: ButtonVariant;
  size?: "xs" | "sm" | "md";
  pending: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => (confirm ? setAsking(true) : onConfirm())}
        className={buttonClass(variant, size)}
      >
        {pending ? pendingLabel : label}
      </button>
      <ConfirmModal
        message={asking ? confirm : null}
        confirmLabel={label}
        tone={variant === "bad" ? "bad" : "ok"}
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          onConfirm();
        }}
      />
    </>
  );
}

/** "What should the author change?" — a reason, then the return; shown in place under the section or page. */
function ReturnBox({ what, pending, onReturn, onCancel }: { what: string; pending: boolean; onReturn: (reason: string) => void; onCancel: () => void }) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-[10px] border border-line p-3">
      <label htmlFor={id} className="crm-label">
        What should the author change in {what}?
      </label>
      <textarea
        id={id}
        rows={3}
        value={reason}
        maxLength={500}
        onChange={(e) => {
          setReason(e.currentTarget.value);
          setMissing(false);
        }}
        className="crm-input"
      />
      {missing ? (
        <p role="alert" className="text-[12px] text-danger">
          Say what the author should change; it is kept with the item&apos;s history.
        </p>
      ) : (
        <p className="crm-hint">It goes back to its author as a draft. The reason is kept with the item&apos;s history.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => (reason.trim() ? onReturn(reason.trim()) : setMissing(true))}
          className={buttonClass("bad", "xs")}
        >
          {pending ? "Returning…" : "Return to author"}
        </button>
        <button type="button" disabled={pending} onClick={onCancel} className={buttonClass("ghost", "xs")}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The text of an item, as Niva or the member app will show it. */
function ItemText({ body }: { body: string | null }) {
  if (!body?.trim()) return <StatusText tone="warn">No text — nothing for members or Niva to read yet.</StatusText>;
  return <InfoBox className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{body}</InfoBox>;
}

function charsLine(body: string | null): string {
  const n = nivaBodyLength(body);
  return `${n.toLocaleString("en-US")} characters${n > NIVA_SOURCE_MAX_CHARS ? " — longer than Niva reads in full" : ""}`;
}

// ---------------------------------------------------------------------------
// One item (anything that is not an imported page)
// ---------------------------------------------------------------------------

/** Approve one item. A Niva source asks first; its result says how many questions Niva will try again. */
export function ApproveItemButton({ id, title, niva, size = "xs" }: { id: string; title: string; niva: boolean; size?: "xs" | "md" }) {
  const d = useDecision(`publish “${title}”`);
  return (
    <div className="flex flex-col items-end">
      <ConfirmButton
        label={niva ? "Publish to Niva" : "Approve"}
        pendingLabel="Publishing…"
        confirm={niva ? publishSourceConfirm(title) : null}
        variant="ok"
        size={size}
        pending={d.pending}
        onConfirm={() => d.run(decideContentAction, { id, decision: "approve" })}
      />
      {d.result && !d.result.ok ? <ActionMessage state={d.result} /> : null}
    </div>
  );
}

/** "Read": the item's full text in the drawer, so it is never approved unseen. */
export function ItemTextButton({ id, title, kindLabel, body, niva, canApprove }: { id: string; title: string; kindLabel: string; body: string | null; niva: boolean; canApprove: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("ghost", "xs")}>
        Read
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        kicker={`${refCode("CT", id)} · ${kindLabel}`}
        title={title}
        subtitle={niva ? `Niva quotes only this text. ${charsLine(body)}.` : undefined}
        footer={canApprove ? <ApproveItemButton id={id} title={title} niva={niva} size="md" /> : undefined}
      >
        <ItemText body={body} />
      </Drawer>
    </>
  );
}

// ---------------------------------------------------------------------------
// An imported web page: all its sections in one row
// ---------------------------------------------------------------------------

export type ReviewSection = { id: string; heading: string; title: string; body: string | null };
export type ReviewPage = { url: string; title: string; sections: ReviewSection[] };

function SectionReview({ s, canApprove }: { s: ReviewSection; canApprove: boolean }) {
  const d = useDecision(`return “${s.title}”`);
  const [returning, setReturning] = useState(false);
  return (
    <section className="flex flex-col gap-2 border-b border-line pb-4 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-bold text-ink">{s.heading}</h3>
        <span className="font-mono text-[12px] text-muted">{refCode("CT", s.id)}</span>
      </div>
      <ItemText body={s.body} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-muted">{charsLine(s.body)}</span>
        {canApprove && !returning ? (
          <button type="button" onClick={() => setReturning(true)} className={buttonClass("bad", "xs")}>
            Return
          </button>
        ) : null}
      </div>
      {returning ? (
        <ReturnBox
          what="this section"
          pending={d.pending}
          onCancel={() => setReturning(false)}
          onReturn={(reason) => d.run(decideContentAction, { id: s.id, decision: "return", reason })}
        />
      ) : null}
      {d.result && !d.result.ok ? <ActionMessage state={d.result} /> : null}
    </section>
  );
}

/**
 * A page's queue actions: Review (every section's title and full text, each with its own Return) and,
 * for an approver, Publish all, which asks first and publishes exactly the sections shown.
 */
export function NivaPageReview({ page, canApprove }: { page: ReviewPage; canApprove: boolean }) {
  const [open, setOpen] = useState(false);
  const [returningAll, setReturningAll] = useState(false);
  const d = useDecision(`publish “${page.title}”`);
  const n = page.sections.length;
  const fields = { source_url: page.url, ids: page.sections.map((s) => s.id).join(",") };
  const publish = () => d.run(decideNivaPageAction, { ...fields, decision: "approve" });

  const footer = canApprove ? (
    <div className="flex w-full flex-col gap-2">
      {returningAll ? (
        <ReturnBox
          what="the whole page"
          pending={d.pending}
          onCancel={() => setReturningAll(false)}
          onReturn={(reason) => d.run(decideNivaPageAction, { ...fields, decision: "return", reason })}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmButton
            label={n === 1 ? "Publish the section" : `Publish all ${n} sections`}
            pendingLabel="Publishing…"
            confirm={publishPageConfirm(n)}
            variant="ok"
            size="md"
            pending={d.pending}
            onConfirm={publish}
          />
          <button type="button" disabled={d.pending} onClick={() => setReturningAll(true)} className={buttonClass("bad", "md")}>
            Return the whole page
          </button>
        </div>
      )}
      {d.result && !d.result.ok ? <ActionMessage state={d.result} /> : null}
    </div>
  ) : undefined;

  return (
    <div className="flex flex-col items-end">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => setOpen(true)} className={buttonClass("ghost", "xs")}>
          Review
        </button>
        {canApprove ? (
          <ConfirmButton label="Publish all" pendingLabel="Publishing…" confirm={publishPageConfirm(n)} variant="ok" pending={d.pending} onConfirm={publish} />
        ) : null}
      </div>
      {!open && d.result && !d.result.ok ? <ActionMessage state={d.result} /> : null}
      <Drawer
        open={open}
        onClose={() => {
          setOpen(false);
          setReturningAll(false);
        }}
        kicker={`Imported page · ${sectionCount(n)}`}
        title={page.title}
        subtitle={
          <a href={page.url} target="_blank" rel="noopener noreferrer" className="break-all underline">
            {displayUrl(page.url)}
          </a>
        }
        footer={footer}
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">
            Niva quotes these sections word for word once they are published. Read each one; return any that is wrong or out of date, then publish the rest.
          </p>
          {page.sections.map((s) => (
            <SectionReview key={s.id} s={s} canApprove={canApprove} />
          ))}
        </div>
      </Drawer>
    </div>
  );
}

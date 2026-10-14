"use client";

// Edit or delete a pledge, in place (owner request 2026-10-13; migration 0782; NEEDS OWNER OK). The household card at the top, what
// happens, then the fields of the pledge: amount, due date, what it is for, who pledged, dedication and recognition, and a reason that
// shows in the family's History. A field the database locked is shown as text with the database's own sentence (a pledge in
// QuickBooks, one that belongs to another screen, one with money applied, one with a write-off waiting). "Delete this pledge…" is a
// second step in the same sheet. The buttons save through editPledgeAction and deletePledgeAction (giving.manage); a result shows
// only after the server said so. No money moves. Enter never submits (there is no form).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { buttonClass } from "@/components/ui";
import { currencySymbol } from "@/lib/community-format";
import {
  DELETE_REASONS,
  DELETE_REASON_PROMPT,
  DELETE_WHAT,
  EDIT_REASONS,
  EDIT_REASON_PROMPT,
  RECOGNITION_MAX,
  checkEditReason,
  deleteButtonLabel,
  deletedMessage,
  diffPledgeEdit,
  editButtonLabel,
  editedMessage,
  editWhatHappens,
  formFromState,
  type PledgeEditForm,
  type PledgeEditState,
} from "@/lib/giving-actions/edit-pledge";
import { DEDICATION_MAX, REASON_MAX, type PledgeSheetOptions } from "@/lib/giving-actions/record-pledge";
import type { GivingSheetContext } from "@/lib/giving-actions/record-sheet";
import type { Family } from "@/lib/giving-today/queue";
import { PLEDGE_STATUS_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

import { useGivingSheetBackend } from "./backend";
import { GivingSheet } from "./sheet";

const CHIP = "inline-flex min-h-[44px] items-center rounded-full border px-3.5 text-[14px] font-semibold";
const chipTone = (on: boolean) => (on ? "border-navy bg-navy-50 text-navy" : "border-line bg-white text-ink-2 hover:border-navy-300");

export type EditPledgeRequest = {
  pledgeId: string;
  /** Called once the server confirmed a change or a delete (a list can show the row as done). */
  onDone?: (message: string) => void;
};

type Loaded = { state: PledgeEditState; options: PledgeSheetOptions };
type Done = { kind: "edited" | "deleted"; message: string };

export function EditPledgeSheet({ ctx, request, onClose }: { ctx: GivingSheetContext; request: EditPledgeRequest; onClose: () => void }) {
  const backend = useGivingSheetBackend();
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; data: Loaded | null; error: string | null } | null>(null);
  const [family, setFamily] = useState<{ id: string; family: Family | null; error: string | null; attempt: number } | null>(null);
  const [familyAttempt, setFamilyAttempt] = useState(0);
  const [form, setForm] = useState<PledgeEditForm | null>(null);
  const [mode, setMode] = useState<"edit" | "delete">("edit");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, startTransition] = useTransition();

  // The pledge, what is locked on it, and the choices.
  useEffect(() => {
    let live = true;
    backend
      .pledgeEditSheet(request.pledgeId)
      .then((res) => {
        if (!live) return;
        if (res.ok && res.data) {
          setForm(formFromState(res.data.state));
          setLoaded({ attempt, data: res.data, error: null });
        } else {
          setLoaded({ attempt, data: null, error: res.ok ? "Could not open the pledge — it was not found." : res.error });
        }
      })
      .catch((err: unknown) => {
        console.error("[edit-pledge] loading the pledge failed:", err);
        if (live) setLoaded({ attempt, data: null, error: "Could not open the pledge — the server did not respond. Try again." });
      });
    return () => {
      live = false;
    };
  }, [backend, request.pledgeId, attempt]);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  const state = current?.data?.state ?? null;
  const options = current?.data?.options ?? null;
  const householdId = state?.householdId ?? null;

  // The household card, read before anything can be saved: a family is never confirmed by its name alone.
  useEffect(() => {
    if (!householdId) return;
    let live = true;
    backend
      .household(householdId)
      .then((res) => {
        if (!live) return;
        setFamily(
          res.ok && res.data
            ? { id: householdId, family: res.data, error: null, attempt: familyAttempt }
            : { id: householdId, family: null, error: res.ok ? "Could not open the family — it was not found." : res.error, attempt: familyAttempt },
        );
      })
      .catch((err: unknown) => {
        console.error("[edit-pledge] reading the family failed:", err);
        if (live) setFamily({ id: householdId, family: null, error: "Could not open the family — the server did not respond. Try again.", attempt: familyAttempt });
      });
    return () => {
      live = false;
    };
  }, [backend, householdId, familyAttempt]);
  const familyNow = family && family.id === householdId && family.attempt === familyAttempt ? family : null;

  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const symbol = currencySymbol({ currency: ctx.currency, locale: ctx.locale });
  const ref = state?.pledgeNumber ?? null;
  const diff = state && form ? diffPledgeEdit(state, form, ctx.today, money) : null;
  const fields = diff?.ok ? diff.value.fields : [];
  const reasonOk = checkEditReason(reason, mode === "delete" ? DELETE_REASON_PROMPT : EDIT_REASON_PROMPT).ok;
  const everythingLocked = !!state && !!state.locks.details;

  function patch(p: Partial<PledgeEditForm>) {
    setForm((f) => (f ? { ...f, ...p } : f));
    setError(null);
  }

  function save() {
    setError(null);
    if (!state || !diff) return;
    if (!diff.ok) return setError(diff.error);
    if (diff.value.fields.length === 0) return setError("Change something first, then save.");
    const why = checkEditReason(reason);
    if (!why.ok) return setError(why.error);
    startTransition(async () => {
      try {
        const res = await backend.editPledge({ pledgeId: state.pledgeId, changes: diff.value.changes, reason: why.value });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (!res.data) {
          setError("Could not confirm the pledge changed — open the family's Pledges to check before trying again.");
          return;
        }
        const message = res.message ?? editedMessage(res.data);
        setDone({ kind: "edited", message });
        request.onDone?.(message);
        router.refresh();
      } catch (err) {
        console.error("[edit-pledge] save failed:", err);
        setError("Could not change the pledge — the server did not respond. Open the family's Pledges to see whether it went through before trying again.");
      }
    });
  }

  function remove() {
    setError(null);
    if (!state) return;
    const why = checkEditReason(reason, DELETE_REASON_PROMPT);
    if (!why.ok) return setError(why.error);
    startTransition(async () => {
      try {
        const res = await backend.deletePledge({ pledgeId: state.pledgeId, reason: why.value });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (!res.data) {
          setError("Could not confirm the pledge was deleted — open the family's Pledges to check before trying again.");
          return;
        }
        const message = res.message ?? deletedMessage(res.data);
        setDone({ kind: "deleted", message });
        request.onDone?.(message);
        router.refresh();
      } catch (err) {
        console.error("[edit-pledge] delete failed:", err);
        setError("Could not delete the pledge — the server did not respond. Open the family's Pledges to see whether it went through before trying again.");
      }
    });
  }

  const loadingState = !current;
  const failed = current && !current.data ? current.error : null;
  const what = done ? null : state ? (
    mode === "delete" ? (
      <p className="m-0" data-testid="what-happens">
        {DELETE_WHAT}
      </p>
    ) : (
      <>
        <p className="m-0" data-testid="what-happens">
          {editWhatHappens(ref)}
        </p>
        {state.locks.qbo ? (
          <p className="m-0 mt-1 text-[13px] text-muted">
            This pledge is in QuickBooks ({state.locks.qbo}). Its amount, what it is for and Delete stay as they are until the books are changed first, so the two places always agree.
          </p>
        ) : null}
      </>
    )
  ) : null;

  const statusLabel = state ? ((PLEDGE_STATUS_LABEL as Record<string, string>)[state.status] ?? state.status) : null;
  const title = done ? (done.kind === "deleted" ? "Pledge deleted" : "Pledge updated") : mode === "delete" ? "Delete this pledge" : "Edit pledge";
  const confirmLabel = done || !state ? undefined : mode === "delete" ? deleteButtonLabel(ref, state.amountCents, ctx.currency, ctx.locale) : editButtonLabel(ref, fields);
  const confirmDisabled = mode === "delete" ? !reasonOk || !familyNow?.family : fields.length === 0 || !reasonOk || !familyNow?.family || (diff ? !diff.ok : true);

  return (
    <GivingSheet
      title={title}
      family={familyNow?.family ?? null}
      labels={ctx.labels}
      what={what}
      error={error}
      confirmLabel={confirmLabel}
      pendingLabel={mode === "delete" ? "Deleting…" : "Saving…"}
      pending={pending}
      confirmDisabled={confirmDisabled}
      tone={mode === "delete" ? "danger" : "primary"}
      cancelLabel="Cancel"
      onConfirm={mode === "delete" ? remove : save}
      onClose={onClose}
    >
      {loadingState ? <p className="m-0 text-[14px] text-muted">Opening the pledge…</p> : null}
      {failed ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-danger">
          {failed}
          <button
            type="button"
            onClick={() => {
              setLoaded(null);
              setAttempt((n) => n + 1);
            }}
            className="font-semibold underline"
          >
            Try again
          </button>
        </p>
      ) : null}
      {state && familyNow?.error ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-danger">
          {familyNow.error}
          <button type="button" onClick={() => setFamilyAttempt((n) => n + 1)} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}
      {state && !familyNow ? <p className="m-0 text-[14px] text-muted">Opening the family…</p> : null}

      {done ? (
        <div role="status" className="flex flex-col gap-2 rounded-[12px] border border-success/30 bg-success-50 px-3 py-2.5 text-[14px] text-success-900">
          <p className="m-0 font-bold">{done.message}</p>
          <p className="m-0">{done.kind === "deleted" ? "No money moved. It is under Closed (Cancelled), and the family's History has your reason." : "No money moved. The family's History shows what it was before, and your reason."}</p>
          {ctx.canOpenFamily && state ? (
            <div className="flex flex-wrap gap-2">
              <Link href={`/households/${state.householdId}?tab=giving`} className={`${buttonClass("ghost", "sm")} min-h-[44px]`}>
                Open family page
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {state && form && !done && mode === "edit" ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[13px] text-muted" data-testid="pledge-line">
            {ref ?? "Pledge"} · {statusLabel} · {money(state.paidCents)} paid of {money(state.amountCents)}
          </p>
          {everythingLocked ? (
            <p role="status" className="m-0 text-[13px] text-muted">
              {state.locks.details}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="epl-amount" className="crm-label">
                Pledge amount ({symbol})
              </label>
              <input
                id="epl-amount"
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                value={form.amount}
                onChange={(e) => patch({ amount: e.target.value })}
                disabled={!!state.locks.amount}
                className="crm-input min-h-[44px] text-[18px] font-bold tabular-nums"
              />
              <p className="crm-hint">{state.locks.amount ?? (state.paidCents > 0 ? `Not less than ${money(state.paidCents)}, which is already paid.` : "Up or down; the History keeps the old amount.")}</p>
            </div>
            <div>
              <label htmlFor="epl-due" className="crm-label">
                Due on
              </label>
              <input
                id="epl-due"
                type="date"
                min={state.pledgedOn}
                value={form.dueOn}
                onChange={(e) => patch({ dueOn: e.target.value })}
                disabled={!!state.locks.due}
                className="crm-input min-h-[44px]"
              />
              <p className="crm-hint">{state.locks.due ?? "Not before the day it was pledged."}</p>
            </div>
          </div>
          <div>
            <label htmlFor="epl-for" className="crm-label">
              For
            </label>
            <select
              id="epl-for"
              value={form.designation}
              onChange={(e) => patch({ designation: e.target.value })}
              disabled={!!state.locks.for || !!state.opportunityId}
              className="crm-input min-h-[44px]"
            >
              <option value="">General (no fund)</option>
              {options && options.funds.length > 0 ? (
                <optgroup label="Funds">
                  {options.funds.map((f) => (
                    <option key={f.id} value={`fund:${f.id}`}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {options && options.campaigns.length > 0 ? (
                <optgroup label="Campaigns">
                  {options.campaigns.map((c) => (
                    <option key={c.id} value={`campaign:${c.id}`}>
                      {c.fundName ? `${c.name} (${c.fundName})` : c.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            {state.locks.for ? <p className="crm-hint">{state.locks.for}</p> : null}
          </div>
          <div>
            <label htmlFor="epl-by" className="crm-label">
              Who pledged
            </label>
            <select
              id="epl-by"
              value={form.pledgedBy}
              onChange={(e) => patch({ pledgedBy: e.target.value })}
              disabled={everythingLocked}
              className="crm-input min-h-[44px]"
            >
              <option value="">The household (no one named)</option>
              {(options?.adults ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <p className="crm-hint">Adults of this household only.</p>
          </div>
          <details className="text-[14px]" open={!!state.dedication || !!state.recognitionName || state.anonymous}>
            <summary className="min-h-[44px] cursor-pointer py-2 font-semibold text-navy">Dedication and recognition</summary>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="epl-dedication" className="crm-label">
                  Dedication (optional)
                </label>
                <input
                  id="epl-dedication"
                  value={form.dedication}
                  onChange={(e) => patch({ dedication: e.target.value })}
                  maxLength={DEDICATION_MAX}
                  disabled={everythingLocked}
                  className="crm-input min-h-[44px]"
                />
              </div>
              <div>
                <label htmlFor="epl-recognition" className="crm-label">
                  Recognition name (optional)
                </label>
                <input
                  id="epl-recognition"
                  value={form.recognitionName}
                  onChange={(e) => patch({ recognitionName: e.target.value })}
                  maxLength={RECOGNITION_MAX}
                  disabled={everythingLocked}
                  className="crm-input min-h-[44px]"
                />
              </div>
            </div>
            <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[14px]">
              <input
                type="checkbox"
                className="h-[18px] w-[18px] flex-none"
                checked={form.anonymous}
                onChange={(e) => patch({ anonymous: e.target.checked })}
                disabled={everythingLocked}
              />
              Keep this pledge anonymous in recognition lists
            </label>
          </details>
          {diff && !diff.ok ? (
            <p role="alert" className="m-0 text-[13px] font-semibold text-danger">
              {diff.error}
            </p>
          ) : null}
          {!everythingLocked ? (
            <div>
              <label htmlFor="epl-reason" className="crm-label">
                Why it changes
              </label>
              <input
                id="epl-reason"
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                }}
                maxLength={REASON_MAX}
                placeholder="Family asked to change it"
                autoComplete="off"
                aria-describedby="epl-reason-hint"
                className="crm-input min-h-[44px]"
              />
              <p id="epl-reason-hint" className="crm-hint">
                Shows in the family&apos;s History, with what it was before.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {EDIT_REASONS.map((r) => (
                  <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`${CHIP} ${chipTone(reason === r)}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="border-t border-line-soft pt-3">
            {state.locks.delete ? (
              <p className="m-0 text-[13px] text-muted" data-testid="delete-locked">
                Cannot be deleted: {state.locks.delete}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setMode("delete");
                  setReason("");
                  setError(null);
                }}
                className={`${buttonClass("ghost", "sm")} min-h-[44px] text-danger`}
              >
                Delete this pledge…
              </button>
            )}
          </div>
        </div>
      ) : null}

      {state && !done && mode === "delete" ? (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[14px] font-bold text-ink">
            {ref ?? "Pledge"} · {money(state.amountCents)} · {statusLabel}
          </p>
          <div>
            <label htmlFor="epl-del-reason" className="crm-label">
              Why it is deleted
            </label>
            <input
              id="epl-del-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              maxLength={REASON_MAX}
              placeholder="Recorded twice by mistake"
              autoComplete="off"
              className="crm-input min-h-[44px]"
            />
            <p className="crm-hint">Shows in the family&apos;s History.</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DELETE_REASONS.map((r) => (
                <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={`${CHIP} ${chipTone(reason === r)}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setMode("edit");
              setReason("");
              setError(null);
            }}
            className="min-h-[36px] self-start text-[13px] font-semibold text-navy underline"
          >
            Back to editing
          </button>
        </div>
      ) : null}
    </GivingSheet>
  );
}

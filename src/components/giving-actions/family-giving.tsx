"use client";

// A family's giving, in place in Giving (docs/GIVING_REDESIGN.md section 4: "a slide-over for a family's giving"): the household card,
// what it owes, its open pledges and its last gifts, with Record payment and a link to the Family page. On a computer it slides in
// from the right; on a phone it is a bottom sheet. READ ONLY: nothing here changes data, and nothing about editing people lives here.
// Esc and Close close it, focus stays inside while it is open and goes back to what opened it. A child is never named.

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { buttonClass } from "@/components/ui";
import {
  owesLine,
  paymentDetail,
  paymentTitle,
  pledgeDetail,
  pledgeTitle,
  type FamilyFocus,
  type FamilyGiving,
} from "@/lib/giving-actions/family-giving";
import type { GivingSheetContext } from "@/lib/giving-actions/record-sheet";
import { familyLine, type Family } from "@/lib/giving-today/queue";

import { useGivingSheetBackend } from "./backend";

type Loaded = { key: string; data: FamilyGiving | null; error: string | null };

export function FamilyGivingPanel({
  ctx,
  householdId,
  focus,
  onClose,
  onRecordPayment,
  onRecordPledge,
}: {
  ctx: GivingSheetContext;
  householdId: string;
  focus: FamilyFocus | null;
  onClose: () => void;
  /** Opens the Record payment sheet for this family (the slide-over closes). Absent: the person cannot record payments. */
  onRecordPayment?: (family: Family) => void;
  /** Opens the Record pledge sheet for this family (slice 7). Absent: the person cannot record pledges (giving.manage). */
  onRecordPledge?: (family: Family) => void;
}) {
  const backend = useGivingSheetBackend();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${householdId}|${focus?.kind ?? ""}|${focus?.id ?? ""}|${attempt}`;

  useEffect(() => {
    let live = true;
    backend
      .family(householdId, focus)
      .then((res) => {
        if (live) setLoaded(res.ok && res.data ? { key, data: res.data, error: null } : { key, data: null, error: res.ok ? "Could not open the family's giving." : res.error });
      })
      .catch((err: unknown) => {
        console.error("[family-giving] loading failed:", err);
        if (live) setLoaded({ key, data: null, error: "Could not open the family's giving — the server did not respond. Try again." });
      });
    return () => {
      live = false;
    };
    // `key` carries the household, the focus and the retry count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, key]);

  useEffect(() => {
    opener.current = document.activeElement;
    const t = window.setTimeout(() => panel.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      const back = opener.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const now = loaded && loaded.key === key ? loaded : null;
  const g = now?.data ?? null;
  const fam = g?.household ?? null;
  const focusId = g?.focus?.id ?? null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-ink/35 md:items-stretch" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="family-giving"
        className="flex max-h-[92vh] w-full flex-col gap-3 overflow-y-auto rounded-t-[22px] bg-white px-5 pb-5 pt-5 shadow-window outline-none md:max-h-none md:w-[460px] md:rounded-none md:rounded-l-[22px]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="m-0 font-display text-[22px] font-semibold leading-tight text-ink">
            {fam ? `${fam.name}: giving` : "Family giving"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[22px] leading-none text-muted hover:bg-canvas">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        {!now ? <p className="m-0 text-[14px] text-muted">Opening the family&apos;s giving…</p> : null}
        {now?.error ? (
          <div role="alert" className="flex flex-wrap items-center gap-2 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            <span className="flex-1">{now.error}</span>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className={`${buttonClass("ghost", "sm")} min-h-[44px]`}>
              Try again
            </button>
          </div>
        ) : null}

        {g && fam ? (
          <>
            <div className="rounded-[14px] border border-line bg-white px-3.5 py-2.5">
              <p className="m-0 text-[15px] font-bold text-ink">{fam.name}</p>
              <p className="m-0 text-[13px] leading-[1.4] text-muted">{familyLine(fam, ctx.labels)}</p>
            </div>
            <p className="m-0 rounded-field bg-ground px-3 py-2 text-[15px] font-bold text-ink" data-testid="family-owes">
              {owesLine(g, ctx.currency, ctx.locale)}
            </p>
            {g.problems.map((p) => (
              <p key={p} role="alert" className="m-0 text-[13px] text-danger">
                {p}{" "}
                <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-semibold underline">
                  Try again
                </button>
              </p>
            ))}
            <div className="flex flex-wrap gap-2">
              {onRecordPayment ? (
                <button type="button" onClick={() => onRecordPayment(fam)} className={`${buttonClass("primary")} min-h-[44px]`}>
                  Record payment
                </button>
              ) : null}
              {onRecordPledge ? (
                <button type="button" onClick={() => onRecordPledge(fam)} className={`${buttonClass("ghost")} min-h-[44px]`}>
                  Record pledge
                </button>
              ) : null}
              {ctx.canOpenFamily ? (
                <Link href={`/households/${fam.id}`} className={`${buttonClass("ghost")} min-h-[44px]`}>
                  Open family page
                </Link>
              ) : null}
            </div>

            <section aria-labelledby={`${titleId}-pl`}>
              <h3 id={`${titleId}-pl`} className="m-0 mb-1.5 text-[13px] font-bold uppercase tracking-[0.05em] text-muted">
                Open pledges
              </h3>
              {g.pledges.length === 0 ? (
                <p className="m-0 text-[14px] text-muted">No open pledge.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {g.pledges.map((p) => (
                    <li key={p.id} className={`rounded-field border px-3 py-2 text-[14px] ${p.id === focusId ? "border-navy bg-navy-50" : "border-line"}`}>
                      <span className="block font-bold text-ink">
                        {pledgeTitle(p)}
                        {p.id === focusId ? <span className="ml-2 text-[12px] font-bold text-navy">Found</span> : null}
                      </span>
                      <span className="block text-[13px] text-muted">{pledgeDetail(p, ctx.currency, ctx.locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby={`${titleId}-pay`}>
              <h3 id={`${titleId}-pay`} className="m-0 mb-1.5 text-[13px] font-bold uppercase tracking-[0.05em] text-muted">
                Last gifts
              </h3>
              {g.payments.length === 0 ? (
                <p className="m-0 text-[14px] text-muted">No gift recorded yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {g.payments.map((p) => (
                    <li key={p.id} className={`rounded-field border px-3 py-2 text-[14px] ${p.id === focusId ? "border-navy bg-navy-50" : "border-line"}`}>
                      <span className="block font-bold tabular-nums text-ink">
                        {paymentTitle(p, ctx.currency, ctx.locale)}
                        {p.id === focusId ? <span className="ml-2 text-[12px] font-bold text-navy">Found</span> : null}
                      </span>
                      <span className="block text-[13px] text-muted">{paymentDetail(p, ctx.currency, ctx.timeZone, ctx.locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/giving/payments?q=${encodeURIComponent(fam.number ?? fam.name)}`} className="mt-2 inline-flex min-h-[44px] items-center text-[14px] font-semibold text-navy underline">
                All of this family&apos;s payments
              </Link>
            </section>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

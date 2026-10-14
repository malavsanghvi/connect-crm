"use client";

// The Giving sheets, opened in place from anywhere in the New look (docs/GIVING_REDESIGN.md section 4, "In place"): the find box,
// Giving's Today, the Family page, the People panel, and the Pledges and Payments lists (slice 3). Mounted once in the shell, so one
// opener serves every page:
//
//   const sheets = useGivingSheets();
//   sheets?.openRecordPayment({ householdId, prefill, onRecorded });
//   sheets?.openFamilyGiving(householdId, { kind: "payment", id });
//   <RecordPaymentButton householdId={id} href={`/giving/payments?household=${id}`}>Record payment</RecordPaymentButton>
//   sheets?.openRecordPledge({ householdId, prefill });          (giving.manage only; slice 7)
//   <RecordPledgeButton householdId={id} />                       (nothing where no sheet can open: there is no other screen)
//   sheets?.openEditPledge({ pledgeId, onDone });                  (giving.manage only; 0782: edit or delete one pledge)
//   <EditPledgeButton pledgeId={id} />                             (nothing where no sheet can open)
//   sheets?.openEmailPledge({ pledgeId, onSent });                 (giving.manage only; 0792: email a pledge with its PDF)
//   <EmailPledgeButton pledgeId={id} />                            (nothing where no sheet can open)
//
// The sheets only open; the Record payment sheet's own button records (through the existing recordOfflinePaymentAction). Where no
// sheet can open (the classic look, or a person without Giving) useGivingSheets() is null and RecordPaymentButton is its plain link.

import Link from "next/link";
import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import type { RecordPaymentResult } from "@/app/(app)/giving/payments/actions";
import type { FamilyFocus } from "@/lib/giving-actions/family-giving";
import type { RecordedPledge, RecordPledgeRequest } from "@/lib/giving-actions/record-pledge";
import type { GivingSheetContext, RecordPaymentRequest } from "@/lib/giving-actions/record-sheet";
import type { EditPledgeRequest } from "./edit-pledge-sheet";
import type { EmailPledgeRequest } from "./email-pledge-sheet";

// The sheets (and the Server Actions behind them) load when one is first opened, not with every page of the shell.
const RecordPaymentSheet = lazy(() => import("./record-payment-sheet").then((m) => ({ default: m.RecordPaymentSheet })));
const FamilyGivingPanel = lazy(() => import("./family-giving").then((m) => ({ default: m.FamilyGivingPanel })));
const RecordPledgeSheet = lazy(() => import("./record-pledge-sheet").then((m) => ({ default: m.RecordPledgeSheet })));
const EditPledgeSheet = lazy(() => import("./edit-pledge-sheet").then((m) => ({ default: m.EditPledgeSheet })));
const EmailPledgeSheet = lazy(() => import("./email-pledge-sheet").then((m) => ({ default: m.EmailPledgeSheet })));

export type OpenRecordPayment = RecordPaymentRequest & {
  /** Called once the server confirmed the payment (a list can show the new row as done). */
  onRecorded?: (result: RecordPaymentResult) => void;
};

export type OpenRecordPledge = RecordPledgeRequest & {
  /** Called once the server confirmed the pledge. */
  onRecorded?: (result: RecordedPledge) => void;
};

export type GivingSheetsApi = {
  /** The person may record a payment (giving.record_offline or giving.manage). */
  canRecord: boolean;
  openRecordPayment: (request?: OpenRecordPayment) => void;
  openFamilyGiving: (householdId: string, focus?: FamilyFocus | null) => void;
  /** The person may record a pledge by hand (giving.manage; slice 7). */
  canRecordPledge: boolean;
  openRecordPledge: (request?: OpenRecordPledge) => void;
  /** The person may edit or delete a pledge (giving.manage; 0782). */
  canEditPledge: boolean;
  openEditPledge: (request: EditPledgeRequest) => void;
  /** The person may email a pledge with its PDF (giving.manage; 0792). */
  canEmailPledge: boolean;
  openEmailPledge: (request: EmailPledgeRequest) => void;
};

type Open =
  | { kind: "record"; request: OpenRecordPayment; n: number }
  | { kind: "pledge"; request: OpenRecordPledge; n: number }
  | { kind: "editPledge"; request: EditPledgeRequest; n: number }
  | { kind: "emailPledge"; request: EmailPledgeRequest; n: number }
  | { kind: "family"; householdId: string; focus: FamilyFocus | null; n: number }
  | null;

const GivingSheetsContext = createContext<GivingSheetsApi | null>(null);

/** The opener, or null where no Giving sheet can open (follow the link instead). */
export function useGivingSheets(): GivingSheetsApi | null {
  return useContext(GivingSheetsContext);
}

export function GivingSheetsProvider({ ctx, children }: { ctx: GivingSheetContext | null; children: ReactNode }) {
  const [open, setOpen] = useState<Open>(null);
  const count = useRef(0);
  const opener = useRef<Element | null>(null);
  const showing = useRef(false);

  // The element that opened the first sheet gets the focus back when the last one closes (a slide-over can hand over to a sheet).
  const remember = useCallback(() => {
    if (!showing.current) opener.current = document.activeElement;
    showing.current = true;
  }, []);

  const api = useMemo<GivingSheetsApi | null>(() => {
    if (!ctx) return null;
    return {
      canRecord: ctx.canRecord,
      openRecordPayment: (request = {}) => {
        if (!ctx.canRecord) return;
        remember();
        setOpen({ kind: "record", request, n: ++count.current });
      },
      openFamilyGiving: (householdId, focus = null) => {
        remember();
        setOpen({ kind: "family", householdId, focus, n: ++count.current });
      },
      canRecordPledge: ctx.canRecordPledge === true,
      openRecordPledge: (request = {}) => {
        if (ctx.canRecordPledge !== true) return;
        remember();
        setOpen({ kind: "pledge", request, n: ++count.current });
      },
      canEditPledge: ctx.canEditPledge === true,
      openEditPledge: (request) => {
        if (ctx.canEditPledge !== true) return;
        remember();
        setOpen({ kind: "editPledge", request, n: ++count.current });
      },
      canEmailPledge: ctx.canEmailPledge === true,
      openEmailPledge: (request) => {
        if (ctx.canEmailPledge !== true) return;
        remember();
        setOpen({ kind: "emailPledge", request, n: ++count.current });
      },
    };
  }, [ctx, remember]);

  function close() {
    setOpen(null);
    showing.current = false;
    const back = opener.current;
    opener.current = null;
    if (back instanceof HTMLElement && back.isConnected) window.setTimeout(() => back.focus(), 0);
  }

  return (
    <GivingSheetsContext.Provider value={api}>
      {children}
      <Suspense
        fallback={
          open ? (
            <p role="status" className="fixed inset-x-0 bottom-24 z-50 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-white shadow-lg">
              Opening…
            </p>
          ) : null
        }
      >
        {ctx && open?.kind === "record" ? (
          <RecordPaymentSheet key={open.n} ctx={ctx} request={open.request} onRecorded={open.request.onRecorded} onClose={close} />
        ) : null}
        {ctx && open?.kind === "pledge" ? (
          <RecordPledgeSheet key={open.n} ctx={ctx} request={open.request} onRecorded={open.request.onRecorded} onClose={close} />
        ) : null}
        {ctx && open?.kind === "editPledge" ? <EditPledgeSheet key={open.n} ctx={ctx} request={open.request} onClose={close} /> : null}
        {ctx && open?.kind === "emailPledge" ? <EmailPledgeSheet key={open.n} ctx={ctx} request={open.request} onClose={close} /> : null}
        {ctx && open?.kind === "family" ? (
          <FamilyGivingPanel
            key={open.n}
            ctx={ctx}
            householdId={open.householdId}
            focus={open.focus}
            onClose={close}
            onRecordPayment={ctx.canRecord ? (family) => setOpen({ kind: "record", request: { household: family }, n: ++count.current }) : undefined}
            onRecordPledge={ctx.canRecordPledge === true ? (family) => setOpen({ kind: "pledge", request: { household: family }, n: ++count.current }) : undefined}
          />
        ) : null}
      </Suspense>
    </GivingSheetsContext.Provider>
  );
}

/**
 * "Record payment": opens the sheet in place where the sheets are mounted (the New look), and is the ordinary link to the Record payment
 * screen everywhere else. `householdId` fills in the family (its card is read, never its name alone).
 */
export function RecordPaymentButton({ householdId, href, className, children }: { householdId?: string | null; href: string; className?: string; children: ReactNode }) {
  const sheets = useGivingSheets();
  if (!sheets?.canRecord) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={() => sheets.openRecordPayment(householdId ? { householdId } : {})}>
      {children}
    </button>
  );
}

/**
 * "Record pledge": opens the Record pledge sheet in place for someone with giving.manage where the sheets are mounted (the New look).
 * There is no Record pledge screen, so elsewhere (the classic look, or without the permission) it renders nothing.
 */
export function RecordPledgeButton({ householdId, className, children = "Record pledge" }: { householdId?: string | null; className?: string; children?: ReactNode }) {
  const sheets = useGivingSheets();
  if (!sheets?.canRecordPledge) return null;
  return (
    <button type="button" className={className} onClick={() => sheets.openRecordPledge(householdId ? { householdId } : {})}>
      {children}
    </button>
  );
}

/**
 * "Edit": opens the Edit pledge sheet in place for someone with giving.manage where the sheets are mounted (the New look). There is no
 * other Edit screen, so elsewhere (the classic look, or without the permission) it renders nothing.
 */
export function EditPledgeButton({ pledgeId, className, children = "Edit", label }: { pledgeId: string; className?: string; children?: ReactNode; label?: string }) {
  const sheets = useGivingSheets();
  if (!sheets?.canEditPledge) return null;
  return (
    <button type="button" className={className} aria-label={label} onClick={() => sheets.openEditPledge({ pledgeId })}>
      {children}
    </button>
  );
}

/**
 * "Email": opens the Email pledge sheet in place for someone with giving.manage where the sheets are mounted (the New look). There is no
 * other way to email a pledge, so elsewhere (the classic look, or without the permission) it renders nothing.
 */
export function EmailPledgeButton({ pledgeId, className, children = "Email", label }: { pledgeId: string; className?: string; children?: ReactNode; label?: string }) {
  const sheets = useGivingSheets();
  if (!sheets?.canEmailPledge) return null;
  return (
    <button type="button" className={className} aria-label={label} onClick={() => sheets.openEmailPledge({ pledgeId })}>
      {children}
    </button>
  );
}

/** A family that opens its giving in place where the sheets are mounted (Giving stays on screen), and its Family page elsewhere. */
export function FamilyGivingLink({ householdId, className, children }: { householdId: string; className?: string; children: ReactNode }) {
  const sheets = useGivingSheets();
  if (!sheets) {
    return (
      <Link href={`/households/${householdId}`} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={() => sheets.openFamilyGiving(householdId)}>
      {children}
    </button>
  );
}

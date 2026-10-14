"use client";

// Email a pledge, in place (⋯ › Email…; owner request 2026-10-14; migration 0792). The household card at the top, then the To box:
// a text box that starts with the household's PRIMARY member's email and can be edited, with whose address it is said under it. Whatever
// address is in the box when Send is pressed gets the pledge email, in the community's own wording, with the pledge's PDF attached.
// A primary member with no address leaves the box empty with a plain note, and the person types one. Nothing says "Sent" until the
// server says so: after Send the sheet asks how it went until it is sent, or says why it was not, with Send again. Enter never submits
// (there is no form). giving.manage; the database checks everything again and the pledge's History records who sent it where.

import { useEffect, useRef, useState, useTransition } from "react";

import { buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import type { GivingSheetContext } from "@/lib/giving-actions/record-sheet";
import type { Family } from "@/lib/giving-today/queue";
import { checkEmailAddress } from "@/lib/pledge-email/address";
import {
  defaultAddress,
  earlierLine,
  noAddressNote,
  outcomeMessage,
  queuedMessage,
  sendButtonLabel,
  whoseAddress,
  type PledgeEmailSheetData,
  type RequestStatus,
} from "@/lib/pledge-email/sheet";
import { formatCents } from "@/lib/money";

import { useGivingSheetBackend } from "./backend";
import { GivingSheet } from "./sheet";

export type EmailPledgeRequest = {
  pledgeId: string;
  /** Called once the server confirmed the email was sent. */
  onSent?: (to: string) => void;
};

/** How often, and for how long, the sheet asks how the email went. */
export const POLL_MS = 2000;
export const POLL_TRIES = 30;

function newKey(): string {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return `email-${c.randomUUID()}`;
  return `email-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

type Sent = { requestId: string; to: string; status: RequestStatus | null; pollsLeft: number };

export function EmailPledgeSheet({ ctx, request, onClose }: { ctx: GivingSheetContext; request: EmailPledgeRequest; onClose: () => void }) {
  const backend = useGivingSheetBackend();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; data: PledgeEmailSheetData | null; error: string | null } | null>(null);
  const [family, setFamily] = useState<{ id: string; family: Family | null; error: string | null; attempt: number } | null>(null);
  const [familyAttempt, setFamilyAttempt] = useState(0);
  const [address, setAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [pending, startTransition] = useTransition();
  // One confirmation key per intent to send: pressing Send twice is one email. A new key is made once the server has answered.
  const key = useRef(newKey());
  const onSentRef = useRef(request.onSent);
  useEffect(() => {
    onSentRef.current = request.onSent;
  });

  // The pledge, the primary member and their address, and what was sent before.
  useEffect(() => {
    let live = true;
    backend
      .pledgeEmailSheet(request.pledgeId)
      .then((res) => {
        if (!live) return;
        if (res.ok && res.data) {
          setAddress(defaultAddress(res.data.primary));
          setLoaded({ attempt, data: res.data, error: null });
        } else {
          setLoaded({ attempt, data: null, error: res.ok ? "Could not open the pledge to email it — it was not found." : res.error });
        }
      })
      .catch((err: unknown) => {
        console.error("[email-pledge] loading the pledge failed:", err);
        if (live) setLoaded({ attempt, data: null, error: "Could not open the pledge to email it — the server did not respond. Try again." });
      });
    return () => {
      live = false;
    };
  }, [backend, request.pledgeId, attempt]);

  const current = loaded && loaded.attempt === attempt ? loaded : null;
  const data = current?.data ?? null;
  const householdId = data?.pledge.householdId ?? null;

  // The household card, read before anything can be sent: a family is never confirmed by its name alone.
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
        console.error("[email-pledge] reading the family failed:", err);
        if (live) setFamily({ id: householdId, family: null, error: "Could not open the family — the server did not respond. Try again.", attempt: familyAttempt });
      });
    return () => {
      live = false;
    };
  }, [backend, householdId, familyAttempt]);
  const familyNow = family && family.id === householdId && family.attempt === familyAttempt ? family : null;

  // Where the email is: composing, sending (the service has not finished), sent, or not sent.
  const phase: "compose" | "sending" | "sent" | "not_sent" = !sent
    ? "compose"
    : sent.status?.status === "sent"
      ? "sent"
      : sent.status && sent.status.status !== "waiting"
        ? "not_sent"
        : "sending";
  const requestId = sent?.requestId ?? null;
  const pollsLeft = sent?.pollsLeft ?? 0;

  // After Send: ask how it went until it is sent, has failed or was not sent (or the sheet has waited long enough).
  useEffect(() => {
    if (!requestId || phase !== "sending" || pollsLeft <= 0) return;
    let live = true;
    const t = window.setTimeout(() => {
      backend
        .emailStatus(requestId)
        .then((res) => {
          if (!live) return;
          if (res.ok && res.data) {
            const status = res.data;
            setSent((s) => (s && s.requestId === requestId ? { ...s, status, pollsLeft: s.pollsLeft - 1 } : s));
            if (status.status === "sent") onSentRef.current?.(status.to);
          } else {
            // A status that cannot be read is said, not hidden; the person can close the sheet and look at the pledge's History.
            setSent((s) => (s && s.requestId === requestId ? { ...s, pollsLeft: s.pollsLeft - 1 } : s));
            if (!res.ok) setError(res.error);
          }
        })
        .catch((err: unknown) => {
          console.error("[email-pledge] checking the email failed:", err);
          if (live) setSent((s) => (s && s.requestId === requestId ? { ...s, pollsLeft: s.pollsLeft - 1 } : s));
        });
    }, POLL_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [backend, requestId, phase, pollsLeft]);

  const checked = checkEmailAddress(address);
  const number = data?.pledge.number ?? null;
  const waitedLong = phase === "sending" && pollsLeft <= 0;

  function send() {
    setError(null);
    setTouched(true);
    if (!data) return;
    if (!checked.ok) return setError(checked.error);
    const to = checked.value;
    startTransition(async () => {
      try {
        const res = await backend.emailPledge({ pledgeId: data.pledge.id, to, key: key.current });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (!res.data) {
          setError("The email may not have been sent: the server did not say. Look at the pledge's History before sending it again.");
          return;
        }
        // The server answered: the next intent to send is a new one.
        key.current = newKey();
        setSent({ requestId: res.data.requestId, to: res.data.to, status: null, pollsLeft: POLL_TRIES });
      } catch (err) {
        console.error("[email-pledge] send failed:", err);
        setError("Could not email the pledge — the server did not respond. Look at the pledge's History to see whether it went before sending it again; pressing Send again will not send it twice.");
      }
    });
  }

  const confirmLabel = !data || phase === "sending" || phase === "sent" ? undefined : phase === "not_sent" ? "Send again" : sendButtonLabel(number, checked.ok ? checked.value : address);
  const confirmDisabled = phase === "compose" ? !checked.ok || !familyNow?.family : !checked.ok;

  return (
    <GivingSheet
      title="Email the pledge"
      family={familyNow?.family ?? null}
      labels={ctx.labels}
      what={
        data ? (
          <p className="m-0" data-testid="what-happens">
            Sends the pledge email, in the community&apos;s own wording, with {number ?? "the pledge"} attached as a PDF drawn with the community&apos;s branding. The pledge&apos;s History
            records who sent it, and to which address.
          </p>
        ) : null
      }
      error={error}
      confirmLabel={confirmLabel}
      pendingLabel="Sending…"
      pending={pending}
      confirmDisabled={confirmDisabled}
      cancelLabel={phase === "sent" ? "Close" : "Cancel"}
      onConfirm={() => {
        if (phase === "not_sent") setSent(null);
        send();
      }}
      onClose={onClose}
    >
      {!current ? <p className="m-0 text-[14px] text-muted">Opening the pledge…</p> : null}
      {current && !current.data ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-danger">
          {current.error}
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
      {data && familyNow?.error ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-2 text-[13px] text-danger">
          {familyNow.error}
          <button type="button" onClick={() => setFamilyAttempt((n) => n + 1)} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}
      {data && !familyNow ? <p className="m-0 text-[14px] text-muted">Opening the family…</p> : null}

      {data ? (
        <EmailPledgeFields
          data={data}
          address={address}
          onAddress={(v) => {
            setAddress(v);
            setError(null);
          }}
          onBlur={() => setTouched(true)}
          touched={touched}
          phase={phase}
          sent={sent ? { to: sent.to, status: sent.status } : null}
          waitedLong={waitedLong}
          currency={ctx.currency}
          locale={ctx.locale}
          timeZone={ctx.timeZone}
        />
      ) : null}
    </GivingSheet>
  );
}

export type EmailPhase = "compose" | "sending" | "sent" | "not_sent";

/** The fields of the sheet: the To box with whose address it is, the note when there is none, how the email is doing, what was sent before. */
export function EmailPledgeFields({
  data,
  address,
  onAddress,
  onBlur,
  touched,
  phase,
  sent,
  waitedLong,
  currency,
  locale,
  timeZone,
}: {
  data: PledgeEmailSheetData;
  address: string;
  onAddress: (value: string) => void;
  onBlur: () => void;
  touched: boolean;
  phase: EmailPhase;
  sent: { to: string; status: RequestStatus | null } | null;
  waitedLong: boolean;
  currency: string;
  locale: string;
  timeZone: string;
}) {
  const checked = checkEmailAddress(address);
  const showInvalid = touched && address.trim() !== "" && !checked.ok;
  const money = (c: number) => formatCents(c, currency, locale);
  const number = data.pledge.number;
  const whose = whoseAddress(data.primary, address);
  const missing = noAddressNote(data.primary);
  const outcome = sent?.status ? outcomeMessage(sent.status) : null;
  return (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] text-muted" data-testid="pledge-line">
          {number ?? "Pledge"} · {money(data.pledge.amountCents)}
        </p>
        <div>
          <label htmlFor="email-pledge-to" className="crm-label">
            To
          </label>
          <input
            id="email-pledge-to"
            type="email"
            inputMode="email"
            autoComplete="off"
            enterKeyHint="send"
            value={address}
            disabled={phase === "sending" || phase === "sent"}
            aria-describedby="email-pledge-whose"
            aria-invalid={showInvalid}
            placeholder="name@example.org"
            onChange={(e) => onAddress(e.target.value)}
            onBlur={onBlur}
            className="crm-input min-h-[44px] w-full"
          />
          <p id="email-pledge-whose" className={`crm-hint ${whose?.primary && !showInvalid ? "font-semibold text-success" : ""}`} data-testid="whose-address">
            {showInvalid && !checked.ok ? checked.error : whose?.text}
          </p>
          {missing ? (
            <p role="status" className="m-0 mt-1 text-[13px] text-ink-2" data-testid="no-address-note">
              {missing}
            </p>
          ) : null}
        </div>
        {phase === "compose" && data.primary.email && !whose?.primary && address.trim() !== "" ? (
          <button type="button" onClick={() => onAddress(data.primary.email ?? "")} className={`${buttonClass("ghost", "xs")} min-h-[36px] self-start`}>
            Use {data.primary.name ?? "the primary member"}&apos;s address instead
          </button>
        ) : null}

        {sent && !outcome ? (
          <p role="status" className="m-0 text-[14px] text-ink-2">
            {queuedMessage(sent.to)}
          </p>
        ) : null}
        {waitedLong ? (
          <p role="status" className="m-0 text-[13px] text-muted">
            It is taking longer than usual. You can close this: the pledge&apos;s History shows who sent it, and Messages shows whether it arrived.
          </p>
        ) : null}
        {outcome ? (
          <p
            role={outcome.tone === "bad" ? "alert" : "status"}
            data-testid="email-outcome"
            className={`m-0 rounded-field border px-3 py-2 text-[14px] ${
              outcome.tone === "ok" ? "border-success/30 bg-success-50 font-bold text-success-900" : outcome.tone === "bad" ? "border-danger/30 bg-danger-50 text-danger" : "border-line bg-ground text-ink-2"
            }`}
          >
            {outcome.text}
          </p>
        ) : null}

        {data.earlier.length > 0 ? (
          <div>
            <p className="m-0 mb-1 text-[13px] font-bold text-ink">Sent before</p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px] text-muted" data-testid="earlier-emails">
              {data.earlier.map((e, i) => (
                <li key={`${e.at}-${i}`}>{earlierLine(e, (iso) => formatDateTime(iso, timeZone))}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
  );
}

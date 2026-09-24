"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { ActionForm } from "@/components/action-form";
import { Toggle } from "@/components/controls";
import { Drawer } from "@/components/drawer";
import type { CardLabels, HouseholdCardData } from "@/components/household-card";
import { HouseholdPicker } from "@/components/household-picker";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { buttonClass, DrawerSection, KeyValueRow } from "@/components/ui";
import { BOLI_STATUS_LABEL, boliRef, closesInFuture, isClosed } from "@/lib/bolis";
import { formatDateTime } from "@/lib/dates";
import { formatCutoff } from "@/lib/local-time";
import { formatCents } from "@/lib/money";

import {
  accommodateOthersAction,
  closeBoliAction,
  findBoliHouseholdsAction,
  recordInPersonPledgeAction,
  setBoliStatusAction,
  setHallDisplayAction,
} from "./actions";
import { BoliForm } from "./boli-form";
import type { BoliDrawerData } from "./drawer-data";

export type DrawerPermissions = { manage: boolean; record: boolean; draftMessages: boolean };

/** Entries drawer, as in the prototype (AdminPortal L759-765), opened by `?boli=<id>`. */
export function BoliDrawer({
  data,
  error,
  can,
  events,
  labels,
  timeZone,
  currency,
  defaultStepCents,
  defaultSoftMinutes,
}: {
  data: BoliDrawerData | null;
  error: string | null;
  can: DrawerPermissions;
  events: { id: string; name: string }[];
  labels: CardLabels;
  timeZone: string;
  currency: string;
  defaultStepCents: number;
  defaultSoftMinutes: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const close = useCallback(() => router.replace(pathname, { scroll: false }), [router, pathname]);
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  const [closeError, setCloseError] = useState<string | null>(null);
  const [offering, setOffering] = useState(false);
  const [offerError, setOfferError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [family, setFamily] = useState<HouseholdCardData | null>(null);

  const boli = data?.boli;
  const live = boli ? boli.status === "open" : false;

  // Keep the entries current while members are pledging.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(t);
  }, [live, router]);

  if (!data || !boli) {
    return (
      <Drawer open={Boolean(error)} onClose={close} kicker="BOLI" title="Could not open this boli">
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      </Drawer>
    );
  }

  const closed = isClosed(boli.status);
  const cutoff = boli.extended_until ?? boli.closes_at;
  const early = closesInFuture(cutoff);
  const money = (c: number) => formatCents(c, currency);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, onDone?: () => void, onError?: (e: string) => void) {
    setActionError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          (onError ?? setActionError)(res.error ?? "Something went wrong.");
          toast?.show(res.error ?? "Something went wrong.", "bad");
          return;
        }
        if (res.message) toast?.show(res.message, "ok");
        onDone?.();
        router.refresh();
      } catch (err) {
        console.error("[bolis] drawer action failed:", err);
        const msg = "Could not finish that — the server did not respond. Check your connection and try again.";
        (onError ?? setActionError)(msg);
        toast?.show(msg, "bad");
      }
    });
  }

  const footer = (
    <>
      {can.manage && !closed ? (
        <button type="button" disabled={pending} onClick={() => setClosing(true)} className={buttonClass("bad")}>
          {early ? "Close early" : "Close and record the top pledge"}
        </button>
      ) : null}
      {can.manage ? (
        <button
          type="button"
          disabled={pending || data.otherFamilies === 0 || !can.draftMessages}
          title={
            !can.draftMessages
              ? "Drafting messages needs comms.send (Communications)."
              : data.otherFamilies === 0
                ? "No other family has pledged yet."
                : undefined
          }
          onClick={() => setOffering(true)}
          className={buttonClass("primary")}
        >
          Accommodate others
        </button>
      ) : null}
      {can.manage && boli.status === "draft" ? (
        <StatusButton boliId={boli.id} status="open" label="Publish" variant="ok" />
      ) : null}
      {can.manage && boli.status === "open" ? <StatusButton boliId={boli.id} status="paused" label="Pause" variant="ghost" /> : null}
      {can.manage && boli.status === "paused" ? <StatusButton boliId={boli.id} status="open" label="Resume" variant="ok" /> : null}
    </>
  );

  return (
    <Drawer
      open
      onClose={close}
      kicker={`BOLI · ${boliRef(boli.id)}`}
      title={boli.name}
      subtitle={`${data.eventName ?? (boli.kind === "in_person" ? "In person" : "Digital")} · floor ${money(boli.floor_cents)} · ${
        closed ? "closed" : `closes ${formatCutoff(cutoff, timeZone)}`
      }${boli.extended_until ? " (extended by a late pledge)" : ""} · ${BOLI_STATUS_LABEL[boli.status] ?? boli.status}`}
      footer={footer}
    >
      {actionError ? (
        <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          {actionError}
        </p>
      ) : null}

      <DrawerSection title="ALL ENTRIES KEPT · FIRST RECORDED WINS">
        {data.entries === null ? (
          <p className="text-[13px] text-muted">
            {data.entriesProblem ?? "Your role can see the top pledge but not individual entries."}
            {data.topCents !== null ? ` Top pledge: ${money(data.topCents)}.` : ""}
          </p>
        ) : data.entries.length === 0 ? (
          <KeyValueRow label="No entries yet" value="—" />
        ) : (
          data.entries.map((e) => {
            const lead = e.id === data.leadingEntryId;
            return (
              <KeyValueRow
                key={e.id}
                label={
                  <>
                    {lead ? "★ " : ""}
                    {e.name}
                    {e.household_number ? <span className="text-muted"> ({e.household_number})</span> : null} · {formatDateTime(e.entered_at, timeZone)}
                    {e.is_in_person ? <span className="text-muted"> · in person</span> : null}
                  </>
                }
                value={money(e.amount_cents)}
                tone={lead ? "ok" : "ink"}
              />
            );
          })
        )}
        {!closed && data.entries !== null ? (
          <p className="text-xs text-muted">
            Next pledge at least {money(data.minimumCents)} (step {money(boli.step_cents)}).
          </p>
        ) : null}
      </DrawerSection>

      <DrawerSection title="AFTER CLOSE">
        <KeyValueRow label="Winner" value={closed ? (boli.winner_pledge_id ? "Pledge created on the household" : "No pledges") : "Pledge created on the household"} />
        <KeyValueRow label="Other interested families" value="Offered similar labh by the coordinator" />
        <KeyValueRow label="Hall display" value={boli.hall_display ? "Live amounts shown on the TV" : "Not shown on the TV"} />
        {closed && boli.closed_reason ? <KeyValueRow label="Closed because" value={boli.closed_reason} /> : null}
      </DrawerSection>

      {can.manage ? (
        <DrawerSection title="HALL DISPLAY">
          <Toggle
            label="Hall display"
            checked={boli.hall_display}
            disabled={pending}
            onChange={(on) => run(() => setHallDisplayAction(boli.id, on))}
            onNote="Show live amounts on the TV"
            offNote="Not on the TV"
          />
        </DrawerSection>
      ) : null}

      {can.record && boli.kind === "in_person" && !closed ? (
        <DrawerSection title="RECORD AN IN-PERSON PLEDGE">
          {family ? (
            <ActionForm action={recordInPersonPledgeAction.bind(null, boli.id)} submitLabel="Record pledge" pendingLabel="Recording…" resetOnSuccess>
              <input type="hidden" name="household_id" value={family.household_id} />
              <KeyValueRow
                label={`${family.household_name ?? "Household"}${family.household_number ? ` (${family.household_number})` : ""}`}
                value={
                  <button type="button" className="crm-link text-xs" onClick={() => setFamily(null)}>
                    Change
                  </button>
                }
              />
              <div className="my-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="bd-amount" className="crm-label">
                    Pledge amount ($)
                  </label>
                  <input id="bd-amount" name="amount" inputMode="decimal" required className="crm-input" />
                  <p className="crm-hint">At least {money(data.minimumCents)}</p>
                </div>
                <div>
                  <label htmlFor="bd-display" className="crm-label">
                    Name to display (optional)
                  </label>
                  <input id="bd-display" name="display_name" maxLength={120} className="crm-input" />
                </div>
              </div>
              <label className="mb-3 flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="anonymous" className="h-4 w-4" /> Family asked to stay anonymous
              </label>
            </ActionForm>
          ) : (
            <HouseholdPicker
              labels={labels}
              timeZone={timeZone}
              currency={currency}
              onSelect={setFamily}
              selectLabel="Record for this family"
              idPrefix="bd-hh"
              finder={findBoliHouseholdsAction}
            />
          )}
        </DrawerSection>
      ) : null}

      {can.manage && !closed ? (
        <details>
          <summary className="cursor-pointer text-[13px] font-bold text-navy">Edit boli</summary>
          <div className="mt-3">
            <BoliForm
              key={boli.id}
              boli={boli}
              events={events}
              timeZone={timeZone}
              defaultStepCents={defaultStepCents}
              defaultSoftMinutes={defaultSoftMinutes}
            />
          </div>
        </details>
      ) : null}

      <Modal
        open={closing}
        kicker={early ? "Close early needs a reason · audited" : "Please confirm"}
        title={early ? `Close ${boli.name} before its cutoff?` : `Close ${boli.name}?`}
        confirmLabel={early ? "Close early" : "Close boli"}
        tone="bad"
        pending={pending}
        error={closeError}
        onCancel={() => {
          setClosing(false);
          setCloseError(null);
        }}
        onConfirm={() => {
          if (early && !reason.trim()) {
            setCloseError("Give a reason for closing early. It is kept in the audit log.");
            return;
          }
          run(
            () => closeBoliAction(boli.id, reason, early),
            () => {
              setClosing(false);
              setReason("");
              setCloseError(null);
            },
            setCloseError,
          );
        }}
      >
        <p>
          The highest pledge becomes a pledge on that household; if two are equal, the first recorded wins.
          {data.topCents !== null ? ` Today that is ${money(data.topCents)}.` : " There are no entries, so no pledge is created."}
        </p>
        <label htmlFor="bd-reason" className="crm-label mt-3">
          Reason{early ? "" : " (optional)"}
        </label>
        <textarea
          id="bd-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          rows={3}
          className="crm-input min-h-20"
          placeholder="e.g. Called in the hall after the aarti"
        />
      </Modal>

      <Modal
        open={offering}
        kicker="Accommodate others"
        title={`Offer similar labh to ${data.otherFamilies} ${data.otherFamilies === 1 ? "family" : "families"}?`}
        confirmLabel="Create draft messages"
        pending={pending}
        error={offerError}
        onCancel={() => {
          setOffering(false);
          setOfferError(null);
        }}
        onConfirm={() =>
          run(
            () => accommodateOthersAction(boli.id),
            () => {
              setOffering(false);
              setOfferError(null);
            },
            setOfferError,
          )
        }
      >
        One draft message per family who pledged but did not win. Nothing is sent: the communications team reviews and sends each draft.
      </Modal>
    </Drawer>
  );
}

function StatusButton({ boliId, status, label, variant }: { boliId: string; status: string; label: string; variant: "ok" | "ghost" }) {
  return (
    <ActionForm
      action={setBoliStatusAction.bind(null, boliId)}
      submitLabel={label}
      variant={variant}
      confirmMessage={status === "open" && label === "Publish" ? "Publish this boli? Members can pledge once it opens." : undefined}
    >
      <input type="hidden" name="status" value={status} />
    </ActionForm>
  );
}

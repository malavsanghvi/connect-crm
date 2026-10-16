"use client";

// A bank gift line (Zelle, ACH, a fund grant) matched to a family, the same on Today and on the Bank tab (docs/GIVING_REDESIGN.md
// slices 1 and 4). A clear suggestion is one click on a button that names the amount and the family. "Pick another" (or "Choose
// the family") opens a sheet with the suggested families, a search across every family, where the money goes (the earliest open
// pledges, or the ones ticked), learning the payer name, and the double-count decision when the same Zelle is already recorded by
// hand (attach the line to that payment, or record it separately with a reason). Every click calls the existing server actions,
// which check the pair again.

import { useState, useTransition } from "react";

import { openPledgesAction, type OpenPledge } from "@/app/(app)/giving/actions";
import { attachBankLineAction, confirmBankMatchAction, type ConfirmResult, type DuplicateZelle } from "@/app/(app)/giving/payments/bank/actions";
import { HouseholdPicker } from "@/components/household-picker";
import { buttonClass } from "@/components/ui";
import { previewAllocation } from "@/lib/allocation";
import { formatDate } from "@/lib/dates";
import { familyFrom, familyRef, type Act, type Family, type SuggestionView } from "@/lib/giving-today/queue";
import { formatCents } from "@/lib/money";
import { stillToPayCents } from "@/lib/pledge-balance";

import { InlineError, SMALL, useRun, type ActContext } from "./row-actions";
import { FamilyCard, GivingSheet, NO_UNDO } from "./sheet";

type Choice = { family: Family; reason: string | null; reportId: string | null; ambiguous: boolean };
type Duplicate = DuplicateZelle & { choice: Choice; pledgeIds: string[] | null };

const fromSuggestion = (s: SuggestionView): Choice => ({ family: s.family, reason: s.reason || null, reportId: s.reportId, ambiguous: s.ambiguous });

export function GiftAct({ act, ctx }: { act: Extract<Act, { kind: "gift" }>; ctx: ActContext }) {
  const { pending, error, setError, run } = useRun();
  const [open, setOpen] = useState(false);
  const all = [...(act.best ? [act.best] : []), ...act.others];
  const [pick, setPick] = useState<Choice | null>(null);
  const [searching, setSearching] = useState(false);
  const [pledges, setPledges] = useState<OpenPledge[] | null>(null);
  const [pledgeError, setPledgeError] = useState<string | null>(null);
  const [specific, setSpecific] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [learn, setLearn] = useState(act.learnPayer);
  const [checked, setChecked] = useState(false);
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [separate, setSeparate] = useState("");
  const [loading, startLoading] = useTransition();
  const money = (c: number) => formatCents(c, ctx.currency, ctx.locale);
  const amount = money(act.amountCents);

  function choose(c: Choice | null) {
    setPick(c);
    setSearching(false);
    setSpecific(false);
    setChosen([]);
    setChecked(false);
    setPledges(null);
    setPledgeError(null);
    setError(null);
    if (!c) return;
    startLoading(async () => {
      try {
        const res = await openPledgesAction(c.family.id);
        if (!res.ok) setPledgeError(res.error);
        else setPledges(res.data ?? []);
      } catch (err) {
        console.error("[giving] loading the family's open pledges failed:", err);
        setPledgeError("Could not load the family's open pledges: the server did not respond. Choose the family again.");
      }
    });
  }

  function openSheet() {
    setDuplicate(null);
    setSeparate("");
    setLearn(act.learnPayer);
    choose(act.best ? (act.others[0] ? fromSuggestion(act.others[0]) : null) : all[0] ? fromSuggestion(all[0]) : null);
    setOpen(true);
  }

  function doneText(d: ConfirmResult | undefined, c: Choice, extra: string): string {
    const applied =
      d && d.applied.length > 0 ? ` Applied to ${d.applied.map((a) => `${a.pledge_number ?? "a pledge"} (${money(a.amount_cents)})`).join(", ")}.` : "";
    const learned = d?.learnedPayer ? ` Learned the payer name "${d.learnedPayer.value}".` : "";
    return d
      ? `Done: ${money(d.amountCents)} matched to ${d.householdName}, receipt ${d.receiptNumber ?? "pending"}.${applied}${learned}${extra}`
      : `Done: ${amount} matched to ${familyRef(c.family)}.${extra}`;
  }

  function confirm(c: Choice, pledgeIds: string[] | null, separateReason: string | null) {
    run(
      separateReason ? "Record the separate gift" : "Confirm the match",
      async () => {
        const res = await confirmBankMatchAction({
          txnId: act.txnId,
          householdId: c.family.id,
          pledgeIds,
          learnPayer: learn && act.learnPayer,
          reportId: c.reportId,
          separateReason,
        });
        if (!res.ok && res.duplicate) {
          // The same Zelle is already recorded by hand for this family: the sheet asks which it is.
          setDuplicate({ ...res.duplicate, choice: c, pledgeIds });
          setSeparate("");
          setPick(c);
          setOpen(true);
        }
        return res;
      },
      (r) => {
        setOpen(false);
        setDuplicate(null);
        ctx.onDone(doneText(r.data, c, separateReason ? ` Recorded as a separate gift: "${separateReason}".` : ""));
      },
    );
  }

  function attach(paymentId: string, receipt: string | null) {
    if (!duplicate) return;
    const c = duplicate.choice;
    run(
      "Attach the bank line",
      () => attachBankLineAction({ txnId: act.txnId, paymentId, reportId: c.reportId }),
      (r) => {
        setOpen(false);
        setDuplicate(null);
        ctx.onDone(doneText(r.data, c, ` Attached to receipt ${receipt ?? "not numbered yet"}: no second payment.`));
      },
    );
  }

  const preview = pledges ? previewAllocation(act.amountCents, pledges, specific ? chosen : null) : null;
  const byId = new Map((pledges ?? []).map((p) => [p.id, p]));
  const needsCheck = Boolean(pick?.ambiguous);
  const blocked = !pick || loading || (needsCheck && !checked) || (specific && chosen.length === 0 && (pledges?.length ?? 0) > 0);
  const pledgeIds = specific && chosen.length > 0 ? chosen : null;

  return (
    <>
      {act.best ? (
        <button
          type="button"
          className={`${buttonClass("primary", "sm")} ${SMALL}`}
          disabled={pending}
          data-spotlight={ctx.spotlight ? "bank-confirm" : undefined}
          onClick={() => {
            setDuplicate(null);
            confirm(fromSuggestion(act.best!), null, null);
          }}
        >
          {pending && !open ? "Confirming…" : act.best.label}
        </button>
      ) : null}
      <button type="button" className={`${buttonClass(act.best ? "ghost" : "primary", "sm")} ${SMALL}`} disabled={pending} onClick={openSheet}>
        {act.best ? "Pick another" : all.length > 0 ? "Choose the family" : "Find the family"}
      </button>
      {!open && error ? <InlineError>{error}</InlineError> : null}
      {open && duplicate ? (
        <GivingSheet
          title={`Is this the same ${amount} gift?`}
          family={duplicate.choice.family}
          labels={ctx.labels}
          what={
            <>
              This family already has a payment of this amount recorded by hand around that date. If it is the same gift, attach the bank line
              to it: no second payment is made. If it is a different gift, record it separately and say why (kept in the audit log). {NO_UNDO}
            </>
          }
          error={error}
          confirmLabel={`Record ${amount} as a separate gift for ${familyRef(duplicate.choice.family)}`}
          pendingLabel="Recording…"
          confirmDisabled={separate.trim() === ""}
          pending={pending}
          onClose={() => setOpen(false)}
          onConfirm={() => confirm(duplicate.choice, duplicate.pledgeIds, separate.trim())}
        >
          <div className="flex flex-col gap-2">
            <p className="m-0 text-[13px] font-bold text-ink">The same gift? Attach the bank line to it</p>
            {duplicate.payments.length === 0 ? (
              <p className="m-0 text-[13px] text-muted">The payment recorded by hand could not be read. Open the family&apos;s payments to find it, then reload this page.</p>
            ) : (
              duplicate.payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-line px-2.5 py-2 text-[13.5px]">
                  <span>
                    Receipt <span className="font-mono">{p.receipt_number ?? "not numbered yet"}</span> · {money(p.amount_cents ?? 0)} recorded{" "}
                    {p.received_on ? formatDate(p.received_on, ctx.timeZone) : ""}
                  </span>
                  <button type="button" className={`${buttonClass("primary", "sm")} ${SMALL}`} disabled={pending} onClick={() => attach(p.id, p.receipt_number)}>
                    {`Attach to receipt ${p.receipt_number ?? "(not numbered yet)"}`}
                  </button>
                </div>
              ))
            )}
          </div>
          <div>
            <label htmlFor={`sep-${act.txnId}`} className="mb-1 block text-[13px] font-bold text-ink">
              A different gift? Why is it separate
            </label>
            <textarea
              id={`sep-${act.txnId}`}
              value={separate}
              onChange={(e) => setSeparate(e.target.value)}
              maxLength={500}
              rows={2}
              className="crm-input w-full"
              placeholder="For example: two gifts the same week, one for each fund"
            />
          </div>
        </GivingSheet>
      ) : open ? (
        <GivingSheet
          title={`Which family gave ${amount}?`}
          family={pick?.family ?? null}
          labels={ctx.labels}
          what={
            <>
              Each family is shown with its number, household id and primary adult. The bank line is recorded as their gift and applied to{" "}
              {specific ? "the pledges you tick" : "their earliest open pledges"}. {NO_UNDO}
            </>
          }
          error={error ?? pledgeError}
          confirmLabel={pick ? `Confirm ${amount} for ${familyRef(pick.family)}` : "Choose a family"}
          pendingLabel="Confirming…"
          confirmDisabled={blocked}
          pending={pending}
          onClose={() => setOpen(false)}
          onConfirm={() => pick && confirm(pick, pledgeIds, null)}
        >
          {all.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[13px] font-bold text-ink">Suggested families</legend>
              {all.map((s) => (
                <label key={s.family.id} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="radio"
                    name={`gift-${act.txnId}`}
                    className="mt-3 h-[18px] w-[18px] flex-none"
                    checked={pick?.family.id === s.family.id}
                    onChange={() => choose(fromSuggestion(s))}
                  />
                  <span className="min-w-0 flex-1">
                    <FamilyCard family={s.family} labels={ctx.labels}>
                      <p className="m-0 mt-1 text-[12.5px] text-ink-2">
                        {s.reason}
                        {s.ambiguous ? " · several families match: check the details" : ""}
                      </p>
                    </FamilyCard>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="m-0 text-[13px] text-muted">No family is suggested. Find it by name or any of its numbers.</p>
          )}
          {searching || all.length === 0 ? (
            <HouseholdPicker
              labels={ctx.labels}
              timeZone={ctx.timeZone}
              currency={ctx.currency}
              onSelect={(card) => choose({ family: familyFrom(card), reason: null, reportId: null, ambiguous: false })}
              idPrefix={`gift-${act.txnId.slice(0, 6)}`}
            />
          ) : (
            <button type="button" className={`${buttonClass("ghost", "sm")} ${SMALL} self-start`} onClick={() => setSearching(true)}>
              Find another family
            </button>
          )}
          {pick && pledges ? (
            <div className="flex flex-col gap-1.5 rounded-field border border-line px-3 py-2 text-[13.5px]">
              <p className="m-0 font-bold text-ink">Where it goes</p>
              {pledges.length === 0 ? <p className="m-0 text-muted">No open pledge: it is recorded as a general gift.</p> : null}
              {pledges.length > 0 ? (
                <label className="flex min-h-[40px] cursor-pointer items-center gap-2">
                  <input type="checkbox" className="h-[18px] w-[18px]" checked={specific} onChange={(e) => setSpecific(e.target.checked)} />
                  Apply to the pledges I tick (otherwise the earliest open pledge first)
                </label>
              ) : null}
              {specific
                ? pledges.map((p) => (
                    <label key={p.id} className="flex min-h-[40px] cursor-pointer items-center gap-2 pl-6">
                      <input
                        type="checkbox"
                        className="h-[18px] w-[18px]"
                        checked={chosen.includes(p.id)}
                        onChange={(e) => setChosen((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono">{p.pledge_number ?? "pledge"}</span>
                        {p.campaign ? ` · ${p.campaign}` : ""} · {money(stillToPayCents(p))} open
                      </span>
                    </label>
                  ))
                : null}
              {preview
                ? preview.lines.map((l) => (
                    <p key={l.pledge_id} className="m-0 flex justify-between gap-3">
                      <span>{byId.get(l.pledge_id)?.pledge_number ?? "A pledge"}</span>
                      <span className="whitespace-nowrap font-bold tabular-nums">{money(l.amount_cents)}</span>
                    </p>
                  ))
                : null}
              {preview && preview.unallocated_cents > 0 && pledges.length > 0 ? (
                <p className="m-0 flex justify-between gap-3 text-muted">
                  <span>Left as a general gift</span>
                  <span className="whitespace-nowrap tabular-nums">{money(preview.unallocated_cents)}</span>
                </p>
              ) : null}
            </div>
          ) : pick && loading ? (
            <p className="m-0 text-[13px] text-muted">Reading the family&apos;s open pledges…</p>
          ) : null}
          {!act.learnPayer ? (
            <p className="m-0 text-[13px] text-muted">A fund or platform sent this, so its name is never learned as the family&apos;s.</p>
          ) : act.payerName ? (
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13.5px]">
              <input type="checkbox" className="h-[18px] w-[18px]" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
              Remember &quot;{act.payerName}&quot; as this family&apos;s bank payer name
            </label>
          ) : null}
          {needsCheck ? (
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13.5px] font-bold text-ink">
              <input type="checkbox" className="h-[18px] w-[18px]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              I checked the numbers and the adults: this is the right family, not just a matching name
            </label>
          ) : null}
        </GivingSheet>
      ) : null}
    </>
  );
}

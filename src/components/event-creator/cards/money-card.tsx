"use client";

import { ChipGroup } from "@/components/controls";
import { centsToDollarsInput, formatShortCents } from "@/lib/events/format";
import { commitmentSummary } from "@/lib/events/report";
import { commitmentSuggestion, lessonsFor, priceSuggestion } from "@/lib/event-creator/smart";
import type { CreatorCtx, EventDraft } from "@/lib/event-creator/types";

import { Field, LessonNotes, Note, SwitchRow, UseSuggestion, type CardProps } from "../parts";

function cents(text: string): number[] {
  return text
    .split(/[,\s]+/)
    .map((s) => s.replace(/[^\d.]/g, ""))
    .filter((s) => /^\d+(\.\d{1,2})?$/.test(s))
    .map((s) => Math.round(Number(s) * 100));
}

/** Tickets and the donation commitment at RSVP: plain event fields, exactly as the builder saves them. Nothing is charged here. */
export function MoneyFields({ draft, set, ctx }: { draft: EventDraft; set: (p: Partial<EventDraft>) => void; ctx: CreatorCtx }) {
  const price = priceSuggestion(draft, ctx);
  const commit = commitmentSuggestion(draft, ctx);
  const fmt = (c: number) => formatShortCents(c, ctx.currency);
  const commitment = (
    <div className="flex flex-col gap-3">
      <SwitchRow
        label="Ask for a donation commitment at RSVP"
        checked={draft.commitments_enabled}
        onChange={(on) =>
          // Switching on with nothing entered starts from the builder's usual amounts, so it cannot save as Off.
          set(on && !draft.commit_per_person.trim() && !draft.commit_lump_sum.trim() && !draft.commit_open ? { commitments_enabled: true, commit_per_person: "3, 5, 7", commit_lump_sum: "10, 25, 50", commit_open: true } : { commitments_enabled: on })
        }
        onNote={commitmentSummary({ per_person: cents(draft.commit_per_person), lump_sum: cents(draft.commit_lump_sum), open: draft.commit_open }, fmt)}
        offNote="Off"
      />
      {commit && !draft.commitments_enabled ? <UseSuggestion why={commit.why} source={commit.source} action="Ask for one" used={false} onUse={() => set({ commitments_enabled: true, commit_per_person: draft.commit_per_person || "3, 5, 7", commit_lump_sum: draft.commit_lump_sum || "10, 25, 50", commit_open: true })} /> : null}
      {draft.commitments_enabled ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`Per person (${ctx.currency})`} hint="Amounts, separated by commas.">
            {(id) => <input id={id} className="crm-input" placeholder="3, 5, 7" value={draft.commit_per_person} onChange={(e) => set({ commit_per_person: e.target.value })} />}
          </Field>
          <Field label={`Lump sum (${ctx.currency})`} hint="Amounts, separated by commas.">
            {(id) => <input id={id} className="crm-input" placeholder="10, 25, 50" value={draft.commit_lump_sum} onChange={(e) => set({ commit_lump_sum: e.target.value })} />}
          </Field>
          <div className="sm:col-span-2">
            <SwitchRow label="Allow an open amount" checked={draft.commit_open} onChange={(v) => set({ commit_open: v })} onNote="Allowed" offNote="Not offered" />
          </div>
        </div>
      ) : null}
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <ChipGroup
        label="Will people pay to come?"
        options={[
          { value: "free", label: "Free" },
          { value: "paid", label: "Tickets" },
        ]}
        value={draft.is_paid ? "paid" : "free"}
        onChange={(v) => set({ is_paid: v === "paid" })}
      />
      {draft.is_paid ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={`Member price (${ctx.currency})`}>
              {(id) => <input id={id} inputMode="decimal" className="crm-input" value={draft.member_price} onChange={(e) => set({ member_price: e.target.value })} />}
            </Field>
            <Field label={`Guest price (${ctx.currency})`}>
              {(id) => <input id={id} inputMode="decimal" className="crm-input" value={draft.guest_price} onChange={(e) => set({ guest_price: e.target.value })} />}
            </Field>
          </div>
          {price ? (
            <UseSuggestion
              why={price.why}
              source={price.source}
              action="Use these prices"
              used={draft.member_price === centsToDollarsInput(price.value.member_cents) && draft.guest_price === centsToDollarsInput(price.value.guest_cents)}
              onUse={() => set({ member_price: centsToDollarsInput(price.value.member_cents), guest_price: centsToDollarsInput(price.value.guest_cents) })}
            />
          ) : null}
        </>
      ) : price ? (
        <Note>{price.why} Choose Tickets to charge again.</Note>
      ) : null}
      <Note tone="warn">Money stays a draft: prices are saved with the event, and nothing is charged until the event is published and someone buys a ticket.</Note>
      {ctx.modules.giving ? (
        commitment
      ) : (
        <details className="rounded-field border border-line bg-ground px-3.5 py-2.5" open={draft.commitments_enabled}>
          <summary className="cursor-pointer text-[14px] font-semibold text-ink">Donation commitment at RSVP</summary>
          <div className="mt-2">{commitment}</div>
        </details>
      )}
    </div>
  );
}

/** Card 4, "Money". */
export function MoneyCard(props: CardProps) {
  return (
    <div className="flex flex-col gap-4">
      <MoneyFields draft={props.draft} set={props.set} ctx={props.ctx} />
      <LessonNotes lessons={lessonsFor("money", props.draft, props.ctx)} />
    </div>
  );
}

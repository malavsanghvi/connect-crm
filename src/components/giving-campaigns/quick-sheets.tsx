"use client";

// The quick-create sheets of Giving › Campaigns & opportunities (docs/GIVING_REDESIGN.md section 2): "New campaign" (name, goal,
// dates, fund → a draft) and "New opportunity" (four questions: what, amount or tiers, which campaign, publish now?). Both call
// the EXISTING server actions; everything else waits for the full screens, one click away. The shared Giving sheet has no form,
// so Enter never sends; the button names what happens.

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";

import { saveOpportunityAction } from "@/app/(app)/giving/opportunities/actions";
import { createCampaignAction } from "@/app/(app)/giving/opportunities/campaigns/actions";
import { GivingSheet } from "@/components/giving-actions/sheet";
import { buttonClass } from "@/components/ui";
import {
  EMPTY_CAMPAIGN,
  NAME_MAX,
  canPublishInto,
  checkQuickCampaign,
  checkQuickOpportunity,
  defaultCampaignId,
  quickCampaignForm,
  quickOpportunityInput,
  quickOpportunityTypes,
  rowsNeeded,
  type CampaignChoice,
  type QuickCampaign,
  type QuickOpportunityType,
  type QuickRow,
} from "@/lib/giving-campaigns/quick";

/** The sheet's household-card labels: these sheets never show a family. */
const NO_FAMILY = { orgMemberLabel: "", orgHouseholdLabel: "" };

type Result = { ok: boolean; error?: string; message?: string };

function useSend() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<ReactNode>(null);
  function send<R extends Result>(doing: string, fn: () => Promise<R>, onOk: (r: R) => void) {
    setError(null);
    start(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          setError(res.error ?? `${doing}.`);
          return;
        }
        onOk(res);
      } catch (err) {
        console.error(`[giving-campaigns] ${doing}:`, err);
        setError(`${doing}: the server did not respond. Reload the page to see whether it went through before trying again.`);
      }
    });
  }
  return { pending, error, setError, send };
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="crm-label">
        {label}
      </label>
      {children}
      {hint ? <p className="m-0 text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- New campaign

export function QuickCampaignSheet({
  startName,
  funds,
  currency,
  onClose,
  onCreated,
}: {
  startName: string;
  funds: readonly { id: string; name: string; restricted: boolean }[];
  currency: string;
  onClose: () => void;
  onCreated: (created: { id: string | null; name: string; message: string }) => void;
}) {
  const [q, setQ] = useState<QuickCampaign>({ ...EMPTY_CAMPAIGN, name: startName });
  const { pending, error, setError, send } = useSend();
  const set = (patch: Partial<QuickCampaign>) => {
    setError(null);
    setQ((v) => ({ ...v, ...patch }));
  };

  function confirm() {
    const problem = checkQuickCampaign(q);
    if (problem) {
      setError(problem);
      return;
    }
    const name = q.name.trim();
    send(
      "Could not create the campaign",
      () => createCampaignAction(null, quickCampaignForm(q)),
      (res) => onCreated({ id: res.data?.id ?? null, name, message: res.message ?? `Created "${name}" as a draft.` }),
    );
  }

  return (
    <GivingSheet
      title="New campaign"
      labels={NO_FAMILY}
      what={
        <>
          A draft is saved. Members see nothing until you publish it. The kind, a description and the visibility window can wait:{" "}
          <Link href="/giving/opportunities/campaigns" className="font-semibold text-navy underline">
            every field
          </Link>
          .
        </>
      }
      error={error}
      confirmLabel="Create draft campaign"
      pendingLabel="Creating…"
      pending={pending}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field id="qc-name" label="Name">
        <input id="qc-name" className="crm-input" maxLength={NAME_MAX} value={q.name} onChange={(e) => set({ name: e.target.value })} autoComplete="off" />
      </Field>
      <Field id="qc-goal" label={`Goal in ${currency} (optional)`} hint="Without a goal the campaign shows its totals, never a made-up target.">
        <input id="qc-goal" className="crm-input" inputMode="decimal" value={q.goal} onChange={(e) => set({ goal: e.target.value })} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field id="qc-start" label="Starts on (optional)">
          <input id="qc-start" type="date" className="crm-input" value={q.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
        </Field>
        <Field id="qc-end" label="Ends on (optional)">
          <input id="qc-end" type="date" className="crm-input" value={q.endsOn} onChange={(e) => set({ endsOn: e.target.value })} />
        </Field>
      </div>
      <Field id="qc-fund" label="Fund">
        <select id="qc-fund" className="crm-input" value={q.fundId} onChange={(e) => set({ fundId: e.target.value })}>
          <option value="">No specific fund</option>
          {funds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.restricted ? " (restricted)" : ""}
            </option>
          ))}
        </select>
      </Field>
    </GivingSheet>
  );
}

// ---------------------------------------------------------------------------------------------------------------- New opportunity

const EMPTY_ROW: QuickRow = { label: "", amount: "" };

export function QuickOpportunitySheet({
  startName,
  campaigns,
  currency,
  listType,
  onClose,
  onSaved,
}: {
  startName: string;
  campaigns: readonly CampaignChoice[];
  currency: string;
  /** The kind's words for a fixed list. */
  listType: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const types = quickOpportunityTypes(listType);
  const [name, setName] = useState(startName);
  const [type, setType] = useState<QuickOpportunityType>("amount");
  const [rows, setRows] = useState<QuickRow[]>([{ ...EMPTY_ROW }, { ...EMPTY_ROW }]);
  const [campaignId, setCampaignId] = useState(defaultCampaignId(campaigns));
  const [wantPublish, setWantPublish] = useState(true);
  const { pending, error, setError, send } = useSend();
  const publishable = canPublishInto(campaigns, campaignId);
  const publish = wantPublish && publishable;
  const need = rowsNeeded(type);
  const members = types.find((t) => t.type === type)?.members ?? "";
  const shownName = name.trim() || "your opportunity";
  const touch = () => setError(null);

  function setRow(i: number, patch: Partial<QuickRow>) {
    touch();
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function confirm() {
    const q = { name, type, rows, campaignId, publish };
    const problem = checkQuickOpportunity(q, campaigns);
    if (problem) {
      setError(problem);
      return;
    }
    send(
      publish ? "Could not publish the opportunity" : "Could not save the opportunity",
      () => saveOpportunityAction(quickOpportunityInput(q)),
      (res) => onSaved(res.message ?? (publish ? `Published "${name.trim()}".` : `Saved "${name.trim()}" as a draft.`)),
    );
  }

  const builderLink = (
    <Link href="/giving/opportunities" className="font-semibold text-navy underline">
      the full builder
    </Link>
  );

  return (
    <GivingSheet
      title="New opportunity"
      labels={NO_FAMILY}
      what={
        campaigns.length === 0 ? (
          <>An opportunity belongs to a campaign, and there is none yet. Create a campaign first.</>
        ) : publish ? (
          <>
            Members will see “{shownName}” in the Give tab, with {members}. Pay now or pledge: members choose. A member alert is drafted in
            Communications for review; nothing is sent from here. Audience, alerts, recurring giving and the visibility window are in{" "}
            {builderLink}.
          </>
        ) : (
          <>
            Saved as a draft: members see nothing until you publish it. Audience, alerts, recurring giving and the visibility window are in{" "}
            {builderLink}.
          </>
        )
      }
      error={error}
      confirmLabel={publish ? `Publish “${shownName}”` : "Save draft"}
      pendingLabel={publish ? "Publishing…" : "Saving…"}
      pending={pending}
      confirmDisabled={campaigns.length === 0}
      onConfirm={confirm}
      onClose={onClose}
    >
      <Field id="qo-name" label="Name members see">
        <input
          id="qo-name"
          className="crm-input"
          maxLength={NAME_MAX}
          value={name}
          onChange={(e) => {
            touch();
            setName(e.target.value);
          }}
          autoComplete="off"
        />
      </Field>

      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="crm-label">What members choose</legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {types.map((t) => (
            <label key={t.type} className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-[14px] has-[:checked]:border-navy has-[:checked]:bg-navy-50">
              <input
                type="radio"
                name="qo-type"
                value={t.type}
                checked={type === t.type}
                onChange={() => {
                  touch();
                  setType(t.type);
                }}
                className="h-4 w-4"
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      {need === "none" ? null : (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="crm-label">{need === "amounts" ? `Amounts in ${currency}` : `Each choice and its amount in ${currency}`}</legend>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              {need === "named" ? (
                <input
                  aria-label={`Choice ${i + 1} name`}
                  className="crm-input min-w-0 flex-[2]"
                  value={r.label}
                  maxLength={120}
                  onChange={(e) => setRow(i, { label: e.target.value })}
                  autoComplete="off"
                />
              ) : null}
              <input
                aria-label={need === "named" ? `Choice ${i + 1} amount` : `Amount ${i + 1}`}
                className="crm-input min-w-0 flex-1"
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => setRow(i, { amount: e.target.value })}
                autoComplete="off"
              />
              {rows.length > 1 ? (
                <button
                  type="button"
                  aria-label={`Remove row ${i + 1}`}
                  title="Remove"
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-[20px] text-muted hover:bg-canvas"
                  onClick={() => {
                    touch();
                    setRows((rs) => rs.filter((_, j) => j !== i));
                  }}
                >
                  <span aria-hidden="true">×</span>
                </button>
              ) : null}
            </div>
          ))}
          {rows.length < 20 ? (
            <button
              type="button"
              className={`${buttonClass("ghost", "sm")} self-start`}
              onClick={() => {
                touch();
                setRows((rs) => [...rs, { ...EMPTY_ROW }]);
              }}
            >
              Add another
            </button>
          ) : null}
        </fieldset>
      )}

      <Field id="qo-campaign" label="Campaign">
        <select
          id="qo-campaign"
          className="crm-input"
          value={campaignId}
          onChange={(e) => {
            touch();
            setCampaignId(e.target.value);
          }}
          disabled={campaigns.length === 0}
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.status === "published" ? "" : ` (${c.status})`}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="crm-label">Publish now?</legend>
        <div className="flex flex-wrap gap-1.5">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-[14px] has-[:checked]:border-navy has-[:checked]:bg-navy-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
            <input type="radio" name="qo-publish" checked={publish} disabled={!publishable} onChange={() => {
                touch();
                setWantPublish(true);
              }} className="h-4 w-4" />
            Publish now
          </label>
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-[14px] has-[:checked]:border-navy has-[:checked]:bg-navy-50">
            <input type="radio" name="qo-publish" checked={!publish} onChange={() => {
                touch();
                setWantPublish(false);
              }} className="h-4 w-4" />
            Save as draft
          </label>
        </div>
        {campaigns.length > 0 && !publishable ? (
          <p className="m-0 text-[12px] text-muted">Its campaign is not published yet. Publish the campaign first, or save this as a draft.</p>
        ) : null}
      </fieldset>
    </GivingSheet>
  );
}

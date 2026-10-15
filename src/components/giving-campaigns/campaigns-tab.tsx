"use client";

// Giving › Campaigns & opportunities in the New look (docs/GIVING_REDESIGN.md section 4, slice 6): one tab with views Campaigns
// (goal progress against each campaign's own goal and dates), Opportunities, Bolis and Labh (the kind's word), quick-create sheets,
// and the full screens one click away. The Bolis and Labh views are the existing screens, handed in by the route as children,
// as is the card that says why a view cannot open. Every write is an existing server action; a draft campaign just created can
// be undone (it is archived, members never saw it); nothing published is undone here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition, type ReactNode } from "react";

import { setOpportunityActiveAction, setOpportunityStatusAction } from "@/app/(app)/giving/opportunities/actions";
import { setCampaignActiveAction, setCampaignStatusAction } from "@/app/(app)/giving/opportunities/campaigns/actions";
import { ActionForm } from "@/components/action-form";
import { GivingTabRow } from "@/components/giving-today/giving-tabs";
import { EmptyState, QueryError, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import type { CampaignItem, CampaignsModel, OpportunityItem } from "@/lib/giving-campaigns/model";
import { campaignProgress, progressWords } from "@/lib/giving-campaigns/progress";
import { quickOpportunityTypes } from "@/lib/giving-campaigns/quick";
import { CAMPAIGNS_PATH, shownViews, viewHref } from "@/lib/giving-campaigns/views";

import { QuickCampaignSheet, QuickOpportunitySheet } from "./quick-sheets";

type Sheet = "campaign" | "opportunity" | null;

const noSubscribe = () => () => {};
type Draft = { id: string | null; name: string; message: string; settled: boolean };

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const CHIP: Record<string, string> = {
  published: "bg-success-50 text-success",
  open: "bg-success-50 text-success",
  draft: "border border-line bg-ground text-muted",
  closed: "bg-navy-50 text-navy",
  taken: "bg-navy-50 text-navy",
};
const STATUS_WORD: Record<string, string> = { published: "Published", open: "Open", draft: "Draft", closed: "Closed", taken: "Taken" };

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${CHIP[status] ?? CHIP.draft}`}>{STATUS_WORD[status] ?? status}</span>
  );
}

/** Hidden by the kill switch, or outside its visibility window; nothing when members can see it. */
function visibilityNote(v: { active: boolean; visibleFrom: string | null; visibleUntil: string | null }, now: Date): string | null {
  if (!v.active) return "Hidden from members";
  if (v.visibleFrom && new Date(v.visibleFrom) > now) return "Scheduled";
  if (v.visibleUntil && new Date(v.visibleUntil) < now) return "Expired";
  return null;
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] leading-[1.45] text-danger">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Campaigns

function ProgressBar({ pledged, received, label }: { pledged: number; received: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="relative h-2.5 w-full overflow-hidden rounded-full border border-line bg-ground">
      <span className="absolute inset-y-0 left-0 rounded-full bg-navy-200" style={{ width: `${pledged}%` }} />
      <span className="absolute inset-y-0 left-0 rounded-full bg-navy" style={{ width: `${received}%` }} />
    </div>
  );
}

function TimeBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div role="img" aria-label={label} className="relative h-1.5 w-full overflow-hidden rounded-full bg-ground">
      <span className="absolute inset-y-0 left-0 rounded-full bg-saffron-200" style={{ width: `${percent}%` }} />
    </div>
  );
}

function CampaignRow({ c, model, now }: { c: CampaignItem; model: CampaignsModel; now: Date }) {
  const dates =
    c.startsOn || c.endsOn ? `${c.startsOn ? formatDate(c.startsOn, model.timeZone) : "Open start"} – ${c.endsOn ? formatDate(c.endsOn, model.timeZone) : "no end date"}` : null;
  const p = c.totals
    ? campaignProgress({ goalCents: c.goalCents, pledgedCents: c.totals.pledgedCents, receivedCents: c.totals.receivedCents, startsOn: c.startsOn, endsOn: c.endsOn, today: model.today })
    : null;
  const words = p && c.totals ? progressWords(p, c.totals, model.currency, model.locale) : null;
  const note = visibilityNote(c, now);
  return (
    <li className="flex flex-col gap-2 border-t border-line py-3.5 first:border-t-0" data-testid="campaign-row">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[16px] font-bold text-ink">{c.name}</span>
        <StatusChip status={c.status} />
        {note ? <span className="text-[12px] font-bold text-brown">{note}</span> : null}
      </div>
      {c.fund || dates ? (
        <p className="m-0 text-[13px] text-muted">
          {[c.fund ? `${c.fund}${c.restricted ? " (restricted)" : ""}` : null, dates].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {p && words && c.totals ? (
        <div className="flex max-w-[640px] flex-col gap-1.5">
          {p.goalCents !== null ? <ProgressBar pledged={p.pledgedBar} received={p.receivedBar} label={`${words.pledged}. ${words.received}.`} /> : null}
          <p className="m-0 text-[13px] text-ink-2">
            <span className="font-semibold">{words.pledged}</span>
            {" · "}
            {words.received}
            {` · ${c.totals.pledges} pledge${c.totals.pledges === 1 ? "" : "s"}`}
          </p>
          {words.time ? (
            <>
              {p.time?.state === "running" ? <TimeBar percent={p.time.percent} label={words.time} /> : null}
              <p className="m-0 text-[12px] text-muted">{words.time}</p>
            </>
          ) : null}
        </div>
      ) : null}
      {model.canManage ? (
        <div className="flex flex-wrap gap-1.5">
          {c.status === "draft" || c.status === "closed" ? (
            <CampaignStatusButton id={c.id} status="published" label={c.status === "closed" ? "Reopen" : "Publish"} />
          ) : null}
          {c.status === "published" ? <CampaignStatusButton id={c.id} status="closed" label="Close" /> : null}
          {c.status === "closed" || c.status === "draft" ? <CampaignStatusButton id={c.id} status="archived" label="Archive" /> : null}
          <ActionForm action={setCampaignActiveAction} submitLabel={c.active ? "Hide" : "Reactivate"} pendingLabel="Saving…" variant={c.active ? "bad" : "ok"} size="xs">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="active" value={c.active ? "false" : "true"} />
          </ActionForm>
        </div>
      ) : null}
    </li>
  );
}

function CampaignStatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <ActionForm action={setCampaignStatusAction} submitLabel={label} pendingLabel="Saving…" variant={status === "archived" ? "ghost" : "secondary"} size="xs">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
    </ActionForm>
  );
}

function CampaignList({ model }: { model: CampaignsModel }) {
  const now = new Date();
  if (model.campaignsError) return <QueryError what="campaigns" error={model.campaignsError} retryHref={CAMPAIGNS_PATH} />;
  return (
    <section aria-labelledby="campaigns-list" className="rounded-[18px] border border-line bg-white px-4 py-4 sm:px-5">
      <h2 id="campaigns-list" className="m-0 font-display text-[20px] font-semibold text-ink">
        Campaigns
      </h2>
      <p className="m-0 mt-1 text-[13px] text-muted">
        Pledged and received against each campaign&apos;s own goal; drafts are seen by staff only. Cancelled and written-off pledges are left out.
      </p>
      {model.totalsError ? (
        <div className="mt-3">
          <QueryError what="campaign totals" error={model.totalsError} retryHref={CAMPAIGNS_PATH} />
        </div>
      ) : null}
      {model.campaigns.length === 0 ? (
        <EmptyState title="No campaigns yet">{model.canManage ? "Start one with New campaign: a name is enough." : null}</EmptyState>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {model.campaigns.map((c) => (
            <CampaignRow key={c.id} c={c} model={model} now={now} />
          ))}
        </ul>
      )}
      {model.archivedCount > 0 ? (
        <p className="m-0 mt-2 text-[13px] text-muted">
          {model.archivedCount} archived campaign{model.archivedCount === 1 ? " is" : "s are"} not shown.{" "}
          <Link href="/giving/opportunities/campaigns" className="font-semibold text-navy underline">
            See every campaign
          </Link>
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Opportunities

function takenText(o: OpportunityItem): string | null {
  const t = o.taken;
  if (!t) return null;
  const head = t.slotsTotal ? `${t.slotsTaken ?? 0} of ${t.slotsTotal} taken` : `${t.slotsTaken ?? 0} pledge${t.slotsTaken === 1 ? "" : "s"}`;
  return t.goalPercent !== null ? `${head} · ${t.goalPercent}% of goal` : head;
}

function OpportunityList({ model }: { model: CampaignsModel }) {
  const now = new Date();
  const typeLabel = new Map<string, string>([...quickOpportunityTypes(model.listType).map((t) => [t.type, t.label] as [string, string]), ["fixed", "Fixed amount"]]);
  if (model.opportunitiesError) return <QueryError what="opportunities" error={model.opportunitiesError} retryHref={viewHref("opportunities")} />;
  const rows = model.opportunities ?? [];
  return (
    <section aria-labelledby="opportunities-list" className="rounded-[18px] border border-line bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="opportunities-list" className="m-0 font-display text-[20px] font-semibold text-ink">
          {model.views.find((v) => v.key === "opportunities")?.label ?? "Opportunities"}
        </h2>
        {model.canManage ? (
          <Link href="/giving/opportunities" className={buttonClass("ghost", "sm")}>
            Open the full builder
          </Link>
        ) : null}
      </div>
      <p className="m-0 mt-1 text-[13px] text-muted">What members see in the Give tab. Drafts are seen by staff only.</p>
      {rows.length === 0 ? (
        <EmptyState title="No opportunities yet">{model.canManage ? "Start one with New opportunity: four questions, the rest later." : null}</EmptyState>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {rows.map((o) => {
            const note = visibilityNote(o, now);
            const meta = [o.campaignName, typeLabel.get(o.kind) ?? o.kind, takenText(o), o.allowRecurring ? "Recurring allowed" : null].filter(Boolean);
            return (
              <li key={o.id} className="flex flex-col gap-1.5 border-t border-line py-3.5 first:border-t-0" data-testid="opportunity-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[16px] font-bold text-ink">{o.name}</span>
                  <StatusChip status={o.status} />
                  {note ? <span className="text-[12px] font-bold text-brown">{note}</span> : null}
                </div>
                {o.subtitle ? <p className="m-0 text-[13px] text-ink-2">{o.subtitle}</p> : null}
                <p className="m-0 text-[13px] text-muted">{meta.join(" · ")}</p>
                {model.canManage ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Link href={`/giving/opportunities?edit=${o.id}`} className={buttonClass("ghost", "xs")}>
                      Edit in the full builder
                    </Link>
                    <ActionForm
                      action={setOpportunityStatusAction}
                      submitLabel={o.status === "open" ? "Close" : o.status === "draft" ? "Publish" : "Reopen"}
                      pendingLabel="Saving…"
                      variant={o.status === "open" ? "bad" : "ok"}
                      size="xs"
                    >
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="status" value={o.status === "open" ? "closed" : "open"} />
                    </ActionForm>
                    <ActionForm action={setOpportunityActiveAction} submitLabel={o.active ? "Hide" : "Reactivate"} pendingLabel="Saving…" variant={o.active ? "bad" : "ok"} size="xs">
                      <input type="hidden" name="id" value={o.id} />
                      <input type="hidden" name="active" value={o.active ? "false" : "true"} />
                    </ActionForm>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- The tab

export function CampaignsTab({ model, children }: { model: CampaignsModel; children?: ReactNode }) {
  const router = useRouter();
  const views = shownViews(model.views);
  const campaignsOn = model.views.some((v) => v.key === "campaigns" && v.state === "on");
  const opportunitiesOn = model.views.some((v) => v.key === "opportunities" && v.state === "on");
  const canCampaign = model.canManage && campaignsOn;
  const canOpportunity = model.canManage && opportunitiesOn;
  const startSheet: Sheet = model.start.sheet === "campaign" && canCampaign ? "campaign" : model.start.sheet === "opportunity" && canOpportunity ? "opportunity" : null;
  const [sheet, setSheet] = useState<Sheet>(startSheet);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<ReactNode>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // A sheet is drawn on the document body, so one asked for by the address (?new=…) opens once the page is in the browser.
  const onClient = useSyncExternalStore(noSubscribe, () => true, () => false);

  function settleDraft(status: "published" | "archived") {
    if (!draft?.id) return;
    const doing = status === "archived" ? "Could not undo the draft" : "Could not publish the campaign";
    setDraftError(null);
    start(async () => {
      try {
        const res = await setCampaignStatusAction(null, fd({ id: draft.id as string, status }));
        if (!res.ok) {
          setDraftError(res.error ?? `${doing}.`);
          return;
        }
        setDraft({
          ...draft,
          settled: true,
          message: status === "archived" ? `Undone: the draft "${draft.name}" was archived. Members never saw it.` : (res.message ?? `"${draft.name}" is now published.`),
        });
        router.refresh();
      } catch (err) {
        console.error(`[giving-campaigns] ${doing}:`, err);
        setDraftError(`${doing}: the server did not respond. Reload the page to see whether it went through before trying again.`);
      }
    });
  }

  return (
    <div data-v2-tokens className="flex flex-col gap-5 pb-24 md:pb-2">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{model.title}</h1>
          <p className="m-0 text-[14px] text-muted">Campaigns carry the goal; opportunities are what members choose.</p>
        </div>
        {canCampaign || canOpportunity ? (
          <div className="flex flex-wrap gap-2">
            {canCampaign ? (
              <button type="button" className={`${buttonClass(canOpportunity ? "ghost" : "primary", "sm")} min-h-[44px]`} onClick={() => setSheet("campaign")}>
                New campaign
              </button>
            ) : null}
            {canOpportunity ? (
              <button type="button" className={`${buttonClass("primary", "sm")} min-h-[44px]`} onClick={() => setSheet("opportunity")}>
                New opportunity
              </button>
            ) : null}
          </div>
        ) : null}
      </header>

      <GivingTabRow tabs={model.tabs} active="campaigns" />

      {views.length >= 2 ? (
        <nav aria-label="Campaigns & opportunities views" className="flex flex-wrap gap-1.5">
          {views.map((v) => (
            <Link key={v.key} href={v.href} aria-current={v.key === model.active ? "page" : undefined} className="cc-chip">
              {v.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {draft ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-white px-4 py-3" data-testid="draft-notice">
          <p className="m-0 min-w-0 flex-1 text-[14px] text-ink">{draft.message}</p>
          {!draft.settled && draft.id ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} className={`${buttonClass("ghost", "sm")} min-h-[40px]`} onClick={() => settleDraft("archived")}>
                Undo
              </button>
              <button type="button" disabled={pending} className={`${buttonClass("primary", "sm")} min-h-[40px]`} onClick={() => settleDraft("published")}>
                Publish “{draft.name}”
              </button>
            </div>
          ) : null}
          {draftError ? (
            <div className="basis-full">
              <Problem>{draftError}</Problem>
            </div>
          ) : null}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-[14px] border border-line bg-white px-4 py-3 text-[14px] text-ink">
          {notice}
        </div>
      ) : null}

      {children ?? (model.active === "opportunities" ? <OpportunityList model={model} /> : <CampaignList model={model} />)}

      {onClient && sheet === "campaign" ? (
        <QuickCampaignSheet
          startName={startSheet === "campaign" ? model.start.name : ""}
          funds={model.funds}
          currency={model.currency}
          onClose={() => setSheet(null)}
          onCreated={(created) => {
            setSheet(null);
            setNotice(null);
            setDraftError(null);
            setDraft({ id: created.id, name: created.name, message: `Created "${created.name}" as a draft. Members see nothing until you publish it.`, settled: false });
            router.refresh();
          }}
        />
      ) : null}
      {onClient && sheet === "opportunity" ? (
        <QuickOpportunitySheet
          startName={startSheet === "opportunity" ? model.start.name : ""}
          campaigns={model.campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status }))}
          currency={model.currency}
          listType={model.listType}
          onClose={() => setSheet(null)}
          onSaved={(message) => {
            setSheet(null);
            setDraft(null);
            setNotice(
              <>
                {message}
                {model.active !== "opportunities" ? (
                  <>
                    {" "}
                    <Link href={viewHref("opportunities")} className="font-semibold text-navy underline">
                      See it in the list
                    </Link>
                  </>
                ) : null}
              </>,
            );
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

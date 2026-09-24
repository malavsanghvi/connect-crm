"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { ChipGroup } from "@/components/controls";
import { Drawer } from "@/components/drawer";
import { HistoryButton } from "@/components/record-history";
import { useToast } from "@/components/toast";
import { Card, InfoBox, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { ALERT_AUDIENCES, OPPORTUNITY_TYPES, type OptionRow } from "@/lib/giving";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { previewAudienceAction, saveOpportunityAction } from "./actions";

export type BuilderCampaign = { id: string; name: string; status: string; fund: string | null; restricted: boolean };
export type BuilderInitial = {
  id: string;
  name: string;
  subtitle: string;
  kind: string;
  campaignId: string;
  allowAnonymous: boolean;
  rows: OptionRow[];
  taken: Record<string, number>;
  status: string;
};

const EMPTY_ROWS: Record<string, OptionRow[]> = {
  tier: [{ label: "", amount: "", recognition: "" }],
  multi: [{ label: "", amount: "" }],
  amount: [{ label: "", amount: "" }],
  open: [],
};

/** The opportunity builder (prototype L601): the form (span 7) and the type's table (span 12). */
export function OpportunityBuilder({
  campaigns,
  initial,
  canManage,
  currency,
  centerName,
}: {
  campaigns: BuilderCampaign[];
  initial: BuilderInitial | null;
  canManage: boolean;
  currency: string;
  centerName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [kind, setKind] = useState(initial?.kind && initial.kind !== "fixed" ? initial.kind : "multi");
  const [campaignId, setCampaignId] = useState(initial?.campaignId ?? campaigns.find((c) => c.status === "published")?.id ?? campaigns[0]?.id ?? "");
  const [anon, setAnon] = useState(initial ? initial.allowAnonymous : true);
  const [rowsByKind, setRowsByKind] = useState<Record<string, OptionRow[]>>(() => ({
    ...EMPTY_ROWS,
    ...(initial ? { [initial.kind]: initial.rows.length ? initial.rows : EMPTY_ROWS[initial.kind] ?? [] } : {}),
  }));
  const [audience, setAudience] = useState<string[]>(["all_members"]);
  const [recipients, setRecipients] = useState<{ count: number | null; note: string | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [pending, start] = useTransition();
  const rows = rowsByKind[kind] ?? [];
  const campaign = campaigns.find((c) => c.id === campaignId);

  useEffect(() => {
    let cancelled = false;
    previewAudienceAction(audience)
      .then((r) => {
        if (cancelled) return;
        setRecipients(r.ok ? { count: r.data?.count ?? null, note: r.data?.note ?? null, error: null } : { count: null, note: null, error: r.error });
      })
      .catch((err) => {
        console.error("[opportunities] recipient preview failed:", err);
        if (!cancelled) setRecipients({ count: null, note: null, error: "Could not count the recipients — the server did not respond." });
      });
    return () => {
      cancelled = true;
    };
  }, [audience]);

  function setRow(i: number, patch: Partial<OptionRow>) {
    setRowsByKind((cur) => ({ ...cur, [kind]: (cur[kind] ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  }
  function addRow() {
    setRowsByKind((cur) => ({ ...cur, [kind]: [...(cur[kind] ?? []), { label: "", amount: "", recognition: "" }] }));
  }
  function removeRow(i: number) {
    setRowsByKind((cur) => ({ ...cur, [kind]: (cur[kind] ?? []).filter((_, j) => j !== i) }));
  }
  function toggleAudience(key: string) {
    setAudience((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  function save(publish: boolean) {
    setError(null);
    start(async () => {
      try {
        const res = await saveOpportunityAction({
          id: initial?.id ?? null,
          name,
          subtitle,
          kind,
          campaignId,
          allowAnonymous: anon,
          rows,
          audience,
          publish,
        });
        if (!res.ok) {
          setError(res.error);
          toast?.show(res.error, "bad");
          return;
        }
        toast?.show(res.message ?? "Saved · audit logged", "ok");
        router.push("/giving/opportunities");
        router.refresh();
      } catch (err) {
        console.error("[opportunities] save failed:", err);
        setError("Could not save the opportunity — the server did not respond. Reload to check before trying again.");
      }
    });
  }

  const typeTitle = kind === "tier" ? "Sponsorship tiers" : kind === "multi" ? "Pujans and fixed bolis" : kind === "amount" ? "Preset amounts" : "Open amount";
  const cents = (a: string) => {
    const c = parseAmountToCents(a);
    return c && c > 0 ? formatCents(c, currency) : "—";
  };

  return (
    <>
      <Card
        span={7}
        title={initial ? `Edit opportunity · ${initial.name}` : "Opportunity builder"}
        actions={initial ? <HistoryButton table="opportunities" recordId={initial.id} title={initial.name} size="xs" /> : undefined}
      >
        <fieldset disabled={!canManage} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="op-name" className="crm-label">
              Name
            </label>
            <input id="op-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="e.g. Diwali aarti and pujans" className="crm-input" />
          </div>
          <div className="sm:col-span-2">
            <p className="crm-label">Type</p>
            <ChipGroup label="Type" value={kind} onChange={setKind} options={OPPORTUNITY_TYPES.map((t) => ({ value: t.kind, label: t.label }))} />
          </div>
          <div>
            <label htmlFor="op-campaign" className="crm-label">
              Campaign and fund
            </label>
            <select id="op-campaign" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="crm-input">
              {campaigns.length === 0 ? <option value="">Create a campaign first</option> : null}
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.status !== "published" ? ` (${c.status})` : ""}
                </option>
              ))}
            </select>
            <p className="crm-hint">{campaign ? `${campaign.name} · ${campaign.fund ? `${campaign.fund}${campaign.restricted ? " (restricted)" : ""}` : "unrestricted"}` : ""}</p>
          </div>
          <div>
            <p className="crm-label">Recognition</p>
            <ChipGroup
              label="Recognition"
              value={anon ? "anon" : "named"}
              onChange={(v) => setAnon(v === "anon")}
              options={[
                { value: "named", label: "Name shown" },
                { value: "anon", label: "Anonymous allowed" },
              ]}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="op-sub" className="crm-label">
              Line under the name (optional)
            </label>
            <input id="op-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={200} className="crm-input" />
          </div>
          <div className="sm:col-span-2">
            <p className="crm-label">Alert these members</p>
            <div role="group" aria-label="Alert these members" className="flex flex-wrap gap-1.5">
              {ALERT_AUDIENCES.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className="cc-chip min-h-[34px]"
                  aria-pressed={audience.includes(a.key)}
                  disabled={!a.audience}
                  title={a.audience ? undefined : "The audience rules can't target this group yet"}
                  onClick={() => toggleAudience(a.key)}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <p className="crm-hint" aria-live="polite">
              {audience.length === 0
                ? "No alert — members find it in the Give tab."
                : recipients?.error
                  ? recipients.error
                  : recipients?.count !== null && recipients?.count !== undefined
                    ? `About ${recipients.count.toLocaleString()} households by email · drafted in Communications for review when you publish.`
                    : (recipients?.note ?? "Counting recipients…")}{" "}
              Past donors and program interests can&apos;t be targeted yet.
            </p>
          </div>
          <div>
            <p className="crm-label">Pay or pledge</p>
            <InfoBox>Members choose; pay-now creates a pledge and closes it</InfoBox>
          </div>
          <div>
            <p className="crm-label">Explainer</p>
            <InfoBox>Video and text from Content (approved)</InfoBox>
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="mt-3 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setPreview(true)} className={buttonClass("ghost")}>
            Preview in app
          </button>
          {canManage ? (
            <>
              <button type="button" onClick={() => save(false)} disabled={pending} className={buttonClass("ghost")}>
                Save draft
              </button>
              <button type="button" onClick={() => save(true)} disabled={pending} className={buttonClass("primary")}>
                {pending ? "Saving…" : initial?.status === "open" ? "Save and keep published" : "Publish opportunity"}
              </button>
            </>
          ) : null}
        </div>
      </Card>

      <Card
        span={12}
        title={typeTitle}
        padded={kind === "open"}
        actions={
          canManage && kind !== "open" ? (
            <button type="button" onClick={addRow} className={buttonClass("ghost", "sm")}>
              {kind === "tier" ? "Add tier" : kind === "multi" ? "Add pujan" : "Add amount"}
            </button>
          ) : null
        }
      >
        {kind === "open" ? (
          <p className="text-[13px] text-muted">Members enter any amount. No options to set.</p>
        ) : (
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  {kind === "amount" ? (
                    <>
                      <th>Option</th>
                      <th>Amount ($)</th>
                      <th>Open amount</th>
                    </>
                  ) : (
                    <>
                      <th>{kind === "tier" ? "Tier" : "Pujan"}</th>
                      <th>Amount ($)</th>
                      {kind === "tier" ? <th>Recognition</th> : null}
                      <th>{kind === "tier" ? "Taken" : "Availability"}</th>
                    </>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const taken = r.key ? (initial?.taken[r.key] ?? 0) : 0;
                  return (
                    <tr key={i}>
                      {kind === "amount" ? (
                        <td className="font-semibold">Option {i + 1}</td>
                      ) : (
                        <td>
                          <input
                            aria-label={`${kind === "tier" ? "Tier" : "Pujan"} ${i + 1} name`}
                            value={r.label}
                            onChange={(e) => setRow(i, { label: e.target.value })}
                            disabled={!canManage}
                            placeholder={kind === "tier" ? "e.g. Gold" : "e.g. Pehli aarti"}
                            className="crm-input font-semibold"
                          />
                        </td>
                      )}
                      <td>
                        <input
                          aria-label={`Amount ${i + 1}`}
                          inputMode="decimal"
                          value={r.amount}
                          onChange={(e) => setRow(i, { amount: e.target.value })}
                          disabled={!canManage}
                          placeholder="251"
                          className="crm-input w-32"
                        />
                        <div className="text-xs text-muted">{cents(r.amount)}</div>
                      </td>
                      {kind === "tier" ? (
                        <td>
                          <input
                            aria-label={`Recognition ${i + 1}`}
                            value={r.recognition ?? ""}
                            onChange={(e) => setRow(i, { recognition: e.target.value })}
                            disabled={!canManage}
                            placeholder="e.g. Named at the event"
                            className="crm-input"
                          />
                        </td>
                      ) : null}
                      {kind === "amount" ? (
                        <td>{i === 0 ? "Allowed" : ""}</td>
                      ) : kind === "tier" ? (
                        <td className="num">{taken}</td>
                      ) : (
                        <td>{taken > 0 ? <StatusText tone="warn">Taken</StatusText> : <StatusText tone="ok">Available</StatusText>}</td>
                      )}
                      <td>
                        {canManage && !(taken > 0) ? (
                          <button type="button" onClick={() => removeRow(i)} className={buttonClass("plain", "xs")} aria-label={`Remove row ${i + 1}`}>
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Drawer
        open={preview}
        onClose={() => setPreview(false)}
        kicker="PREVIEW · MEMBER APP › GIVE"
        title={name || "Untitled opportunity"}
        subtitle={`${centerName} · ${campaign?.name ?? "No campaign"}`}
      >
        <div className="rounded-[20px] border border-line bg-white p-4 shadow-sm">
          <p className="font-display text-[20px] font-semibold text-ink">{name || "Untitled opportunity"}</p>
          {subtitle ? <p className="text-[13px] text-muted">{subtitle}</p> : null}
          <div className="mt-3 flex flex-col gap-2">
            {kind === "open" ? <p className="rounded-xl bg-subtle px-3 py-2 text-[14px] font-semibold">Enter any amount</p> : null}
            {kind === "amount" ? (
              <div className="flex flex-wrap gap-2">
                {rows.map((r, i) => (
                  <span key={i} className="cc-chip min-h-[40px]">
                    {cents(r.amount)}
                  </span>
                ))}
                <span className="cc-chip min-h-[40px]">Other amount</span>
              </div>
            ) : null}
            {kind === "tier" || kind === "multi"
              ? rows
                  .filter((r) => r.label.trim())
                  .map((r, i) => {
                    const taken = r.key ? (initial?.taken[r.key] ?? 0) : 0;
                    return (
                      <div key={i} className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-[14px]">
                        <span>
                          <span className="font-semibold">{r.label}</span>
                          {r.recognition ? <span className="block text-xs text-muted">{r.recognition}</span> : null}
                        </span>
                        <span className="font-bold">{kind === "multi" && taken > 0 ? "Taken" : cents(r.amount)}</span>
                      </div>
                    );
                  })
              : null}
          </div>
          <p className="mt-3 text-xs text-muted">
            {anon ? "Families may give anonymously." : "Donor names are shown."} Members choose to pay now or pledge.
          </p>
        </div>
        <p className="text-xs text-muted">This is how the card reads in the member app&apos;s Give tab. Nothing is published until you press Publish.</p>
      </Drawer>
    </>
  );
}

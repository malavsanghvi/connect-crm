"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { ActionForm } from "@/components/action-form";
import { Card, buttonClass } from "@/components/ui";
import {
  DEFAULT_RSVP_STATUSES,
  EMPTY_SELECTION,
  LANGUAGES,
  buildAudience,
  composeAction,
  parseAudience,
  requiresSecondApprover,
  type AudienceSelection,
  type LanguageCode,
} from "@/lib/comms";

import { previewRecipientsAction, saveCampaignAction, submitNewsletterAction } from "./actions";

type Opt = { id: string; name: string };
export type ComposeOptions = { zones: Opt[]; classes: Opt[]; events: Opt[]; unavailable: string[] };

export type CampaignDraft = {
  id: string;
  name: string | null;
  title: string;
  body_md: string | null;
  channels: string[];
  audience: unknown;
  translations: unknown;
  scheduled_local: string;
};

const CHANNELS: { value: string; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "push", label: "Push teaser" },
  { value: "in_app", label: "In-app archive" },
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
];

function Chip({ on, onClick, children, disabled, title }: { on: boolean; onClick?: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} title={title} onClick={onClick} className="cc-chip min-h-[34px]">
      {children}
    </button>
  );
}

function translationOf(t: unknown, code: string): { title: string; body_md: string } {
  const v = t && typeof t === "object" ? (t as Record<string, unknown>)[code] : null;
  if (!v || typeof v !== "object") return { title: "", body_md: "" };
  const o = v as Record<string, unknown>;
  return { title: typeof o.title === "string" ? o.title : "", body_md: typeof o.body_md === "string" ? o.body_md : "" };
}

/**
 * The prototype's one-screen newsletter: New newsletter (7) + live Recipients (5).
 * Segments combine — a household in any chosen segment receives it.
 */
export function NewsletterCompose({
  options,
  canApprove,
  myEmail,
  campaign,
}: {
  options: ComposeOptions;
  canApprove: boolean;
  myEmail: string | null;
  campaign?: CampaignDraft;
}) {
  const [sel, setSel] = useState<AudienceSelection>(() => (campaign ? parseAudience(campaign.audience) : { ...EMPTY_SELECTION }));
  const [channels, setChannels] = useState<string[]>(campaign?.channels ?? ["email", "push", "in_app"]);
  const [langs, setLangs] = useState<LanguageCode[]>(() => {
    const out: LanguageCode[] = ["en"];
    if (campaign) for (const l of LANGUAGES) if (l.code !== "en" && translationOf(campaign.translations, l.code).title) out.push(l.code);
    return out;
  });
  const [count, setCount] = useState<{ n: number | null; error: string | null }>({ n: null, error: null });
  const [counting, startCount] = useTransition();

  const built = useMemo(() => buildAudience(sel), [sel]);
  const audienceJson = built.ok ? JSON.stringify(built.audience) : "{}";
  const needsSecond = built.ok && requiresSecondApprover(built.audience);
  const mode = built.ok ? composeAction(built.audience, canApprove) : "submit";
  const allClassIds = options.classes.map((c) => c.id);
  const pathshalaOn = allClassIds.length > 0 && allClassIds.every((id) => sel.pathshalaClassIds.includes(id));

  useEffect(() => {
    if (!built.ok) return;
    const t = setTimeout(() => {
      startCount(async () => {
        try {
          const res = await previewRecipientsAction(audienceJson);
          setCount(res.ok ? { n: res.data?.count ?? 0, error: null } : { n: null, error: res.error });
        } catch (err) {
          console.error("[comms] recipient preview failed:", err);
          setCount({ n: null, error: "Could not count the recipients — the server did not respond. Change a segment to try again." });
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [audienceJson, built.ok]);

  const toggle = (k: "allMembers" | "lifeMembers") => setSel((s) => ({ ...s, [k]: !s[k] }));
  const toggleZone = (id: string) => setSel((s) => ({ ...s, zoneIds: s.zoneIds.includes(id) ? s.zoneIds.filter((z) => z !== id) : [...s.zoneIds, id] }));
  const toggleChannel = (v: string) => setChannels((c) => (c.includes(v) ? c.filter((x) => x !== v) : [...c, v]));
  const toggleLang = (code: LanguageCode) => {
    if (code === "en") return;
    setLangs((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));
  };

  const previewBg = !built.ok ? "bg-[#FBF7F0]" : needsSecond || mode === "submit" ? "bg-[#FBEBD7]" : "bg-[#E4F2EA]";
  const approvalLine = !built.ok
    ? "Choose who receives it"
    : needsSecond
      ? "Needs a second approver (all members) · two different people approve"
      : canApprove
        ? "No second approver needed · you can schedule it now"
        : "Needs one approver (comms.approve) before it goes out";

  return (
    <>
      <Card title={campaign ? "Edit newsletter" : "New newsletter"} span={7}>
        <ActionForm
          action={campaign ? saveCampaignAction : submitNewsletterAction}
          submitLabel={campaign ? "Save changes" : mode === "schedule" ? "Schedule send" : "Send for approval"}
          resetOnSuccess={!campaign}
          confirmMessage={
            !campaign && mode === "schedule"
              ? `Schedule this newsletter? ${count.n !== null ? `It goes to ${count.n.toLocaleString()} households by email` : "It goes to the chosen audience"} once it is scheduled.`
              : undefined
          }
          extraButtons={
            campaign ? null : (
              <button
                type="button"
                disabled
                title="Email sending is not connected to this app yet, so a test cannot be delivered."
                className={buttonClass("off")}
              >
                Send test to me
              </button>
            )
          }
        >
          {campaign ? <input type="hidden" name="id" value={campaign.id} /> : null}
          <input type="hidden" name="audience" value={audienceJson} />
          {channels.map((c) => (
            <input key={c} type="hidden" name="channels" value={c} />
          ))}
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="nl-name" className="crm-label">
                Name
              </label>
              <input id="nl-name" name="name" required defaultValue={campaign?.name ?? ""} placeholder="Pathshala fall update · West zone" className="crm-input" />
            </div>
            <div className="sm:col-span-2">
              <p className="crm-label">Audience (combine segments)</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Audience segments">
                <Chip on={sel.allMembers} onClick={() => toggle("allMembers")}>
                  All members
                </Chip>
                <Chip on={sel.lifeMembers} onClick={() => toggle("lifeMembers")}>
                  Life members
                </Chip>
                <Chip
                  on={pathshalaOn}
                  disabled={allClassIds.length === 0}
                  title={allClassIds.length === 0 ? "No Pathshala classes you can see this term" : undefined}
                  onClick={() => setSel((s) => ({ ...s, pathshalaClassIds: pathshalaOn ? [] : allClassIds }))}
                >
                  Pathshala parents
                </Chip>
                {options.zones.map((z) => (
                  <Chip key={z.id} on={sel.zoneIds.includes(z.id)} onClick={() => toggleZone(z.id)}>
                    {z.name} zone
                  </Chip>
                ))}
                <Chip
                  on={sel.eventId !== null}
                  disabled={options.events.length === 0}
                  title={options.events.length === 0 ? "No events you can see" : undefined}
                  onClick={() => setSel((s) => ({ ...s, eventId: s.eventId ? null : (options.events[0]?.id ?? null), rsvpStatuses: [...DEFAULT_RSVP_STATUSES] }))}
                >
                  Event attendees
                </Chip>
                <Chip on={false} disabled title="The recipient count cannot tell who is not on the app yet, so this segment is not available.">
                  Not on the app
                </Chip>
              </div>
              {sel.pathshalaClassIds.length > 0 && !pathshalaOn ? (
                <p className="crm-hint">Parents of {sel.pathshalaClassIds.length} Pathshala class{sel.pathshalaClassIds.length === 1 ? "" : "es"} (from an earlier selection).</p>
              ) : null}
              {sel.eventId !== null ? (
                <div className="mt-2">
                  <label htmlFor="nl-event" className="crm-label">
                    Which event
                  </label>
                  <select id="nl-event" value={sel.eventId} onChange={(e) => setSel((s) => ({ ...s, eventId: e.target.value }))} className="crm-input">
                    {options.events.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {options.unavailable.length > 0 ? (
                <p className="crm-hint text-brown">Your roles can&apos;t read {options.unavailable.join(" or ")}, so those segments are limited.</p>
              ) : null}
            </div>
            <div>
              <p className="crm-label">Channels</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Channels">
                {CHANNELS.map((c) => (
                  <Chip key={c.value} on={channels.includes(c.value)} onClick={() => toggleChannel(c.value)}>
                    {c.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <p className="crm-label">Language</p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Languages">
                {LANGUAGES.map((l) => (
                  <Chip key={l.code} on={langs.includes(l.code)} onClick={() => toggleLang(l.code)} title={l.code === "en" ? "English is always included" : "Add a translation"}>
                    {l.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="nl-subject" className="crm-label">
                Subject
              </label>
              <input id="nl-subject" name="title" required defaultValue={campaign?.title ?? ""} placeholder="Fall term: classes, teachers and dates for West zone families" className="crm-input" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="nl-body" className="crm-label">
                Message
              </label>
              <textarea id="nl-body" name="body_md" required rows={7} defaultValue={campaign?.body_md ?? ""} className="crm-input" />
            </div>
            {LANGUAGES.filter((l) => l.code !== "en").map((l) =>
              langs.includes(l.code) ? (
                <div key={l.code} className="flex flex-col gap-2 sm:col-span-2">
                  <div>
                    <label htmlFor={`nl-title-${l.code}`} className="crm-label">
                      Subject · {l.label}
                    </label>
                    <input id={`nl-title-${l.code}`} name={`title_${l.code}`} defaultValue={translationOf(campaign?.translations, l.code).title} className="crm-input" />
                  </div>
                  <div>
                    <label htmlFor={`nl-body-${l.code}`} className="crm-label">
                      Message · {l.label}
                    </label>
                    <textarea id={`nl-body-${l.code}`} name={`body_${l.code}`} rows={4} defaultValue={translationOf(campaign?.translations, l.code).body_md} className="crm-input" />
                  </div>
                </div>
              ) : null,
            )}
            <div>
              <label htmlFor="nl-at" className="crm-label">
                Send at (optional)
              </label>
              <input id="nl-at" type="datetime-local" name="scheduled_at" defaultValue={campaign?.scheduled_local ?? ""} className="crm-input" />
              <p className="crm-hint">Blank = as soon as it is approved.</p>
            </div>
          </div>
          {!campaign ? (
            <p className="mb-2 text-xs text-muted">
              Send test to me is unavailable: email delivery is not connected to this app yet{myEmail ? `, so nothing can reach ${myEmail}` : ""}.
            </p>
          ) : null}
        </ActionForm>
      </Card>

      <Card title="Recipients" description="Live count" span={5} className={previewBg}>
        <p className="text-[22px] font-extrabold text-ink" aria-live="polite">
          {!built.ok ? "—" : count.error ? "Count unavailable" : count.n === null || counting ? "Counting…" : `${count.n.toLocaleString()} household${count.n === 1 ? "" : "s"}`}
        </p>
        {count.error && built.ok ? <p className="mt-1 text-[13px] text-danger">{count.error}</p> : null}
        <p className="mt-1 text-[13px] font-medium text-ink-2">
          Adults who opted in to email · children never receive email · anyone not opted in, or unsubscribed, is excluded
        </p>
        <p className={`mt-2 text-[13px] font-bold ${!built.ok ? "text-muted" : needsSecond || mode === "submit" ? "text-brown" : "text-success-900"}`}>{approvalLine}</p>
      </Card>
    </>
  );
}

"use client";

import Link from "next/link";
import { useId, useState } from "react";

import { Card, buttonClass } from "@/components/ui";
import {
  CHANNEL_ORDER,
  channelLabel,
  channelsLine,
  COPY_NOTE,
  defaultPickerChannel,
  recentForPicker,
  startFromOptions,
  templatesForPicker,
  WHATSAPP_TEMPLATE_NOTE,
  type ChannelFilter,
  type RecentRow,
  type StartKey,
  type TemplateRow,
} from "@/lib/comms-templates";

import { startFromTemplateAction, copyCampaignAction } from "./template-actions";
import { useStartDraft } from "./start-draft";

/**
 * The start of a new communication: Blank (the form below), A saved template, or A recent communication. A template or a recent
 * communication makes a new draft and opens it in the composer; nothing is sent. The channel chips list only the channels the
 * community has set up. The search looks in names, subjects, audiences and who wrote them.
 */
export function StartFrom({ recent, templates, available }: { recent: RecentRow[]; templates: TemplateRow[]; available: string[] }) {
  const [mode, setMode] = useState<StartKey>("blank");
  const [channel, setChannel] = useState<ChannelFilter>(() => defaultPickerChannel(available));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ kind: StartKey; id: string } | null>(null);
  const draft = useStartDraft();
  const groupId = useId();
  const searchId = useId();
  const options = startFromOptions({ templates: templates.length, recent: recent.length });
  const channels = CHANNEL_ORDER.filter((c) => available.includes(c));
  const rows = mode === "recent" ? recentForPicker(recent, { channel, query }) : [];
  const tpls = mode === "template" ? templatesForPicker(templates, { channel, query }) : [];

  function startWith(kind: StartKey, id: string) {
    setPicked({ kind, id });
    if (kind === "recent") draft.run(copyCampaignAction, id, "copy the communication");
    else draft.run(startFromTemplateAction, id, "start from the template");
  }
  const retry = () => (picked ? startWith(picked.kind, picked.id) : undefined);
  const chip = "cc-chip min-h-[34px]";

  return (
    <Card title="Start from" description="Begin with a blank form, a saved template or a communication you made before. Nothing is sent until someone approves it." span={12}>
      <div role="radiogroup" aria-labelledby={groupId} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <span id={groupId} className="sr-only">
          Start from
        </span>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={mode === o.key}
            onClick={() => {
              setMode(o.key);
              draft.setError(null);
            }}
            className={`min-h-11 rounded-[14px] border px-3.5 py-2.5 text-left transition-colors ${
              mode === o.key ? "border-navy bg-navy-50" : "border-line bg-white hover:bg-canvas"
            }`}
          >
            <span className="block text-[14.5px] font-bold text-ink">{o.label}</span>
            <span className="block text-[12.5px] text-muted">{o.hint}</span>
          </button>
        ))}
      </div>

      {mode === "blank" ? <p className="crm-hint mt-3">Fill in the form below.</p> : null}

      {mode !== "blank" ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-end gap-3">
            <div role="group" aria-label="Channel" className="flex flex-wrap gap-1.5">
              {channels.map((c) => (
                <button key={c} type="button" aria-pressed={channel === c} onClick={() => setChannel(c)} className={chip}>
                  {channelLabel(c)}
                </button>
              ))}
              <button type="button" aria-pressed={channel === "all"} onClick={() => setChannel("all")} className={chip}>
                All channels
              </button>
            </div>
            <div className="min-w-[14rem] flex-1">
              <label htmlFor={searchId} className="crm-label">
                Search {mode === "template" ? "templates" : "communications"}
              </label>
              <input
                id={searchId}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={mode === "template" ? "Name or subject" : "Name, subject, audience or who wrote it"}
                className="crm-input"
              />
            </div>
          </div>

          {mode === "recent" ? <p className="crm-hint mt-2">{COPY_NOTE}</p> : null}
          {mode === "template" && (channel === "whatsapp" || tpls.some((t) => t.channels.includes("whatsapp"))) ? (
            <p role="note" className="mt-2 rounded-field border border-warning-200 bg-warning-50 px-3 py-2 text-[13px] text-warning-ink">
              {WHATSAPP_TEMPLATE_NOTE}
            </p>
          ) : null}

          {draft.error ? (
            <p role="alert" className="mt-3 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {draft.error}{" "}
              <button type="button" onClick={retry} disabled={draft.pending} className={`${buttonClass("bad", "xs")} align-middle`}>
                Try again
              </button>
            </p>
          ) : null}

          <ul className="m-0 mt-2 list-none p-0" aria-live="polite">
            {mode === "recent"
              ? rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[14.5px] font-bold text-ink">{r.name}</p>
                      {r.subject && r.subject !== r.name ? <p className="m-0 text-[13px] text-ink-2">{r.subject}</p> : null}
                      <p className="m-0 text-[12.5px] text-muted">
                        {channelsLine(r.channels)} · {r.audience} · {r.statusLabel} · {r.when} · {r.by}
                      </p>
                    </div>
                    <button type="button" disabled={draft.pending} onClick={() => startWith("recent", r.id)} className={buttonClass("primary", "sm")}>
                      {draft.pending && picked?.id === r.id ? "Copying…" : "Use this one"}
                    </button>
                  </li>
                ))
              : tpls.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[14.5px] font-bold text-ink">{t.name}</p>
                      {t.subject && t.subject !== t.name ? <p className="m-0 text-[13px] text-ink-2">{t.subject}</p> : null}
                      <p className="m-0 text-[12.5px] text-muted">
                        {channelsLine(t.channels)} · {t.when} · {t.by}
                        {t.tokens.length > 0 ? ` · merge fields: ${t.tokens.join(", ")}` : ""}
                      </p>
                      {t.channels.includes("whatsapp") ? <p className="m-0 text-[12.5px] text-brown">Starting point for the words only. Not approved by WhatsApp.</p> : null}
                    </div>
                    <button type="button" disabled={draft.pending} onClick={() => startWith("template", t.id)} className={buttonClass("primary", "sm")}>
                      {draft.pending && picked?.id === t.id ? "Starting…" : "Use this template"}
                    </button>
                  </li>
                ))}
          </ul>

          {mode === "recent" && rows.length === 0 ? (
            <p className="crm-hint mt-2">
              {recent.length === 0 ? "Nothing has been sent, scheduled or drafted yet." : `No communication matches${query.trim() ? ` "${query.trim()}"` : ""} in ${channel === "all" ? "any channel" : channelLabel(channel)}.`}
            </p>
          ) : null}
          {mode === "template" && tpls.length === 0 ? (
            <p className="crm-hint mt-2">
              {templates.length === 0
                ? "No templates are saved yet. Open a communication and choose Save as template."
                : `No template matches${query.trim() ? ` "${query.trim()}"` : ""} in ${channel === "all" ? "any channel" : channelLabel(channel)}.`}
            </p>
          ) : null}
          {mode === "template" ? (
            <p className="mt-2 text-[13px]">
              <Link href="/comms/templates" className="crm-link">
                Manage saved templates
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

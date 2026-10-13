"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";

import { ActionForm } from "@/components/action-form";
import { Alert, Card, StatusText, buttonClass } from "@/components/ui";
import { missingWords, sendValues } from "@/lib/merge/build";
import { placeholderGroups, type EmailTrigger } from "@/lib/merge/catalogue";
import { brokenPlaceholders, mergeSegments, unknownPlaceholders, type MergeSegment } from "@/lib/merge/render";

import { saveEmailWordingAction, sendEmailTestAction, setEmailAutomationAction } from "./actions";

export type EmailCardData = {
  key: EmailTrigger;
  title: string;
  when: string;
  enabled: boolean;
  /** Receipts only: whether uploaded donations get one too; null for the other emails. */
  uploaded: boolean | null;
  canEdit: boolean;
  /** Receipts and pledge confirmations: the treasurer's approval of the receipt templates. */
  approval: { ok: boolean; detail: string } | null;
  wordings: { language: string; subject: string; body: string; version: number }[];
  standard: { subject: string; body: string } | null;
  languages: { code: string; label: string }[];
  /** The preview's values: from the most recent real record (realSample) or made up. null = the record has none. */
  values: Record<string, string | null>;
  realSample: boolean;
  week: { queued: number; skipped: number };
};

/** A merged text: values marked lightly, values the record lacks marked in amber, unknown names in red. */
export function Segments({ segments }: { segments: MergeSegment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.text}</span>
        ) : s.kind === "value" ? (
          <span key={i} className="rounded bg-navy/5 px-0.5" title={`{{${s.name}}}`}>
            {s.text}
          </span>
        ) : s.kind === "missing" ? (
          <span key={i} className="rounded bg-saffron-50 px-0.5 text-brown-900" title={`{{${s.name}}}: this record has no value, so the email says this`}>
            [{s.text || `${s.name.replace(/_/g, " ")}: empty`}]
          </span>
        ) : (
          <span key={i} className="rounded bg-danger-50 px-0.5 text-danger" title="Not a placeholder of this email">
            {s.text}
          </span>
        ),
      )}
    </>
  );
}

/** The placeholder picker: one button per placeholder, grouped; a click inserts {{name}} where the cursor is. */
export function PlaceholderPicker({
  groups,
  into,
  onInsert,
}: {
  groups: { group: string; items: { name: string; label: string }[] }[];
  into: "subject" | "body";
  onInsert: (name: string) => void;
}) {
  return (
    <div className="mt-3">
      <p className="crm-label">Insert a placeholder (into the {into === "subject" ? "subject" : "email"})</p>
      <div className="grid gap-2">
        {groups.map((g) => (
          <div key={g.group} className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 text-[12px] text-muted">{g.group}</span>
            {g.items.map((p) => (
              <button key={p.name} type="button" className={buttonClass("ghost", "sm")} title={`{{${p.name}}}`} onClick={() => onInsert(p.name)}>
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AutomaticEmailCard({ email, log }: { email: EmailCardData; log: ReactNode }) {
  const firstLanguage = email.wordings.find((w) => w.language === email.languages[0]?.code)?.language ?? email.languages[0]?.code ?? "en";
  const [language, setLanguage] = useState(firstLanguage);
  const wordingFor = (lang: string) => email.wordings.find((w) => w.language === lang) ?? null;
  const start = wordingFor(firstLanguage) ?? email.standard ?? { subject: "", body: "" };
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const [field, setField] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const groups = useMemo(() => placeholderGroups(email.key), [email.key]);
  const allowed = useMemo(() => groups.flatMap((g) => g.items.map((p) => p.name)), [groups]);
  const missing = useMemo(() => missingWords(email.key), [email.key]);
  const unknown = unknownPlaceholders(`${subject}\n${body}`, allowed);
  const broken = brokenPlaceholders(`${subject}\n${body}`);
  const saved = wordingFor(language);
  // With no wording of the community's own in this language, saving the standard text makes it the community's own.
  const dirty = !saved || saved.subject !== subject || saved.body !== body;
  const testVars = JSON.stringify(sendValues(email.key, email.values));

  function chooseLanguage(lang: string) {
    setLanguage(lang);
    const w = wordingFor(lang) ?? email.standard ?? { subject: "", body: "" };
    setSubject(w.subject);
    setBody(w.body);
  }

  function insert(name: string) {
    const token = `{{${name}}}`;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    const value = field === "subject" ? subject : body;
    const from = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? value.length;
    const next = value.slice(0, from) + token + value.slice(to);
    if (field === "subject") setSubject(next);
    else setBody(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(from + token.length, from + token.length);
    });
  }

  const status = email.enabled ? <StatusText tone="ok">On</StatusText> : <StatusText tone="warn">Off</StatusText>;
  const week = `This week: ${email.week.queued} sent${email.week.skipped ? ` · ${email.week.skipped} not sent` : ""}`;

  return (
    <Card span={12} title={<span className="flex flex-wrap items-center gap-2">{email.title} {status}</span>} description={email.when}>
      <div className="flex flex-wrap items-center gap-3">
        {email.canEdit ? (
          <ActionForm
            action={setEmailAutomationAction}
            submitLabel={email.enabled ? "Switch off" : "Switch on"}
            pendingLabel="Saving…"
            variant={email.enabled ? "ghost" : "primary"}
            size="sm"
            confirmMessage={
              email.enabled
                ? `Switch the ${email.title.toLowerCase()} off?\nNothing more is sent until it is switched on again.`
                : `Switch the ${email.title.toLowerCase()} on?\nFrom now on each new record gets this email, in the wording below. Nothing already recorded is emailed.`
            }
          >
            <input type="hidden" name="key" value={email.key} />
            <input type="hidden" name="enabled" value={email.enabled ? "off" : "on"} />
          </ActionForm>
        ) : (
          <span className="text-[13px] text-muted">Only someone who manages this area can switch it or change its wording.</span>
        )}
        <span className="text-[13px] text-muted">{week}</span>
      </div>

      {email.approval && !email.approval.ok ? (
        <div className="mt-3">
          <Alert tone="warning" title="Waiting for the treasurer">
            This email goes only while the treasurer&apos;s approval of the receipt templates is current. {email.approval.detail}
          </Alert>
        </div>
      ) : null}

      {email.uploaded !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
          <span>
            Uploaded donations: <strong>{email.uploaded ? "get a receipt email too" : "no receipt email"}</strong>
          </span>
          {email.canEdit ? (
            <ActionForm
              action={setEmailAutomationAction}
              submitLabel={email.uploaded ? "Stop emailing uploaded donations" : "Email uploaded donations too"}
              pendingLabel="Saving…"
              variant="ghost"
              size="sm"
              confirmMessage={
                email.uploaded
                  ? undefined
                  : "Email receipts for uploaded donations too?\nEach donation in a future upload gets a receipt email while receipts are on. Uploads done before are not emailed."
              }
            >
              <input type="hidden" name="key" value={email.key} />
              <input type="hidden" name="enabled" value={email.enabled ? "on" : "off"} />
              <input type="hidden" name="uploaded" value={email.uploaded ? "off" : "on"} />
            </ActionForm>
          ) : null}
        </div>
      ) : null}

      <details className="mt-4 rounded-lg border border-line">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">Wording, placeholders and preview</summary>
        <div className="grid grid-cols-1 gap-4 p-3 lg:grid-cols-2">
          <div>
            <ActionForm
              action={saveEmailWordingAction}
              submitLabel="Save wording"
              pendingLabel="Saving…"
              size="sm"
              hideSubmit={!email.canEdit}
              submitDisabled={unknown.length > 0 || !dirty}
              extraButtons={
                email.canEdit && email.standard ? (
                  <button
                    type="button"
                    className={buttonClass("ghost", "sm")}
                    onClick={() => {
                      setSubject(email.standard?.subject ?? "");
                      setBody(email.standard?.body ?? "");
                    }}
                  >
                    Start from the standard wording
                  </button>
                ) : null
              }
            >
              <input type="hidden" name="key" value={email.key} />
              <fieldset disabled={!email.canEdit} className="grid gap-3">
                {email.languages.length > 1 ? (
                  <label>
                    <span className="crm-label">Language</span>
                    <select name="language" value={language} onChange={(e) => chooseLanguage(e.target.value)} className="crm-input">
                      {email.languages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label}
                          {wordingFor(l.code) ? "" : " (standard wording until saved)"}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <input type="hidden" name="language" value={language} />
                )}
                <label>
                  <span className="crm-label">Subject</span>
                  <input
                    ref={subjectRef}
                    name="subject"
                    value={subject}
                    maxLength={200}
                    onFocus={() => setField("subject")}
                    onChange={(e) => setSubject(e.target.value)}
                    className="crm-input"
                  />
                </label>
                <label>
                  <span className="crm-label">Email</span>
                  <textarea
                    ref={bodyRef}
                    name="body"
                    value={body}
                    rows={12}
                    onFocus={() => setField("body")}
                    onChange={(e) => setBody(e.target.value)}
                    className="crm-input font-mono text-[13px]"
                  />
                </label>
              </fieldset>
              {unknown.length > 0 ? (
                <p role="alert" className="mt-2 text-[13px] text-danger">
                  This email has no {unknown.map((n) => `{{${n}}}`).join(", ")}. Choose from the placeholders below.
                </p>
              ) : null}
              {broken.length > 0 ? (
                <p className="mt-2 text-[13px] text-brown-900">
                  These look like placeholders but are not: {broken.join(", ")}. A placeholder is a name in double braces, like {"{{recipient_first_name}}"}.
                </p>
              ) : null}
            </ActionForm>

            {email.canEdit ? <PlaceholderPicker groups={groups} into={field} onInsert={insert} /> : null}
          </div>

          <div>
            <p className="crm-label">
              Preview · {email.realSample ? "from the most recent real record" : "made-up values (no record of this kind yet)"} ·{" "}
              <span className="rounded bg-saffron-50 px-1 text-brown-900">[marked]</span> = the record has no value
            </p>
            <div className="rounded-lg border border-line bg-white p-3 text-[14px]">
              <p className="mb-2 font-semibold">
                <Segments segments={mergeSegments(subject, email.values, missing)} />
              </p>
              <div className="whitespace-pre-wrap">
                <Segments segments={mergeSegments(body, email.values, missing)} />
              </div>
            </div>
            {email.canEdit ? (
              <ActionForm action={sendEmailTestAction} submitLabel="Send the saved wording to me" pendingLabel="Sending…" variant="ghost" size="sm" className="mt-2">
                <input type="hidden" name="key" value={email.key} />
                <input type="hidden" name="language" value={language} />
                <input type="hidden" name="vars" value={testVars} />
              </ActionForm>
            ) : null}
          </div>
        </div>
      </details>

      <div className="mt-4">{log}</div>
    </Card>
  );
}

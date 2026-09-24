"use client";

import { useState } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { QuestionsBuilder } from "@/components/survey/questions-builder";
import { InfoBox } from "@/components/ui";
import { SEND_TIMINGS, type FeedbackTemplateSettings } from "@/lib/survey/feedback";
import type { SurveyQuestion } from "@/lib/survey/questions";

/** The prototype's "Survey template" form, plus an editor for the questions behind the summary. */
export function TemplateForm({
  action,
  questions,
  settings,
  editable,
}: {
  action: FormAction;
  questions: SurveyQuestion[];
  settings: FeedbackTemplateSettings;
  editable: boolean;
}) {
  const [anon, setAnon] = useState(settings.anonymousAllowed);
  const [timing, setTiming] = useState<string>(settings.sendTiming);
  const [reminder, setReminder] = useState(settings.reminderAfterDays ? "after_3_days" : "none");
  const summary = "Overall stars · 4 area ratings · likelihood to recommend (0–10) · what did you attend · open comment";
  return (
    <ActionForm action={action} submitLabel="Save template" hideSubmit={!editable} buttonsClassName="mt-3 justify-end">
      <fieldset disabled={!editable} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="md:col-span-3">
          <span className="crm-label">Questions</span>
          <InfoBox>{summary}</InfoBox>
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] font-bold text-navy">Edit the questions ({questions.length})</summary>
            <div className="mt-2">
              <QuestionsBuilder initial={questions} disabled={!editable} />
            </div>
          </details>
        </div>
        <div>
          <span className="crm-label">Anonymous answers</span>
          <Toggle
            name="anonymous_allowed"
            label="Anonymous answers"
            checked={anon}
            onChange={setAnon}
            onNote="Allowed · member chooses"
            offNote="Always anonymous · no names stored"
            disabled={!editable}
          />
        </div>
        <div>
          <span className="crm-label">When to send</span>
          <ChipGroup
            name="send_timing"
            label="When to send"
            options={SEND_TIMINGS.map((t) => ({ value: t.key, label: t.label }))}
            value={timing}
            onChange={setTiming}
            disabled={!editable}
          />
        </div>
        <div>
          <span className="crm-label">Reminder</span>
          <ChipGroup
            name="reminder"
            label="Reminder"
            options={[
              { value: "none", label: "None" },
              { value: "after_3_days", label: "Once after 3 days" },
            ]}
            value={reminder}
            onChange={setReminder}
            disabled={!editable}
          />
        </div>
        <div className="md:col-span-3">
          <span className="crm-label">Who receives it</span>
          <InfoBox>Checked-in attendees (members in the app; guests by SMS or WhatsApp) · children answer only if the family allows</InfoBox>
        </div>
      </fieldset>
    </ActionForm>
  );
}

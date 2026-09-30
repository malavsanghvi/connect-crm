"use client";

import { useState } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { QuestionsBuilder } from "@/components/survey/questions-builder";
import { InfoBox } from "@/components/ui";
import { defaultSurveyTitle, type TemplateOption } from "@/lib/survey/event-survey";
import type { SurveyQuestion } from "@/lib/survey/questions";

const ANONYMITY_OPTIONS = [
  { value: "choose", label: "Members choose: name or anonymous" },
  { value: "always", label: "Always anonymous: no names stored" },
];

/** Points, anonymity and automatic sending: the settings the attach and edit forms share. */
function SurveySettings({
  points,
  onPoints,
  anonymity,
  onAnonymity,
  auto,
  onAuto,
  autoNote,
}: {
  points: string;
  onPoints: (v: string) => void;
  anonymity: string;
  onAnonymity: (v: string) => void;
  auto: boolean;
  onAuto: (v: boolean) => void;
  autoNote: string;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div>
        <label htmlFor="sv-points" className="crm-label">
          Points for answering
        </label>
        <input
          id="sv-points"
          name="points"
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          step={1}
          value={points}
          onChange={(e) => onPoints(e.target.value)}
          className="crm-input w-32"
        />
        <p className="crm-hint">Each person earns this once, when they answer (0 to 1000). 0 means no points. The notification mentions it.</p>
      </div>
      <div>
        <span className="crm-label">Anonymous answers</span>
        <ChipGroup name="anonymity" label="Anonymous answers" options={ANONYMITY_OPTIONS} value={anonymity} onChange={onAnonymity} />
        <p className="crm-hint">Anonymous answers never show a name, household or device. Points still go to the person who answered.</p>
      </div>
      <div>
        <span className="crm-label">Send automatically</span>
        <Toggle
          name="auto"
          label="Send automatically when the event is completed"
          checked={auto}
          onChange={onAuto}
          onNote="On: opens when the event is marked completed"
          offNote="Off: you send it yourself"
        />
        <p className="crm-hint">{autoNote}</p>
      </div>
    </div>
  );
}

/** Attach a saved survey (copied, so editing it never changes the template) or write a new one. */
export function AttachSurveyForm({
  action,
  eventName,
  eventCompleted,
  templates,
  starterQuestions,
}: {
  action: FormAction;
  eventName: string;
  eventCompleted: boolean;
  templates: TemplateOption[];
  starterQuestions: SurveyQuestion[];
}) {
  const [mode, setMode] = useState(templates.length ? "template" : "new");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [points, setPoints] = useState("0");
  const [anonymity, setAnonymity] = useState(templates[0]?.anonymous ? "always" : "choose");
  const [auto, setAuto] = useState(true);

  function pickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setAnonymity(t.anonymous ? "always" : "choose");
  }

  const autoNote = eventCompleted
    ? auto
      ? "This event is already completed, so the survey is sent as soon as you attach it."
      : "This event is already completed. The survey stays a draft until you press Launch now."
    : auto
      ? "Everyone with an RSVP (or who attended) is notified when you mark the event completed, with two reminders."
      : "Nothing is sent until you turn this on or press Launch now after the event.";

  return (
    <ActionForm action={action} submitLabel="Attach survey" pendingLabel="Attaching…" buttonsClassName="mt-4 justify-end">
      <div className="flex flex-col gap-4">
        <div>
          <span className="crm-label">Survey</span>
          <ChipGroup
            name="mode"
            label="Where the questions come from"
            options={[
              ...(templates.length ? [{ value: "template", label: "Use a saved survey" }] : []),
              { value: "new", label: "Write a new survey" },
            ]}
            value={mode}
            onChange={setMode}
          />
          {templates.length === 0 ? (
            <p className="crm-hint">
              There is no saved survey yet. Write one here; it starts from the standard feedback questions. You can save a reusable one under Event feedback.
            </p>
          ) : null}
        </div>
        {mode === "template" ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor="sv-template" className="crm-label">
                Saved survey
              </label>
              <select id="sv-template" name="template_id" value={templateId} onChange={(e) => pickTemplate(e.target.value)} className="crm-input">
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} · {t.questionCount} {t.questionCount === 1 ? "question" : "questions"}
                  </option>
                ))}
              </select>
              <p className="crm-hint">The questions are copied to this event. Changing them here never changes the saved survey.</p>
            </div>
            <div>
              <label htmlFor="sv-title" className="crm-label">
                Title (optional)
              </label>
              <input id="sv-title" name="title" placeholder={defaultSurveyTitle(eventName)} className="crm-input" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="md:max-w-md">
              <label htmlFor="sv-title" className="crm-label">
                Title (optional)
              </label>
              <input id="sv-title" name="title" placeholder={defaultSurveyTitle(eventName)} className="crm-input" />
            </div>
            <QuestionsBuilder initial={starterQuestions} />
          </div>
        )}
        <SurveySettings points={points} onPoints={setPoints} anonymity={anonymity} onAnonymity={setAnonymity} auto={auto} onAuto={setAuto} autoNote={autoNote} />
        <InfoBox>
          An event has one survey. Members see it in the app once it opens and answer there; you read the results on this tab and under Event feedback.
        </InfoBox>
      </div>
    </ActionForm>
  );
}

/** Change a draft survey: title, questions, points, anonymity, automatic sending. */
export function EditSurveyForm({
  action,
  eventCompleted,
  initial,
}: {
  action: FormAction;
  eventCompleted: boolean;
  initial: { title: string; questions: SurveyQuestion[]; points: number; anonymous: boolean; auto: boolean };
}) {
  const [points, setPoints] = useState(String(initial.points));
  const [anonymity, setAnonymity] = useState(initial.anonymous ? "always" : "choose");
  const [auto, setAuto] = useState(initial.auto);
  const autoNote = eventCompleted
    ? "This event is already completed. Use Launch now to send the survey."
    : auto
      ? "Everyone with an RSVP (or who attended) is notified when you mark the event completed, with two reminders."
      : "Nothing is sent until you turn this on or press Launch now after the event.";
  return (
    <ActionForm action={action} submitLabel="Save survey" pendingLabel="Saving…" buttonsClassName="mt-4 justify-end">
      <div className="flex flex-col gap-4">
        <div className="md:max-w-md">
          <label htmlFor="sv-edit-title" className="crm-label">
            Title
          </label>
          <input id="sv-edit-title" name="title" defaultValue={initial.title} className="crm-input" />
        </div>
        <QuestionsBuilder initial={initial.questions} />
        <SurveySettings points={points} onPoints={setPoints} anonymity={anonymity} onAnonymity={setAnonymity} auto={auto} onAuto={setAuto} autoNote={autoNote} />
      </div>
    </ActionForm>
  );
}

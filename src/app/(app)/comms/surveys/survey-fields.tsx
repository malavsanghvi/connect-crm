import { QuestionsBuilder, type SurveyQuestion } from "@/components/survey/questions-builder";
import { Toggle } from "@/components/controls";

import { AudienceChips } from "../audience-chips";

type Opt = { id: string; name: string };

export function SurveyFields({
  options,
  survey,
}: {
  options: { zones: Opt[]; classes: Opt[]; events: Opt[] };
  survey?: { id: string; title: string; description: string | null; questions: SurveyQuestion[]; anonymous: boolean; audience: unknown; opens_local: string; closes_local: string };
}) {
  const p = survey ? `sv-${survey.id.slice(0, 6)}` : "sv-new";
  return (
    <>
      {survey ? <input type="hidden" name="id" value={survey.id} /> : null}
      <div>
        <label htmlFor={`${p}-title`} className="crm-label">
          Title
        </label>
        <input id={`${p}-title`} name="title" required defaultValue={survey?.title ?? ""} className="crm-input" />
      </div>
      <div>
        <label htmlFor={`${p}-desc`} className="crm-label">
          Intro
        </label>
        <textarea id={`${p}-desc`} name="description" rows={2} defaultValue={survey?.description ?? ""} className="crm-input" />
      </div>
      <QuestionsBuilder initial={survey?.questions ?? []} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${p}-open`} className="crm-label">
            Opens
          </label>
          <input id={`${p}-open`} type="datetime-local" name="opens_at" defaultValue={survey?.opens_local ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-close`} className="crm-label">
            Closes
          </label>
          <input id={`${p}-close`} type="datetime-local" name="closes_at" defaultValue={survey?.closes_local ?? ""} className="crm-input" />
        </div>
      </div>
      <Toggle name="anonymous" label="Anonymous answers" defaultChecked={survey?.anonymous ?? false} onNote="Anonymous — no names stored" offNote="Answers show who sent them" />
      <AudienceChips zones={options.zones} classes={options.classes} events={options.events} initial={survey?.audience} />
    </>
  );
}

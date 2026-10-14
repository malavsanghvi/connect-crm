import { ActionForm, type FormAction } from "@/components/action-form";
import { Field } from "@/components/ui";
import type { ProgramFieldsInitial } from "@/components/matching/program-fields";
import { ProgramFields } from "@/components/matching/program-fields";

export type DuplicateChoice = { value: string; label: string };

/**
 * The three decisions on a submission, each its own form so nothing is sent by mistake: approve (the facts as sent, editable
 * first), reject (with a reason the community sees) and duplicate (of a directory entry or another submission). Used by Gift
 * matching (a community's CatchTheMatch manager) and Platform › Gift matching directory (Weaver's team): the database
 * decides who may and what an approval does (a community's approval of a change to an entry Weaver's team checked goes to
 * them).
 */
export function DecisionForms({
  action,
  submissionId,
  facts,
  source,
  approveHint,
  duplicates,
}: {
  action: FormAction;
  submissionId: string;
  facts: ProgramFieldsInitial;
  source: string | null;
  approveHint: string;
  duplicates: DuplicateChoice[];
}) {
  const p = `decide-${submissionId}`;
  return (
    <div className="mt-3 flex flex-col gap-2" data-testid="decision-forms">
      <details>
        <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Check the facts and approve</summary>
        <ActionForm action={action} submitLabel="Approve" pendingLabel="Approving" size="sm" variant="success" className="mt-2 flex flex-col gap-3">
          <input type="hidden" name="submission_id" value={submissionId} />
          <input type="hidden" name="decision" value="approve" />
          {source ? <input type="hidden" name="source" value={source} /> : null}
          <p className="crm-hint m-0">{approveHint}</p>
          <ProgramFields idPrefix={`${p}-a`} initial={facts} context="community" />
          <Field label="What you checked (optional)" htmlFor={`${p}-a-reason`} hint="For example: the employer's benefits page. It goes in the history.">
            <input id={`${p}-a-reason`} name="reason" className="crm-input w-full" maxLength={500} />
          </Field>
        </ActionForm>
      </details>
      <details>
        <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">Reject it</summary>
        <ActionForm action={action} submitLabel="Reject" pendingLabel="Rejecting" size="sm" variant="danger" className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="submission_id" value={submissionId} />
          <input type="hidden" name="decision" value="reject" />
          <Field label="Why" htmlFor={`${p}-r-reason`} hint="The community that sent it sees this.">
            <input id={`${p}-r-reason`} name="reason" className="crm-input w-full" maxLength={500} required />
          </Field>
        </ActionForm>
      </details>
      <details>
        <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">It is a duplicate</summary>
        {duplicates.length === 0 ? (
          <p className="crm-hint mt-2">Nothing in the directory or among the waiting submissions has a similar name.</p>
        ) : (
          <ActionForm action={action} submitLabel="Mark as a duplicate" pendingLabel="Marking" size="sm" variant="ghost" className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="submission_id" value={submissionId} />
            <input type="hidden" name="decision" value="duplicate" />
            <Field label="It repeats" htmlFor={`${p}-d-of`}>
              <select id={`${p}-d-of`} name="duplicate_of" className="crm-input w-full" required defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {duplicates.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note (optional)" htmlFor={`${p}-d-reason`}>
              <input id={`${p}-d-reason`} name="reason" className="crm-input w-full" maxLength={500} />
            </Field>
          </ActionForm>
        )}
      </details>
    </div>
  );
}

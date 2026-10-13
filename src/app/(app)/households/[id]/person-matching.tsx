import { recordMatchEmployerAction } from "@/app/(app)/people/matching-actions";
import { ActionForm } from "@/components/action-form";
import { PartNote } from "@/components/people-v2/slideover/section";
import { Field } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { loadMatchEmployer, matchEmployerSourceLine } from "@/lib/people-v2/match-employer";
import type { CrmSession } from "@/lib/session";

/**
 * The Gift matching section of the person slide-over (CatchTheMatch, migration 0759; drawn only with CatchTheMatch on and never for a
 * child): the employer the person put on file for gift matching, where it came from and when. CatchTheMatch's own roles read it; anyone
 * else is told they have no access. A CatchTheMatch manager can record one from a signed paper form, prefilled from the profile's
 * employer to check against the form. The person adds, changes and removes their own in the member app.
 */
export async function PersonMatchingServer({ session, person }: { session: CrmSession; person: { id: string; firstName: string; profileEmployer: string | null } }) {
  const facts = await loadMatchEmployer(session, person);
  if (facts.state !== "ok") return <PartNote part={facts} what="gift matching" />;
  const f = facts.data;
  const when = f.recordedAt ? formatDate(f.recordedAt, session.center.time_zone) : null;
  const inputId = `match-employer-${person.id}`;
  return (
    <div data-testid="person-matching">
      {f.employer ? (
        <>
          <p className="m-0 text-[14.5px] text-ink">
            <span className="text-muted">Employer for gift matching: </span>
            <span dir="auto" className="font-semibold">
              {f.employer}
            </span>
          </p>
          <p className="m-0 mt-0.5 text-[13px] text-muted">{matchEmployerSourceLine(f, person.firstName, when)}</p>
        </>
      ) : (
        <p className="m-0 py-1 text-[14px] text-muted">
          No employer on file for gift matching. {person.firstName} can add one in the member app.
        </p>
      )}
      {f.canRecord ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13.5px] font-bold text-[var(--v2-blue)]">
            {f.employer ? "Replace it from a signed paper form" : "Record one from a signed paper form"}
          </summary>
          <ActionForm action={recordMatchEmployerAction} submitLabel="Record employer" pendingLabel="Recording" size="sm" className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="person_id" value={person.id} />
            <input type="hidden" name="first_name" value={person.firstName} />
            <Field
              label="Employer"
              htmlFor={inputId}
              hint={f.suggestion ? `From ${person.firstName}'s profile: ${f.suggestion}. Check it against the form.` : "As written on the form."}
            >
              <input id={inputId} name="employer" className="crm-input w-full" maxLength={120} required defaultValue={f.employer ?? f.suggestion ?? ""} />
            </Field>
            <label className="flex items-start gap-2 text-[13.5px] text-ink">
              <input type="checkbox" name="signed" className="mt-0.5 size-4" required />
              <span>{person.firstName} signed a paper form agreeing to gift matching. It is recorded as their consent, with your name and today&apos;s date.</span>
            </label>
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}

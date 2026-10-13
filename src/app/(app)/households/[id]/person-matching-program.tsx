import Link from "next/link";

import { linkProgramAction, unlinkProgramAction } from "@/app/(app)/giving/matching/actions";
import { ActionForm } from "@/components/action-form";
import { formatDate } from "@/lib/dates";
import { loadCandidates } from "@/lib/matching/data";
import { howText } from "@/lib/matching/directory";
import { matchingCan } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/**
 * Under the employer on file in the person's Gift matching section: the shared directory's entry it is (CatchTheMatch slice 2,
 * 0767), or the entry it may be, found by name. A CatchTheMatch manager confirms the link; nothing is linked without them.
 * The read is logged in the organization's own audit.
 */
export async function PersonMatchingProgram({ session, person }: { session: CrmSession; person: { id: string; firstName: string } }) {
  const res = await loadCandidates(session.db, session.center.id, person.id);
  if (!res.ok) {
    return (
      <p role="alert" className="m-0 mt-2 text-[13px] text-danger">
        {res.error} Reload to try again.
      </p>
    );
  }
  const { link, candidates } = res.data;
  const canLink = matchingCan(session, "manage");
  const choose = (
    <Link href={`/giving/matching?person=${person.id}`} className="crm-link text-[13px]">
      {link ? "Choose another entry" : candidates.length > 0 ? "Choose another entry" : "Search the directory"}
    </Link>
  );
  if (link?.program) {
    const p = link.program;
    return (
      <div className="mt-2" data-testid="person-matching-program">
        <p className="m-0 text-[14px] text-ink">
          <span className="text-muted">In the gift matching directory: </span>
          <Link href={`/giving/matching/${p.id}`} className="crm-link font-semibold" dir="auto">
            {p.company_name}
          </Link>
          {p.status === "retired" ? <span className="text-muted"> (the program has ended)</span> : null}
        </p>
        <p className="m-0 mt-0.5 text-[13px] text-muted">
          {howText(link.how)} · confirmed by {link.confirmed_by} on {formatDate(link.confirmed_at, session.center.time_zone)}
        </p>
        {link.changed_since_confirmed ? (
          <p className="m-0 mt-0.5 text-[13px] font-semibold text-brown" data-testid="changed-since-confirmed">
            Changed since you confirmed it. Check the entry, then confirm it again.
          </p>
        ) : null}
        {canLink ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {link.changed_since_confirmed && p.status === "active" ? (
              <ActionForm action={linkProgramAction} submitLabel="Confirm again" pendingLabel="Confirming" size="xs">
                <input type="hidden" name="person_id" value={person.id} />
                <input type="hidden" name="program_id" value={p.id} />
                <input type="hidden" name="first_name" value={person.firstName} />
              </ActionForm>
            ) : null}
            {choose}
            <ActionForm
              action={unlinkProgramAction}
              submitLabel="Remove link"
              pendingLabel="Removing"
              size="xs"
              variant="ghost"
              confirmMessage={`Remove the link to ${p.company_name}? ${person.firstName}'s employer on file stays.`}
            >
              <input type="hidden" name="person_id" value={person.id} />
            </ActionForm>
          </div>
        ) : null}
      </div>
    );
  }
  const best = candidates[0] ?? null;
  return (
    <div className="mt-2" data-testid="person-matching-program">
      <p className="m-0 text-[13.5px] text-muted">
        Not linked to the gift matching directory yet.
        {best ? (
          <>
            {" "}
            Maybe{" "}
            <Link href={`/giving/matching/${best.id}`} className="crm-link" dir="auto">
              {best.company_name}
            </Link>{" "}
            ({howText(best.how).toLowerCase()}).
          </>
        ) : (
          " Nothing in the directory has this name yet."
        )}
      </p>
      {canLink ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {best ? (
            <ActionForm action={linkProgramAction} submitLabel={`Link to ${best.company_name}`} pendingLabel="Linking" size="xs">
              <input type="hidden" name="person_id" value={person.id} />
              <input type="hidden" name="program_id" value={best.id} />
              <input type="hidden" name="first_name" value={person.firstName} />
            </ActionForm>
          ) : null}
          {choose}
        </div>
      ) : null}
    </div>
  );
}

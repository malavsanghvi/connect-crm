import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, EmptyState, Field, NoAccess, PageHeader } from "@/components/ui";
import { formatDay } from "@/lib/care/model";
import { formatCents } from "@/lib/money";
import { CLAIM_STATE_LABEL, householdLine } from "@/lib/matching/catch";
import { loadPersonGifts } from "@/lib/matching/data";
import { matchingCan } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { recordClaimAction } from "../../actions";

export const metadata: Metadata = { title: "Gift matching: record a match" };

// Gift matching › Claims › Record a match (CatchTheMatch Phase 1, 0886): for a claim the office already knows about, such as the first match an
// employer paid this community. Nothing is proven until one claim is received; then the program's other members show under To catch. For a
// person whose employer on file is linked to a program (Employers on file), on one of their own gifts. No match amount is recorded.

export default async function RecordMatchPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title={MATCHING_TITLE} description={MATCHING_DESCRIPTION} />;
  if (!matchingCan(session, "manage")) {
    return (
      <>
        {header}
        <NoAccess area="Recording a gift match" access="matchingManage" />
      </>
    );
  }
  const sp = await searchParams;
  const personId = param(sp, "person") ?? "";
  const back = (
    <Link href="/giving/matching/employers" className="crm-link">
      Choose a person on Employers on file
    </Link>
  );
  if (!isUuid(personId)) {
    return (
      <>
        {header}
        <MatchingNav active="claims" />
        <Card>
          <EmptyState title="Choose a person first">{back}</EmptyState>
        </Card>
      </>
    );
  }
  const res = await loadPersonGifts(session.db, session.center.id, personId);
  if (!res.ok) {
    return (
      <>
        {header}
        <MatchingNav active="claims" />
        <Alert tone="danger" title="This person's gifts could not be loaded">
          {res.error}{" "}
          <Link href={`/giving/matching/claims/record?person=${personId}`} className="crm-link">
            Try again
          </Link>
        </Alert>
      </>
    );
  }
  const d = res.data;
  const money = d.amounts ? (c: number) => formatCents(c, session.center.currency) : null;
  const open = d.gifts.filter((g) => g.claim === null);

  return (
    <>
      {header}
      <MatchingNav active="claims" />
      <Card title={`Record a match for ${d.person.name}`} description={d.household ? `${d.household.name} · ${householdLine(d.household)}` : undefined}>
        {d.program === null ? (
          <Alert tone="warning" title="Their employer is not linked to a program yet">
            A claim is for the employer program a member of staff confirmed.{" "}
            <Link href="/giving/matching/employers" className="crm-link">
              Link it on Employers on file
            </Link>
            , then come back.
          </Alert>
        ) : open.length === 0 ? (
          <EmptyState title="Every gift of the last two years already has a claim">
            <Link href="/giving/matching/claims" className="crm-link">
              See the claims
            </Link>
          </EmptyState>
        ) : (
          <ActionForm action={recordClaimAction} submitLabel="Record" pendingLabel="Saving" size="sm" className="flex flex-col gap-3">
            <input type="hidden" name="person_id" value={d.person.id} />
            <p className="m-0 text-[13.5px] text-ink">
              Employer program: <span className="font-semibold">{d.program.companyName}</span>
            </p>
            <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
              <legend className="crm-label">Which gift was matched</legend>
              {open.map((g, i) => (
                <label key={g.paymentId} className="flex items-center gap-2 text-[14px] text-ink">
                  <input type="radio" name="payment_id" value={g.paymentId} required defaultChecked={i === 0} />
                  Gift of {formatDay(g.receivedOn)}
                  {money && g.amountCents !== null ? ` · ${money(g.amountCents)}` : ""}
                </label>
              ))}
            </fieldset>
            <Field label="Where it stands" htmlFor="record-state">
              <select id="record-state" name="state" className="crm-input w-full" defaultValue="received">
                {(["received", "verified", "requested", "asked"] as const).map((s) => (
                  <option key={s} value={s}>
                    {CLAIM_STATE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="The day the match was received (only for a match received; leave empty for today)" htmlFor="record-day">
              <input id="record-day" name="received_on" type="date" className="crm-input w-full" />
            </Field>
            <Field label="Note (optional)" htmlFor="record-note">
              <input id="record-note" name="note" className="crm-input w-full" maxLength={500} />
            </Field>
          </ActionForm>
        )}
        {d.gifts.some((g) => g.claim) ? (
          <ul className="m-0 mt-3 list-none p-0 text-[13px] text-muted">
            {d.gifts
              .filter((g) => g.claim)
              .map((g) => (
                <li key={g.paymentId}>
                  Gift of {formatDay(g.receivedOn)}: {g.claim ? CLAIM_STATE_LABEL[g.claim.state].toLowerCase() : ""}
                </li>
              ))}
          </ul>
        ) : null}
      </Card>
    </>
  );
}

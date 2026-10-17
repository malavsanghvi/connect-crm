import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { MATCHING_DESCRIPTION, MATCHING_TITLE, MatchingNav } from "@/components/matching/matching-nav";
import { Alert, Card, NoAccess, PageHeader } from "@/components/ui";
import { formatDay } from "@/lib/care/model";
import { CLAIM_STATE_LABEL, householdLine } from "@/lib/matching/catch";
import { loadMatchClaim } from "@/lib/matching/data";
import { MATCH_PAYMENT_EFFECTS } from "@/lib/matching/pay";
import { formatCents } from "@/lib/money";
import { matchingCan } from "@/lib/permissions";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { recordMatchPaymentAction } from "../../actions";

export const metadata: Metadata = { title: "Gift matching: record the match" };

// Gift matching › Claims › Record the match (CatchTheMatch Phase 1, migration 0925): the employer's match reached the organization. One payment is
// recorded in Giving as a matching gift for the donor's household (the donor's soft credit), exactly once, in whole cents; the claim becomes
// Match received. It is not applied to a pledge, no receipt goes to the donor, and it is not part of the donor's tax-deductible total.
// Needs matching.manage and a giving permission; the amount shows only to a role that also sees giving.

export default async function RecordMatchPaymentPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title={MATCHING_TITLE} description={MATCHING_DESCRIPTION} />;
  if (!matchingCan(session, "manage")) {
    return (
      <>
        {header}
        <NoAccess area="Recording a match" access="matching" />
      </>
    );
  }
  const sp = await searchParams;
  const claimId = param(sp, "claim") ?? "";
  if (!isUuid(claimId)) {
    return (
      <>
        {header}
        <MatchingNav active="claims" />
        <Alert tone="danger" title="That claim was not found">
          Open it from <Link href="/giving/matching/claims" className="crm-link">Claims</Link> and choose Record the match.
        </Alert>
      </>
    );
  }
  const res = await loadMatchClaim(session.db, session.center.id, claimId);
  if (!res.ok) {
    return (
      <>
        {header}
        <MatchingNav active="claims" />
        <Alert tone="danger" title="The claim could not be loaded">
          {res.error}{" "}
          <Link href={`/giving/matching/claims/pay?claim=${claimId}`} className="crm-link">
            Try again
          </Link>
        </Alert>
      </>
    );
  }
  const { claim, amounts, today, canRecord } = res.data;
  const money = (c: number) => formatCents(c, session.center.currency);
  const first = claim.person.name.split(" ")[0] ?? claim.person.name;
  const ended = claim.state === "declined" || claim.state === "expired" || claim.state === "withdrawn";

  return (
    <>
      {header}
      <MatchingNav active="claims" />
      <p className="crm-hint m-0 mb-3 max-w-3xl">
        <Link href="/giving/matching/claims" className="crm-link">
          ← Claims
        </Link>
      </p>
      <Card>
        <h2 className="m-0 font-display text-[20px] font-semibold text-ink">Record the match for {claim.person.name}</h2>
        <p className="m-0 mt-1 text-[13.5px] text-muted" dir="auto">
          <Link href={`/giving/matching/${claim.program.id}`} className="crm-link">
            {claim.program.companyName}
          </Link>{" "}
          · gift of {formatDay(claim.gift.receivedOn)}
          {amounts && claim.gift.amountCents !== null ? ` (${money(claim.gift.amountCents)})` : ""} · {CLAIM_STATE_LABEL[claim.state]}
        </p>
        {claim.household ? (
          <p className="m-0 mt-1 text-[12.5px] text-muted">
            <Link href={`/households/${claim.household.id}`} className="crm-link">
              {claim.household.name}
            </Link>{" "}
            · {householdLine(claim.household)}
          </p>
        ) : null}
      </Card>
      {claim.match.recorded ? (
        <div className="mt-3">
          <Alert tone="success" title="The match is already recorded in Giving">
            {amounts && claim.match.amountCents !== null ? `${money(claim.match.amountCents)} was recorded. ` : ""}A match is recorded once. To change it, correct the payment in Giving.
          </Alert>
        </div>
      ) : ended ? (
        <div className="mt-3">
          <Alert tone="warning" title="This claim ended without a match">
            Open it again under Claims first if the employer did pay.
          </Alert>
        </div>
      ) : !canRecord ? (
        <div className="mt-3">
          <Alert tone="warning" title="You can not record this here">
            Recording a match in Giving needs matching.manage and giving.record_offline (or giving.manage). Ask someone who has both.
          </Alert>
        </div>
      ) : (
        <Card className="mt-3">
          <p className="m-0 text-[13.5px] font-semibold text-ink">What recording does</p>
          <ul className="m-0 mt-1 list-disc pl-5 text-[13px] text-ink">
            {MATCH_PAYMENT_EFFECTS.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <ActionForm action={recordMatchPaymentAction} submitLabel="Record the match" pendingLabel="Recording" className="mt-3 flex max-w-md flex-col gap-3"
            confirmMessage={`Record the employer's match for ${claim.person.name} in Giving? A match is recorded once.`}>
            <input type="hidden" name="claim_id" value={claim.id} />
            <input type="hidden" name="donor_first_name" value={first} />
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Amount the employer paid ({session.center.currency})
              <input name="amount" inputMode="decimal" required placeholder="120.00" className="crm-input" autoComplete="off" />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Day the money was received
              <input name="received_on" type="date" defaultValue={today} max={today} className="crm-input" />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Note (optional, at most 200 characters)
              <input name="note" maxLength={200} className="crm-input" placeholder="For example the platform&apos;s batch number" />
            </label>
          </ActionForm>
        </Card>
      )}
    </>
  );
}

import { ProofQueue } from "@/components/giving-proofs/proof-queue";
import { Alert, EmptyState, NoAccess, PageHeader } from "@/components/ui";
import type { ProofsPage } from "@/lib/data/payment-proofs";

// Giving > Payment proofs (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 4.3): what members sent when they paid another
// way, for the treasury team to verify. A refusal is said in words ("You don't have access to this area"), never shown as an
// empty queue; a failure to read is said with its reason and a way to try again.

export function ProofsScreen({ page }: { page: ProofsPage }) {
  const header = (
    <PageHeader
      title="Payment confirmations"
      description="Photos and files members sent when they paid another way. Their pledges show Soft credit until you approve the confirmation."
    />
  );
  if (page.state === "no_access") {
    return (
      <>
        {header}
        <NoAccess area="Payment confirmations" access="payments" />
      </>
    );
  }
  if (page.state === "off") {
    return (
      <>
        {header}
        <Alert tone="info" title="Payment confirmations are switched off for this community.">
          A community administrator can switch them on in Settings › Modules.
        </Alert>
      </>
    );
  }
  if (page.state === "error") {
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load the payment confirmations"
          action={
            <a href="/giving/proofs" className="cc-btn cc-btn-bad cc-btn-xs">
              Try again
            </a>
          }
        >
          {page.error}
        </Alert>
      </>
    );
  }
  return (
    <>
      {header}
      {page.notices.map((n) => (
        <div key={n} className="mb-3">
          <Alert tone="warning" title="Some previews are not ready">
            {n}
          </Alert>
        </div>
      ))}
      {!page.can.decide ? (
        <div className="mb-3">
          <Alert tone="info" title="You can look at these confirmations, but not decide them.">
            Reviewing a payment confirmation needs the permission to record payments.
          </Alert>
        </div>
      ) : null}
      {page.cards.length === 0 ? (
        <EmptyState title="No payment confirmations are waiting.">
          When a member sends a photo or file for a payment made another way, it appears here and its pledges show Soft credit until you decide.
        </EmptyState>
      ) : (
        <ProofQueue cards={page.cards} can={page.can} fmt={page.fmt} timeZone={page.timeZone} labels={page.labels} />
      )}
    </>
  );
}

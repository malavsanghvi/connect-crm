import type { Metadata } from "next";
import Link from "next/link";

import { FamilyCard } from "@/components/giving-actions/sheet";
import { PrintButton } from "@/components/giving-statements/print-button";
import { ReceiptPreview } from "@/components/giving-statements/receipt-preview";
import { NoAccess, buttonClass } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { loadReceiptCopy } from "@/lib/data/giving-statements";
import { todayInTz } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Receipt copy" };

// When printed, only the receipt shows: the shell, the tab row and the buttons are hidden.
const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  [data-print-area], [data-print-area] * { visibility: visible !important; }
  [data-print-area] { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
}`;

/**
 * A printable copy of one receipt (docs/GIVING_REDESIGN.md slice 8). There is no receipt generator in the portal, so the browser
 * prints the copy or saves it as a PDF. Printing is off until the treasurer's approval of the receipt templates is current. The
 * copy is addressed to the household's adults when the name on the receipt is a child's (app.receipt_copy, 0746). Nothing is sent
 * and nothing is recorded.
 */
export default async function ReceiptCopyPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const session = await getSession();
  if (!canAccess(session, "statements")) return <NoAccess area="Receipts" access="statements" />;
  const { paymentId } = await params;
  const back = (
    <Link href="/giving/statements" className={`${buttonClass("ghost", "sm")} min-h-[44px] print:hidden`}>
      Back to Statements
    </Link>
  );
  if (!isUuid(paymentId)) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="m-0 text-[14px] text-ink">That address does not name a payment. Find the receipt by its number on the Statements tab.</p>
        <div>{back}</div>
      </div>
    );
  }
  const part = await loadReceiptCopy(session, paymentId, todayInTz(session.center.time_zone));
  if (part.state === "no_access") return <NoAccess area="Receipts" access="statements" />;
  if (part.state !== "ok") {
    const message = part.state === "none" ? "There is no receipt to show." : part.message;
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="m-0 rounded-[14px] border border-danger/30 bg-danger-50 px-4 py-3 text-[14px] text-danger">
          {message}
        </p>
        <div>{back}</div>
      </div>
    );
  }
  const v = part.view;
  const rules = identifierRules(session.center.rules);
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="m-0 font-display text-[26px] font-semibold text-ink">Copy of receipt {v.copy.receiptNumber}</h1>
        {back}
      </div>
      <div className="print:hidden">
        <FamilyCard family={v.family} labels={{ orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel }} />
      </div>
      {v.printBlocked ? (
        <p role="status" className="m-0 rounded-[12px] border border-line bg-canvas px-3 py-2 text-[14px] text-ink-2" data-testid="receipt-print-off">
          {v.printBlocked}
        </p>
      ) : (
        <>
          <div data-print-area>
            <ReceiptPreview lines={v.lines} />
          </div>
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <PrintButton />
            <p className="m-0 text-[13px] text-muted">Hand the copy over yourself: nothing is sent to the family from here.</p>
          </div>
        </>
      )}
    </div>
  );
}

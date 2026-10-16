import { Card, TableWrap } from "@/components/ui";
import type { PlatformFeeRatesData, Section } from "@/lib/data/chip-in-platform";
import { formatDate } from "@/lib/dates";
import { FEE_CLASSES, FEE_CLASS_SHORT, rateText } from "@/lib/payments/chip-in-platform";

import { FeeRateForm } from "../_components/fee-rate-form";
import { SectionProblem } from "../_components/section-problem";

/**
 * Platform › Payments › "Stripe fee estimate": the platform-wide rates that estimate the card fee a member may choose to cover
 * (docs/PAYMENT_ADDONS.md §5.3, §11.2). One row in force per way to pay (card, which includes Apple Pay and Google Pay, and bank debit);
 * an organization with its own rate (Platform › Centers › the organization) uses that instead. A change adds a row, earlier rows stay on
 * record, and every change needs a reason and is audited. It moves no money and reads no credential.
 */
export function FeeRatesCard({ data, tz }: { data: Section<PlatformFeeRatesData>; tz: string }) {
  return (
    <Card
      title="Stripe fee estimate"
      description="The rates that estimate the card fee a member may choose to cover · Weaver team only · every change needs a reason and is audited"
    >
      {data.ok ? <Body data={data.value} tz={tz} /> : <SectionProblem section={data} what="the Stripe fee rates" retryHref="/platform/payments" />}
    </Card>
  );
}

function Body({ data, tz }: { data: PlatformFeeRatesData; tz: string }) {
  const earlier = data.earlier;
  return (
    <>
      <TableWrap>
        <table className="crm-table" aria-label="Stripe fee rates in force">
          <thead>
            <tr>
              <th>Way to pay</th>
              <th>Rate in force</th>
              <th>Where it comes from</th>
            </tr>
          </thead>
          <tbody>
            {FEE_CLASSES.map((cls) => {
              const r = data.effective[cls];
              return (
                <tr key={cls} data-rate={cls}>
                  <td className="font-bold">{FEE_CLASS_SHORT[cls]}</td>
                  {r ? (
                    <>
                      <td>
                        {rateText(r)}
                        {r.effectiveFrom ? <span className="block text-[12px] text-muted">From {formatDate(r.effectiveFrom, tz)}</span> : null}
                      </td>
                      <td className="text-[13px]">{r.sourceNote}</td>
                    </>
                  ) : (
                    <td colSpan={2} className="text-[13px] text-muted">
                      No rate is set, so a member cannot be offered to cover this fee.
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <p className="crm-hint mt-2">
        Only an estimate of what Stripe charges: card is 2.9% plus 30 cents and bank debit 0.8% up to $5 at Stripe&apos;s standard US pricing. The fee recorded on every payment is
        Stripe&apos;s own. An organization with its own rate uses that one instead.
      </p>
      {earlier.length > 0 ? (
        <details className="mt-3 text-[13px]" data-testid="fee-rate-history">
          <summary className="cursor-pointer font-semibold">Earlier rates ({earlier.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {earlier.map((row) => (
              <li key={row.id}>
                <span className="font-semibold">{FEE_CLASS_SHORT[row.methodClass]}</span> · {rateText(row)} · {row.setBy ? `from ${formatDate(row.effectiveFrom, tz)} · ` : ""}
                {row.by} · {row.sourceNote}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <h3 className="crm-label mt-4">Add a new platform rate</h3>
      <p className="crm-hint mb-2">It takes effect at once for every organization that has no rate of its own. The one in force today stays on record.</p>
      <FeeRateForm centerId={null} submitLabel="Add platform rate" />
    </>
  );
}

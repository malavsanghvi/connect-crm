import { redirect } from "next/navigation";

import { PaymentsView } from "@/components/giving-lists/payments-view";
import { loadPaymentsList } from "@/lib/data/giving-lists";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { RecordPaymentForm } from "./record-payment-form";

/**
 * Giving › Payments in the New look (docs/GIVING_REDESIGN.md section 4, slice 3). Until slice 2's Record payment sheet is wired in,
 * ?record=1 (or a household in the address, as every "Record payment" button on a family sends) shows today's Record payment form
 * on top, exactly as the classic page draws it. The counts have their own tab since slice 5: ?view=counts sends there.
 */
export async function PaymentsV2({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  if (param(sp, "view") === "counts") redirect("/giving/counts");
  const session = await getSession();
  const model = await loadPaymentsList(session, sp);
  const record = model.record;
  return (
    <PaymentsView
      model={model}
      recordSlot={
        record ? (
          <RecordPaymentForm
            labels={model.labels}
            timeZone={model.timeZone}
            currency={model.currency}
            today={model.today}
            canAllocate={record.canAllocate}
            bankOn={record.bankOn}
            initialHousehold={record.household}
            {...(record.values ? { initialValues: record.values } : {})}
          />
        ) : null
      }
    />
  );
}

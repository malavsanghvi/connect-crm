import { PaymentsView } from "@/components/giving-lists/payments-view";
import { Alert } from "@/components/ui";
import { loadPaymentsList } from "@/lib/data/giving-lists";
import type { RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { CountingForm } from "./counting-form";
import { RecordPaymentForm } from "./record-payment-form";

/**
 * Giving › Payments in the New look (docs/GIVING_REDESIGN.md section 4, slice 3). Until slice 2's Record payment sheet is wired in,
 * ?record=1 (or a household in the address, as every "Record payment" button on a family sends) shows today's Record payment form
 * on top, exactly as the classic page draws it. Until slice 5, the counts view keeps today's New count form.
 */
export async function PaymentsV2({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const model = await loadPaymentsList(session, await searchParams);
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
      countSlot={
        model.canCount && model.counters ? (
          <details>
            <summary className="cursor-pointer text-[14px] font-bold text-navy">New count</summary>
            <div className="mt-3">
              {model.counters.error ? (
                <Alert tone="warning">{model.counters.error} Choosing counters needs people.view (a treasurer can do it).</Alert>
              ) : (
                <CountingForm counters={model.counters.options} today={model.today} />
              )}
            </div>
          </details>
        ) : null
      }
    />
  );
}

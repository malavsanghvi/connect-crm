import type { Metadata } from "next";

import { Alert, PageHeader, buttonClass } from "@/components/ui";
import { loadPlatformFeeRates } from "@/lib/data/chip-in-platform";
import { parsePauses } from "@/lib/payments/change-control";
import { untypedRpc } from "@/lib/payments/rpc";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";
import { FeeRatesCard } from "./fee-rates-card";
import { PausesPanel } from "./pauses-panel";

export const metadata: Metadata = { title: "Payments · Platform" };
export const dynamic = "force-dynamic";

// Platform › Payments (docs/PAYMENTS_PLAN.md §2.5, docs/PAYMENT_ADDONS.md §11.2): Weaver can pause a way to pay for every community or for
// one, with a reason, and sets the Stripe fee rates that estimate the card fee a member may cover. Neither reads a credential or moves
// money. Each part is read on its own: one that fails says so in its own place and the other still shows.
export default async function PlatformPaymentsPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Platform"
      description="Payments · pause a way to pay for every community or one, and set the Stripe fee rates · the platform team never reads a credential or moves money"
    />
  );
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const [res, feeRates] = await Promise.all([untypedRpc(session.db)("payment_plugin_pauses", {}), loadPlatformFeeRates(session)]);
  const rates = <FeeRatesCard data={feeRates} tz={session.center.time_zone} />;
  if (res.error) {
    console.error("[platform/payments] payment_plugin_pauses failed:", res.error);
    return (
      <>
        {header}
        <div className="flex flex-col gap-4">
          <Alert tone="danger" title="Could not load the paused ways to pay" action={<a href="/platform/payments" className={buttonClass("bad", "xs")}>Try again</a>}>
            {res.error.message || "The database did not answer."} Nothing was changed.
          </Alert>
          {rates}
        </div>
      </>
    );
  }
  const parsed = parsePauses(res.data);
  if (!parsed.ok) {
    console.error("[platform/payments] unexpected answer from payment_plugin_pauses:", res.data);
    return (
      <>
        {header}
        <div className="flex flex-col gap-4">
          <Alert tone="danger" title="Could not load the paused ways to pay" action={<a href="/platform/payments" className={buttonClass("bad", "xs")}>Try again</a>}>
            {parsed.error[0].toUpperCase() + parsed.error.slice(1)}.
          </Alert>
          {rates}
        </div>
      </>
    );
  }
  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <PausesPanel view={parsed.value} tz={session.center.time_zone} />
        {rates}
      </div>
    </>
  );
}

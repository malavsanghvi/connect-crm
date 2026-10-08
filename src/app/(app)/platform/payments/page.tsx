import type { Metadata } from "next";

import { Alert, PageHeader, buttonClass } from "@/components/ui";
import { parsePauses } from "@/lib/payments/change-control";
import { untypedRpc } from "@/lib/payments/rpc";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";
import { PausesPanel } from "./pauses-panel";

export const metadata: Metadata = { title: "Payments · Platform" };
export const dynamic = "force-dynamic";

// Platform › Payments (docs/PAYMENTS_PLAN.md §2.5): Community Connect can pause a way to pay for every community or for one,
// with a reason. The only power a platform admin has over payments; nothing here reads a credential.
export default async function PlatformPaymentsPage() {
  const session = await getSession();
  const header = <PageHeader title="Platform" description="Payments · pause a way to pay for every community or one; the only power over payments the platform team has" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const res = await untypedRpc(session.db)("payment_plugin_pauses", {});
  if (res.error) {
    console.error("[platform/payments] payment_plugin_pauses failed:", res.error);
    return (
      <>
        {header}
        <Alert tone="danger" title="Could not load the paused ways to pay" action={<a href="/platform/payments" className={buttonClass("bad", "xs")}>Try again</a>}>
          {res.error.message || "The database did not answer."} Nothing was changed.
        </Alert>
      </>
    );
  }
  const parsed = parsePauses(res.data);
  if (!parsed.ok) {
    console.error("[platform/payments] unexpected answer from payment_plugin_pauses:", res.data);
    return (
      <>
        {header}
        <Alert tone="danger" title="Could not load the paused ways to pay" action={<a href="/platform/payments" className={buttonClass("bad", "xs")}>Try again</a>}>
          {parsed.error[0].toUpperCase() + parsed.error.slice(1)}.
        </Alert>
      </>
    );
  }
  return (
    <>
      {header}
      <PausesPanel view={parsed.value} tz={session.center.time_zone} />
    </>
  );
}

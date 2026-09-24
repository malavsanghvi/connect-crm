import type { Metadata } from "next";

import { Alert, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { readPublicEnv } from "@/lib/env";
import type { PaymentSettings } from "@/lib/payments/view";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { PaymentsPanel } from "./payments-panel";

export const metadata: Metadata = { title: "Payments · Settings" };

// Settings › Payments (ONBOARDING_PLAN §4 Step 1.2): Stripe and/or PayPal with
// the organization's own account, one default at checkout, test or live, the
// online methods, statement descriptor and donor-may-cover-fee; the offline
// methods with the instructions members see; "offline only"; payouts.
export default async function PaymentsSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Payments: online processors and the ways members can give" />;
  if (!canAccess(session, "paymentSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Payments" access="paymentSettings" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const { data, error } = await db.rpc("payment_settings", { p_center: center.id });
  if (error) {
    return (
      <>
        {header}
        <QueryError what="the payment settings" error={error} retryHref="/settings/payments" />
      </>
    );
  }
  const env = readPublicEnv();
  const connected = typeof sp.connected === "string" ? sp.connected : null;
  const connectError = typeof sp.connect_error === "string" ? sp.connect_error : null;
  return (
    <>
      {header}
      {connected ? (
        <Alert tone="success" title={`${connected === "paypal" ? "PayPal" : "Stripe"} sent you back`}>
          The authorization is in the vault. The background service is finishing the connection; this page shows it as soon as it is done.
        </Alert>
      ) : null}
      {connectError ? <Alert tone="danger" title="Not connected">{connectError}</Alert> : null}
      <PaymentsPanel
        settings={data as unknown as PaymentSettings}
        centerName={center.short_name ?? center.name}
        tz={center.time_zone}
        env={env.ok ? { supabaseUrl: env.env.supabaseUrl, supabaseAnonKey: env.env.supabaseAnonKey } : null}
      />
    </>
  );
}

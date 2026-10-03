import type { Metadata } from "next";

import { Alert, buttonClass, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { readPublicEnv } from "@/lib/env";
import { parsePluginSettings } from "@/lib/payments/plugins/view";
import type { PaymentSettings } from "@/lib/payments/view";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { PaymentsPanel } from "./payments-panel";
import { PluginCards } from "./plugin-cards";

export const metadata: Metadata = { title: "Payments · Settings" };

// Settings › Payments (ONBOARDING_PLAN §4 Step 1.2; docs/PAYMENTS_PLAN.md §2): every way to pay as a
// plugin card with its status and an on/off switch. The Card card holds the Stripe account (connect,
// test or live, default, statement descriptor, the $1 test), the PayPal card the PayPal account,
// Zelle and the offline methods the instructions members see; "offline only" and the payouts stay.
export default async function PaymentsSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Payments: the ways members can give, and the accounts behind them" />;
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
  const [settingsRes, pluginsRes] = await Promise.all([
    db.rpc("payment_settings", { p_center: center.id }),
    db.rpc("payment_plugin_settings", { p_center: center.id }),
  ]);
  if (settingsRes.error) {
    return (
      <>
        {header}
        <QueryError what="the payment settings" error={settingsRes.error} retryHref="/settings/payments" />
      </>
    );
  }
  if (pluginsRes.error) {
    return (
      <>
        {header}
        <QueryError what="the ways members can pay" error={pluginsRes.error} retryHref="/settings/payments" />
      </>
    );
  }
  // The answer is jsonb: every field is checked, a shape this screen does not understand is an error shown here.
  const plugins = parsePluginSettings(pluginsRes.data);
  if (!plugins.ok) {
    console.error("[settings/payments] unexpected answer from payment_plugin_settings:", pluginsRes.data);
    return (
      <>
        {header}
        <Alert
          tone="danger"
          title="Could not load the ways members can pay"
          action={<a href="/settings/payments" className={buttonClass("bad", "xs")}>Try again</a>}
        >
          {plugins.error[0].toUpperCase() + plugins.error.slice(1)}.
        </Alert>
      </>
    );
  }
  const settings = settingsRes.data as unknown as PaymentSettings;
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
        settings={settings}
        centerName={center.short_name ?? center.name}
        tz={center.time_zone}
        env={env.ok ? { supabaseUrl: env.env.supabaseUrl, supabaseAnonKey: env.env.supabaseAnonKey } : null}
      >
        <PluginCards s={settings} ps={plugins.value} tz={center.time_zone} />
      </PaymentsPanel>
    </>
  );
}

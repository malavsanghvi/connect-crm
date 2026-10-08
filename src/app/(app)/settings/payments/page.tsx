import type { Metadata } from "next";

import { Alert, buttonClass, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { readPublicEnv } from "@/lib/env";
import { explainError } from "@/lib/errors";
import { parsePayeeQueue, parsePaymentReadiness } from "@/lib/payments/change-control";
import { parsePluginSettings } from "@/lib/payments/plugins/view";
import { untypedRpc } from "@/lib/payments/rpc";
import type { PaymentSettings } from "@/lib/payments/view";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import type { ChangeControl } from "./change-control";
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
  const rpc = untypedRpc(db);
  const [settingsRes, pluginsRes, queueRes, readinessRes] = await Promise.all([
    db.rpc("payment_settings", { p_center: center.id }),
    db.rpc("payment_plugin_settings", { p_center: center.id }),
    rpc("payee_change_queue", { p_center: center.id }),
    rpc("payment_readiness", { p_center: center.id }),
  ]);
  // The database is the rule: if it says this person may not see the payment settings, say that, not "could not load".
  if (settingsRes.error?.code === "42501" || pluginsRes.error?.code === "42501") {
    return (
      <>
        {header}
        <NoAccess area="Payments" access="paymentSettings" />
      </>
    );
  }
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
  // Change control and readiness (migration 0597). Each is read on its own: a failure is said in plain English on that part
  // of the screen (with a retry), never as an empty list, and never stops the rest of the page.
  const cc: ChangeControl = { queue: null, queueError: null, readiness: null, readinessError: null };
  const sentence = (what: string, why: string) => `Could not load ${what} — ${why}.`;
  if (queueRes.error) {
    console.error("[settings/payments] payee_change_queue failed:", queueRes.error);
    cc.queueError = sentence("the changes to where gifts go", explainError(queueRes.error));
  } else {
    const q = parsePayeeQueue(queueRes.data);
    if (q.ok) cc.queue = q.value;
    else {
      console.error("[settings/payments] unexpected answer from payee_change_queue:", queueRes.data);
      cc.queueError = sentence("the changes to where gifts go", q.error);
    }
  }
  if (readinessRes.error) {
    console.error("[settings/payments] payment_readiness failed:", readinessRes.error);
    cc.readinessError = sentence("the go-live readiness for payments", explainError(readinessRes.error));
  } else {
    const r = parsePaymentReadiness(readinessRes.data);
    if (r.ok) cc.readiness = r.value;
    else {
      console.error("[settings/payments] unexpected answer from payment_readiness:", readinessRes.data);
      cc.readinessError = sentence("the go-live readiness for payments", r.error);
    }
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
        <PluginCards s={settings} ps={plugins.value} tz={center.time_zone} cc={cc} />
      </PaymentsPanel>
    </>
  );
}

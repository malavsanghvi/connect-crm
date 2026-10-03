// The payment plugins (docs/PAYMENTS_PLAN.md §2.2): the same twelve keys as the app.payment_plugins
// catalog of migration 0580 (tests/payment-plugins.test.ts compares them line by line). Pure; no
// server-only or Next imports, so the portal, the worker and the tests can all read it.

export type PluginKey =
  | "card"
  | "apple_pay"
  | "google_pay"
  | "bank_debit"
  | "paypal"
  | "zelle"
  | "check"
  | "cash"
  | "ach_wire"
  | "stock"
  | "daf"
  | "matching_gift";

/** provider_checkout: the provider hosts the page; reported_transfer: the member reports it, the bank confirms it; instructions: offline. */
export type PluginFamily = "provider_checkout" | "reported_transfer" | "instructions";
export type PluginProvider = "stripe" | "paypal";
/** test_mode: the provider's own test mode; rehearsal: no test mode exists, so a sandbox hides the real payee (Zelle); none: offline. */
export type SandboxBehavior = "test_mode" | "rehearsal" | "none";

export type PaymentPlugin = {
  key: PluginKey;
  label: string;
  family: PluginFamily;
  provider: PluginProvider | null;
  /** The value in center_payment_processors.methods this plugin switches (provider plugins). */
  processorMethod: string | null;
  /** The center_payment_methods.method this plugin switches (Zelle and the offline methods). */
  legacyMethod: string | null;
  /** The app.payment_method values a payment made with it is recorded as. */
  recordsAs: string[];
  dependsOn: PluginKey[];
  sandboxBehavior: SandboxBehavior;
  sort: number;
};

export const PAYMENT_PLUGINS: readonly PaymentPlugin[] = [
  { key: "card", label: "Card", family: "provider_checkout", provider: "stripe", processorMethod: "card", legacyMethod: null, recordsAs: ["card"], dependsOn: [], sandboxBehavior: "test_mode", sort: 10 },
  { key: "apple_pay", label: "Apple Pay", family: "provider_checkout", provider: "stripe", processorMethod: "apple_pay", legacyMethod: null, recordsAs: ["apple_pay"], dependsOn: ["card"], sandboxBehavior: "test_mode", sort: 11 },
  { key: "google_pay", label: "Google Pay", family: "provider_checkout", provider: "stripe", processorMethod: "google_pay", legacyMethod: null, recordsAs: ["google_pay"], dependsOn: ["card"], sandboxBehavior: "test_mode", sort: 12 },
  { key: "bank_debit", label: "Bank account (ACH)", family: "provider_checkout", provider: "stripe", processorMethod: "ach", legacyMethod: null, recordsAs: ["ach"], dependsOn: ["card"], sandboxBehavior: "test_mode", sort: 13 },
  { key: "paypal", label: "PayPal", family: "provider_checkout", provider: "paypal", processorMethod: "paypal", legacyMethod: null, recordsAs: ["paypal", "venmo", "card"], dependsOn: [], sandboxBehavior: "test_mode", sort: 20 },
  { key: "zelle", label: "Zelle", family: "reported_transfer", provider: null, processorMethod: null, legacyMethod: "zelle", recordsAs: ["zelle"], dependsOn: [], sandboxBehavior: "rehearsal", sort: 30 },
  { key: "check", label: "Check", family: "instructions", provider: null, processorMethod: null, legacyMethod: "check", recordsAs: ["check"], dependsOn: [], sandboxBehavior: "none", sort: 40 },
  { key: "cash", label: "Cash (bhandar)", family: "instructions", provider: null, processorMethod: null, legacyMethod: "cash", recordsAs: ["cash"], dependsOn: [], sandboxBehavior: "none", sort: 50 },
  { key: "ach_wire", label: "ACH and wire", family: "instructions", provider: null, processorMethod: null, legacyMethod: "ach", recordsAs: ["ach"], dependsOn: [], sandboxBehavior: "none", sort: 60 },
  { key: "stock", label: "Stock", family: "instructions", provider: null, processorMethod: null, legacyMethod: "stock", recordsAs: ["stock"], dependsOn: [], sandboxBehavior: "none", sort: 70 },
  { key: "daf", label: "Donor-advised fund", family: "instructions", provider: null, processorMethod: null, legacyMethod: "daf", recordsAs: ["daf"], dependsOn: [], sandboxBehavior: "none", sort: 80 },
  { key: "matching_gift", label: "Matching gift", family: "instructions", provider: null, processorMethod: null, legacyMethod: "matching_gift", recordsAs: ["matching_gift"], dependsOn: [], sandboxBehavior: "none", sort: 90 },
];

export const PLUGIN_KEYS: readonly PluginKey[] = PAYMENT_PLUGINS.map((p) => p.key);

export function isPluginKey(k: unknown): k is PluginKey {
  return typeof k === "string" && (PLUGIN_KEYS as readonly string[]).includes(k);
}

export function pluginByKey(k: string): PaymentPlugin | undefined {
  return PAYMENT_PLUGINS.find((p) => p.key === k);
}

export function pluginLabel(k: string): string {
  return pluginByKey(k)?.label ?? k.replace(/_/g, " ");
}

/** The plugins that ride on this one (Card → Apple Pay, Google Pay, ACH). */
export function dependentsOf(k: PluginKey): PaymentPlugin[] {
  return PAYMENT_PLUGINS.filter((p) => p.dependsOn.includes(k));
}

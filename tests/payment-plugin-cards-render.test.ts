import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Settings › Payments as plugin cards: what each switch says and whether it is locked. The cards call
// server actions and the panel's runner; here nothing is called, only rendered.
vi.mock("@/app/(app)/settings/payments/actions", () => ({ setPluginAction: vi.fn() }));
vi.mock("@/app/(app)/settings/payments/change-actions", () => ({
  requestZelleChangeAction: vi.fn(), decidePayeeChangeAction: vi.fn(), cancelPayeeChangeAction: vi.fn(), approveZelleInstructionsAction: vi.fn(), confirmWalletAction: vi.fn(),
}));
vi.mock("@/app/(app)/settings/payments/payments-panel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/(app)/settings/payments/payments-panel")>();
  return { ...original, usePaymentsPanel: () => ({ run: vi.fn(), busy: null, askReason: vi.fn() }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PluginCards } from "@/app/(app)/settings/payments/plugin-cards";
import { PAYMENT_PLUGINS } from "@/lib/payments/plugins/catalog";
import { parsePluginSettings, type PluginEntry, type PluginSettings } from "@/lib/payments/plugins/view";
import { OFFLINE_METHODS, type PaymentSettings, type ProcessorSettings } from "@/lib/payments/view";

const REQUIRED: Record<string, string[]> = {
  check: ["payee", "address"], cash: ["where"], zelle: ["recipient"], ach: ["details"], stock: ["details"],
  daf: ["legal_name", "ein"], matching_gift: ["legal_name", "ein"],
};

const entry = (key: string, over: Partial<PluginEntry> = {}): PluginEntry => {
  const p = PAYMENT_PLUGINS.find((x) => x.key === key)!;
  return {
    key, label: p.label, label_override: null, family: p.family, provider: p.provider, depends_on: [...p.dependsOn], sandbox_behavior: p.sandboxBehavior,
    catalog_status: "available", enabled: false, mode: "test", status: "off", problem: null, sort: p.sort, config: {}, config_fields: [], changed_at: null, ...over,
  };
};

const processor = (name: "stripe" | "paypal", over: Partial<ProcessorSettings> = {}): ProcessorSettings => ({
  processor: name, status: "not_connected", is_default: false, methods: [], statement_descriptor: null, donor_covers_fee_allowed: false, api_mode: "test",
  connection: null, last_job: null, tests: [], test_pending: null, ...over,
});

const settings = (over: Partial<PaymentSettings> = {}): PaymentSettings => ({
  environment: "production", forced_test: false, offline_only: false,
  processors: [processor("stripe"), processor("paypal")],
  methods: OFFLINE_METHODS.map((m, i) => ({ method: m.method, accepted: false, instructions: {}, sort: i + 1, required: REQUIRED[m.method] ?? [] })),
  paypal_email_pending: null, payouts: [], messaging_available: true, can_configure: true, can_connect: true, ...over,
});

const plugins = (entries: PluginEntry[], over: Partial<PluginSettings> = {}): PluginSettings => ({
  environment: "production", forced_test: false, offline_only: false, can_configure: true, can_connect: true, plugins: entries, ...over,
});

const render = (s: PaymentSettings, ps: PluginSettings) => renderToStaticMarkup(createElement(PluginCards, { s, ps, tz: "America/Chicago" }));

/** The opening tag of the switch named "Offer <name>". */
function switchTag(html: string, name: string): string {
  const m = new RegExp(`<button[^>]*aria-label="Offer ${name.replace(/[()]/g, "\\$&")}"[^>]*>`).exec(html);
  if (!m) throw new Error(`no switch "Offer ${name}" in the markup`);
  return m[0];
}
const locked = (html: string, name: string) => /\sdisabled(=""|\s|>)/.test(switchTag(html, name));

describe("Settings › Payments plugin cards", () => {
  it("locks Card on while Stripe is connected and says how to stop; Apple Pay still switches off", () => {
    const html = render(
      settings({ processors: [processor("stripe", { status: "test", methods: ["card", "apple_pay"] }), processor("paypal")] }),
      plugins([entry("card", { enabled: true, status: "ready" }), entry("apple_pay", { enabled: true, status: "ready" })]),
    );
    expect(locked(html, "Card")).toBe(true);
    expect(html).toContain("Stripe is connected, so Card stays on. To stop taking card payments, disconnect Stripe below.");
    expect(locked(html, "Apple Pay")).toBe(false);
  });

  it("lets Card be switched off when nothing is connected, and says the wallets go with it", () => {
    const html = render(settings(), plugins([entry("card", { enabled: true, status: "needs_setup", problem: "Connect Stripe first (Card › Connect)." })]));
    expect(locked(html, "Card")).toBe(false);
    expect(html).toContain("Connect Stripe first (Card › Connect).");
  });

  it("holds Apple Pay, Google Pay and ACH off until Card is on", () => {
    const html = render(settings(), plugins([entry("card"), entry("apple_pay"), entry("google_pay"), entry("bank_debit")]));
    for (const name of ["Apple Pay", "Google Pay", "Bank account (ACH)"]) expect(locked(html, name)).toBe(true);
    expect(html).toContain("Turn Card on first.");
  });

  it("locks an offline method until its instructions are saved, and says what is missing", () => {
    const empty = render(settings(), plugins([entry("check")]));
    expect(locked(empty, "Check")).toBe(true);
    expect(empty).toContain("Before turning it on: Fill in &quot;payee&quot; before accepting check. Save the instructions below, then turn it on.");
    const saved = settings({
      methods: OFFLINE_METHODS.map((m, i) => ({
        method: m.method, accepted: false, sort: i + 1, required: REQUIRED[m.method] ?? [],
        instructions: (m.method === "check" ? { payee: "Jain Society of Houston", address: "3905 Arbor St" } : {}) as Record<string, string>,
      })),
    });
    const ready = render(saved, plugins([entry("check", { config: { payee: "Jain Society of Houston", address: "3905 Arbor St" } })]));
    expect(locked(ready, "Check")).toBe(false);
  });

  it("keeps a paused plugin off and says Community Connect paused it; a plugin that is on can still be switched off", () => {
    const paused = render(settings(), plugins([entry("zelle", { catalog_status: "suspended", status: "suspended", problem: "Community Connect has paused Zelle for now." })]));
    expect(locked(paused, "Zelle")).toBe(true);
    expect(paused).toContain("Paused by Community Connect");
    const on = render(
      settings(),
      plugins([entry("cash", { enabled: true, status: "live", config: { where: "Bhandar" } })]),
    );
    expect(locked(on, "Cash (bhandar)")).toBe(false);
  });

  it("shows only the name members see, the rehearsal note in a sandbox, and no switches or rename for a person who may only look", () => {
    const sandbox = render(
      settings({ environment: "sandbox" }),
      plugins([entry("zelle", { label_override: "Zelle (Temple)" })], { environment: "sandbox" }),
    );
    expect(sandbox).toContain("Zelle (Temple)");
    expect(sandbox).toContain("Rehearsal: members see &quot;Sandbox: no real money moves&quot;, never this address.");
    expect(sandbox).toContain("Match Zelle payments on the bank statement");
    expect(sandbox).toContain("Rename / order");
    const readOnly = render(settings({ can_configure: false }), plugins([entry("check"), entry("cash")], { can_configure: false }));
    expect(locked(readOnly, "Check")).toBe(true);
    expect(locked(readOnly, "Cash (bhandar)")).toBe(true);
    expect(readOnly).not.toContain("Rename / order");
  });

  it("leaves out a plugin this version does not know instead of guessing", () => {
    const unknown = parsePluginSettings({
      environment: "production", forced_test: false, offline_only: false, can_configure: true, can_connect: true,
      plugins: [{ ...entry("check"), key: "venmo_direct", label: "Venmo direct" }],
    });
    expect(unknown.ok).toBe(true);
    if (!unknown.ok) return;
    const html = render(settings(), unknown.value);
    expect(html).not.toContain("Venmo direct");
  });
});

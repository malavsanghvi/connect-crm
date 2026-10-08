import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Settings › Payments and Platform › Payments, change control part (migration 0597): what each screen says and which
// buttons it offers to whom. The actions and the panel's runner are replaced; here nothing is called, only rendered.
vi.mock("@/app/(app)/settings/payments/actions", () => ({ setPluginAction: vi.fn() }));
vi.mock("@/app/(app)/settings/payments/change-actions", () => ({
  requestZelleChangeAction: vi.fn(), decidePayeeChangeAction: vi.fn(), cancelPayeeChangeAction: vi.fn(), approveZelleInstructionsAction: vi.fn(), confirmWalletAction: vi.fn(),
}));
vi.mock("@/app/(app)/platform/payments/actions", () => ({ suspendPluginAction: vi.fn(), liftPauseAction: vi.fn() }));
vi.mock("@/app/(app)/settings/payments/payments-panel", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/(app)/settings/payments/payments-panel")>();
  return { ...original, usePaymentsPanel: () => ({ run: vi.fn(), busy: null, askReason: vi.fn() }) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/step-up", () => ({ useStepUp: () => null }));

import { PausesPanel } from "@/app/(app)/platform/payments/pauses-panel";
import type { ChangeControl } from "@/app/(app)/settings/payments/change-control";
import { PluginCards } from "@/app/(app)/settings/payments/plugin-cards";
import { parsePauses, type PayeeRequest, type PaymentReadiness } from "@/lib/payments/change-control";
import { PAYMENT_PLUGINS } from "@/lib/payments/plugins/catalog";
import type { PluginEntry, PluginSettings } from "@/lib/payments/plugins/view";
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
const processor = (name: "stripe" | "paypal"): ProcessorSettings => ({
  processor: name, status: "not_connected", is_default: false, methods: [], statement_descriptor: null, donor_covers_fee_allowed: false, api_mode: "test",
  connection: null, last_job: null, tests: [], test_pending: null,
});
const ZELLE = { recipient: "give@temple.example", name: "Jain Society of Houston", memo_hint: "Your member number" };
const settings = (): PaymentSettings => ({
  environment: "production", forced_test: false, offline_only: false, processors: [processor("stripe"), processor("paypal")],
  methods: OFFLINE_METHODS.map((m, i) => ({
    method: m.method, accepted: m.method === "zelle", instructions: (m.method === "zelle" ? ZELLE : {}) as Record<string, string>, sort: i + 1, required: REQUIRED[m.method] ?? [],
  })),
  paypal_email_pending: null, payouts: [], messaging_available: true, can_configure: true, can_connect: true,
});
const plugins = (entries: PluginEntry[]): PluginSettings => ({ environment: "production", forced_test: false, offline_only: false, can_configure: true, can_connect: true, plugins: entries });

const request = (over: Partial<PayeeRequest> = {}): PayeeRequest => ({
  id: "11111111-1111-4111-8111-111111111111", plugin_key: "zelle", status: "pending", requested_by: "u1", requested_by_name: "Tanu Treasurer",
  requested_at: "2026-10-08T10:00:00Z", request_reason: "New account", expires_at: "2026-10-22T10:00:00Z", expired: false, decided_by_name: null,
  decided_at: null, decision_reason: null, applied_at: null, mine: false,
  fields: [{ field: "recipient", label: "the Zelle address", from: "give@temple.example", to: "new@temple.example" }], ...over,
});
const readiness = (over: Partial<PaymentReadiness> = {}): PaymentReadiness => ({
  ok: false, offline_only: false, environment: "production",
  plugins: [
    { key: "check", label: "Check", family: "instructions", ready: true, detail: "The instructions are filled in." },
    { key: "zelle", label: "Zelle", family: "reported_transfer", ready: false, detail: "The treasurer has not approved the Zelle instructions and matching process yet (Settings › Payments › Zelle)." },
  ],
  zelle_approval: { state: "none", approved_by_name: null, approved_at: null, note: null }, is_treasurer: true, can_configure: true, ...over,
});
const cc = (over: Partial<ChangeControl> = {}): ChangeControl => ({
  queue: { can_request: true, can_approve: true, requests: [] }, queueError: null, readiness: readiness(), readinessError: null, ...over,
});
const render = (c?: ChangeControl, entries: PluginEntry[] = [entry("zelle", { enabled: true, status: "live", config: ZELLE })]) =>
  renderToStaticMarkup(createElement(PluginCards, { s: settings(), ps: plugins(entries), tz: "America/Chicago", cc: c }));

/** The opening tag of the input holding this value. */
function inputWith(html: string, value: string): string {
  const m = new RegExp(`<input[^>]*value="${value.replace(/[.@]/g, "\\$&")}"[^>]*>`).exec(html);
  if (!m) throw new Error(`no input holding "${value}" in the markup`);
  return m[0];
}
const disabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag);

describe("Settings › Payments: the Zelle card under change control", () => {
  it("shows a saved address and name read-only, offers a request for a change, and leaves the memo editable", () => {
    const html = render(cc());
    expect(disabled(inputWith(html, "give@temple.example"))).toBe(true);
    expect(disabled(inputWith(html, "Jain Society of Houston"))).toBe(true);
    expect(disabled(inputWith(html, "Your member number"))).toBe(false);
    expect(html).toContain("Request a change to the address or name");
  });

  it("without the change-control data the address stays read-only (the database refuses a change anyway), with no request button and no readiness card", () => {
    const html = render(undefined);
    expect(disabled(inputWith(html, "give@temple.example"))).toBe(true);
    expect(html).not.toContain("Request a change to the address or name");
    expect(html).not.toContain("Ready to go live?");
  });

  it("a person who may not ask sees no request button", () => {
    const html = render(cc({ queue: { can_request: false, can_approve: false, requests: [] } }));
    expect(html).not.toContain("Request a change to the address or name");
  });

  it("lists a waiting request for the second person with Confirm and Turn it down, and says members keep the current details", () => {
    const html = render(cc({ queue: { can_request: true, can_approve: true, requests: [request()] } }));
    expect(html).toContain("Changes to where gifts go");
    expect(html).toContain("Waiting for a second person");
    expect(html).toContain("asked by Tanu Treasurer");
    expect(html).toContain("the Zelle address");
    expect(html).toContain("new@temple.example");
    expect(html).toContain("Confirm the change");
    expect(html).toContain("Turn it down");
    expect(html).toContain("Members keep seeing the current details until it is confirmed.");
  });

  it("the person who asked cannot confirm it, only withdraw it, and is told why", () => {
    const html = render(cc({ queue: { can_request: true, can_approve: true, requests: [request({ mine: true })] } }));
    expect(html).not.toContain("Confirm the change");
    expect(html).toContain("Withdraw the request");
    expect(html).toContain("You asked for this change, so a different person with giving.approve has to confirm it.");
  });

  it("someone who may not confirm sees who does, and no Confirm button", () => {
    const html = render(cc({ queue: { can_request: true, can_approve: false, requests: [request()] } }));
    expect(html).not.toContain("Confirm the change");
    expect(html).toContain("A person with giving.approve confirms it.");
  });

  it("shows what was decided and by whom, without buttons", () => {
    const html = render(cc({ queue: { can_request: true, can_approve: true, requests: [request({ status: "applied", decided_by_name: "Tara Treasurer", decided_at: "2026-10-09T10:00:00Z", decision_reason: "Checked with the bank" })] } }));
    expect(html).toContain("Confirmed");
    expect(html).toContain("Confirmed by Tara Treasurer");
    expect(html).toContain("Checked with the bank");
    expect(html).not.toContain("Withdraw the request");
  });

  it("says a failed read in plain English with a retry, instead of an empty list", () => {
    const html = render(cc({ queue: null, queueError: "Could not load the changes to where gifts go — the database could not be reached." }));
    expect(html).toContain("Could not load the changes to where gifts go");
    expect(html).toContain("Try again");
  });

  it("offers the treasurer the go-live approval of the Zelle instructions; others are told who approves", () => {
    const treasurer = render(cc());
    expect(treasurer).toContain("Go-live approval of the Zelle instructions");
    expect(treasurer).toContain("Not approved yet");
    expect(treasurer).toContain("Approve the Zelle instructions");
    const other = render(cc({ readiness: readiness({ is_treasurer: false }) }));
    expect(other).not.toContain("Approve the Zelle instructions");
    expect(other).toContain("Only the person with the Treasurer role approves them");
    const done = render(cc({ readiness: readiness({ zelle_approval: { state: "current", approved_by_name: "Tara Treasurer", approved_at: "2026-10-09T10:00:00Z", note: null } }) }));
    expect(done).toContain("Approved by the treasurer");
    expect(done).not.toContain("Approve the Zelle instructions");
    const changed = render(cc({ readiness: readiness({ zelle_approval: { state: "changed", approved_by_name: "Tara Treasurer", approved_at: "2026-10-09T10:00:00Z", note: null } }) }));
    expect(changed).toContain("The details changed after they were approved. The treasurer approves the new version.");
    expect(changed).toContain("Approve the Zelle instructions");
  });
});

describe("Settings › Payments: readiness and the wallets", () => {
  it("lists every enabled way to pay with Ready or Not ready in words, and the summary", () => {
    const html = render(cc());
    expect(html).toContain("Ready to go live?");
    expect(html).toContain("1 of 2 ways to pay is not ready: Zelle.");
    expect(html).toMatch(/data-plugin="check" data-ready="yes"/);
    expect(html).toMatch(/data-plugin="zelle" data-ready="no"/);
    expect(html).toContain("The treasurer has not approved the Zelle instructions and matching process yet");
  });

  it("says an organization that takes offline payments only is not checked for Stripe and PayPal", () => {
    const html = render(cc({ readiness: readiness({ offline_only: true, ok: true, plugins: [] }) }));
    expect(html).toContain("The organization takes offline payments only");
    expect(html).toContain("No way to pay is switched on yet, so there is nothing to check.");
  });

  it("says a failed readiness read in plain English with a retry", () => {
    const html = render(cc({ readiness: null, readinessError: "Could not load the go-live readiness for payments — you don't have permission to make this change." }));
    expect(html).toContain("Could not load the go-live readiness for payments");
    expect(html).toContain("Try again");
  });

  it("offers 'I turned it on in Stripe' on a wallet that waits only for that statement", () => {
    const wallet = (detail: string, ready = false): PaymentReadiness =>
      readiness({ plugins: [{ key: "apple_pay", label: "Apple Pay", family: "provider_checkout", ready, detail }] });
    const entries = [entry("card", { enabled: true, status: "live" }), entry("apple_pay", { enabled: true, status: "live" })];
    const waiting = render(cc({ readiness: wallet("Turn Apple Pay on in your Stripe payment settings, then say so.") }), entries);
    expect(waiting).toContain("I turned it on in Stripe");
    const cardFirst = render(cc({ readiness: wallet("Card is not ready yet. Run the $1 live test (Card › Run the $1 test).") }), entries);
    expect(cardFirst).not.toContain("I turned it on in Stripe");
    const done = render(cc({ readiness: wallet("Apple Pay was confirmed as turned on in Stripe on October 9, 2026.", true) }), entries);
    expect(done).not.toContain("I turned it on in Stripe");
    expect(done).toContain("Apple Pay was confirmed as turned on in Stripe on October 9, 2026.");
  });
});

describe("Platform › Payments", () => {
  const parsed = parsePauses({
    plugins: [
      { key: "card", label: "Card", family: "provider_checkout", status: "suspended",
        platform_pause: { id: "p1", reason: "Stripe outage", at: "2026-10-08T10:00:00Z", by: "pat@cc.example" }, centers: [] },
      { key: "zelle", label: "Zelle", family: "reported_transfer", status: "available", platform_pause: null,
        centers: [{ id: "p2", center_id: "c1", center_name: "Houston", slug: "jsh", reason: "Bank problem", at: "2026-10-08T10:00:00Z", by: null }] },
      { key: "check", label: "Check", family: "instructions", status: "available", platform_pause: null, centers: [] },
    ],
    history: [{ id: "p1", plugin_key: "card", platform_wide: true, center_name: null, reason: "Stripe outage", suspended_at: "2026-10-08T10:00:00Z",
                suspended_by: "pat@cc.example", lifted_at: null, lift_reason: null, lifted_by: null }],
    centers: [{ id: "c1", name: "Houston", slug: "jsh", environment: "production" }, { id: "c2", name: "Austin", slug: "atx", environment: "sandbox" }],
  });
  if (!parsed.ok) throw new Error("test fixture does not parse");
  const html = renderToStaticMarkup(createElement(PausesPanel, { view: parsed.value, tz: "America/Chicago" }));

  it("shows each way to pay as running or paused, with who paused it and why", () => {
    expect(html).toContain("Paused for every community");
    expect(html).toContain("Paused for Houston");
    expect(html).toContain("Running");
    expect(html).toContain("Stripe outage");
    expect(html).toContain("Bank problem");
    expect(html).toContain("still paused");
  });

  it("offers Resume where something is paused and Pause where it is not, and a list of communities to pause one for", () => {
    expect(html).toContain("Resume for everyone");
    expect(html).toContain("Resume for Houston");
    expect(html).toContain("Pause for everyone");
    expect(html).toContain("Austin (sandbox)");
  });

  it("says plainly what a pause does", () => {
    expect(html).toContain("A pause turns a way to pay off for members");
    expect(html).toContain("An organization cannot undo a pause, not even by resetting its sandbox.");
  });
});

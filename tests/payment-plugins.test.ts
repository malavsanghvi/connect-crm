import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PAYMENT_PLUGINS, PLUGIN_KEYS, dependentsOf, isPluginKey } from "@/lib/payments/plugins/catalog";
import { instructionsProblem, paymentPluginConfigProblem, pluginStatusView, ZELLE_NAME_PROBLEM } from "@/lib/payments/plugins/config";
import { parseMemberMethods, parsePluginSettings, pluginDisplayName, UNEXPECTED_SHAPE } from "@/lib/payments/plugins/view";
import { OFFLINE_METHODS } from "@/lib/payments/view";

const migration = readFileSync(join(__dirname, "..", "supabase", "migrations", "0580_payment_plugins.sql"), "utf8");
// One catalog row per line, each beginning with ('<key>', (the migration says so).
const sqlRows = migration
  .split(/\r?\n/)
  .filter((l) => /^\('[a-z_]+', /.test(l))
  .map((l) => {
    const m = /^\('([a-z_]+)', '([^']+)', '([a-z_]+)', (null|'[a-z]+'), (null|'[a-z_]+'), (null|'[a-z_]+'), '\{([a-z_,]*)\}', '\{([a-z_,]*)\}', '(\[.*\])', '([a-z_]+)', '([a-z]+)', (\d+)\),?$/.exec(l);
    if (!m) throw new Error(`cannot read the catalog line: ${l}`);
    const unq = (v: string) => (v === "null" ? null : v.slice(1, -1));
    const list = (v: string) => (v ? v.split(",") : []);
    return {
      key: m[1], label: m[2], family: m[3], provider: unq(m[4]), processorMethod: unq(m[5]), legacyMethod: unq(m[6]),
      recordsAs: list(m[7]), dependsOn: list(m[8]), configFields: JSON.parse(m[9]) as { key: string; label: string; sensitive: boolean }[],
      sandboxBehavior: m[10], status: m[11], sort: Number(m[12]),
    };
  });

// app.payment_method_required_fields (0211), as payment_settings.methods[].required gives them to the screen.
const REQUIRED: Record<string, string[]> = {
  check: ["payee", "address"], cash: ["where"], zelle: ["recipient"], ach: ["details"], stock: ["details"],
  daf: ["legal_name", "ein"], matching_gift: ["legal_name", "ein"],
};

describe("payment plugin catalog", () => {
  it("has exactly the keys of the 0580 catalog rows, in the same order and shape", () => {
    expect(sqlRows).toHaveLength(12);
    expect([...PLUGIN_KEYS]).toEqual(sqlRows.map((r) => r.key));
    for (const r of sqlRows) {
      const p = PAYMENT_PLUGINS.find((x) => x.key === r.key)!;
      expect({ label: p.label, family: p.family, provider: p.provider, processorMethod: p.processorMethod, legacyMethod: p.legacyMethod,
               recordsAs: p.recordsAs, dependsOn: p.dependsOn, sandboxBehavior: p.sandboxBehavior, sort: p.sort })
        .toEqual({ label: r.label, family: r.family, provider: r.provider, processorMethod: r.processorMethod, legacyMethod: r.legacyMethod,
                   recordsAs: r.recordsAs, dependsOn: r.dependsOn, sandboxBehavior: r.sandboxBehavior, sort: r.sort });
      expect(r.status).toBe("available");
    }
  });

  it("depends only on known keys, never on itself, and only Card has riders", () => {
    for (const p of PAYMENT_PLUGINS) {
      for (const d of p.dependsOn) {
        expect(isPluginKey(d)).toBe(true);
        expect(d).not.toBe(p.key);
      }
    }
    expect(dependentsOf("card").map((p) => p.key)).toEqual(["apple_pay", "google_pay", "bank_debit"]);
    expect(dependentsOf("paypal")).toEqual([]);
  });

  it("lists the same instruction fields as the offline-method editor, with only Zelle's payee fields sensitive", () => {
    for (const r of sqlRows.filter((x) => x.legacyMethod)) {
      const def = OFFLINE_METHODS.find((m) => m.method === r.legacyMethod)!;
      expect(r.configFields.map((f) => [f.key, f.label])).toEqual(def.fields.map((f) => [f.key, f.label]));
      const sensitive = r.configFields.filter((f) => f.sensitive).map((f) => f.key);
      expect(sensitive).toEqual(r.key === "zelle" ? ["recipient", "name"] : []);
    }
    for (const k of ["card", "paypal"]) expect(sqlRows.find((r) => r.key === k)!.configFields.map((f) => f.key)).toEqual(["statement_descriptor"]);
    for (const k of ["apple_pay", "google_pay", "bank_debit"]) expect(sqlRows.find((r) => r.key === k)!.configFields).toEqual([]);
  });
});

describe("paymentPluginConfigProblem mirrors app.payment_plugin_config_problem", () => {
  const problem = (key: string, config: unknown, mode = "test") => {
    const legacy = PAYMENT_PLUGINS.find((p) => p.key === key)?.legacyMethod;
    return paymentPluginConfigProblem(key, config, mode, legacy ? REQUIRED[legacy] : []);
  };

  it("checks Zelle's recipient, and its name in live mode", () => {
    expect(problem("zelle", { recipient: "treasurer" })).toBe("The Zelle recipient is an email address or a US phone number.");
    expect(problem("zelle", {})).toBe('Fill in "recipient" before accepting zelle.');
    expect(problem("zelle", { recipient: "+1 713 555 0142" })).toBeNull();
    expect(problem("zelle", { recipient: "give@plg.example" }, "live")).toBe(ZELLE_NAME_PROBLEM);
    expect(ZELLE_NAME_PROBLEM).toBe("Add the name shown in Zelle so members can check they are paying the right account.");
    expect(problem("zelle", { recipient: "give@plg.example", name: "Plugin Test Temple" }, "live")).toBeNull();
  });

  it("allows Card and PayPal only a valid statement descriptor", () => {
    expect(problem("card", { statement_descriptor: "JAIN SOCIETY OF HOUSTON TX" })).toBe("The statement descriptor can be at most 22 characters.");
    expect(problem("card", { statement_descriptor: "JSH<>" })).toBe("The statement descriptor cannot contain < > \\ ' \" or *.");
    expect(problem("paypal", { statement_descriptor: "PTT TEMPLE" }, "live")).toBeNull();
    expect(problem("card", { x: "1" })).toBe('"x" is not a Card setting; the only one is the statement descriptor.');
    expect(problem("card", { statement_descriptor: 5 })).toBe("The statement descriptor must be text.");
  });

  it("checks the EIN, the offline instructions, and plugins with no settings", () => {
    expect(problem("daf", { legal_name: "PTT", ein: "12-345" })).toBe("The EIN is 9 digits, written like 12-3456789.");
    expect(problem("daf", { legal_name: "PTT", ein: "12345" })).toBe("The EIN is 9 digits, written like 12-3456789.");
    expect(problem("matching_gift", { legal_name: "PTT", ein: "12-3456789" })).toBeNull();
    expect(problem("check", { payee: "Jain Society of Houston" })).toBe('Fill in "address" before accepting check.');
    expect(problem("ach_wire", {})).toBe('Fill in "details" before accepting ach.');
    expect(problem("cash", { where: "  " })).toBe('Fill in "where" before accepting cash.');
    expect(problem("check", { Payee: "x" })).toBe('"Payee" is not an instructions field.');
    expect(problem("stock", { details: "x".repeat(601) })).toBe('The "details" field can be at most 600 characters.');
    expect(problem("google_pay", { a: "b" })).toBe("Google Pay has no settings of its own.");
    expect(problem("bank_debit", {})).toBeNull();
    expect(problem("nope", {})).toBe("That is not a payment method Community Connect offers.");
    expect(problem("check", ["x"])).toBe("The settings must be a set of fields.");
  });

  it("reports problems in the order the database finds them (jsonb key order: shorter keys first)", () => {
    // Both keys are bad; jsonb visits "zz" before "aaa".
    expect(instructionsProblem("check", { aaa: 1, zz: 2 }, [])).toBe('The "zz" field must be text.');
  });
});

describe("pluginStatusView", () => {
  it("names every status in words", () => {
    expect(pluginStatusView("off", "production")).toEqual({ label: "Off", tone: "neutral" });
    expect(pluginStatusView("needs_setup", "sandbox").label).toBe("Needs setup");
    expect(pluginStatusView("ready", "sandbox").label).toBe("Ready to test");
    expect(pluginStatusView("ready", "production").label).toBe("Ready");
    expect(pluginStatusView("test_passed", "sandbox").label).toBe("Test passed");
    expect(pluginStatusView("live", "production").label).toBe("Live");
    expect(pluginStatusView("live", "production", "instructions").label).toBe("On");
    expect(pluginStatusView("suspended", "production")).toEqual({ label: "Paused by Community Connect", tone: "danger" });
    expect(pluginStatusView("bogus", "production").label).toBe("Unknown");
  });
});

// The contract sample (the member app reads this shape).
const MEMBER_SAMPLE = {
  environment: "sandbox",
  currency: "usd",
  online_unavailable: null,
  methods: [
    { key: "paypal", family: "provider_checkout", label: "PayPal", provider: "paypal", mode: "test", wallets: [], also: ["venmo"], sort: 20 },
    { key: "card", family: "provider_checkout", label: "Card", provider: "stripe", mode: "test", wallets: ["apple_pay", "google_pay"], also: [], sort: 10 },
    { key: "zelle", family: "reported_transfer", label: "Zelle", mode: "rehearsal", instructions: { name: "Sandbox: no real money moves", memo_hint: "Your member number" },
      report: { available: false, confirmation: "ask", window_days: 10 }, sort: 30 },
    { key: "check", family: "instructions", label: "Cheque", method: "check", instructions: { payee: "Jain Society of Houston", address: "3905 Arbor St" }, sort: 5 },
  ],
};

describe("parseMemberMethods", () => {
  it("accepts the contract sample, sorted", () => {
    const r = parseMemberMethods(MEMBER_SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.methods.map((m) => m.key)).toEqual(["check", "card", "paypal", "zelle"]);
    const card = r.value.methods.find((m) => m.key === "card");
    expect(card?.family === "provider_checkout" && card.wallets).toEqual(["apple_pay", "google_pay"]);
    const zelle = r.value.methods.find((m) => m.key === "zelle");
    expect(zelle?.family === "reported_transfer" && zelle.instructions).toEqual({ name: "Sandbox: no real money moves", memo_hint: "Your member number" });
  });

  it("never passes a rehearsal address through, and skips a family it does not know", () => {
    const r = parseMemberMethods({
      ...MEMBER_SAMPLE,
      methods: [
        { ...MEMBER_SAMPLE.methods[2], instructions: { recipient: "real@bank.example", name: "x" } },
        { key: "crypto", family: "future_family", label: "Later", sort: 99 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.methods).toHaveLength(1);
    expect(JSON.stringify(r.value)).not.toContain("real@bank.example");
  });

  it("rejects junk in plain English", () => {
    for (const junk of [null, "x", [], {}, { ...MEMBER_SAMPLE, methods: "no" }, { ...MEMBER_SAMPLE, online_unavailable: "maybe" },
                        { ...MEMBER_SAMPLE, methods: [{ key: "card", family: "provider_checkout", label: "Card", provider: "square", mode: "test", wallets: [], also: [], sort: 1 }] },
                        { ...MEMBER_SAMPLE, methods: [{ ...MEMBER_SAMPLE.methods[2], report: { available: "yes", confirmation: "ask", window_days: 10 } }] },
                        { ...MEMBER_SAMPLE, methods: [{ ...MEMBER_SAMPLE.methods[3], sort: 1.5 }] }]) {
      expect(parseMemberMethods(junk)).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    }
  });
});

describe("parsePluginSettings", () => {
  const entry = {
    key: "check", label: "Check", label_override: "Cheque", family: "instructions", provider: null, depends_on: [], sandbox_behavior: "none",
    catalog_status: "available", enabled: true, mode: "live", status: "live", problem: null, sort: 5,
    config: { payee: "PTT", address: "1 Temple Rd" },
    config_fields: [{ key: "payee", label: "Make checks payable to", kind: "setting", member_visible: true, sensitive: false }],
    changed_at: "2026-10-02T10:00:00Z",
  };
  const sample = { environment: "production", forced_test: false, offline_only: false, can_configure: true, can_connect: false, plugins: [entry] };

  it("reads the settings and the name members see", () => {
    const r = parsePluginSettings(sample);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(pluginDisplayName(r.value.plugins[0])).toBe("Cheque");
    expect(pluginDisplayName({ label: "Card", label_override: null })).toBe("Card");
  });

  it("refuses a shape it does not understand", () => {
    expect(parsePluginSettings(null)).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePluginSettings({ ...sample, plugins: [{ ...entry, status: "maybe" }] })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
    expect(parsePluginSettings({ ...sample, plugins: [{ ...entry, config: { payee: 1 } }] })).toEqual({ ok: false, error: UNEXPECTED_SHAPE });
  });
});

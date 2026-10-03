// What a payment plugin's settings may hold, and how its status reads. Mirrors
// app.payment_plugin_config_problem (0580) word for word so Settings › Payments can say it before
// saving; the database is still the rule. Pure; tested in tests/payment-plugins.test.ts.

import { statementDescriptorProblem } from "@/lib/payments/view";

import { pluginByKey, type PluginFamily } from "./catalog";

/** Postgres btrim(): trims spaces only (not tabs or newlines). */
function btrim(s: string): string {
  return s.replace(/^ +| +$/g, "");
}

/** jsonb keeps an object's keys shorter first, then by bytes; the SQL loops see them in that order. */
function jsonbKeyOrder(keys: string[]): string[] {
  const enc = new TextEncoder();
  return [...keys].sort((a, b) => {
    const x = enc.encode(a);
    const y = enc.encode(b);
    if (x.length !== y.length) return x.length - y.length;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const ZELLE_RECIPIENT = /(^[^@\s]+@[^@\s]+\.[^@\s]+$)|(^\+?[0-9 ().-]{10,20}$)/;
const EIN = /^\d{2}-?\d{7}$/;
export const ZELLE_NAME_PROBLEM = "Add the name shown in Zelle so members can check they are paying the right account.";

/** Mirrors app.payment_method_instructions_problem(method, instructions); `required` is payment_settings.methods[].required. */
export function instructionsProblem(method: string, p: unknown, required: readonly string[]): string | null {
  if (!isPlainObject(p)) return "The instructions must be a set of fields.";
  for (const k of jsonbKeyOrder(Object.keys(p))) {
    const v = p[k];
    if (!/^[a-z_]{1,30}$/.test(k)) return `"${k}" is not an instructions field.`;
    if (v !== null && v !== undefined && typeof v !== "string") return `The "${k}" field must be text.`;
    if ([...(typeof v === "string" ? v : "")].length > 600) return `The "${k}" field can be at most 600 characters.`;
  }
  for (const f of required) {
    const v = p[f];
    if (!btrim(typeof v === "string" ? v : "")) return `Fill in "${f.replace(/_/g, " ")}" before accepting ${method.replace(/_/g, " ")}.`;
  }
  if ((method === "daf" || method === "matching_gift") && typeof p.ein === "string" && !EIN.test(btrim(p.ein))) {
    return "The EIN is 9 digits, written like 12-3456789.";
  }
  if (method === "zelle" && typeof p.recipient === "string" && !ZELLE_RECIPIENT.test(btrim(p.recipient))) {
    return "The Zelle recipient is an email address or a US phone number.";
  }
  return null;
}

/**
 * Mirrors app.payment_plugin_config_problem(key, config, mode). Zelle and the offline methods: their
 * instructions (and Zelle's name in live mode); Card and PayPal: the statement descriptor only; the
 * rest have no settings of their own.
 */
export function paymentPluginConfigProblem(key: string, config: unknown, mode: "test" | "live" | string, required: readonly string[]): string | null {
  const plugin = pluginByKey(key);
  if (!plugin) return "That is not a payment method Community Connect offers.";
  const v = config ?? {};
  if (!isPlainObject(v)) return "The settings must be a set of fields.";
  if (plugin.legacyMethod) {
    const problem = instructionsProblem(plugin.legacyMethod, v, required);
    if (problem) return problem;
    if (plugin.key === "zelle" && mode === "live" && !btrim(typeof v.name === "string" ? v.name : "")) return ZELLE_NAME_PROBLEM;
    return null;
  }
  if (plugin.key === "card" || plugin.key === "paypal") {
    for (const k of jsonbKeyOrder(Object.keys(v))) {
      if (k !== "statement_descriptor") return `"${k}" is not a ${plugin.label} setting; the only one is the statement descriptor.`;
      if (v[k] !== null && v[k] !== undefined && typeof v[k] !== "string") return "The statement descriptor must be text.";
    }
    return statementDescriptorProblem(typeof v.statement_descriptor === "string" ? v.statement_descriptor : "");
  }
  if (Object.keys(v).length > 0) return `${plugin.label} has no settings of its own.`;
  return null;
}

export type PluginStatus = "off" | "needs_setup" | "ready" | "test_passed" | "live" | "suspended";
export const PLUGIN_STATUSES: readonly PluginStatus[] = ["off", "needs_setup", "ready", "test_passed", "live", "suspended"];
/** Badge tones (src/components/ui.tsx); the label always says it in words too. */
export type PluginTone = "neutral" | "warning" | "navy" | "success" | "danger";

/** The status chip. An offline method that is live in production simply reads "On". */
export function pluginStatusView(status: string | null | undefined, environment: string | null | undefined, family?: PluginFamily): { label: string; tone: PluginTone } {
  switch (status) {
    case "off":
      return { label: "Off", tone: "neutral" };
    case "needs_setup":
      return { label: "Needs setup", tone: "warning" };
    case "ready":
      return { label: environment === "sandbox" ? "Ready to test" : "Ready", tone: "navy" };
    case "test_passed":
      return { label: "Test passed", tone: "success" };
    case "live":
      return { label: family === "instructions" && environment === "production" ? "On" : "Live", tone: "success" };
    case "suspended":
      return { label: "Paused by Community Connect", tone: "danger" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}

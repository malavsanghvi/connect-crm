// The two answers of the plugin layer, read defensively: app.payment_plugin_settings (Settings ›
// Payments) and app.member_payment_methods (the member app, through GET /api/payments/methods).
// Both RPCs answer jsonb (typed as Json), so every field is checked here; a shape this code does not
// understand is a plain error, never a guess. Pure; tested.

import type { PluginFamily, SandboxBehavior } from "./catalog";
import type { PluginStatus } from "./config";

export const UNEXPECTED_SHAPE = "the database answered in a shape this screen does not understand (has the latest migration been applied?)";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => isStr(v) && (list as readonly string[]).includes(v);

const FAMILIES: readonly PluginFamily[] = ["provider_checkout", "reported_transfer", "instructions"];
const STATUSES: readonly PluginStatus[] = ["off", "needs_setup", "ready", "test_passed", "live", "suspended"];
const SANDBOX: readonly SandboxBehavior[] = ["test_mode", "rehearsal", "none"];

/** Text fields only: the instructions and the statement descriptor (null when not set). */
function textRecord(v: unknown): Record<string, string | null> | null {
  if (!isObj(v)) return null;
  const out: Record<string, string | null> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!strOrNull(x)) return null;
    out[k] = x;
  }
  return out;
}

// ── app.payment_plugin_settings(center) ─────────────────────────────────────
export type PluginConfigField = { key: string; label: string; kind: string; member_visible: boolean; sensitive: boolean };
export type PluginEntry = {
  key: string;
  label: string;
  label_override: string | null;
  family: PluginFamily;
  provider: "stripe" | "paypal" | null;
  depends_on: string[];
  sandbox_behavior: SandboxBehavior;
  catalog_status: "available" | "beta" | "suspended";
  enabled: boolean;
  mode: "test" | "live";
  status: PluginStatus;
  problem: string | null;
  sort: number;
  config: Record<string, string | null>;
  config_fields: PluginConfigField[];
  changed_at: string | null;
};
export type PluginSettings = {
  environment: "sandbox" | "production";
  forced_test: boolean;
  offline_only: boolean;
  can_configure: boolean;
  can_connect: boolean;
  plugins: PluginEntry[];
};

function parseField(v: unknown): PluginConfigField | null {
  if (!isObj(v) || !isStr(v.key) || !isStr(v.label) || !isStr(v.kind) || !isBool(v.member_visible) || !isBool(v.sensitive)) return null;
  return { key: v.key, label: v.label, kind: v.kind, member_visible: v.member_visible, sensitive: v.sensitive };
}

function parseEntry(v: unknown): PluginEntry | null {
  if (!isObj(v)) return null;
  const config = textRecord(v.config);
  const fields = Array.isArray(v.config_fields) ? v.config_fields.map(parseField) : null;
  if (
    !isStr(v.key) || !isStr(v.label) || !strOrNull(v.label_override) || !oneOf(v.family, FAMILIES)
    || !(v.provider === null || v.provider === "stripe" || v.provider === "paypal") || !strList(v.depends_on)
    || !oneOf(v.sandbox_behavior, SANDBOX) || !oneOf(v.catalog_status, ["available", "beta", "suspended"] as const)
    || !isBool(v.enabled) || !oneOf(v.mode, ["test", "live"] as const) || !oneOf(v.status, STATUSES) || !strOrNull(v.problem)
    || !isInt(v.sort) || !config || !fields || fields.some((f) => f === null) || !strOrNull(v.changed_at)
  ) {
    return null;
  }
  return {
    key: v.key, label: v.label, label_override: v.label_override, family: v.family, provider: v.provider, depends_on: v.depends_on,
    sandbox_behavior: v.sandbox_behavior, catalog_status: v.catalog_status, enabled: v.enabled, mode: v.mode, status: v.status,
    problem: v.problem, sort: v.sort, config, config_fields: fields as PluginConfigField[], changed_at: v.changed_at,
  };
}

export function parsePluginSettings(json: unknown): Parsed<PluginSettings> {
  if (!isObj(json) || !oneOf(json.environment, ["sandbox", "production"] as const) || !isBool(json.forced_test) || !isBool(json.offline_only)
      || !isBool(json.can_configure) || !isBool(json.can_connect) || !Array.isArray(json.plugins)) {
    return { ok: false, error: UNEXPECTED_SHAPE };
  }
  const plugins: PluginEntry[] = [];
  for (const p of json.plugins) {
    const e = parseEntry(p);
    if (!e) return { ok: false, error: UNEXPECTED_SHAPE };
    plugins.push(e);
  }
  plugins.sort((a, b) => a.sort - b.sort);
  return {
    ok: true,
    value: { environment: json.environment, forced_test: json.forced_test, offline_only: json.offline_only, can_configure: json.can_configure, can_connect: json.can_connect, plugins },
  };
}

/** The name members see. */
export function pluginDisplayName(p: Pick<PluginEntry, "label" | "label_override">): string {
  return p.label_override?.trim() ? p.label_override.trim() : p.label;
}

// ── app.member_payment_methods(center) ──────────────────────────────────────
/** Shown for 30 days after a confirmed change of where gifts go (Zelle details, PayPal account): "The Zelle details changed on October 8, 2026. Check it before you pay." */
export type PayeeNotice = { changed_on: string; days: number; text: string };

export type MemberProviderMethod = {
  key: string;
  family: "provider_checkout";
  label: string;
  provider: "stripe" | "paypal";
  mode: "test" | "live";
  /** Wallets Stripe's checkout page may show (apple_pay, google_pay). */
  wallets: string[];
  /** Other ways the same page may offer (bank_debit on Stripe, venmo on PayPal). */
  also: string[];
  sort: number;
  payee_notice?: PayeeNotice;
};
export type MemberZelleMethod = {
  key: string;
  family: "reported_transfer";
  label: string;
  /** rehearsal: a sandbox; the real address is never sent. */
  mode: "live" | "rehearsal";
  instructions: { recipient?: string; name?: string; memo_hint?: string };
  report: { available: boolean; confirmation: "ask"; window_days: number };
  sort: number;
  payee_notice?: PayeeNotice;
};
export type MemberInstructionsMethod = {
  key: string;
  family: "instructions";
  label: string;
  method: string;
  instructions: Record<string, string>;
  sort: number;
};
export type MemberPaymentMethod = MemberProviderMethod | MemberZelleMethod | MemberInstructionsMethod;
export type MemberPaymentMethods = {
  environment: "sandbox" | "production";
  currency: string;
  online_unavailable: null | "offline_only" | "not_connected" | "test_mode";
  methods: MemberPaymentMethod[];
};

function stringsOnly(v: unknown): Record<string, string> | null {
  if (!isObj(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) {
    if (!isStr(x)) return null;
    out[k] = x;
  }
  return out;
}

/** Absent is fine (undefined); present must have the three fields, or the whole answer is not understood. */
function parseNotice(v: unknown): PayeeNotice | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (!isObj(v) || !isStr(v.changed_on) || !isInt(v.days) || !isStr(v.text)) return null;
  return { changed_on: v.changed_on, days: v.days, text: v.text };
}

function parseMemberMethod(v: unknown): MemberPaymentMethod | null | "skip" {
  if (!isObj(v) || !isStr(v.key) || !isStr(v.label) || !isInt(v.sort)) return null;
  if (v.family === "provider_checkout") {
    if ((v.provider !== "stripe" && v.provider !== "paypal") || !oneOf(v.mode, ["test", "live"] as const) || !strList(v.wallets) || !strList(v.also)) return null;
    const notice = parseNotice(v.payee_notice);
    if (notice === null) return null;
    return {
      key: v.key, family: "provider_checkout", label: v.label, provider: v.provider, mode: v.mode, wallets: v.wallets, also: v.also, sort: v.sort,
      ...(notice ? { payee_notice: notice } : {}),
    };
  }
  if (v.family === "reported_transfer") {
    const ins = stringsOnly(v.instructions);
    const r = v.report;
    if (!oneOf(v.mode, ["live", "rehearsal"] as const) || !ins || !isObj(r) || !isBool(r.available) || r.confirmation !== "ask" || !isInt(r.window_days)) return null;
    const instructions: MemberZelleMethod["instructions"] = {};
    if (ins.recipient !== undefined) instructions.recipient = ins.recipient;
    if (ins.name !== undefined) instructions.name = ins.name;
    if (ins.memo_hint !== undefined) instructions.memo_hint = ins.memo_hint;
    // A rehearsal never carries the real address; if it ever did, it is dropped here too.
    if (v.mode === "rehearsal") delete instructions.recipient;
    const notice = parseNotice(v.payee_notice);
    if (notice === null) return null;
    return {
      key: v.key, family: "reported_transfer", label: v.label, mode: v.mode, instructions,
      report: { available: r.available, confirmation: "ask", window_days: r.window_days }, sort: v.sort,
      // A rehearsal never shows the real details, so it never carries a notice about them either.
      ...(notice && v.mode !== "rehearsal" ? { payee_notice: notice } : {}),
    };
  }
  if (v.family === "instructions") {
    const ins = stringsOnly(v.instructions);
    if (!isStr(v.method) || !ins) return null;
    return { key: v.key, family: "instructions", label: v.label, method: v.method, instructions: ins, sort: v.sort };
  }
  // A family this code does not know yet (a newer database): left out, not guessed at.
  return isStr(v.family) ? "skip" : null;
}

export function parseMemberMethods(json: unknown): Parsed<MemberPaymentMethods> {
  if (!isObj(json) || !oneOf(json.environment, ["sandbox", "production"] as const) || !isStr(json.currency) || !Array.isArray(json.methods)
      || !(json.online_unavailable === null || oneOf(json.online_unavailable, ["offline_only", "not_connected", "test_mode"] as const))) {
    return { ok: false, error: UNEXPECTED_SHAPE };
  }
  const methods: MemberPaymentMethod[] = [];
  for (const m of json.methods) {
    const parsed = parseMemberMethod(m);
    if (parsed === null) return { ok: false, error: UNEXPECTED_SHAPE };
    if (parsed !== "skip") methods.push(parsed);
  }
  methods.sort((a, b) => a.sort - b.sort);
  return { ok: true, value: { environment: json.environment, currency: json.currency, online_unavailable: json.online_unavailable, methods } };
}

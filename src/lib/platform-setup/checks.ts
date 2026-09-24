// "Test" in the platform setup wizard: the background service calls each
// provider with the keys it will really use (saved in the wizard first, its
// environment second) and reports plain lines. Pure over an injected request,
// like src/lib/messaging/providers.ts; base URLs can point at local mocks:
//   RESEND_API_BASE, POSTMARK_API_BASE, STRIPE_API_BASE, PAYPAL_API_BASE,
//   PAYPAL_SANDBOX_API_BASE, TWILIO_API_BASE, ANTHROPIC_BASE_URL.
// A result never carries a key: every configured secret value is blanked out of
// the provider's answer before it is stored (app.jobs.result).

import { createDomain, verifyDomain, type DnsRecord, type Env, type Req } from "../messaging/providers";

import { SECRET_NAMES, type StepKey } from "./catalog";

export type CheckLine = { label: string; ok: boolean; detail: string };
export type StepTest = { ok: boolean; lines: CheckLine[]; records?: DnsRecord[]; domain?: string; domainStatus?: string };

const v = (env: Env, name: string) => (env[name] ?? "").trim();
const base = (env: Env, name: string, dflt: string) => (v(env, name) || dflt).replace(/\/+$/, "");

/** Blank out every configured secret value (and anything that looks like a bearer token). */
export function redactSecrets(text: string, env: Env): string {
  let out = text;
  for (const name of SECRET_NAMES) {
    const value = v(env, name);
    if (value.length >= 8) for (const part of value.split(",")) if (part.trim().length >= 8) out = out.split(part.trim()).join("[redacted]");
  }
  return out.replace(/\b(sk|rk)_(live|test)_[A-Za-z0-9]+/g, "[redacted]").replace(/\bsk-ant-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 400);
}

function providerMessage(text: string): string {
  try {
    const b = JSON.parse(text) as Record<string, unknown>;
    const e = b.error;
    const m = (e && typeof e === "object" ? (e as Record<string, unknown>).message : e) ?? b.message ?? b.Message ?? b.error_description;
    return typeof m === "string" ? m : "";
  } catch {
    return text.slice(0, 160);
  }
}

async function call(req: Req, env: Env, label: string, url: string, init: { method: string; headers: Record<string, string>; body?: string }, okDetail: (body: string) => string): Promise<CheckLine> {
  try {
    const r = await req(url, init);
    if (r.status >= 200 && r.status < 300) return { label, ok: true, detail: okDetail(r.text) };
    const why = providerMessage(r.text);
    const plain = r.status === 401 || r.status === 403 ? "the key was refused" : `the provider answered HTTP ${r.status}`;
    return { label, ok: false, detail: redactSecrets(`${plain}${why ? ` (${why})` : ""}`, env) };
  } catch (err) {
    return { label, ok: false, detail: redactSecrets(`could not reach the provider: ${err instanceof Error ? err.message : String(err)}`, env) };
  }
}

const missing = (label: string, names: string[]): CheckLine => ({ label, ok: false, detail: `not set (${names.join(", ")})` });
const json = (t: string): Record<string, unknown> => {
  try {
    const x = JSON.parse(t) as unknown;
    return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

async function testEmail(req: Req, env: Env): Promise<StepTest> {
  const provider = v(env, "MESSAGING_EMAIL_PROVIDER") === "postmark" ? "postmark" : "resend";
  const lines: CheckLine[] = [];
  const from = v(env, "MESSAGING_FROM_ADDRESS");
  const domain = from.includes("@") ? from.split("@").pop()!.toLowerCase() : "";
  let domainId: string | null = null;
  if (provider === "resend") {
    if (!v(env, "RESEND_API_KEY")) return { ok: false, lines: [missing("Resend API key", ["RESEND_API_KEY"])] };
    let listed: Record<string, unknown>[] = [];
    lines.push(await call(req, env, "Resend accepts the API key", `${base(env, "RESEND_API_BASE", "https://api.resend.com")}/domains`,
      { method: "GET", headers: { authorization: `Bearer ${v(env, "RESEND_API_KEY")}` } },
      (t) => {
        listed = (Array.isArray(json(t).data) ? json(t).data : []) as Record<string, unknown>[];
        return `${listed.length} sending domain${listed.length === 1 ? "" : "s"} on the account`;
      }));
    domainId = String(listed.find((d) => String(d.name ?? "").toLowerCase() === domain)?.id ?? "") || null;
  } else {
    if (!v(env, "POSTMARK_SERVER_TOKEN")) return { ok: false, lines: [missing("Postmark server token", ["POSTMARK_SERVER_TOKEN"])] };
    lines.push(await call(req, env, "Postmark accepts the server token", `${base(env, "POSTMARK_API_BASE", "https://api.postmarkapp.com")}/server`,
      { method: "GET", headers: { "x-postmark-server-token": v(env, "POSTMARK_SERVER_TOKEN"), accept: "application/json" } }, (t) => `server "${String(json(t).Name ?? "?")}"`));
    if (!v(env, "POSTMARK_ACCOUNT_TOKEN")) lines.push(missing("Postmark account token (for domains)", ["POSTMARK_ACCOUNT_TOKEN"]));
    else {
      let listed: Record<string, unknown>[] = [];
      lines.push(await call(req, env, "Postmark accepts the account token", `${base(env, "POSTMARK_API_BASE", "https://api.postmarkapp.com")}/domains?count=500&offset=0`,
        { method: "GET", headers: { "x-postmark-account-token": v(env, "POSTMARK_ACCOUNT_TOKEN"), accept: "application/json" } },
        (t) => {
          listed = (Array.isArray(json(t).Domains) ? json(t).Domains : []) as Record<string, unknown>[];
          return `${listed.length} sending domain${listed.length === 1 ? "" : "s"} on the account`;
        }));
      domainId = String(listed.find((d) => String(d.Name ?? "").toLowerCase() === domain)?.ID ?? "") || null;
    }
  }
  if (!domain) {
    lines.push(missing("Community Connect's sender address", ["MESSAGING_FROM_ADDRESS"]));
    return { ok: false, lines };
  }
  if (!lines.every((l) => l.ok)) return { ok: false, lines };
  // The platform's own sending domain: add it when missing, then read its DNS records and status.
  try {
    const state = domainId ? await verifyDomain(req, env, provider, domainId, domain) : await createDomain(req, env, provider, domain);
    const verified = state.status === "verified";
    lines.push({
      label: `Sending domain ${domain}`, ok: verified,
      detail: verified ? "verified" : `${domainId ? "waiting for DNS" : `added to ${provider === "resend" ? "Resend" : "Postmark"} just now`} — put the records below at the DNS provider of ${domain}, then test again`,
    });
    return { ok: lines.every((l) => l.ok), lines, records: state.records, domain, domainStatus: state.status };
  } catch (err) {
    lines.push({ label: `Sending domain ${domain}`, ok: false, detail: redactSecrets(err instanceof Error ? err.message : String(err), env) });
    return { ok: false, lines, domain };
  }
}

async function testPayments(req: Req, env: Env): Promise<StepTest> {
  const lines: CheckLine[] = [];
  const stripeBase = base(env, "STRIPE_API_BASE", "https://api.stripe.com");
  for (const [name, mode] of [["STRIPE_TEST_SECRET_KEY", "test"], ["STRIPE_SECRET_KEY", "live"]] as const) {
    if (!v(env, name)) continue;
    lines.push(await call(req, env, `Stripe ${mode} key`, `${stripeBase}/v1/balance`, { method: "GET", headers: { authorization: `Bearer ${v(env, name)}` } }, (t) => {
      const live = json(t).livemode;
      return typeof live === "boolean" && live !== (mode === "live") ? `accepted, but Stripe says it is a ${live ? "live" : "test"} key` : "accepted";
    }));
  }
  const anyStripe = v(env, "STRIPE_TEST_SECRET_KEY") || v(env, "STRIPE_SECRET_KEY") || v(env, "STRIPE_CLIENT_ID");
  if (anyStripe) {
    lines.push(v(env, "STRIPE_CLIENT_ID") ? { label: "Stripe Connect client id", ok: true, detail: "set (Stripe checks it when an organization connects)" } : missing("Stripe Connect client id", ["STRIPE_CLIENT_ID"]));
    lines.push(v(env, "STRIPE_WEBHOOK_SECRET") ? { label: "Stripe webhook secret", ok: true, detail: "set" } : missing("Stripe webhook secret", ["STRIPE_WEBHOOK_SECRET"]));
  }
  for (const [idName, secretName, mode, baseName, dflt] of [
    ["PAYPAL_SANDBOX_CLIENT_ID", "PAYPAL_SANDBOX_CLIENT_SECRET", "sandbox", "PAYPAL_SANDBOX_API_BASE", "https://api-m.sandbox.paypal.com"],
    ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "live", "PAYPAL_API_BASE", "https://api-m.paypal.com"],
  ] as const) {
    if (!v(env, idName) && !v(env, secretName)) continue;
    if (!v(env, idName) || !v(env, secretName)) {
      lines.push(missing(`PayPal ${mode} app`, [!v(env, idName) ? idName : secretName]));
      continue;
    }
    lines.push(await call(req, env, `PayPal ${mode} app`, `${base(env, baseName, dflt)}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${v(env, idName)}:${v(env, secretName)}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    }, () => "accepted"));
  }
  if (lines.length === 0) return { ok: false, lines: [{ label: "Payments", ok: false, detail: "no Stripe or PayPal keys are set" }] };
  lines.push(v(env, "OAUTH_STATE_SECRET").length >= 32 ? { label: "Connect-link signing secret", ok: true, detail: "set" } : missing("Connect-link signing secret", ["OAUTH_STATE_SECRET"]));
  return { ok: lines.every((l) => l.ok), lines };
}

async function testTexting(req: Req, env: Env): Promise<StepTest> {
  const sid = v(env, "TWILIO_ACCOUNT_SID");
  const token = v(env, "TWILIO_AUTH_TOKEN");
  if (!sid || !token) return { ok: false, lines: [missing("Twilio account", [...(sid ? [] : ["TWILIO_ACCOUNT_SID"]), ...(token ? [] : ["TWILIO_AUTH_TOKEN"])])] };
  const lines = [await call(req, env, "Twilio accepts the SID and token", `${base(env, "TWILIO_API_BASE", "https://api.twilio.com")}/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`,
    { method: "GET", headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` } },
    (t) => `account "${String(json(t).friendly_name ?? sid)}" is ${String(json(t).status ?? "active")}`)];
  lines.push(v(env, "TWILIO_FROM_NUMBER") || v(env, "TWILIO_MESSAGING_SERVICE_SID")
    ? { label: "Number to send from", ok: true, detail: v(env, "TWILIO_FROM_NUMBER") || "messaging service" }
    : missing("Number to send from", ["TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID"]));
  return { ok: lines.every((l) => l.ok), lines };
}

function testQuickbooks(env: Env): StepTest {
  const lines: CheckLine[] = [];
  const prod = !!(v(env, "INTUIT_CLIENT_ID") && v(env, "INTUIT_CLIENT_SECRET"));
  const dev = !!(v(env, "INTUIT_SANDBOX_CLIENT_ID") && v(env, "INTUIT_SANDBOX_CLIENT_SECRET"));
  lines.push(prod ? { label: "Intuit production keys", ok: true, detail: "set (Intuit checks them when an organization connects a real company)" }
    : { label: "Intuit production keys", ok: dev, detail: dev ? "not set: only Intuit sandbox companies can connect" : "not set (INTUIT_CLIENT_ID, INTUIT_CLIENT_SECRET)" });
  if (dev) lines.push({ label: "Intuit development keys", ok: true, detail: "set (for organizations' sandboxes)" });
  lines.push(v(env, "OAUTH_STATE_SECRET").length >= 32 ? { label: "Connect-link signing secret", ok: true, detail: "set" } : missing("Connect-link signing secret", ["OAUTH_STATE_SECRET"]));
  return { ok: lines.every((l) => l.ok), lines };
}

async function testAi(req: Req, env: Env): Promise<StepTest> {
  if (!v(env, "ANTHROPIC_API_KEY")) return { ok: false, lines: [missing("Anthropic API key", ["ANTHROPIC_API_KEY"])] };
  const line = await call(req, env, "Anthropic accepts the API key", `${base(env, "ANTHROPIC_BASE_URL", "https://api.anthropic.com")}/v1/models?limit=1`,
    { method: "GET", headers: { "x-api-key": v(env, "ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" } }, () => "accepted");
  return { ok: line.ok, lines: [line] };
}

function testPush(env: Env): StepTest {
  return {
    ok: true,
    lines: [{ label: "Expo push", ok: true, detail: v(env, "EXPO_ACCESS_TOKEN") ? "access token set (sent with every push)" : "no token: push is sent without one, which works unless enhanced push security is on" }],
  };
}

export async function testStep(step: StepKey, req: Req, env: Env): Promise<StepTest> {
  switch (step) {
    case "email":
      return testEmail(req, env);
    case "payments":
      return testPayments(req, env);
    case "texting":
      return testTexting(req, env);
    case "quickbooks":
      return testQuickbooks(env);
    case "ai":
      return testAi(req, env);
    case "push":
      return testPush(env);
    default:
      return { ok: false, lines: [{ label: step, ok: false, detail: "this step is checked by the portal, not the background service" }] };
  }
}

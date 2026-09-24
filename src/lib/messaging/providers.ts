// The provider APIs messaging talks to — Resend and Postmark (email, O7),
// Twilio (texts and WhatsApp), Expo (push) — as small functions over an
// injected `request`, so the worker (ctx.http: timeouts, retries, scrubbed
// errors) and the portal's Auth hooks (fetch) share one implementation.
//
// Base URLs come from env and default to the real services:
//   RESEND_API_BASE, POSTMARK_API_BASE, TWILIO_API_BASE, EXPO_PUSH_API_BASE.
// Tests point them at local mock servers; nothing here holds a key.

export type Env = Readonly<Record<string, string | undefined>>;
export type Req = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; text: string }>;

/** A provider answered with an error; `permanent` = retrying will not help (4xx other than 408/429). */
export class ProviderError extends Error {
  override name = "ProviderError";
  constructor(message: string, readonly status: number | null, readonly permanent: boolean) {
    super(message);
  }
}

/** Platform credentials that are missing (names only). */
export class MissingConfigError extends Error {
  override name = "MissingConfigError";
}

const base = (env: Env, name: string, dflt: string) => (env[name]?.trim() || dflt).replace(/\/+$/, "");
const has = (env: Env, name: string) => typeof env[name] === "string" && env[name]!.trim() !== "";

export function requireVars(env: Env, names: string[], what: string): void {
  const missing = names.filter((n) => !has(env, n));
  if (missing.length > 0) throw new MissingConfigError(`${what} isn't configured on the Community Connect server yet (${missing.join(", ")} not set)`);
}

function parse(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return {};
  }
}

function fail(provider: string, what: string, status: number, text: string): never {
  const body = parse(text);
  const msg = String(body.message ?? body.Message ?? body.error ?? body.name ?? text.slice(0, 200) ?? "").trim();
  const permanent = status >= 400 && status < 500 && status !== 408 && status !== 429;
  throw new ProviderError(`${provider} could not ${what} (HTTP ${status}${msg ? `: ${msg}` : ""})`, status, permanent);
}

// ── Email ────────────────────────────────────────────────────────────────────
export type EmailProvider = "resend" | "postmark";
export type OutgoingEmail = { from: string; to: string; subject: string; html: string; text: string; replyTo?: string | null; unsubscribeUrl?: string | null };

/** The platform key for a provider, unless the organization stored its own (vault) key. */
export function emailKey(env: Env, provider: EmailProvider, ownKey: string | null | undefined): string {
  if (ownKey) return ownKey;
  if (provider === "resend") {
    requireVars(env, ["RESEND_API_KEY"], "Email sending (Resend)");
    return env.RESEND_API_KEY!.trim();
  }
  requireVars(env, ["POSTMARK_SERVER_TOKEN"], "Email sending (Postmark)");
  return env.POSTMARK_SERVER_TOKEN!.trim();
}

export async function sendEmail(req: Req, env: Env, provider: EmailProvider, key: string, m: OutgoingEmail): Promise<{ id: string }> {
  const listUnsub = m.unsubscribeUrl ? { "List-Unsubscribe": `<${m.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : null;
  if (provider === "resend") {
    const r = await req(`${base(env, "RESEND_API_BASE", "https://api.resend.com")}/emails`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}), ...(listUnsub ? { headers: listUnsub } : {}) }),
    });
    if (r.status >= 300) fail("Resend", "send the email", r.status, r.text);
    const id = parse(r.text).id;
    if (typeof id !== "string") throw new ProviderError("Resend accepted the email but returned no id", r.status, false);
    return { id };
  }
  const r = await req(`${base(env, "POSTMARK_API_BASE", "https://api.postmarkapp.com")}/email`, {
    method: "POST",
    headers: { "x-postmark-server-token": key, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      From: m.from, To: m.to, Subject: m.subject, HtmlBody: m.html, TextBody: m.text, MessageStream: "outbound",
      ...(m.replyTo ? { ReplyTo: m.replyTo } : {}),
      ...(listUnsub ? { Headers: Object.entries(listUnsub).map(([Name, Value]) => ({ Name, Value })) } : {}),
    }),
  });
  const body = parse(r.text);
  if (r.status >= 300 || (typeof body.ErrorCode === "number" && body.ErrorCode !== 0)) fail("Postmark", "send the email", r.status >= 300 ? r.status : 422, r.text);
  return { id: String(body.MessageID ?? "") };
}

export type DnsRecord = { type: string; name: string; value: string; purpose: string; status: string; priority?: number | null };
export type DomainState = { providerDomainId: string; status: "pending" | "verified" | "failed"; records: DnsRecord[] };

/** DMARC is not issued by the providers; it is recommended alongside their records. */
export function dmarcRecord(domain: string): DnsRecord {
  return { type: "TXT", name: `_dmarc.${domain}`, value: "v=DMARC1; p=none;", purpose: "DMARC (recommended)", status: "recommended" };
}

function resendState(body: Record<string, unknown>, domain: string): DomainState {
  const records = (Array.isArray(body.records) ? body.records : []).map((r) => {
    const x = r as Record<string, unknown>;
    const record = String(x.record ?? "");
    return {
      type: String(x.type ?? ""), name: String(x.name ?? ""), value: String(x.value ?? ""),
      purpose: record === "SPF" ? (String(x.type) === "MX" ? "Return path (MX)" : "SPF") : record === "DKIM" ? "DKIM" : record || "Record",
      status: String(x.status ?? "pending"), priority: typeof x.priority === "number" ? x.priority : null,
    };
  });
  const s = String(body.status ?? "pending");
  return {
    providerDomainId: String(body.id ?? ""),
    status: s === "verified" ? "verified" : s === "failed" || s === "temporary_failure" ? "failed" : "pending",
    records: [...records, dmarcRecord(domain)],
  };
}

function postmarkState(body: Record<string, unknown>, domain: string): DomainState {
  const dkimHost = String(body.DKIMPendingHost || body.DKIMHost || "");
  const dkimValue = String(body.DKIMPendingTextValue || body.DKIMTextValue || "");
  const dkimOk = body.DKIMVerified === true;
  const rpOk = body.ReturnPathDomainVerified === true;
  const records: DnsRecord[] = [
    { type: "TXT", name: dkimHost, value: dkimValue, purpose: "DKIM", status: dkimOk ? "verified" : "pending" },
    { type: "CNAME", name: String(body.ReturnPathDomain ?? `pm-bounces.${domain}`), value: String(body.ReturnPathDomainCNAMEValue ?? "pm.mtasv.net"), purpose: "Return path", status: rpOk ? "verified" : "pending" },
    dmarcRecord(domain),
  ];
  return { providerDomainId: String(body.ID ?? ""), status: dkimOk && rpOk ? "verified" : "pending", records };
}

export async function createDomain(req: Req, env: Env, provider: EmailProvider, domain: string): Promise<DomainState> {
  if (provider === "resend") {
    requireVars(env, ["RESEND_API_KEY"], "Email sending (Resend)");
    const r = await req(`${base(env, "RESEND_API_BASE", "https://api.resend.com")}/domains`, {
      method: "POST", headers: { authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" },
      body: JSON.stringify({ name: domain }),
    });
    if (r.status >= 300) fail("Resend", `add ${domain}`, r.status, r.text);
    return resendState(parse(r.text), domain);
  }
  requireVars(env, ["POSTMARK_ACCOUNT_TOKEN"], "Email domains (Postmark)");
  const r = await req(`${base(env, "POSTMARK_API_BASE", "https://api.postmarkapp.com")}/domains`, {
    method: "POST", headers: { "x-postmark-account-token": env.POSTMARK_ACCOUNT_TOKEN!.trim(), accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ Name: domain, ReturnPathDomain: `pm-bounces.${domain}` }),
  });
  if (r.status >= 300) fail("Postmark", `add ${domain}`, r.status, r.text);
  return postmarkState(parse(r.text), domain);
}

/** Ask the provider to check the DNS again, then read the domain's state. */
export async function verifyDomain(req: Req, env: Env, provider: EmailProvider, id: string, domain: string): Promise<DomainState> {
  if (provider === "resend") {
    requireVars(env, ["RESEND_API_KEY"], "Email sending (Resend)");
    const b = base(env, "RESEND_API_BASE", "https://api.resend.com");
    const headers = { authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`, "content-type": "application/json" };
    const v = await req(`${b}/domains/${encodeURIComponent(id)}/verify`, { method: "POST", headers, body: "{}" });
    if (v.status >= 300) fail("Resend", `check ${domain}`, v.status, v.text);
    const r = await req(`${b}/domains/${encodeURIComponent(id)}`, { method: "GET", headers });
    if (r.status >= 300) fail("Resend", `read ${domain}`, r.status, r.text);
    return resendState(parse(r.text), domain);
  }
  requireVars(env, ["POSTMARK_ACCOUNT_TOKEN"], "Email domains (Postmark)");
  const b = base(env, "POSTMARK_API_BASE", "https://api.postmarkapp.com");
  const headers = { "x-postmark-account-token": env.POSTMARK_ACCOUNT_TOKEN!.trim(), accept: "application/json", "content-type": "application/json" };
  for (const what of ["verifyDkim", "verifyReturnPath"]) {
    const v = await req(`${b}/domains/${encodeURIComponent(id)}/${what}`, { method: "PUT", headers, body: "{}" });
    if (v.status >= 300) fail("Postmark", `check ${domain}`, v.status, v.text);
  }
  const r = await req(`${b}/domains/${encodeURIComponent(id)}`, { method: "GET", headers });
  if (r.status >= 300) fail("Postmark", `read ${domain}`, r.status, r.text);
  return postmarkState(parse(r.text), domain);
}

// ── Texts and WhatsApp (Twilio) ──────────────────────────────────────────────
export type OutgoingText = { to: string; body: string; from?: string | null; messagingServiceSid?: string | null; statusCallback?: string | null; whatsapp?: boolean };

export async function sendTwilio(req: Req, env: Env, m: OutgoingText): Promise<{ sid: string; status: string }> {
  requireVars(env, ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], "Texting (Twilio)");
  const sid = env.TWILIO_ACCOUNT_SID!.trim();
  const form = new URLSearchParams();
  form.set("To", m.whatsapp ? `whatsapp:${m.to}` : m.to);
  if (m.whatsapp) form.set("From", `whatsapp:${m.from ?? ""}`);
  else if (m.messagingServiceSid) form.set("MessagingServiceSid", m.messagingServiceSid);
  else if (m.from) form.set("From", m.from);
  else throw new ProviderError("No number to text from: the texting registration has no approved number yet", null, true);
  form.set("Body", m.body);
  if (m.statusCallback) form.set("StatusCallback", m.statusCallback);
  const r = await req(`${base(env, "TWILIO_API_BASE", "https://api.twilio.com")}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN!.trim()}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (r.status >= 300) fail("Twilio", m.whatsapp ? "send the WhatsApp message" : "send the text", r.status, r.text);
  const body = parse(r.text);
  return { sid: String(body.sid ?? ""), status: String(body.status ?? "queued") };
}

// ── Push (Expo) ──────────────────────────────────────────────────────────────
export type PushTicket = { token: string; ok: boolean; id?: string; error?: string; dead: boolean };

export async function sendExpoPush(req: Req, env: Env, tokens: string[], title: string | null, body: string, data: Record<string, unknown>): Promise<PushTicket[]> {
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (has(env, "EXPO_ACCESS_TOKEN")) headers.authorization = `Bearer ${env.EXPO_ACCESS_TOKEN!.trim()}`;
  const r = await req(`${base(env, "EXPO_PUSH_API_BASE", "https://exp.host")}/--/api/v2/push/send`, {
    method: "POST", headers,
    body: JSON.stringify(tokens.map((to) => ({ to, ...(title ? { title } : {}), body, data, sound: "default" }))),
  });
  if (r.status >= 300) fail("Expo push", "send the notification", r.status, r.text);
  const tickets = parse(r.text).data;
  const list = Array.isArray(tickets) ? tickets : [];
  return tokens.map((token, i) => {
    const t = (list[i] ?? {}) as Record<string, unknown>;
    const details = (t.details ?? {}) as Record<string, unknown>;
    const ok = t.status === "ok";
    return { token, ok, id: typeof t.id === "string" ? t.id : undefined, error: ok ? undefined : String(t.message ?? "no ticket"), dead: details.error === "DeviceNotRegistered" };
  });
}

// ── Inbound provider events → one shape ──────────────────────────────────────
export type EmailEvent = { providerRef: string; event: "delivered" | "opened" | "bounced" | "complained" | "delayed"; address: string | null; detail: string | null };

/** A Resend (Svix) webhook body, or a Postmark webhook body, as an email event (null = not one we track). */
export function emailEvent(provider: EmailProvider, payload: Record<string, unknown>): EmailEvent | null {
  if (provider === "resend") {
    const type = String(payload.type ?? "");
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const map: Record<string, EmailEvent["event"]> = {
      "email.delivered": "delivered", "email.opened": "opened", "email.bounced": "bounced",
      "email.complained": "complained", "email.delivery_delayed": "delayed",
    };
    const ev = map[type];
    if (!ev || typeof data.email_id !== "string") return null;
    const to = Array.isArray(data.to) ? String(data.to[0] ?? "") : typeof data.to === "string" ? data.to : null;
    const bounce = (data.bounce ?? {}) as Record<string, unknown>;
    return { providerRef: data.email_id, event: ev, address: to || null, detail: typeof bounce.message === "string" ? bounce.message : type };
  }
  const rt = String(payload.RecordType ?? "");
  const map: Record<string, EmailEvent["event"]> = { Delivery: "delivered", Open: "opened", Bounce: "bounced", SpamComplaint: "complained" };
  const ev = map[rt];
  if (!ev || payload.MessageID === undefined) return null;
  // Soft bounces (e.g. a full mailbox) are not suppressed.
  if (ev === "bounced" && payload.Inactive === false) return { providerRef: String(payload.MessageID), event: "delayed", address: String(payload.Email ?? payload.Recipient ?? ""), detail: String(payload.Description ?? "soft bounce") };
  return { providerRef: String(payload.MessageID), event: ev, address: String(payload.Email ?? payload.Recipient ?? "") || null, detail: String(payload.Description ?? payload.Details ?? rt) };
}

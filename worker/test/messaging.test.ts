import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NotConfiguredError, PermanentError } from "../src/errors";
import { createHttp } from "../src/http";
import * as domainVerify from "../src/handlers/messaging.domain_verify";
import * as send from "../src/handlers/messaging.send";
import * as webhookEmail from "../src/handlers/messaging.webhook.email";
import * as webhookTwilio from "../src/handlers/messaging.webhook.twilio";
import { HANDLERS } from "../src/handlers";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

// The same local mock the e2e flow uses (e2e/mock-providers.cjs): no network, fake keys.
const require_ = createRequire(import.meta.url);
const { createMockProviders } = require_("../../e2e/mock-providers.cjs") as {
  createMockProviders: () => { server: import("node:http").Server; state: { inbox: Record<string, unknown>[]; verified: Set<string> } };
};
const mock = createMockProviders();
let baseUrl = "";
beforeAll(async () => {
  await new Promise<void>((r) => mock.server.listen(0, "127.0.0.1", () => r()));
  baseUrl = `http://127.0.0.1:${(mock.server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => mock.server.close(() => r())));
beforeEach(() => {
  mock.state.inbox.length = 0;
});

const env = () => ({
  RESEND_API_KEY: "re_test_fake", RESEND_API_BASE: baseUrl, POSTMARK_API_BASE: baseUrl, POSTMARK_SERVER_TOKEN: "pm_fake",
  POSTMARK_ACCOUNT_TOKEN: "pma_fake", TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", TWILIO_API_BASE: baseUrl,
  EXPO_PUSH_API_BASE: baseUrl, MESSAGING_FROM_ADDRESS: "no-reply@mail.cc.test", PORTAL_PUBLIC_URL: "https://portal.test",
  MESSAGING_LINK_SECRET: "link-secret", SUPABASE_URL: "https://db.test",
});

type Row = Record<string, unknown>;
function ctxWith(message: Row, over: Record<string, string | undefined> = {}, j = job({ kind: "messaging.send", payload: { message_id: "m1" } })) {
  const { db, calls } = fakeDb({
    query: (text) => (text.includes("worker_message_to_send") ? [{ m: message }] : []),
  });
  const { log } = captureLog();
  const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env: { ...env(), ...over }, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
  return { ctx, calls, j };
}
const results = (calls: { fn: string; args: unknown[] }[]) =>
  calls.filter((c) => c.fn === "query" && String(c.args[0]).includes("worker_message_result")).map((c) => c.args[1] as unknown[]);

const base = {
  id: "m1", center_id: "c1", purpose: "notification", subject: "Hello", body: "Line one.\n\nVisit https://jsh.test/x <b>", sandbox: false,
  skip: null, payload: {}, brand: { name: "Jain Society", short_name: "JSH", logo_path: "c1/logo.png", primary_color: "#123456", public_email: "office@jsh.test" },
};

describe("messaging.send", () => {
  it("sends an email through Resend with the brand, escaped text, footer and unsubscribe link", async () => {
    const { ctx, calls, j } = ctxWith({ ...base, channel: "email", to: "priya@example.com",
      route: { provider: "resend", sender: { from_name: "JSH Office", from_address: "office@mail.jsh.test", reply_to: "office@jsh.test" }, footer: { postal_address: "1 Temple Rd", note: null }, unsubscribe: true } });
    const out = await send.run(j, ctx);
    expect(out).toMatchObject({ status: "sent", provider: "resend" });
    const m = mock.state.inbox[0]!;
    expect(m).toMatchObject({ provider: "resend", to: "priya@example.com", from: '"JSH Office" <office@mail.jsh.test>', reply_to: "office@jsh.test" });
    expect(String(m.html)).toContain("&lt;b&gt;");
    expect(String(m.html)).toContain("1 Temple Rd");
    expect(String(m.html)).toContain("https://db.test/storage/v1/object/public/branding/c1/logo.png");
    expect(String(m.html)).toMatch(/https:\/\/portal\.test\/api\/messaging\/unsubscribe\?m=m1&amp;s=/);
    expect((m.headers as Record<string, string>)["List-Unsubscribe"]).toContain("/api/messaging/unsubscribe?m=m1");
    expect(results(calls)[0]).toEqual(["m1", "sent", "resend", m.id, null, null]);
  });

  it("puts the sandbox banner on a sandbox email and uses Community Connect's address without a verified sender", async () => {
    const { ctx, j } = ctxWith({ ...base, sandbox: true, subject: "[Sandbox · test data] Hi", channel: "email", to: "t@example.com",
      route: { provider: "postmark", sender: null, footer: null, unsubscribe: false } });
    await send.run(j, ctx);
    const m = mock.state.inbox[0]!;
    expect(m.provider).toBe("postmark");
    expect(m.subject).toBe("[Sandbox · test data] Hi");
    expect(String(m.html)).toContain("Sandbox · test data");
    expect(m.from).toBe('"Jain Society via Community Connect" <no-reply@mail.cc.test>');
    expect(m.reply_to).toBe("office@jsh.test");
  });

  it("fails honestly, without retrying, when the platform email key is missing", async () => {
    const { ctx, calls, j } = ctxWith({ ...base, channel: "email", to: "p@example.com", route: { provider: "resend", sender: null, unsubscribe: false } }, { RESEND_API_KEY: undefined });
    const err = await send.run(j, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotConfiguredError);
    expect((err as Error).message).toBe("Email sending (Resend) isn't configured on the Community Connect server yet (RESEND_API_KEY not set)");
    expect(results(calls)[0]?.[1]).toBe("failed");
  });

  it("a provider refusal is permanent and recorded", async () => {
    const { ctx, calls, j } = ctxWith({ ...base, channel: "email", to: "reject@example.com", route: { provider: "resend", sender: null, unsubscribe: false } });
    await expect(send.run(j, ctx)).rejects.toBeInstanceOf(PermanentError);
    expect(String(results(calls)[0]?.[4])).toContain("Resend could not send the email (HTTP 422");
  });

  it("texts through Twilio with the approved number, the status callback and the segment count", async () => {
    const { ctx, calls, j } = ctxWith({ ...base, channel: "sms", to: "+17135550100", body: "Sandbox · test data: JSH: your code is 123456",
      route: { provider: "twilio", connected: true, from_number: "+18325550100", messaging_service_sid: null } });
    await send.run(j, ctx);
    expect(mock.state.inbox[0]).toMatchObject({ provider: "twilio", channel: "sms", to: "+17135550100", from: "+18325550100", status_callback: "https://portal.test/api/webhooks/twilio" });
    expect(results(calls)[0]?.[5]).toBe(1);
  });

  it("refuses to text before the registration is approved", async () => {
    const { ctx, calls, j } = ctxWith({ ...base, channel: "sms", to: "+17135550100", route: { provider: "twilio", connected: false } });
    await expect(send.run(j, ctx)).rejects.toThrow(/registration is not approved/);
    expect(results(calls)[0]?.[1]).toBe("failed");
    expect(mock.state.inbox).toHaveLength(0);
  });

  it("refuses WhatsApp until Meta approved it", async () => {
    const { ctx, j } = ctxWith({ ...base, channel: "whatsapp", to: "+17135550100", route: { provider: "twilio", approved: false, from_number: "+18325550101" } });
    await expect(send.run(j, ctx)).rejects.toThrow(/not approved by Meta yet/);
  });

  it("pushes through Expo and marks dead tokens", async () => {
    const { ctx, calls, j } = ctxWith({ ...base, channel: "push", to: "u1", route: { provider: "expo_push", tokens: ["ExponentPushToken[good1234]", "ExponentPushToken[Dead5678]"] } });
    const out = await send.run(j, ctx);
    expect(out).toMatchObject({ status: "sent", phones: 1, dead: 1 });
    const dead = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("worker_push_result"));
    expect((dead?.args[1] as unknown[])[1]).toEqual(["ExponentPushToken[Dead5678]"]);
  });

  it("records a skip (suppressed after queuing) without calling a provider", async () => {
    const { ctx, calls, j } = ctxWith({ ...base, channel: "email", to: "x@example.com", skip: "Not sent: x was suppressed (bounce) after it was queued.", route: {} });
    expect(await send.run(j, ctx)).toMatchObject({ status: "suppressed" });
    expect(results(calls)[0]?.[1]).toBe("suppressed");
    expect(mock.state.inbox).toHaveLength(0);
  });
});

describe("messaging.domain_verify", () => {
  it("adds the domain at Resend, stores its DNS records (plus DMARC), then verifies once DNS is in place", async () => {
    const stored: unknown[][] = [];
    let providerId: string | null = null;
    const { db } = fakeDb({
      query: (text, params) => {
        if (text.includes("worker_email_domain(")) return [{ d: { id: "d1", domain: "mail.jsh.test", provider: "resend", provider_domain_id: providerId, status: "pending" } }];
        if (text.includes("worker_email_domain_result")) { stored.push(params); providerId = params[1] as string; }
        return [];
      },
    });
    const { log } = captureLog();
    const mk = (payload: Record<string, unknown>) => {
      const j = job({ kind: "messaging.domain_verify", payload });
      return { j, ctx: jobContext({ db, reg: createRegistry(HANDLERS), env: env(), http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log) };
    };
    let r = mk({ domain_id: "d1", action: "create" });
    expect(await domainVerify.run(r.j, r.ctx)).toMatchObject({ status: "pending" });
    const records = JSON.parse(String(stored[0]![2])) as { purpose: string; name: string }[];
    expect(records.map((x) => x.purpose)).toEqual(["Return path (MX)", "SPF", "DKIM", "DMARC (recommended)"]);
    expect(records[3]!.name).toBe("_dmarc.mail.jsh.test");
    mock.state.verified.add("mail.jsh.test");
    r = mk({ domain_id: "d1", action: "verify" });
    expect(await domainVerify.run(r.j, r.ctx)).toMatchObject({ status: "verified" });
    expect(stored[1]![3]).toBe("verified");
  });
  it("is not configured without an email provider key", () => {
    expect(domainVerify.configured({})).toMatchObject({ configured: false });
  });
});

describe("webhooks", () => {
  it("a Resend bounce becomes a bounce event for the message", async () => {
    const calls: unknown[][] = [];
    const { db } = fakeDb({
      query: (text, params) => {
        calls.push([text, params]);
        if (text.includes("worker_webhook_event")) return [{ e: { id: "e1", provider: "resend", processed_at: null,
          payload: { type: "email.bounced", data: { email_id: "re_1", to: ["gone@example.com"], bounce: { message: "Mailbox does not exist" } } } } }];
        return [{ r: { suppression_id: "s1" } }];
      },
    });
    const { log } = captureLog();
    const j = job({ kind: "messaging.webhook.email", payload: { event_id: "e1" } });
    const out = await webhookEmail.run(j, jobContext({ db, reg: createRegistry(HANDLERS), env: {}, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log));
    expect(out).toMatchObject({ event: "bounced" });
    const rec = calls.find((c) => String(c[0]).includes("worker_record_email_event"))!;
    expect(rec[1]).toEqual(["resend", "re_1", "bounced", "gone@example.com", "Mailbox does not exist"]);
    expect(calls.some((c) => String(c[0]).includes("worker_webhook_done"))).toBe(true);
  });

  it("an inbound STOP is recorded and its confirmation sent", async () => {
    const { db } = fakeDb({
      query: (text) => {
        if (text.includes("worker_webhook_event")) return [{ e: { id: "e2", provider: "twilio", processed_at: null, payload: { From: "+17135550191", To: "+18325550100", Body: "STOP", MessageSid: "SMin" } } }];
        if (text.includes("worker_record_inbound_sms")) return [{ r: { keyword: "stop", reply_message_id: "r1" } }];
        if (text.includes("worker_message_to_send")) return [{ m: { ...base, id: "r1", channel: "sms", to: "+17135550191", body: "JSH: You are unsubscribed", payload: { keyword_reply: true, reply_from: "+18325550100" }, route: { connected: true } } }];
        return [];
      },
    });
    const { log } = captureLog();
    const j = job({ kind: "messaging.webhook.twilio", payload: { event_id: "e2" } });
    const out = await webhookTwilio.run(j, jobContext({ db, reg: createRegistry(HANDLERS), env: env(), http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log));
    expect(out).toMatchObject({ keyword: "stop", reply: { status: "sent" } });
    expect(mock.state.inbox[0]).toMatchObject({ channel: "sms", to: "+17135550191", from: "+18325550100" });
  });
});

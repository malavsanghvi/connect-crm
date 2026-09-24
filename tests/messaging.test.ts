import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { brandingUrl, escapeHtml, fromHeader, renderEmail } from "@/lib/messaging/email";
import { domainStatus, hour12, messageStatus, parseTextingDetail, registrationStatus } from "@/lib/messaging/labels";
import { MissingConfigError, emailEvent, emailKey } from "@/lib/messaging/providers";
import {
  linkSignature,
  signStandardWebhook,
  twilioSignature,
  unsubscribeUrl,
  verifyBasicToken,
  verifyLink,
  verifyStandardWebhook,
  verifyTwilio,
} from "@/lib/messaging/signatures";
import { smsKeyword, smsLength, smsLengthText } from "@/lib/messaging/sms";
import { isPublicPath } from "@/lib/supabase/proxy";

describe("SMS segments", () => {
  it("counts GSM-7 at 160, then 153 per segment; extension characters count twice", () => {
    expect(smsLength("a".repeat(160))).toMatchObject({ encoding: "gsm7", segments: 1 });
    expect(smsLength("a".repeat(161))).toMatchObject({ encoding: "gsm7", segments: 2 });
    expect(smsLength("a".repeat(306))).toMatchObject({ segments: 2 });
    expect(smsLength("a".repeat(307))).toMatchObject({ segments: 3 });
    expect(smsLength("{}").units).toBe(4);
    expect(smsLength("€".repeat(80))).toMatchObject({ encoding: "gsm7", units: 160, segments: 1 });
  });
  it("Gujarati and Hindi are Unicode: 70, then 67", () => {
    expect(smsLength("જ".repeat(70))).toMatchObject({ encoding: "ucs2", segments: 1 });
    expect(smsLength("जय".repeat(36))).toMatchObject({ encoding: "ucs2", segments: 2 });
    expect(smsLength("Sandbox · test data: hi")).toMatchObject({ encoding: "ucs2", unicodeChars: ["·"] });
    expect(smsLengthText("Hello")).toBe("1 segment · 5 of 160 characters");
    expect(smsLengthText("Jai Jinendra 🙏")).toMatch(/^1 segment · Unicode, 15 of 70 characters \(because of “🙏”\)$/);
  });
  it("recognises STOP, START and HELP keywords", () => {
    expect(smsKeyword(" stop ")).toBe("stop");
    expect(smsKeyword("Unsubscribe")).toBe("stop");
    expect(smsKeyword("START")).toBe("start");
    expect(smsKeyword("help!")).toBe("help");
    expect(smsKeyword("stop by the temple")).toBeNull();
  });
});

describe("email rendering", () => {
  const brand = { name: "Jain Society of Houston", short_name: "JSH", primary_color: "#1B2C5C", logo_url: null };
  it("escapes the text so a template value cannot inject HTML, and links bare URLs", () => {
    const r = renderEmail({ subject: "Hi", body: "Hello <script>alert(1)</script>\n\nSee https://jsh.test/e/1.", brand, sandbox: false });
    expect(r.html).not.toContain("<script>");
    expect(r.html).toContain("&lt;script&gt;");
    expect(r.html).toContain('<a href="https://jsh.test/e/1"');
    expect(r.text).toContain("Hello <script>");
  });
  it("adds the sandbox banner and subject prefix once", () => {
    const r = renderEmail({ subject: "Code", body: "x", brand, sandbox: true });
    expect(r.subject).toBe("[Sandbox · test data] Code");
    expect(r.html).toContain("Sandbox · test data");
    expect(renderEmail({ subject: "[Sandbox · test data] Code", body: "x", brand, sandbox: true }).subject).toBe("[Sandbox · test data] Code");
  });
  it("puts the postal address and the unsubscribe link in the footer", () => {
    const r = renderEmail({ subject: "N", body: "x", brand, footer: { postal_address: "1 Temple Rd", note: null }, sandbox: false, unsubscribeUrl: "https://p.test/u?m=1&s=2" });
    expect(r.html).toContain("1 Temple Rd");
    expect(r.html).toContain("https://p.test/u?m=1&amp;s=2");
    expect(r.text).toContain("Unsubscribe: https://p.test/u?m=1&s=2");
  });
  it("never uses an unsafe brand color", () => {
    expect(renderEmail({ subject: "s", body: "b", brand: { ...brand, primary_color: "red;background:url(x)" }, sandbox: false }).html).not.toContain("url(x)");
  });
  it("sends from the center's sender, else Community Connect's address in the center's name", () => {
    const platform = { address: "no-reply@cc.test", name: "Community Connect" };
    expect(fromHeader({ from_name: 'JSH "Office"', from_address: "office@mail.jsh.test" }, brand, platform)).toBe('"JSH Office" <office@mail.jsh.test>');
    expect(fromHeader(null, brand, platform)).toBe('"Jain Society of Houston via Community Connect" <no-reply@cc.test>');
    expect(fromHeader(null, null, platform)).toBe('"Community Connect" <no-reply@cc.test>');
  });
  it("builds public branding URLs", () => {
    expect(brandingUrl("https://x.supabase.co/", "c1/logo mark.png")).toBe("https://x.supabase.co/storage/v1/object/public/branding/c1/logo%20mark.png");
    expect(brandingUrl(null, "a")).toBeNull();
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
});

describe("signatures", () => {
  const secret = "v1,whsec_" + Buffer.from("super-secret-hook-key").toString("base64");
  it("verifies Supabase/Svix standard webhooks and refuses tampering, old timestamps and missing headers", () => {
    const now = 1_790_000_000;
    const body = '{"user":{"email":"a@b.test"}}';
    const sig = signStandardWebhook(secret, "msg_1", now, body);
    expect(verifyStandardWebhook(secret, { id: "msg_1", timestamp: String(now), signature: `v1,wrong ${sig}` }, body, now)).toEqual({ ok: true });
    expect(verifyStandardWebhook(secret, { id: "msg_1", timestamp: String(now), signature: sig }, body + " ", now).ok).toBe(false);
    expect(verifyStandardWebhook(secret, { id: "msg_1", timestamp: String(now - 600), signature: sig }, body, now)).toMatchObject({ ok: false, reason: expect.stringContaining("5-minute") });
    expect(verifyStandardWebhook(secret, { id: null, timestamp: String(now), signature: sig }, body, now).ok).toBe(false);
  });
  it("verifies Twilio's signature over the URL and sorted parameters", () => {
    const params = { To: "+18005551212", CallSid: "CA1234567890ABCDE", Digits: "1234", From: "+12349013030" };
    const url = "https://example.com/myapp.php?foo=1&bar=2";
    // Twilio's algorithm: the URL, then each parameter name and value in name order, HMAC-SHA1, base64.
    const expected = createHmac("sha1", "12345").update(url + "CallSidCA1234567890ABCDEDigits1234From+12349013030To+18005551212").digest("base64");
    expect(twilioSignature("12345", url, params)).toBe(expected);
    expect(verifyTwilio("12345", url, params, expected).ok).toBe(true);
    expect(verifyTwilio("12345", url, { ...params, Digits: "9" }, expected).ok).toBe(false);
  });
  it("checks Postmark's Basic credentials and unsubscribe links", () => {
    expect(verifyBasicToken("tok", "Basic " + Buffer.from("postmark:tok").toString("base64")).ok).toBe(true);
    expect(verifyBasicToken("tok", "Basic " + Buffer.from("postmark:nope").toString("base64")).ok).toBe(false);
    expect(verifyLink("k", "m1", linkSignature("k", "m1"))).toBe(true);
    expect(verifyLink("k", "m2", linkSignature("k", "m1"))).toBe(false);
    expect(unsubscribeUrl("https://p.test/", "k", "m1")).toBe(`https://p.test/api/messaging/unsubscribe?m=m1&s=${linkSignature("k", "m1")}`);
    expect(unsubscribeUrl(null, "k", "m1")).toBeNull();
  });
});

describe("providers", () => {
  it("names the missing platform variable instead of pretending", () => {
    expect(() => emailKey({}, "resend", null)).toThrow(MissingConfigError);
    expect(() => emailKey({}, "postmark", null)).toThrow("Email sending (Postmark) isn't configured on the Community Connect server yet (POSTMARK_SERVER_TOKEN not set)");
    expect(emailKey({ RESEND_API_KEY: " re_x " }, "resend", null)).toBe("re_x");
  });
  it("reads Resend and Postmark events into one shape; soft bounces are not suppressed", () => {
    expect(emailEvent("resend", { type: "email.bounced", data: { email_id: "e1", to: ["a@b.test"], bounce: { message: "No such user" } } })).toEqual({
      providerRef: "e1", event: "bounced", address: "a@b.test", detail: "No such user",
    });
    expect(emailEvent("resend", { type: "email.sent", data: { email_id: "e1" } })).toBeNull();
    expect(emailEvent("postmark", { RecordType: "SpamComplaint", MessageID: "p1", Email: "a@b.test" })).toMatchObject({ event: "complained" });
    expect(emailEvent("postmark", { RecordType: "Bounce", MessageID: "p2", Email: "a@b.test", Inactive: false, Description: "Mailbox full" })).toMatchObject({ event: "delayed" });
    expect(emailEvent("postmark", { RecordType: "Bounce", MessageID: "p3", Email: "a@b.test", Inactive: true })).toMatchObject({ event: "bounced" });
  });
});

describe("labels", () => {
  it("says plainly where each thing stands", () => {
    expect(domainStatus("pending").label).toBe("Waiting for DNS");
    expect(messageStatus("suppressed").label).toBe("Not sent (suppressed)");
    expect(registrationStatus(undefined).label).toBe("Not started");
    expect(registrationStatus("submitted").label).toBe("Submitted · waiting for the carriers");
    expect(hour12(21)).toBe("9 PM");
    expect(hour12(0)).toBe("12 AM");
  });
  it("turns the registration form into its detail, dropping blanks", () => {
    const fd = new Map<string, string>([["legal_name", " JSH "], ["ein", "12-3456789"], ["sample_1", "a"], ["sample_2", ""], ["sample_3", "c"], ["website", ""]]);
    expect(parseTextingDetail({ get: (k) => fd.get(k) ?? null })).toEqual({ legal_name: "JSH", ein: "123456789", samples: ["a", "c"] });
  });
  it("keeps the hooks, webhooks and unsubscribe links reachable without a session", () => {
    expect(isPublicPath("/api/auth-hooks/send-email")).toBe(true);
    expect(isPublicPath("/api/webhooks/twilio")).toBe(true);
    expect(isPublicPath("/api/messaging/unsubscribe")).toBe(true);
    expect(isPublicPath("/settings/email")).toBe(false);
  });
});

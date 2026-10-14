import { describe, expect, it } from "vitest";

import { MAX_ATTACHMENT_BYTES, ProviderError, attachmentBytes, sendEmail, type EmailAttachment, type Req } from "@/lib/messaging/providers";

// Email attachments (pledge PDFs): the same file goes to Resend and to Postmark in each one's own fields, never silently dropped,
// and a message that carries too much is refused before anything is sent.

const FILE: EmailAttachment = { filename: "Pledge-PL-1.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.7 hello").toString("base64") };
const MAIL = { from: "Club <office@club.test>", to: "a@b.test", subject: "Your pledge", html: "<p>Hi</p>", text: "Hi" };

function recorder(response: { status: number; text: string }) {
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const req: Req = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
    return response;
  };
  return { req, sent };
}

describe("sending an email with a file", () => {
  it("Resend gets it as attachments with filename, base64 content and its type", async () => {
    const { req, sent } = recorder({ status: 200, text: JSON.stringify({ id: "re_1" }) });
    await sendEmail(req, { RESEND_API_BASE: "https://resend.test" }, "resend", "key", { ...MAIL, attachments: [FILE] });
    expect(sent[0]?.url).toBe("https://resend.test/emails");
    expect(sent[0]?.body.attachments).toEqual([{ filename: "Pledge-PL-1.pdf", content: FILE.content, content_type: "application/pdf" }]);
  });

  it("Postmark gets it as Attachments with Name, Content and ContentType", async () => {
    const { req, sent } = recorder({ status: 200, text: JSON.stringify({ MessageID: "pm-1", ErrorCode: 0 }) });
    await sendEmail(req, { POSTMARK_API_BASE: "https://pm.test" }, "postmark", "key", { ...MAIL, attachments: [FILE] });
    expect(sent[0]?.body.Attachments).toEqual([{ Name: "Pledge-PL-1.pdf", Content: FILE.content, ContentType: "application/pdf" }]);
  });

  it("without a file the request is exactly what it was before (no attachments field at all)", async () => {
    const a = recorder({ status: 200, text: JSON.stringify({ id: "re_1" }) });
    await sendEmail(a.req, {}, "resend", "key", MAIL);
    expect("attachments" in (a.sent[0]?.body ?? {})).toBe(false);
    const b = recorder({ status: 200, text: JSON.stringify({ MessageID: "pm-1", ErrorCode: 0 }) });
    await sendEmail(b.req, {}, "postmark", "key", { ...MAIL, attachments: [] });
    expect("Attachments" in (b.sent[0]?.body ?? {})).toBe(false);
  });

  it("weighs a file once decoded, and refuses a message that carries more than it may, before calling the provider", async () => {
    expect(attachmentBytes([FILE])).toBe(Buffer.from("%PDF-1.7 hello").length);
    expect(attachmentBytes(null)).toBe(0);
    const heavy: EmailAttachment = { filename: "big.pdf", contentType: "application/pdf", content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64") };
    const { req, sent } = recorder({ status: 200, text: "{}" });
    const err = await sendEmail(req, {}, "resend", "key", { ...MAIL, attachments: [heavy] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).permanent).toBe(true);
    expect(sent).toHaveLength(0);
  });
});

import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";

import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PermanentError } from "../src/errors";
import { createHttp } from "../src/http";
import * as send from "../src/handlers/messaging.send";
import { HANDLERS } from "../src/handlers";
import { attachmentSpecs, buildAttachments } from "../src/message-attachments";
import { DEMO_REFUSAL } from "../src/messaging";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

// A pledge email carries the pledge's PDF. The message names the file by id only; this service draws it when the message is sent,
// with the same code the portal's Print route runs, and hands it to the provider (Resend or Postmark) as base64.

const require_ = createRequire(import.meta.url);
const { createMockProviders } = require_("../../e2e/mock-providers.cjs") as {
  createMockProviders: () => { server: import("node:http").Server; state: { inbox: Record<string, unknown>[] } };
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

const AUTO = "17000000-0000-4000-8000-0000000000aa";
const PLEDGE = "17000000-0000-4000-8000-0000000000bb";

const env = () => ({
  RESEND_API_KEY: "re_test_fake", RESEND_API_BASE: baseUrl, POSTMARK_API_BASE: baseUrl, POSTMARK_SERVER_TOKEN: "pm_fake",
  MESSAGING_FROM_ADDRESS: "no-reply@mail.cc.test", PORTAL_PUBLIC_URL: "https://portal.test", MESSAGING_LINK_SECRET: "link-secret",
  // The community's logo is looked for here: the mock answers 401 for it, so the PDF falls back to the community's name.
  SUPABASE_URL: baseUrl,
});

const doc = {
  center: { id: "c1", name: "Riverside Community Center", currency: "USD", time_zone: "America/Chicago", country: "US", languages: ["en"], branding: { logo_path: "c1/brand/logo.png" } },
  organization: { public_email: "office@riverside.example" },
  pledge: { id: PLEDGE, number: "PL-0455", status: "open", pledged_at: "2026-10-03", due_on: "2026-11-02", amount_cents: 120_000, paid_cents: 0, campaign: "Building campaign" },
  household: { id: "h1", name: "Adeyemi, Tunde & Zoya", number: "H-0127", primary_member: "Tunde Adeyemi", minor_first_names: ["Zoya"] },
  payments: [],
  wording: null,
};

type Row = Record<string, unknown>;
const message = (payload: Row, over: Row = {}): Row => ({
  id: "m1", center_id: "c1", channel: "email", to: "tunde@example.org", purpose: "receipt", subject: "Your pledge PL-0455", body: "Thank you.", sandbox: false, skip: null,
  payload, brand: { name: "Riverside", short_name: "Riverside", logo_path: null, primary_color: "#1B2C5C", public_email: "office@riverside.example" },
  route: { provider: "resend", sender: null, footer: null, unsubscribe: false }, ...over,
});

function setup(msg: Row, answers: { document?: Row | null; majority?: Row; demo?: boolean } = {}) {
  const { db, calls } = fakeDb({
    query: (text) => {
      if (text.includes("worker_message_to_send")) return [{ m: msg }];
      if (text.includes("is_demo_center")) return [{ demo: answers.demo === true }];
      if (text.includes("worker_email_context")) return [{ c: answers.majority ?? { country: "US", state_region: "TX", age_of_majority: null } }];
      if (text.includes("worker_pledge_document")) return [{ d: answers.document === undefined ? doc : answers.document }];
      return [];
    },
  });
  const { log } = captureLog();
  const j = job({ kind: "messaging.send", payload: { message_id: "m1" } });
  const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env: env(), http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
  return { ctx, calls, j };
}
const queries = (calls: { fn: string; args: unknown[] }[], needle: string) => calls.filter((c) => c.fn === "query" && String(c.args[0]).includes(needle));
const results = (calls: { fn: string; args: unknown[] }[]) => queries(calls, "worker_message_result").map((c) => c.args[1] as unknown[]);

const WITH_PDF = { automation_id: AUTO, ref_id: PLEDGE, attachments: [{ kind: "pledge_pdf", pledge_id: PLEDGE }] };

describe("the attachments a message asks for", () => {
  it("are read from the payload: ids only, a known kind, a few at most", () => {
    expect(attachmentSpecs(undefined)).toEqual([]);
    expect(attachmentSpecs({})).toEqual([]);
    expect(attachmentSpecs({ attachments: [{ kind: "pledge_pdf", pledge_id: PLEDGE }] })).toEqual([{ kind: "pledge_pdf", pledgeId: PLEDGE }]);
    expect(() => attachmentSpecs({ attachments: [{ kind: "pledge_pdf", pledge_id: "not-an-id" }] })).toThrow(PermanentError);
    expect(() => attachmentSpecs({ attachments: [{ kind: "shell_script", pledge_id: PLEDGE }] })).toThrow(/does not know how to make/);
    expect(() => attachmentSpecs({ attachments: "pledge" })).toThrow(PermanentError);
    expect(() => attachmentSpecs({ attachments: Array.from({ length: 4 }, () => ({ kind: "pledge_pdf", pledge_id: PLEDGE })) })).toThrow(PermanentError);
  });
});

describe("a pledge email with its PDF", () => {
  it("draws the PDF from the pledge's id and attaches it for Resend: base64, a file name, the PDF type, one pledge's details", async () => {
    const { ctx, calls, j } = setup(message(WITH_PDF));
    const out = await send.run(j, ctx);
    expect(out).toMatchObject({ status: "sent", provider: "resend" });
    const m = mock.state.inbox[0]!;
    expect(m.to).toBe("tunde@example.org");
    const files = m.attachments as { filename: string; content: string; content_type: string }[];
    expect(files).toHaveLength(1);
    expect(files[0]?.filename).toBe("Pledge-PL-0455-Riverside-Community-Center.pdf");
    expect(files[0]?.content_type).toBe("application/pdf");
    const bytes = Buffer.from(files[0]!.content, "base64");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe("Pledge PL-0455 · Riverside Community Center");
    // The service asked the database for this pledge, for this message, with the community's age of majority (a child's name stays out).
    const asked = queries(calls, "worker_pledge_document")[0]!.args[1] as unknown[];
    expect(asked).toEqual(["m1", PLEDGE, 18]);
    expect(queries(calls, "worker_email_context")[0]!.args[1]).toEqual([AUTO]);
    expect(results(calls)[0]).toEqual(["m1", "sent", "resend", m.id, null, null]);
  });

  it("attaches it for Postmark in Postmark's own fields", async () => {
    const { ctx, j } = setup(message(WITH_PDF, { route: { provider: "postmark", sender: null, footer: null, unsubscribe: false } }));
    await send.run(j, ctx);
    const m = mock.state.inbox[0]!;
    expect(m.provider).toBe("postmark");
    const files = m.attachments as { Name: string; Content: string; ContentType: string }[];
    expect(files[0]?.Name).toBe("Pledge-PL-0455-Riverside-Community-Center.pdf");
    expect(files[0]?.ContentType).toBe("application/pdf");
    expect(Buffer.from(files[0]!.Content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("sends an email with no attachments exactly as before", async () => {
    const { ctx, calls, j } = setup(message({ automation_id: AUTO, ref_id: PLEDGE }));
    await send.run(j, ctx);
    expect(mock.state.inbox[0]?.attachments).toEqual([]);
    expect(queries(calls, "worker_pledge_document")).toHaveLength(0);
  });

  it("never names a child in the PDF it draws, and uses the age of majority of the community's place", async () => {
    const { ctx, calls, j } = setup(message(WITH_PDF), { majority: { country: "SG", state_region: null, age_of_majority: null } });
    await send.run(j, ctx);
    expect((queries(calls, "worker_pledge_document")[0]!.args[1] as unknown[])[2]).toBe(21);
    const content = (mock.state.inbox[0]!.attachments as { content: string }[])[0]!.content;
    expect(Buffer.from(content, "base64").toString("latin1")).not.toContain("Zoya");
  });
});

describe("when the PDF cannot be made, nothing is sent", () => {
  it("a pledge the database will not give is a permanent failure with a plain reason, and the message is recorded as failed", async () => {
    const { ctx, calls, j } = setup(message(WITH_PDF), { document: null });
    await expect(send.run(j, ctx)).rejects.toBeInstanceOf(PermanentError);
    expect(mock.state.inbox).toHaveLength(0);
    expect(String(results(calls)[0]?.[4])).toBe("The pledge could not be read, so its PDF could not be attached and the email was not sent.");
    expect(results(calls)[0]?.[1]).toBe("failed");
  });

  it("an attachment the sender does not understand is refused, not dropped", async () => {
    const { ctx, calls, j } = setup(message({ attachments: [{ kind: "invoice_pdf", pledge_id: PLEDGE }] }));
    await expect(send.run(j, ctx)).rejects.toBeInstanceOf(PermanentError);
    expect(mock.state.inbox).toHaveLength(0);
    expect(results(calls)[0]?.[1]).toBe("failed");
  });

  it("a database error while reading the pledge is retried by the queue (not recorded as failed until the last try)", async () => {
    const { db, calls } = fakeDb({
      query: (text) => {
        if (text.includes("worker_message_to_send")) return [{ m: message(WITH_PDF) }];
        if (text.includes("is_demo_center")) return [{ demo: false }];
        if (text.includes("worker_email_context")) return [{ c: {} }];
        throw new Error("connection reset");
      },
    });
    const { log } = captureLog();
    const j = job({ kind: "messaging.send", payload: { message_id: "m1" }, attempts: 1, max_attempts: 5 });
    const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env: env(), http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
    await expect(send.run(j, ctx)).rejects.toThrow("connection reset");
    expect(results(calls)).toHaveLength(0);
    expect(mock.state.inbox).toHaveLength(0);
  });

  it("a pledge PDF is small: a few kilobytes, far below what a message may carry", async () => {
    const { ctx } = setup(message(WITH_PDF));
    const files = await buildAttachments(ctx, { id: "m1", payload: WITH_PDF });
    expect(files).toHaveLength(1);
    expect(Buffer.from(files[0]!.content, "base64").length).toBeLessThan(200_000);
  });
});

describe("a demo community is still never sent anything, and no PDF is drawn for it", () => {
  it("is suppressed before any attachment work", async () => {
    const { ctx, calls, j } = setup(message(WITH_PDF), { demo: true });
    const out = await send.run(j, ctx);
    expect(out).toEqual({ message_id: "m1", status: "suppressed", reason: DEMO_REFUSAL });
    expect(queries(calls, "worker_pledge_document")).toHaveLength(0);
    expect(mock.state.inbox).toHaveLength(0);
  });
});

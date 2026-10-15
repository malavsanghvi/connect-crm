import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { NotConfiguredError } from "../src/errors";
import { createHttp } from "../src/http";
import * as send from "../src/handlers/messaging.send";
import { HANDLERS } from "../src/handlers";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

// A link that opens the member app is written %MEMBER_APP_URL%/<path> by the database (0823: the emailed link of an RSVP made
// without signing in); this service knows the address (the MEMBER_APP_URL repository variable) and writes it in when it sends.
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
  RESEND_API_KEY: "re_test_fake", RESEND_API_BASE: baseUrl, MESSAGING_FROM_ADDRESS: "no-reply@mail.cc.test", PORTAL_PUBLIC_URL: "https://portal.test",
  MESSAGING_LINK_SECRET: "link-secret", SUPABASE_URL: "https://db.test",
});

type Row = Record<string, unknown>;
function ctxWith(message: Row, over: Record<string, string | undefined> = {}) {
  const j = job({ kind: "messaging.send", payload: { message_id: "m1" } });
  const { db, calls } = fakeDb({ query: (text) => (text.includes("worker_message_to_send") ? [{ m: message }] : []) });
  const { log } = captureLog();
  const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env: { ...env(), ...over }, http: createHttp(fetch, async () => {}), log, workerId: "w" }, j, log);
  return { ctx, calls, j };
}
const results = (calls: { fn: string; args: unknown[] }[]) =>
  calls.filter((c) => c.fn === "query" && String(c.args[0]).includes("worker_message_result")).map((c) => c.args[1] as unknown[]);

// A fresh row each time: the sender writes into the row it is given.
const link = () => ({
  id: "m1", center_id: "c1", purpose: "notification", subject: "You are registered", body: "Open this link:\n%MEMBER_APP_URL%/rsvp/tok123abc", sandbox: false,
  skip: null, payload: {}, brand: { name: "Jain Society", short_name: "JSH", logo_path: null, primary_color: null, public_email: "office@jsh.test" },
  channel: "email", to: "mira@example.com", route: { provider: "resend", sender: null, footer: null, unsubscribe: false },
});

describe("messaging.send · a link that opens the member app (RSVP without signing in, 0823)", () => {
  it("writes the member web app's address into the link before sending", async () => {
    const { ctx, j } = ctxWith(link(), { MEMBER_APP_URL: "https://app.example.test/" });
    await send.run(j, ctx);
    const html = String(mock.state.inbox[0]!.html);
    expect(html).toContain("https://app.example.test/rsvp/tok123abc");
    expect(html).not.toContain("%MEMBER_APP_URL%");
  });

  it("fails honestly, and never sends a broken link, when the address is not set", async () => {
    const { ctx, calls, j } = ctxWith(link());
    const err = await send.run(j, ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotConfiguredError);
    expect((err as Error).message).toContain("MEMBER_APP_URL");
    expect(results(calls)[0]?.[1]).toBe("failed");
    expect(mock.state.inbox).toHaveLength(0);
  });

  it("leaves every other email alone", async () => {
    const { ctx, j } = ctxWith({ ...link(), body: "No member app link here, only https://jsh.test/x" });
    await send.run(j, ctx);
    expect(String(mock.state.inbox[0]!.html)).toContain("https://jsh.test/x");
  });
});

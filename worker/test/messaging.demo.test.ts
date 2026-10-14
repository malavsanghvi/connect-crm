import { describe, expect, it } from "vitest";

import { createHttp } from "../src/http";
import * as send from "../src/handlers/messaging.send";
import * as testSend from "../src/handlers/messaging.test_send";
import { HANDLERS } from "../src/handlers";
import { DEMO_REFUSAL } from "../src/messaging";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

// B88: nothing is ever delivered to a demo community (invented people, invented addresses), on any channel.

const env = {
  RESEND_API_KEY: "re_test_fake", TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", MESSAGING_FROM_ADDRESS: "no-reply@mail.cc.test",
  PORTAL_PUBLIC_URL: "https://portal.test", MESSAGING_LINK_SECRET: "link-secret", SUPABASE_URL: "https://db.test",
};

type Row = Record<string, unknown>;
const base = { id: "m1", center_id: "c-demo", purpose: "notification", subject: "Hello", body: "Hello there.", sandbox: true, skip: null, payload: {}, brand: null };
const channels: Record<string, Row> = {
  email: { ...base, channel: "email", to: "asha@demo.weaverams.org", route: { provider: "resend", sender: null, footer: null, unsubscribe: false } },
  sms: { ...base, channel: "sms", to: "+12145550101", route: { from_number: "+12145550100", connected: true } },
  whatsapp: { ...base, channel: "whatsapp", to: "+12145550102", route: { from_number: "+12145550100", approved: true } },
  push: { ...base, channel: "push", to: "user-1", route: { tokens: ["ExponentPushToken[demo]"] } },
};

function setup(message: Row, demo: boolean, kind = "messaging.send") {
  const network: string[] = [];
  const { db, calls } = fakeDb({
    query: (text) => {
      if (text.includes("worker_message_to_send")) return [{ m: message }];
      if (text.includes("is_demo_center")) return [{ demo }];
      return [];
    },
  });
  const { log, lines } = captureLog();
  const http = createHttp((async (url: unknown) => {
    network.push(String(url));
    throw new Error("the network must not be used");
  }) as unknown as typeof fetch, async () => {});
  const j = job({ kind, payload: { message_id: "m1" } });
  const ctx = jobContext({ db, reg: createRegistry(HANDLERS), env, http, log, workerId: "w" }, j, log);
  return { ctx, calls, lines, network, j };
}
const results = (calls: { fn: string; args: unknown[] }[]) =>
  calls.filter((c) => c.fn === "query" && String(c.args[0]).includes("worker_message_result")).map((c) => c.args[1] as unknown[]);

describe("a demo community is never sent anything", () => {
  it("says why in plain words", () => {
    expect(DEMO_REFUSAL).toBe("demo community: nothing is sent");
  });

  for (const [channel, message] of Object.entries(channels)) {
    it(`refuses ${channel}: suppressed with the reason, logged, no provider called`, async () => {
      const { ctx, calls, lines, network, j } = setup(message, true);
      const out = await send.run(j, ctx);
      expect(out).toEqual({ message_id: "m1", status: "suppressed", reason: DEMO_REFUSAL });
      expect(network).toEqual([]);
      expect(results(calls)).toEqual([["m1", "suppressed", null, null, DEMO_REFUSAL, null]]);
      expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("is_demo_center") && (c.args[1] as unknown[])[0] === "c-demo")).toBe(true);
      expect(JSON.stringify(lines)).toContain(DEMO_REFUSAL);
    });
  }

  it("refuses a 'send a test' as well (same path)", async () => {
    const { ctx, calls, network, j } = setup(channels.email!, true, "messaging.test_send");
    const out = await testSend.run(j, ctx);
    expect(out).toMatchObject({ test: true, status: "suppressed", reason: DEMO_REFUSAL });
    expect(network).toEqual([]);
    expect(results(calls)).toHaveLength(1);
  });

  it("does not touch a message of an ordinary community (the provider is called)", async () => {
    const { ctx, network, j } = setup(channels.email!, false);
    await expect(send.run(j, ctx)).rejects.toBeTruthy();
    expect(network.length).toBeGreaterThan(0);
  });

  it("does not look up the community of a platform message (no center)", async () => {
    const { ctx, calls, j } = setup({ ...channels.email!, center_id: null }, false);
    await expect(send.run(j, ctx)).rejects.toBeTruthy();
    expect(calls.some((c) => c.fn === "query" && String(c.args[0]).includes("is_demo_center"))).toBe(false);
  });
});

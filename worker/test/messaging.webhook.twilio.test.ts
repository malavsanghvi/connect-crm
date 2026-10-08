import { describe, expect, it } from "vitest";

import { HANDLERS } from "../src/handlers";
import * as webhookTwilio from "../src/handlers/messaging.webhook.twilio";
import { createHttp } from "../src/http";
import { createRegistry, jobContext } from "../src/runner";
import { captureLog, fakeDb, job } from "./helpers";

// STOP / HELP replies after a Twilio error (0598): the reply is sent by the webhook job itself, the same reply on every
// retry, and the event is marked processed only when it went (or when no retry is left).

const REPLY = {
  id: "r1", center_id: "c1", channel: "sms", to: "+17135550191", purpose: "notification", template_key: "keyword_reply", subject: null,
  body: "JSH: You are unsubscribed and will get no more texts from us. Reply START to subscribe again.", sandbox: false, skip: null,
  status: "queued", payload: { keyword_reply: true, reply_from: "+18325550100" }, brand: null, route: { provider: "twilio", connected: true },
};

const env = {
  TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", TWILIO_API_BASE: "https://twilio.test", PORTAL_PUBLIC_URL: "https://portal.test",
};

/** The database as the webhook job sees it, and a Twilio that answers `statuses` call by call (then 201). */
function world(statuses: number[], over: { reply?: Record<string, unknown>; payload?: Record<string, string>; dbFails?: string } = {}) {
  const state = { processed: false, done: [] as unknown[][], results: [] as unknown[][], recorded: 0, fetches: 0 };
  const payload = over.payload ?? { From: "+17135550191", To: "+18325550100", Body: "STOP", MessageSid: "SMin1" };
  const { db, calls } = fakeDb({
    query: (text, params) => {
      if (text.includes("worker_webhook_event")) return [{ e: { id: "e2", provider: "twilio", processed_at: state.processed ? "2026-10-08T00:00:00Z" : null, payload } }];
      if (text.includes("worker_record_inbound_sms")) {
        state.recorded += 1;
        // The database returns the SAME reply for the same inbound message (idempotent, 0598).
        return [{ r: { keyword: "stop", reply_message_id: "r1", ...(state.recorded > 1 ? { repeated: true } : {}) } }];
      }
      if (text.includes("worker_record_sms_status")) {
        if (over.dbFails) throw new Error(over.dbFails);
        return [{ r: { message_id: "m9" } }];
      }
      if (text.includes("worker_message_to_send")) return [{ m: { ...REPLY, ...(over.reply ?? {}) } }];
      if (text.includes("worker_webhook_done")) {
        state.processed = true;
        state.done.push(params);
        return [];
      }
      if (text.includes("worker_message_result")) {
        state.results.push(params);
        return [];
      }
      return [];
    },
  });
  const fetchImpl = (async () => {
    const status = statuses[state.fetches++] ?? 201;
    return new Response(status === 201 ? JSON.stringify({ sid: "SMreply1", status: "queued" }) : JSON.stringify({ message: "Service unavailable", code: status }), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const { log } = captureLog();
  const run = (j: ReturnType<typeof job>) =>
    webhookTwilio.run(j, jobContext({ db, reg: createRegistry(HANDLERS), env, http: createHttp(fetchImpl, async () => {}), log, workerId: "w" }, j, log));
  return { state, calls, run };
}

const attempt = (n: number, max = 5) => job({ kind: "messaging.webhook.twilio", payload: { event_id: "e2" }, attempts: n, max_attempts: max });

describe("messaging.webhook.twilio: the STOP / HELP reply survives a Twilio error", () => {
  it("sends the reply and marks the event processed when Twilio answers", async () => {
    const w = world([]);
    const out = await w.run(attempt(1));
    expect(out).toMatchObject({ keyword: "stop", reply: { status: "sent", provider: "twilio", provider_ref: "SMreply1" } });
    expect(w.state.done).toEqual([["e2", null]]);
    expect(w.state.results).toHaveLength(1);
    expect(w.state.results[0]?.slice(0, 5)).toEqual(["r1", "sent", "twilio", "SMreply1", null]);
  });

  it("a Twilio error that may pass leaves the event unprocessed and the reply queued, and the retry sends the same reply", async () => {
    // Two 503s: the first try and the http client's own retry. Then Twilio is back.
    const w = world([503, 503]);
    await expect(w.run(attempt(1))).rejects.toThrow(/Twilio could not send the text \(HTTP 503/);
    expect(w.state.done).toEqual([]); // not marked processed
    expect(w.state.results).toEqual([]); // the reply is not recorded as failed: it stays queued for the retry
    expect(w.state.processed).toBe(false);

    const out = await w.run(attempt(2));
    expect(out).toMatchObject({ keyword: "stop", reply: { status: "sent", provider_ref: "SMreply1" } });
    expect(w.state.recorded).toBe(2); // the database was asked again and returned the same reply
    expect(w.state.done).toEqual([["e2", null]]);
    expect(w.state.results).toHaveLength(1);
    expect(w.state.results[0]?.slice(0, 5)).toEqual(["r1", "sent", "twilio", "SMreply1", null]);
    // Once it is processed a further run does nothing, and never texts twice.
    const again = await w.run(attempt(3));
    expect(again).toEqual({ event_id: "e2", skipped: "already processed" });
    expect(w.state.fetches).toBe(3);
  });

  it("on the last try the reply is recorded as failed and the event is marked processed with the error", async () => {
    const w = world([503, 503]);
    await expect(w.run(attempt(5, 5))).rejects.toThrow(/HTTP 503/);
    expect(w.state.results).toHaveLength(1);
    expect(w.state.results[0]?.slice(0, 3)).toEqual(["r1", "failed", "twilio"]);
    expect(String(w.state.results[0]?.[4])).toContain("HTTP 503");
    expect(w.state.done).toHaveLength(1);
    expect(w.state.done[0]?.[0]).toBe("e2");
    expect(String(w.state.done[0]?.[1])).toContain("HTTP 503");
  });

  it("a refusal that cannot pass is final at once: failed, processed with the error, no pointless retries", async () => {
    const w = world([400]);
    await expect(w.run(attempt(1))).rejects.toThrow(/HTTP 400/);
    expect(w.state.results[0]?.slice(0, 3)).toEqual(["r1", "failed", "twilio"]);
    expect(w.state.done).toHaveLength(1);
    expect(String(w.state.done[0]?.[1])).toContain("HTTP 400");
  });

  it("a status callback whose database call failed is retried too, and not marked processed until the last try", async () => {
    const payload = { MessageSid: "SMout1", MessageStatus: "delivered" };
    const first = world([], { payload, dbFails: "connection reset" });
    await expect(first.run(attempt(1))).rejects.toThrow("connection reset");
    expect(first.state.done).toEqual([]);
    const last = world([], { payload, dbFails: "connection reset" });
    await expect(last.run(attempt(5, 5))).rejects.toThrow("connection reset");
    expect(last.state.done).toEqual([["e2", "connection reset"]]);
  });

  it("a reply the database already sent is not sent again", async () => {
    const w = world([], { reply: { status: "sent", skip: "The message is already sent." } });
    const out = await w.run(attempt(1));
    expect(out).toMatchObject({ reply: { skipped: "The message is already sent." } });
    expect(w.state.fetches).toBe(0);
    expect(w.state.done).toEqual([["e2", null]]);
  });
});

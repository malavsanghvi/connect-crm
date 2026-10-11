import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const claims = vi.fn();
const createClient = vi.fn(async () => ({ auth: { getClaims: claims } }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: () => createClient() }));

const sendEvents = vi.fn(async () => ({ status: "sent", count: 1 }));
vi.mock("@/lib/activity/send", () => ({ sendEvents: (...args: unknown[]) => sendEvents(...(args as [])) }));

const afterResponse: Array<() => Promise<void> | void> = [];
vi.mock("@/lib/activity/schedule", () => ({ runAfterResponse: (task: () => Promise<void> | void) => void afterResponse.push(task) }));

import { POST } from "@/app/api/activity/route";

const CENTER = "11111111-2222-4333-8444-555555555555";
const ID = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";

function post(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/activity", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const good = { centerId: CENTER, events: [{ key: "screen:/events/[id]", duration_ms: 3000 }] };

beforeEach(() => {
  claims.mockReset().mockResolvedValue({ data: { claims: { sub: "user-1" } }, error: null });
  createClient.mockClear();
  sendEvents.mockClear();
  afterResponse.length = 0;
});

describe("POST /api/activity", () => {
  it("accepts screens from a signed-in browser, answers at once and sends after the response", async () => {
    const res = await POST(post(good));
    expect(res.status).toBe(204);
    expect(sendEvents).not.toHaveBeenCalled();
    await afterResponse[0]();
    expect(sendEvents).toHaveBeenCalledTimes(1);
    const args = sendEvents.mock.calls[0] as unknown as [unknown, string, Array<{ key: string; kind: string }>];
    expect(args[1]).toBe(CENTER);
    expect(args[2].map((e) => `${e.kind}:${e.key}`)).toEqual(["screen:screen:/events/[id]"]);
  });

  it("refuses a request from another site", async () => {
    const res = await POST(post(good, { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    expect((await POST(post(good, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(post("not json"))).status).toBe(400);
  });

  it("refuses a body that is too large", async () => {
    const res = await POST(post({ ...good, padding: "x".repeat(20_000) }));
    expect(res.status).toBe(413);
  });

  it("refuses screens that carry an id, and anything that is not a screen", async () => {
    expect((await POST(post({ centerId: CENTER, events: [{ key: `screen:/events/${ID}`, duration_ms: 1 }] }))).status).toBe(400);
    expect((await POST(post({ centerId: CENTER, events: [{ key: "giving.record_payment", duration_ms: 1 }] }))).status).toBe(400);
    expect((await POST(post({ centerId: "acme", events: good.events }))).status).toBe(400);
    expect(sendEvents).not.toHaveBeenCalled();
  });

  it("does nothing for someone who is not signed in", async () => {
    claims.mockResolvedValue({ data: { claims: null }, error: null });
    const res = await POST(post(good));
    expect(res.status).toBe(401);
    expect(afterResponse).toHaveLength(0);
  });

  it("answers with an error status, not an exception, when the database client cannot be made", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createClient.mockRejectedValueOnce(new Error("Supabase is not configured"));
    expect((await POST(post(good))).status).toBe(503);
  });
});

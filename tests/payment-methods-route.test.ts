import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/payments/methods (docs/PAYMENTS_PLAN.md §2.7) and the Settings › Payments switch action,
// with the database and the session replaced: what is checked is what the code sends and answers.
const rpc = vi.fn();
let clientAvailable = true;
vi.mock("@/lib/payments/server", () => ({
  tokenClient: () => (clientAvailable ? { rpc } : null),
  NotConfigured: class NotConfigured extends Error {},
  ProviderError: class ProviderError extends Error {},
  originOf: () => "http://localhost:3000",
  paypalReferralUrl: vi.fn(),
  stripeAuthorizeUrl: vi.fn(),
}));
vi.mock("@/lib/payments/checkout", () => ({ startProviderCheckout: vi.fn() }));
vi.mock("@/lib/platform-setup/server-config", () => ({ loadPlatformConfig: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
const sessionRpc = vi.fn();
vi.mock("@/lib/session", () => ({
  authorizeAction: async () => ({ ok: true, session: { center: { id: "00000000-0000-4000-8000-000000000001" }, db: { rpc: sessionRpc } } }),
  dbWithReason: async (session: { db: unknown }) => session.db,
}));

import { setPluginAction } from "@/app/(app)/settings/payments/actions";
import { GET, OPTIONS } from "@/app/api/payments/methods/route";

const CENTER = "00000000-0000-4000-8000-0000000000aa";
const request = (opts: { token?: string | null; center?: string | null } = {}) => {
  const url = new URL("http://localhost/api/payments/methods");
  const center = opts.center === undefined ? CENTER : opts.center;
  if (center !== null) url.searchParams.set("center_id", center);
  const token = opts.token === undefined ? "member-token" : opts.token;
  return new NextRequest(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
};

const ANSWER = {
  environment: "sandbox",
  currency: "usd",
  online_unavailable: null,
  methods: [
    { key: "card", family: "provider_checkout", label: "Card", provider: "stripe", mode: "test", wallets: ["apple_pay"], also: [], sort: 10, account_id: "acct_SECRET" },
    {
      key: "zelle", family: "reported_transfer", label: "Zelle", mode: "rehearsal",
      instructions: { recipient: "real@bank.example", name: "Sandbox: no real money moves" },
      report: { available: false, confirmation: "ask", window_days: 10 }, sort: 30,
    },
    { key: "crypto", family: "future_family", label: "Later", sort: 99 },
  ],
};

beforeEach(() => {
  rpc.mockReset();
  sessionRpc.mockReset();
  clientAvailable = true;
});

describe("GET /api/payments/methods", () => {
  it("answers the contract only: no address in a rehearsal, no undeclared field, no unknown family, plus an empty client", async () => {
    rpc.mockResolvedValue({ data: ANSWER, error: null });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const text = await res.text();
    expect(text).not.toContain("real@bank.example");
    expect(text).not.toContain("acct_SECRET");
    expect(text).not.toContain("future_family");
    const body = JSON.parse(text);
    expect(body.client).toEqual({});
    expect(body.methods.map((m: { key: string }) => m.key)).toEqual(["card", "zelle"]);
    expect(body.methods[1].instructions).toEqual({ name: "Sandbox: no real money moves" });
    expect(rpc).toHaveBeenCalledWith("member_payment_methods", { p_center: CENTER });
  });

  it("is a plain-English 401 without a token, 400 without a community, 503 when the portal is not configured", async () => {
    expect(await (await GET(request({ token: null }))).json()).toEqual({ error: "Sign in to see how to give." });
    expect((await GET(request({ token: null }))).status).toBe(401);
    const noCenter = await GET(request({ center: null }));
    expect(noCenter.status).toBe(400);
    expect((await noCenter.json()).error).toMatch(/community id/);
    expect((await GET(request({ center: "not-a-uuid" }))).status).toBe(400);
    clientAvailable = false;
    expect((await GET(request())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's own refusal on: 403 for a child or a non-member (its sentence, not a generic one), 400 for a bad community", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Only an adult of the family can pay for it." } });
    const child = await GET(request());
    expect(child.status).toBe(403);
    expect(await child.json()).toEqual({ error: "Only an adult of the family can pay for it." });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "permission denied for function member_payment_methods" } });
    const denied = await GET(request());
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe("you don't have permission to make this change");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "That community was not found." } });
    const missing = await GET(request());
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "That community was not found." });
  });

  it("is a 500 in plain English, with the detail logged, for a failure or an answer it does not understand", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
    const gone = await GET(request());
    expect(gone.status).toBe(500);
    expect((await gone.json()).error).toMatch(/^Could not load how to give — the database function is not available/);
    rpc.mockResolvedValueOnce({ data: { environment: "moon" }, error: null });
    const odd = await GET(request());
    expect(odd.status).toBe(500);
    expect((await odd.json()).error).toMatch(/^Could not load how to give — the database answered in a shape this screen does not understand/);
    rpc.mockRejectedValueOnce(new Error("socket hang up"));
    const down = await GET(request());
    expect(down.status).toBe(500);
    expect((await down.json()).error).toMatch(/could not be reached/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("answers the preflight for GET with the bearer header", () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toContain("authorization");
  });
});

describe("setPluginAction", () => {
  it("sends the switch's direction, and the name and order it was given, with the reason", async () => {
    sessionRpc.mockResolvedValue({ data: {}, error: null });
    const res = await setPluginAction("card", false, null, null, "  Stop cards for now ");
    expect(res).toEqual({ ok: true, message: "Card is off · audit logged" });
    expect(sessionRpc).toHaveBeenCalledWith("set_payment_plugin", {
      p_center: "00000000-0000-4000-8000-000000000001", p_key: "card", p_enabled: false, p_config: null, p_label_override: null, p_sort: null,
      p_reason: "Stop cards for now",
    });
  });

  it("a rename or a reorder leaves the switch to the database, so a stale page cannot flip it", async () => {
    sessionRpc.mockResolvedValue({ data: {}, error: null });
    const res = await setPluginAction("check", true, " Cheque ", 5, "Our members say cheque", "rename");
    expect(res).toEqual({ ok: true, message: "Cheque saved · audit logged" });
    expect(sessionRpc).toHaveBeenCalledWith("set_payment_plugin", expect.objectContaining({ p_key: "check", p_enabled: null, p_label_override: "Cheque", p_sort: 5 }));
  });

  it("refuses what the database would refuse, before asking it, in plain English", async () => {
    expect(await setPluginAction("venmo_direct", true, null, null, "x")).toEqual({
      ok: false, error: "Could not turn on venmo direct — that is not a payment method Community Connect offers.",
    });
    expect((await setPluginAction("card", true, "x".repeat(41), null, "x")).error).toMatch(/at most 40 characters/);
    expect((await setPluginAction("card", true, null, 1000, "x")).error).toMatch(/whole number from 0 to 999/);
    expect((await setPluginAction("card", true, null, 1.5, "x")).error).toMatch(/whole number from 0 to 999/);
    expect((await setPluginAction("card", true, null, null, "  ")).error).toBe("Could not turn on Card — say why. The reason is kept in the audit log.");
    expect(sessionRpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal next to what was done, logs the detail, and never says it worked", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sessionRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "Stripe is connected, so it needs at least one way to pay. To stop taking card payments, disconnect Stripe in the Card card." },
    });
    const res = await setPluginAction("card", false, null, null, "Stop cards");
    expect(res).toEqual({
      ok: false,
      error: "Could not turn off Card — Stripe is connected, so it needs at least one way to pay. To stop taking card payments, disconnect Stripe in the Card card.",
    });
    expect(log).toHaveBeenCalled();
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Changing the ways members can pay needs the owner, integrations.manage or giving.manage." } });
    expect((await setPluginAction("cash", true, null, null, "Cash")).error).toBe("Could not turn on Cash (bhandar) — you don't have permission to make this change.");
    log.mockRestore();
  });

  it("asks for a fresh 2FA check when the database does", async () => {
    sessionRpc.mockResolvedValueOnce({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check." } });
    const res = await setPluginAction("zelle", true, null, null, "Zelle");
    expect(res).toMatchObject({ ok: false, stepUp: true });
  });
});

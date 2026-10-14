import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /giving/pledges/<id>/pdf: the PDF staff print. giving.view or giving.manage in the person's own community, the database decides
// again, and every failure is one plain sentence as text (the Print button shows it with a retry).

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
type State = { status: "ok"; session: Record<string, unknown> } | { status: "signed_out" } | { status: "env_missing" };
let state: State;
vi.mock("@/lib/session", () => ({ loadSession: async () => state }));

import { GET } from "@/app/(app)/giving/pledges/[id]/pdf/route";

const ID = "18400000-0000-4000-8000-000000000201";
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

const DOC = {
  center: { id: "c-1", name: "Riverside Community Center", currency: "USD", time_zone: "America/Chicago", country: "US", languages: ["en"], branding: { logo_path: "c-1/brand/logo.png", primary: "#123456" } },
  organization: { legal_name: "Riverside Community Center Inc.", ein: "12-3456789" },
  pledge: { id: ID, number: "PL-0455", status: "open", pledged_at: "2026-10-03", due_on: "2026-11-02", amount_cents: 120000, paid_cents: 0, campaign: "Building campaign" },
  household: { id: "h-1", name: "Adeyemi, Tunde & Zoya", number: "H-0127", primary_member: "Tunde Adeyemi", minor_first_names: ["Zoya"] },
  payments: [],
  wording: null,
};

function session(over: Record<string, unknown> = {}) {
  return {
    db: { rpc: (n: string, a: unknown) => rpc(n, a) },
    center: { id: "c-1", name: "Riverside Community Center", country: "US", state_region: "TX", rules: {}, time_zone: "America/Chicago" },
    permissions: ["giving.view"],
    isPlatformAdmin: false,
    modulesOff: [],
    ...over,
  };
}

const call = (id = ID) => GET(new Request("http://x/giving/pledges/x/pdf") as never, { params: Promise.resolve({ id }) } as never);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: DOC, error: null });
  state = { status: "ok", session: session() };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (String(url).endsWith("logo.png") ? new Response(PNG, { status: 200 }) : new Response("nope", { status: 404 }))),
  );
});

describe("the pledge PDF route", () => {
  it("returns the pledge as an inline PDF named for the pledge and the community, drawn from what the database gave", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="Pledge-PL-0455-Riverside-Community-Center.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toBe("Pledge PL-0455 · Riverside Community Center");
    expect(rpc).toHaveBeenCalledWith("pledge_document", { p_center: "c-1", p_pledge: ID, p_majority: 18 });
    // The community's logo is read from its public branding file.
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("https://x.supabase.co/storage/v1/object/public/branding/c-1/brand/logo.png", expect.anything());
  });

  it("is the same page staff see: a child's name is not on it", async () => {
    const res = await call();
    const text = Buffer.from(await res.arrayBuffer()).toString("latin1");
    expect(text).not.toContain("Zoya");
  });

  it("still draws the PDF, with the community's name, when the logo cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    expect((await call()).status).toBe(200);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect((await call()).status).toBe(200);
  });

  it("answers a person without giving.view or giving.manage with a sentence, and never asks the database", async () => {
    state = { status: "ok", session: session({ permissions: ["giving.record_offline"] }) };
    const res = await call();
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("Could not make the pledge PDF — you don't have access to this area.\n");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("giving.manage alone is enough, and so is giving.view alone", async () => {
    state = { status: "ok", session: session({ permissions: ["giving.manage"] }) };
    expect((await call()).status).toBe(200);
    state = { status: "ok", session: session({ permissions: ["giving.view"] }) };
    expect((await call()).status).toBe(200);
  });

  it("says so when the session has expired, the app is not configured, or Giving is off", async () => {
    state = { status: "signed_out" };
    expect(await (await call()).text()).toBe("Could not make the pledge PDF — your session has expired. Sign in again.\n");
    state = { status: "env_missing" };
    expect((await call()).status).toBe(500);
    state = { status: "ok", session: session({ modulesOff: ["giving"] }) };
    const off = await call();
    expect(off.status).toBe(403);
    expect(await off.text()).toContain("Riverside Community Center");
  });

  it("a made-up address is not found, without asking the database", async () => {
    const res = await call("not-an-id");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Could not make the pledge PDF — that address does not name a pledge.\n");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("another community's pledge, or one that does not exist, is 'not found' (the database says the same for both)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "That pledge was not found." } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Could not make the pledge PDF — that pledge was not found.\n");
    rpc.mockResolvedValue({ data: null, error: null });
    expect((await call()).status).toBe(404);
  });

  it("a refusal by the database is a 403 sentence; any other failure is a plain 500 sentence with a retry hint, logged on the server", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "You don't have access to this area." } });
    expect((await call()).status).toBe(403);
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "connection reset" } });
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Could not make the pledge PDF — connection reset. Try again.\n");
    expect(console.error).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

// The export route of Giving's lists (slice 9): data.export before anything is read, the database's check (a fresh code no earlier
// export used) before the rows are read, the audit entry before the file is sent, and the file with its watermark. Reads are
// replaced by invented rows; the database by a recorded rpc.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: async (_key: string, action: () => Promise<unknown>) => action() }));

const rpc = vi.fn();
let permissions = ["giving.view", "giving.manage", "data.export"];
let signedIn: "ok" | "signed_out" = "ok";
const session = () => ({
  permissions,
  isPlatformAdmin: false,
  isOwner: false,
  email: "treasurer@club.example",
  person: { id: "p1", name: "Grace Okafor", memberNumber: null },
  center: { id: "center-1", name: "Lakeside Community Club", time_zone: "America/Chicago", currency: "USD", rules: {} },
  db: { rpc: (name: string, args: unknown) => rpc(name, args) },
});
vi.mock("@/lib/session", () => ({ loadSession: async () => (signedIn === "ok" ? { status: "ok", session: session() } : { status: "signed_out" }) }));

const readGivingExport = vi.fn();
vi.mock("@/lib/data/giving-export", () => ({ readGivingExport: (...a: unknown[]) => readGivingExport(...a) }));

import { GET } from "@/app/(app)/giving/export/route";
import { paymentExportFilter } from "@/lib/giving-export/filters";
import { paymentQuery } from "@/lib/giving-lists/payments";

const req = (qs: string) => ({ nextUrl: new URL(`https://app.example.org/giving/export?${qs}`) }) as never;
const body = async (res: Response) => (await res.text()).replace(/^﻿/, "");
const stepUpError = { code: "CCSTP", message: "This needs a fresh 2FA check.", details: "export.giving_payments", hint: "Each export needs a new code" };
const filter = paymentExportFilter(paymentQuery("all", (k) => ({ method: "check" })[k], "2026-10-12"), "Okafor", "en-US");

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  readGivingExport.mockReset();
  readGivingExport.mockResolvedValue({
    ok: true,
    header: ["Receipt number", "Amount", "Currency"],
    lines: [
      ["R-2026-0413", "200.00", "USD"],
      ["R-2026-0398", "80.00", "USD"],
    ],
    filter,
    count: 2,
  });
  permissions = ["giving.view", "giving.manage", "data.export"];
  signedIn = "ok";
});

describe("who may export", () => {
  it("answers a signed-out person with 401, and a person without data.export with 403 in words, before anything is read or checked", async () => {
    signedIn = "signed_out";
    expect((await GET(req("list=payments"))).status).toBe(401);
    signedIn = "ok";
    permissions = ["giving.view", "giving.manage"];
    const res = await GET(req("list=payments"));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Exporting needs the data-export permission");
    expect(rpc).not.toHaveBeenCalled();
    expect(readGivingExport).not.toHaveBeenCalled();
  });

  it("asks for Payments or Pledges", async () => {
    const res = await GET(req("list=bank_lines"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("choose Payments or Pledges");
  });
});

describe("the fresh code and the database's check", () => {
  it("answers 403 with x-step-up when the code is missing or was used by an earlier export, and reads nothing", async () => {
    rpc.mockImplementation(async (name: string) => (name === "giving_export_check" ? { data: null, error: stepUpError } : { data: null, error: null }));
    const res = await GET(req("list=payments&method=check"));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-step-up")).toBe("required");
    expect(await res.text()).toContain("each export needs a fresh code");
    expect(readGivingExport).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("says the database's own refusal in its words (a module that is off), with 403", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "giving_export_check" ? { data: null, error: { code: "42501", message: "The Bank reconciliation module is switched off for this community." } } : { data: null, error: null },
    );
    const res = await GET(req("list=payments"));
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("Could not export the list — The Bank reconciliation module is switched off for this community.\n");
  });
});

describe("the read, the audit entry and the file", () => {
  it("stops when a part cannot be read, and records nothing", async () => {
    readGivingExport.mockResolvedValue({ ok: false, status: 500, error: "Could not export the list — The payments could not be read: timeout. Nothing was exported; try again." });
    const res = await GET(req("list=payments"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Nothing was exported");
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["giving_export_check"]);
  });

  it("records the export with the count and the chips, never the search's text, and sends no file when recording fails", async () => {
    rpc.mockImplementation(async (name: string) => (name === "record_giving_export" ? { data: null, error: stepUpError } : { data: null, error: null }));
    const res = await GET(req("list=payments&method=check&q=Okafor"));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-step-up")).toBe("required");
    const recorded = rpc.mock.calls.find((c) => c[0] === "record_giving_export")?.[1];
    expect(recorded).toEqual({ p_center: "center-1", p_list: "payments", p_detail: { rows: 2, chips: { method: "check" }, searched: true } });
    expect(JSON.stringify(recorded)).not.toContain("Okafor");
  });

  it("sends the file: the watermark line, the header, the rows; named after the list and its chips", async () => {
    const res = await GET(req("list=payments&method=check&q=Okafor"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="payments-check-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(readGivingExport).toHaveBeenCalledWith(expect.anything(), "payments", expect.objectContaining({ list: "payments", method: "check", q: "Okafor" }));
    const lines = (await body(res)).trim().split("\r\n");
    expect(lines[0]).toMatch(
      /^"Exported from Lakeside Community Club by Grace Okafor \(treasurer@club\.example\) on .+ \(America\/Chicago\)\. Payments: check, matching “Okafor”\. 2 payments\. Confidential: .+"$/,
    );
    expect(lines.slice(1)).toEqual(["Receipt number,Amount,Currency", "R-2026-0413,200.00,USD", "R-2026-0398,80.00,USD"]);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["giving_export_check", "record_giving_export"]);
  });
});

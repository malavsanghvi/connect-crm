import { beforeEach, describe, expect, it, vi } from "vitest";

// The export of a list on the People screen: the same rule as the other exports (the database asks for a fresh 2FA check and records
// the export with counts only), and a child's record is never in it. Reads are replaced by invented adults and children.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: async (_key: string, action: () => Promise<unknown>) => action() }));

import { NO_FILTERS, type HouseholdFilters } from "@/lib/people-v2/ask";
import { gapPeople, type GapPerson } from "@/lib/people-v2/gaps";

const rpc = vi.fn();
let permissions = ["people.view", "people.manage"];
let signedIn: "ok" | "signed_out" = "ok";
const session = () => ({
  permissions,
  isPlatformAdmin: false,
  isOwner: false,
  center: { id: "center-1", time_zone: "America/Chicago", currency: "USD", rules: {} },
  db: { rpc: (name: string, args: unknown) => rpc(name, args) },
});
vi.mock("@/lib/session", () => ({ loadSession: async () => (signedIn === "ok" ? { status: "ok", session: session() } : { status: "signed_out" }) }));

const loadGapPeople = vi.fn();
const loadExportCards = vi.fn();
vi.mock("@/lib/people-v2/gap-load", () => ({ loadGapPeople: (s: unknown, f: HouseholdFilters) => loadGapPeople(s, f), loadExportCards: (s: unknown, ids: string[]) => loadExportCards(s, ids) }));
const loadFilteredHouseholds = vi.fn();
vi.mock("@/lib/people-v2/load", () => ({ loadFilteredHouseholds: (...a: unknown[]) => loadFilteredHouseholds(...a), loadZones: async () => ({ zones: [{ id: "z1", name: "North Riverside" }], error: null }) }));

import { GET } from "@/app/(app)/people/export/route";

const req = (qs: string) => ({ nextUrl: new URL(`https://app.example.org/people/export?${qs}`) }) as never;
const person = (id: string, name: string, over: Partial<GapPerson> = {}): GapPerson => ({
  id,
  name,
  memberNumber: null,
  email: null,
  phone: "+17135550138",
  dateOfBirth: "1980-01-01",
  role: "spouse",
  onApp: false,
  onTeam: false,
  household: { id: "h1", name: "Patel household", number: "0127", hasAddress: true, zoneId: "z1" },
  ...over,
});
const everyone: GapPerson[] = [person("p1", "Anil Patel"), person("p2", "田中 花子", { household: null }), person("p3", "Layla Patel", { dateOfBirth: "2015-03-04", role: "child" }), person("p4", "=SUM(1)", { role: "primary" })];

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
  loadGapPeople.mockReset();
  loadGapPeople.mockImplementation(async (_s: unknown, f: HouseholdFilters) => ({ people: gapPeople(everyone, f, { today: "2026-10-12", majority: 18 }), problems: [], notes: [], failed: false }));
  loadExportCards.mockReset();
  loadExportCards.mockResolvedValue({ cards: new Map([["h1", { name: "Patel household", number: "0127", orgId: "RCC-H-0961", city: "Riverside", zone: "North Riverside", adults: ["Anil Patel"] }]]), error: null });
  loadFilteredHouseholds.mockReset();
  permissions = ["people.view", "people.manage"];
  signedIn = "ok";
});

const body = async (res: Response) => (await res.text()).replace(/^\uFEFF/, "");

describe("who may export, and the fresh 2FA check", () => {
  it("answers a signed-out person with 401 and a person without People access with 403, and reads nothing", async () => {
    signedIn = "signed_out";
    expect((await GET(req("list=people&noemail=1"))).status).toBe(401);
    signedIn = "ok";
    permissions = ["events.view"];
    const res = await GET(req("list=people&noemail=1"));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("you don't have access to this area");
    expect(loadGapPeople).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a role that may only view people: 403 in words, and nothing is read, checked or recorded", async () => {
    permissions = ["people.view"];
    for (const qs of ["list=people&noemail=1", "list=households"]) {
      const res = await GET(req(qs));
      expect(res.status).toBe(403);
      expect(res.headers.get("x-step-up")).toBeNull();
      const text = await res.text();
      expect(text).toContain("you don't have access to this area");
      expect(text).toContain("needs permission to manage people");
    }
    expect(loadGapPeople).not.toHaveBeenCalled();
    expect(loadFilteredHouseholds).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets a role that manages people go on to the fresh-code check", async () => {
    permissions = ["people.manage"];
    const res = await GET(req("list=people&noemail=1"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("assert_step_up", { p_action: "export.people_list" });
  });

  it("asks for the fresh code first: 403 with the step-up header, before anything is read or recorded", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "CCSTP", message: "This needs a fresh 2FA check." } });
    const res = await GET(req("list=people&noemail=1"));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-step-up")).toBe("required");
    expect(rpc).toHaveBeenCalledWith("assert_step_up", { p_action: "export.people_list" });
    expect(loadGapPeople).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("says in words when the check itself failed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "fetch failed" } });
    const res = await GET(req("list=people&noemail=1"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Could not export the list");
  });

  it("answers 403 with the header too when the recording step asks again", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { code: "CCSTP", message: "fresh 2FA check" } });
    const res = await GET(req("list=people&noemail=1"));
    expect(res.status).toBe(403);
    expect(res.headers.get("x-step-up")).toBe("required");
  });
});

describe("a list of adults", () => {
  it("is a CSV of adults only, never a child, and records the export with counts and filter names, never the data", async () => {
    const res = await GET(req("list=people&noemail=1&band=adults"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="adults-with-no-email-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // A byte order mark first, so a spreadsheet reads names in every script correctly.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv.split("\r\n")[0]).toBe("Name,Relationship,Member number,Email,Mobile,On the app,Age,Household number,Community household ID,Household,City");
    expect(csv).toContain("Anil Patel");
    expect(csv).toContain("田中 花子");
    expect(csv).toContain("RCC-H-0961");
    expect(csv).toContain("'=SUM(1)");
    expect(csv).not.toContain("Layla");
    expect(rpc).toHaveBeenCalledWith("record_export", { p_center: "center-1", p_kind: "people_list", p_detail: { rows: 3, filters: ["band", "noemail"] } });
  });

  it("keeps a typed search out of the audit entry (it can be a name), while still using it for the list", async () => {
    const res = await GET(req("list=people&noemail=1&q=Anil"));
    const csv = await body(res);
    expect(csv).toContain("Anil Patel");
    expect(csv).not.toContain("田中");
    expect(rpc).toHaveBeenCalledWith("record_export", { p_center: "center-1", p_kind: "people_list", p_detail: { rows: 1, filters: ["noemail"] } });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("Anil");
  });

  it("is adults even when the address asks for under 18 with a gap", async () => {
    const res = await GET(req("list=people&noemail=1&band=minors"));
    expect(res.status).toBe(200);
    expect(await body(res)).not.toContain("Layla");
    const used = loadGapPeople.mock.calls[0][1] as HouseholdFilters;
    expect(used.noEmail).toBe(true);
  });

  it("refuses to export a list of children with no gap asked", async () => {
    const res = await GET(req("list=people&band=minors"));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("a list of children is not exported");
    expect(loadGapPeople).not.toHaveBeenCalled();
  });

  it("says when the people could not be read, and records nothing", async () => {
    loadGapPeople.mockResolvedValue({ people: [], problems: [{ what: "the people", message: "the database could not be reached" }], notes: [], failed: true });
    const res = await GET(req("list=people&noemail=1"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("the people could not be read: the database could not be reached");
    expect(rpc).not.toHaveBeenCalledWith("record_export", expect.anything());
  });

  it("opens the people list when the address names no list but asks for a gap", async () => {
    const res = await GET(req("noemail=1"));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("assert_step_up", { p_action: "export.people_list" });
  });
});

describe("a list of families", () => {
  it("is a CSV with each family's card, the adults' names and no balance for a role without giving", async () => {
    loadFilteredHouseholds.mockResolvedValue({ sorted: [{ id: "h1", name: "Patel, Anil, Priya & Layla", number: "0127", zoneId: "z1", city: "Riverside", tiers: [] }], balanceMap: null, giving: false, fails: [], notes: [] });
    const res = await GET(req("list=households&ending=60"));
    expect(res.status).toBe(200);
    const csv = await body(res);
    expect(csv.split("\r\n")[0]).toBe("Household number,Community household ID,Household,Adults,City,Area");
    expect(csv).toContain("0127,RCC-H-0961,Patel household,Anil Patel,Riverside,North Riverside");
    expect(csv).not.toContain("Layla");
    expect(csv).not.toContain("Open balance");
    expect(rpc).toHaveBeenCalledWith("record_export", { p_center: "center-1", p_kind: "household_list", p_detail: { rows: 1, filters: ["ending"] } });
  });

  it("adds the open balance in major units when the person may see giving", async () => {
    loadFilteredHouseholds.mockResolvedValue({ sorted: [{ id: "h1", name: "x", number: "0127", zoneId: null, city: null, tiers: [] }], balanceMap: new Map([["h1", 30000]]), giving: true, fails: [], notes: [] });
    const csv = await body(await GET(req("list=households")));
    expect(csv.split("\r\n")[0]).toBe("Household number,Community household ID,Household,Adults,City,Area,Open balance");
    expect(csv).toContain(",300.00");
  });

  it("says when a part of the list could not be read, and records nothing", async () => {
    loadFilteredHouseholds.mockResolvedValue({ sorted: [], balanceMap: null, giving: false, fails: [{ what: "open balances", error: { message: "fetch failed" } }], notes: [] });
    const res = await GET(req("list=households&over=0"));
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("open balances could not be read");
    expect(rpc).not.toHaveBeenCalledWith("record_export", expect.anything());
  });
});

describe("the same filters the list reads", () => {
  it("reads the address the way the page does: a malformed value is ignored", async () => {
    await GET(req("list=people&noemail=yes&nomobile=1"));
    const used = loadGapPeople.mock.calls[0][1] as HouseholdFilters;
    expect(used).toEqual({ ...NO_FILTERS, noMobile: true });
  });
});

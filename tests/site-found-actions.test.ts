import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ authorizeAction: vi.fn() }));
// The recording wrapper only notes the key and runs the action.
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: vi.fn((_key: string, action: () => Promise<unknown>) => action()) }));

import { revalidatePath } from "next/cache";

import { lookAtWebsiteAction, saveSiteAddressesAction, siteStatusAction } from "@/app/(app)/setup/website/actions";
import { withActivity } from "@/lib/activity/with-activity";
import { authorizeAction } from "@/lib/session";

import { fakeDb, fakeSession, type FakeDbOptions } from "./commands/helpers";
import { ownResult } from "./fixtures/site-found";

const status = (over: Record<string, unknown> = {}) => ({
  own_url: "https://www.jsh.example.org",
  reference_urls: ["https://one.example.net"],
  saved_at: "2026-10-11T09:00:00Z",
  profile_website: null,
  reads_last_hour: 0,
  max_reads_per_hour: 8,
  jobs: [],
  ...over,
});
const doneJob = { id: 11, slot: "own", mode: "own", url: "https://www.jsh.example.org", run: "r", status: "done", attempts: 1, max_attempts: 2, last_error: null, created_at: "2026-10-11T10:00:00Z", finished_at: "2026-10-11T10:01:00Z", pages_read: 7 };

function world(opts: FakeDbOptions = {}) {
  const db = fakeDb({ rpc: { site_found_status: status(), site_found_save_inputs: {}, site_crawl_start: { run: "r", queued: [] }, ...opts.rpc }, failRpc: opts.failRpc });
  const session = fakeSession({ db });
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session });
  return db;
}
const calls = (db: ReturnType<typeof fakeDb>, fn: string) => db.rpcCalls.filter((c) => c.fn === fn);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(authorizeAction).mockReset();
  vi.mocked(withActivity).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe("saving the website addresses", () => {
  it("is recorded under its own activity key and asks for the Setup permission", async () => {
    world();
    await saveSiteAddressesAction("example.org", []);
    expect(withActivity).toHaveBeenCalledWith("website.save_addresses", expect.any(Function));
    expect(authorizeAction).toHaveBeenCalledWith("setup", "save the website addresses");
  });

  it("refuses a person without the permission and calls nothing", async () => {
    const db = fakeDb();
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Could not save the website addresses — you don't have permission (needs settings.manage)." });
    const res = await saveSiteAddressesAction("example.org", []);
    expect(res).toEqual({ ok: false, error: "Could not save the website addresses — you don't have permission (needs settings.manage)." });
    expect(db.rpcCalls).toEqual([]);
  });

  it("refuses a bad address in plain English before anything is sent", async () => {
    const db = world();
    const res = await saveSiteAddressesAction("http://10.0.0.5/admin", []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Could not save the website addresses — "http:\/\/10\.0\.0\.5\/admin" points to a private network/);
    expect(calls(db, "site_found_save_inputs")).toEqual([]);
  });

  it("refuses a fourth website it likes", async () => {
    const db = world();
    const res = await saveSiteAddressesAction("example.org", ["a.example.net", "b.example.net", "c.example.net", "d.example.net"]);
    expect(res).toEqual({ ok: false, error: "Could not save the website addresses — You can give at most 3 websites you like (this was 4). Remove 1 and save again." });
    expect(db.rpcCalls).toEqual([]);
  });

  it("sends what was typed, for the community of the session, and returns the saved addresses with a message", async () => {
    const db = world();
    const res = await saveSiteAddressesAction(" www.jsh.example.org ", ["one.example.net", ""]);
    expect(res).toMatchObject({ ok: true, message: "Website addresses saved." });
    expect(calls(db, "site_found_save_inputs")).toEqual([{ fn: "site_found_save_inputs", args: { p_center: "center-1", p_own: "www.jsh.example.org", p_refs: ["one.example.net"] } }]);
    expect(res.data?.status).toMatchObject({ ownUrl: "https://www.jsh.example.org", referenceUrls: ["https://one.example.net"] });
    expect(revalidatePath).toHaveBeenCalledWith("/setup/website");
  });

  it("never says it saved when the database refused: the reason is shown instead", async () => {
    world({ failRpc: { site_found_save_inputs: { code: "42501", message: "Giving the website addresses needs the settings.manage permission." } } });
    const res = await saveSiteAddressesAction("example.org", []);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Could not save the website addresses — you don't have permission to make this change.");
    expect(res.message).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says it saved even when the details cannot be read back, and says they could not be", async () => {
    world({ failRpc: { site_found_status: { code: "XX000", message: "boom" } } });
    const res = await saveSiteAddressesAction("example.org", []);
    expect(res).toMatchObject({ ok: true, message: "Website addresses saved." });
    expect(res.data).toBeUndefined();
  });
});

describe("pressing Look at my website", () => {
  it("is recorded under its own activity key and asks for the Setup permission", async () => {
    world();
    await lookAtWebsiteAction();
    expect(withActivity).toHaveBeenCalledWith("website.look_at_site", expect.any(Function));
    expect(authorizeAction).toHaveBeenCalledWith("setup", "start looking at the website");
  });

  it("queues every saved website when no slot is given, and only the named one for Try again", async () => {
    const db = world();
    expect(await lookAtWebsiteAction()).toMatchObject({ ok: true, message: expect.stringContaining("Looking at your websites") });
    expect(await lookAtWebsiteAction("ref1")).toMatchObject({ ok: true, message: expect.stringContaining("that website again") });
    expect(calls(db, "site_crawl_start").map((c) => c.args)).toEqual([
      { p_center: "center-1" },
      { p_center: "center-1", p_slot: "ref1" },
    ]);
  });

  it("sends no address of its own: the database reads the saved ones", async () => {
    const db = world();
    await lookAtWebsiteAction("own");
    expect(Object.keys(calls(db, "site_crawl_start")[0]!.args).sort()).toEqual(["p_center", "p_slot"]);
  });

  it("refuses a website it does not know and calls nothing", async () => {
    const db = world();
    const res = await lookAtWebsiteAction("ref9");
    expect(res).toEqual({ ok: false, error: "Could not start looking at the website — Weaver does not know which website that is." });
    expect(db.rpcCalls).toEqual([]);
  });

  it("shows the rate limit in the database's own words, next to what was done", async () => {
    world({ failRpc: { site_crawl_start: { code: "P0001", message: "Weaver reads at most 8 websites an hour for one community, and 8 have been read in the last hour. Try again in about 10 minutes." } } });
    const res = await lookAtWebsiteAction();
    expect(res).toEqual({
      ok: false,
      error: "Could not start looking at the website — Weaver reads at most 8 websites an hour for one community, and 8 have been read in the last hour. Try again in about 10 minutes.",
    });
  });

  it("asks the same of the permission when it is missing", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Could not start looking at the website — your session has expired. Sign in again." });
    expect(await lookAtWebsiteAction()).toEqual({ ok: false, error: "Could not start looking at the website — your session has expired. Sign in again." });
  });
});

describe("checking on the websites", () => {
  it("fetches the report of a finished read once, and not again when the screen already has it", async () => {
    const db = world({ rpc: { site_found_status: status({ jobs: [doneJob] }), site_found_report: { id: 11, result: ownResult } } });
    const first = await siteStatusAction([]);
    expect(first.ok).toBe(true);
    expect(calls(db, "site_found_report")).toEqual([{ fn: "site_found_report", args: { p_center: "center-1", p_job: 11 } }]);
    expect(first.data?.views["11"]).toMatchObject({ ok: true, view: { mode: "own", site: "jsh.example.org" } });
    await siteStatusAction([11]);
    expect(calls(db, "site_found_report")).toHaveLength(1);
  });

  it("puts a report it cannot load next to that website instead of failing the whole screen", async () => {
    world({ rpc: { site_found_status: status({ jobs: [doneJob] }) }, failRpc: { site_found_report: { code: "P0001", message: "That report is not available: the website may still be read, or it was not read for this community." } } });
    const res = await siteStatusAction([]);
    expect(res.ok).toBe(true);
    expect(res.data?.views["11"]).toEqual({ ok: false, error: "Could not load what was found — That report is not available: the website may still be read, or it was not read for this community." });
  });

  it("says so when a report is not in a form the screen understands", async () => {
    world({ rpc: { site_found_status: status({ jobs: [doneJob] }), site_found_report: { id: 11, result: { schema: 9 } } } });
    const res = await siteStatusAction([]);
    expect(res.data?.views["11"]).toMatchObject({ ok: false, error: expect.stringContaining("not in a form this screen understands") });
  });

  it("fails in words, with the reason, when the status cannot be read", async () => {
    world({ failRpc: { site_found_status: { code: "42501", message: "permission denied" } } });
    expect(await siteStatusAction([])).toEqual({ ok: false, error: "Could not check on the websites — you don't have permission to make this change." });
  });

  it("fails in words when the database answers in another shape", async () => {
    world({ rpc: { site_found_status: { nothing: true } } });
    const res = await siteStatusAction([]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Could not check on the websites — the database answered in a shape this screen does not understand/);
  });
});

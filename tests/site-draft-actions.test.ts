import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ authorizeAction: vi.fn() }));
// The recording wrapper only notes the key and runs the action.
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: vi.fn((_key: string, action: () => Promise<unknown>) => action()) }));

import { revalidatePath } from "next/cache";

import { buildFirstDraftAction, setDraftPageStatusAction } from "@/app/(app)/setup/website/draft-actions";
import { withActivity } from "@/lib/activity/with-activity";
import { authorizeAction } from "@/lib/session";
import type { SiteDraft } from "@/lib/site-draft/types";

import { fakeDb, fakeSession, type FakeDbOptions } from "./commands/helpers";
import { JAIN, weaverJson } from "./fixtures/site-draft";
import { hostileReferenceResult, ownResult } from "./fixtures/site-found";

const OWN_URL = "https://www.jsh.example.org";
const REF_URL = "https://lovely-temple.example.net";
const status = (over: Record<string, unknown> = {}) => ({
  own_url: OWN_URL,
  reference_urls: [REF_URL],
  saved_at: "2026-10-11T09:00:00Z",
  profile_website: null,
  reads_last_hour: 0,
  max_reads_per_hour: 8,
  jobs: [],
  ...over,
});
const job = (id: number, slot: string, url: string, over: Record<string, unknown> = {}) => ({
  id,
  slot,
  mode: slot === "own" ? "own" : "reference",
  url,
  run: "r",
  status: "done",
  attempts: 1,
  max_attempts: 2,
  last_error: null,
  created_at: "2026-10-11T10:00:00Z",
  finished_at: "2026-10-11T10:01:00Z",
  pages_read: 7,
  ...over,
});
const OWN_JOB = job(11, "own", OWN_URL);
const REF_JOB = job(12, "ref1", REF_URL);

const stored = {
  site: { name: "Maple Hall Community", status: "draft", theme: {}, draft_version: 1, built_at: "2026-10-11T12:00:00Z", source_job: 11 },
  pages: [{ id: "00000000-0000-4000-8000-000000000001", slug: "home", title: "Home", kind: "home", sort: 0, status: "draft", approved_at: null, source_path: "/", block_count: 4, stand_ins: 0 }],
};

function world(opts: FakeDbOptions = {}, jobs: unknown[] = [OWN_JOB, REF_JOB], statusOver: Record<string, unknown> = {}) {
  const db = fakeDb({
    rpc: {
      site_found_status: status({ jobs, ...statusOver }),
      site_found_report: (args: Record<string, unknown>) => ({ id: args.p_job, result: args.p_job === 11 ? ownResult : hostileReferenceResult }),
      site_draft_data: weaverJson(),
      site_draft_save: { draft_version: 1, pages: 7, blocks: 20, replaced: false },
      site_draft_get: stored,
      site_page_set_status: { id: "x", slug: "home", status: "approved" },
      ...opts.rpc,
    },
    failRpc: opts.failRpc,
  });
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, session: fakeSession({ db, kind: JAIN }) });
  return db;
}
const calls = (db: ReturnType<typeof fakeDb>, fn: string) => db.rpcCalls.filter((c) => c.fn === fn);
const savedDraft = (db: ReturnType<typeof fakeDb>): SiteDraft => calls(db, "site_draft_save")[0]!.args.p_draft as SiteDraft;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(authorizeAction).mockReset();
  vi.mocked(withActivity).mockClear();
  vi.mocked(revalidatePath).mockClear();
});

describe("Build my first draft", () => {
  it("is recorded under its own activity key and asks for the Setup permission", async () => {
    world();
    await buildFirstDraftAction(false);
    expect(withActivity).toHaveBeenCalledWith("website.build_draft", expect.any(Function));
    expect(authorizeAction).toHaveBeenCalledWith("setup", "build the first draft of your website");
  });

  it("refuses a person without the permission and calls nothing", async () => {
    const db = fakeDb();
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Could not build the first draft of your website — you don't have permission (needs settings.manage)." });
    const res = await buildFirstDraftAction(false);
    expect(res).toEqual({ ok: false, error: "Could not build the first draft of your website — you don't have permission (needs settings.manage)." });
    expect(db.rpcCalls).toEqual([]);
  });

  it("builds the draft from the finished reads and Weaver's records, for the session's community, and stores it as the first draft", async () => {
    const db = world();
    const res = await buildFirstDraftAction(false);
    expect(res).toMatchObject({ ok: true });
    expect(res.message).toMatch(/^Your first draft is ready: \d+ pages\./);
    expect(res.message).toContain("Nothing is published");
    const [save] = calls(db, "site_draft_save");
    expect(save!.args).toMatchObject({ p_center: "center-1", p_job: 11, p_replace: false });
    const draft = savedDraft(db);
    expect(draft.name).toBe("Maple Hall Community");
    expect(draft.pages.map((p) => p.kind)).toEqual(expect.arrayContaining(["home", "about", "events", "give", "contact"]));
    // The old website's words are kept with the old page named; Weaver's events are in; the greeting is the kind's own.
    const blocks = draft.pages.flatMap((p) => p.blocks);
    expect(blocks.some((b) => b.source === "own_site" && b.source_page?.startsWith("https://www.jsh.example.org"))).toBe(true);
    expect(JSON.stringify(draft)).toContain("Harvest Supper");
    expect(JSON.stringify(draft)).toContain("Jai Jinendra");
    expect(res.data?.pages[0]).toMatchObject({ slug: "home", status: "draft", blocks: 4 });
    expect(revalidatePath).toHaveBeenCalledWith("/setup/website");
    expect(revalidatePath).toHaveBeenCalledWith("/setup/website/preview");
  });

  it("takes only layout and colours from a website the organization likes: none of its words reach the stored draft", async () => {
    const db = world();
    await buildFirstDraftAction(false);
    expect(JSON.stringify(savedDraft(db))).not.toMatch(/HOSTILE|lovely-temple|welcome every family to our temple/);
  });

  it("starts the draft again only when asked to", async () => {
    const db = world();
    await buildFirstDraftAction(true);
    expect(calls(db, "site_draft_save")[0]!.args).toMatchObject({ p_replace: true });
  });

  it("can build from a website the organization likes alone when it has no website of its own", async () => {
    const db = world({}, [REF_JOB], { own_url: null });
    const res = await buildFirstDraftAction(false);
    expect(res.ok).toBe(true);
    expect(calls(db, "site_draft_save")[0]!.args).not.toHaveProperty("p_job");
    expect(savedDraft(db).pages.flatMap((p) => p.blocks).some((b) => b.source === "own_site")).toBe(false);
  });

  it("asks to look at a website first when none has been read", async () => {
    const db = world({}, []);
    const res = await buildFirstDraftAction(false);
    expect(res).toEqual({ ok: false, error: "Could not build the first draft of your website — Weaver has not finished looking at your website yet. Wait for it to finish, or press Look at my website, then try again." });
    expect(calls(db, "site_draft_save")).toEqual([]);
    const none = world({}, [], { own_url: null, reference_urls: [] });
    expect(await buildFirstDraftAction(false)).toEqual({ ok: false, error: "Could not build the first draft of your website — Weaver has not looked at a website yet. Press Look at my website first." });
    expect(calls(none, "site_draft_save")).toEqual([]);
  });

  it("does not use a read of an address that was changed since, or one that has not finished", async () => {
    const db = world({}, [job(11, "own", "https://old-address.example.org"), job(13, "ref1", REF_URL, { status: "running", finished_at: null })]);
    const res = await buildFirstDraftAction(false);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("has not finished looking at your website");
    expect(calls(db, "site_draft_save")).toEqual([]);
    expect(calls(db, "site_found_report")).toEqual([]);
  });

  it("never says it built a draft when the database refused: the reason is shown instead", async () => {
    world({ failRpc: { site_draft_save: { code: "P0001", message: "This community already has a website draft. Start the draft again to replace it; the approvals on its pages will be cleared." } } });
    const res = await buildFirstDraftAction(false);
    expect(res).toEqual({ ok: false, error: "Could not build the first draft of your website — This community already has a website draft. Start the draft again to replace it; the approvals on its pages will be cleared." });
    expect(res.message).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("stops with the reason when Weaver's records cannot be read, and stores nothing", async () => {
    const db = world({ failRpc: { site_draft_data: { code: "XX000", message: "boom" } } });
    const res = await buildFirstDraftAction(false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^Could not build the first draft of your website — /);
    expect(calls(db, "site_draft_save")).toEqual([]);
  });

  it("stops with the reason when a finished read cannot be fetched or is not a report it understands", async () => {
    const a = world({ failRpc: { site_found_report: { code: "XX000", message: "boom" } } });
    expect((await buildFirstDraftAction(false)).ok).toBe(false);
    expect(calls(a, "site_draft_save")).toEqual([]);
    const b = world({ rpc: { site_found_report: { id: 11, result: { nonsense: true } } } });
    const res = await buildFirstDraftAction(false);
    expect(res.error).toContain("the report of your website is not in a form Weaver understands");
    expect(calls(b, "site_draft_save")).toEqual([]);
  });

  it("says it built the draft even when the summary cannot be read back, and says nothing is shown", async () => {
    world({ failRpc: { site_draft_get: { code: "XX000", message: "boom" } } });
    const res = await buildFirstDraftAction(false);
    expect(res).toMatchObject({ ok: true });
    expect(res.data).toBeUndefined();
  });
});

describe("Approve page", () => {
  const PAGE = "00000000-0000-4000-8000-000000000001";

  it("is recorded under its own activity key and asks for the Setup permission", async () => {
    world();
    await setDraftPageStatusAction(PAGE, "approved");
    expect(withActivity).toHaveBeenCalledWith("website.approve_page", expect.any(Function));
    expect(authorizeAction).toHaveBeenCalledWith("setup", "approve this page");
    await setDraftPageStatusAction(PAGE, "draft");
    expect(authorizeAction).toHaveBeenCalledWith("setup", "reopen this page");
  });

  it("approves a page for the session's community and says nothing is published", async () => {
    const db = world();
    const res = await setDraftPageStatusAction(PAGE, "approved");
    expect(res).toEqual({ ok: true, message: "Page approved. Nothing is published yet.", data: { pageId: PAGE, status: "approved" } });
    expect(calls(db, "site_page_set_status")).toEqual([{ fn: "site_page_set_status", args: { p_center: "center-1", p_page: PAGE, p_status: "approved" } }]);
    expect(revalidatePath).toHaveBeenCalledWith("/setup/website/preview");
  });

  it("reopens a page", async () => {
    const db = world();
    const res = await setDraftPageStatusAction(PAGE, "draft");
    expect(res).toMatchObject({ ok: true, message: "Page reopened as a draft.", data: { status: "draft" } });
    expect(calls(db, "site_page_set_status")[0]!.args.p_status).toBe("draft");
  });

  it("refuses anything but a page and a status Weaver knows, before the database is asked", async () => {
    const db = world();
    expect(await setDraftPageStatusAction("not-a-page", "approved")).toEqual({ ok: false, error: "Could not approve this page — Weaver does not know which page that is." });
    expect(await setDraftPageStatusAction(PAGE, "published")).toEqual({ ok: false, error: "Could not reopen this page — a page is either a draft or approved." });
    expect(db.rpcCalls).toEqual([]);
  });

  it("never says a page is approved when the database refused", async () => {
    world({ failRpc: { site_page_set_status: { code: "42501", message: "Approving a page of the website draft needs the settings.manage permission." } } });
    const res = await setDraftPageStatusAction(PAGE, "approved");
    expect(res).toEqual({ ok: false, error: "Could not approve this page — you don't have permission to make this change." });
    expect(res.message).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});


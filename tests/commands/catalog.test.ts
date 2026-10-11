import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { revalidatePath } from "next/cache";

import { CATALOG } from "@/lib/commands/catalog";
import { PEOPLE_COMMANDS } from "@/lib/commands/catalog/people";
import { pickSaved } from "@/lib/commands/catalog/messages-draft-reminder";
import { summarizeBehind } from "@/lib/commands/catalog/pledges-behind";
import { draftReminder, fillTemplate, whenText } from "@/lib/commands/catalog/reminder-text";
import { CommandRegistry } from "@/lib/commands/registry";
import { confirmProposal, runCommand } from "@/lib/commands/run";
import type { CommandRunResult, CommandVia } from "@/lib/commands/types";
import { loadHomeTasks } from "@/lib/data/home-tasks";

import { addEventsWorld, EV } from "./events-world";
import { CHILDREN, communityWithChildren, fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

const DIWALI = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001";
const PICNIC = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1003";
const CANCELLED = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1004";

const ALL_PERMISSIONS = ["people.view", "people.manage", "people.approve", "giving.view", "events.view", "events.manage", "comms.send", "accounting.close"];

function catalogRegistry() {
  const r = new CommandRegistry();
  for (const c of CATALOG) r.register(c);
  return r;
}

function setup(opts: { via?: CommandVia; permissions?: string[]; world?: FakeDbOptions; rules?: unknown } = {}) {
  const db = fakeDb(opts.world ?? communityWithChildren());
  const session = fakeSession({
    db,
    permissions: opts.permissions ?? ALL_PERMISSIONS,
    center: { ...fakeSession().center, rules: opts.rules ?? {} },
  });
  const ctx = testContext({ session, registry: catalogRegistry(), via: opts.via ?? "screen", minorNames: CHILDREN.full });
  return { ctx, db, session };
}

const dataOf = <T,>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(loadHomeTasks).mockReset();
});

// ---------------------------------------------------------------------------
describe("the first commands", () => {
  it("start with these, and every write is a confirm command, switched off by default", () => {
    const expected = [
      "people.search:read",
      "tasks.mine:read",
      "giving.pledges_behind:read",
      "accounting.month_close_blockers:read",
      "messages.draft_reminder:draft",
      // The Events commands (tests/commands/events-commands.test.ts has their own list and behaviour).
      "events.upcoming:read",
      "events.summary:read",
      "events.readiness:read",
      "events.audience_preview:read",
      "events.rsvps:read",
      "events.draft_change:draft",
      "events.clone_draft:draft",
      "events.set_field:confirm",
      "events.set_status:confirm",
      "events.set_rsvp_status:confirm",
      "events.assign_volunteer:confirm",
      "events.create_from_clone:confirm",
    ];
    // The Events commands are followed by other workspaces' commands (People: tests/commands/people-reads.test.ts).
    expect(CATALOG.slice(0, expected.length).map((c) => `${c.key}:${c.level}`)).toEqual(expected);
    const confirm = CATALOG.filter((c) => c.level === "confirm");
    expect(confirm.map((c) => c.key)).toContain("events.set_field");
    for (const c of confirm) expect(c.enabledByDefault, c.key).not.toBe(true);
  });

  it("have no money, role, permission or delete commands", () => {
    // A merge changes records and is asked about first, like every write; it is never a read or a draft.
    for (const c of CATALOG) if (/merge/.test(c.key)) expect(c.level).toBe("confirm");
    for (const c of CATALOG) expect(c.key).not.toMatch(/record|payment|refund|write_?off|role|permission|grant|delete|remove|approve|send|schedule/);
    // The one that changes a detail is a single-detail event change; its fields never include prices, status or the owner.
    expect(JSON.stringify(CATALOG.find((c) => c.key === "events.set_field")!.input.json())).not.toMatch(/price|status|owner|confidential/);
  });

  it("are described for a model", () => {
    for (const c of CATALOG) {
      expect(c.title.length).toBeGreaterThan(8);
      expect(c.description.length).toBeGreaterThan(80);
      expect(c.description).not.toMatch(/\bbid\b/i);
    }
  });

  it("are all visible to a person with every permission, and none to a person with none", () => {
    const { session } = setup();
    expect(catalogRegistry().list(session).map((c) => c.key)).toHaveLength(CATALOG.length - 0);
    const none = fakeSession({ permissions: [] });
    // tasks.mine is open to everyone signed in; every other command needs a permission.
    expect(catalogRegistry().list(none).map((c) => c.key)).toEqual(["tasks.mine"]);
  });

  it("hide a command from Niva when its module is off for the community, and offer Niva no write until it is switched on", () => {
    const { session } = setup();
    expect(catalogRegistry().modelTools(session).map((t) => t.name)).not.toContain("events_set_field");
    const on = setup({ rules: { assistant: { tools: { "events.set_field": true } } } }).session;
    expect(catalogRegistry().modelTools(on).map((t) => t.name)).toContain("events_set_field");
    const noGiving = fakeSession({ permissions: ALL_PERMISSIONS, modulesOff: ["giving", "accounting"] });
    expect(catalogRegistry().list(noGiving).map((c) => c.key)).not.toContain("giving.pledges_behind");
    expect(catalogRegistry().list(noGiving).map((c) => c.key)).not.toContain("accounting.month_close_blockers");
  });
});

// ---------------------------------------------------------------------------
describe("people.search", () => {
  it("answers with household cards, never a name alone, and the adults of each household only", async () => {
    const { ctx } = setup();
    const r = await runCommand(ctx, "people.search", { query: "Shah" });
    const data = dataOf<{ count: number; results: { household: Record<string, unknown>; matched_on: string[] }[] }>(r);
    expect(data.count).toBe(3);
    const shah = data.results.find((x) => x.household.household_id === "hh-shah")!.household;
    expect(shah).toMatchObject({
      household_number: "H-1001",
      org_household_id: "2041",
      adults: ["Priya Shah", "Rahul Shah"],
      primary_adult: "Priya Shah",
      city: "Naperville",
      zone: "North",
      last_gift_on: "2026-09-14",
      open_pledge_cents: 250000,
      open_pledge: "$2,500.00",
      household_name: "Shah, Priya, Rahul",
    });
    const patel = data.results.find((x) => x.household.household_id === "hh-patel")!.household;
    expect(patel.adults).toEqual(["Nikhil Patel"]);
  });

  it("never returns a child's name, birth date or the card's text of everyone's names", async () => {
    for (const via of ["screen", "assistant"] as const) {
      const { ctx } = setup({ via });
      const text = JSON.stringify(await runCommand(ctx, "people.search", { query: "Shah" }));
      for (const word of [...CHILDREN.first, ...CHILDREN.full, "date_of_birth", "2018-05-05", "members", "primary_member"]) expect(text).not.toContain(word);
    }
  });

  it("says which ID matched, leaving out an ID that belongs to a child", async () => {
    const world = communityWithChildren();
    world.rpc.resolve_identifier = [
      { kind: "org_member", system: "jsh", value: "0417", person_id: "p-priya", household_id: "hh-shah", display_name: "Priya Shah", household_name: null, household_number: null, org_household_id: null, members: "Priya, Zoya" },
      { kind: "org_member", system: "jsh", value: "0999", person_id: "p-zoya", household_id: "hh-shah", display_name: "Zoya Shah", household_name: null, household_number: null, org_household_id: null, members: "Priya, Zoya" },
      { kind: "org_household", system: "jsh", value: "2042", person_id: null, household_id: "hh-patel", display_name: null, household_name: "Patel family", household_number: null, org_household_id: "2042", members: null },
    ] as never;
    const { ctx } = setup({ world });
    const data = dataOf<{ results: { household: { household_id: string }; matched_on: string[] }[] }>(await runCommand(ctx, "people.search", { query: "0417" }));
    expect(data.results.find((x) => x.household.household_id === "hh-shah")!.matched_on).toEqual(["Organization member ID 0417"]);
    expect(data.results.find((x) => x.household.household_id === "hh-patel")!.matched_on).toEqual(["Organization household ID 2042"]);
    expect(JSON.stringify(data)).not.toContain("0999");
  });

  it("says when nothing matched, and when the search is too short", async () => {
    const { ctx } = setup({ world: { tables: {}, rpc: {} } });
    const r = await runCommand(ctx, "people.search", { query: "Nobody" });
    expect(r).toMatchObject({ ok: true, data: { count: 0, results: [] }, message: "Nothing matched that search." });
    expect(await runCommand(ctx, "people.search", { query: "a" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("explains a database problem instead of showing an empty list", async () => {
    const { ctx } = setup({ world: { ...communityWithChildren(), failTables: { households: { code: "42501", message: "permission denied for table households" } } } });
    const r = await runCommand(ctx, "people.search", { query: "Shah" });
    expect(r).toMatchObject({ ok: false, error: "Could not search households and people — you don't have permission to make this change." });
  });

  it("needs a permission to look people up", async () => {
    const { ctx } = setup({ permissions: ["events.view"] });
    expect(await runCommand(ctx, "people.search", { query: "Shah" })).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("tasks.mine", () => {
  it("lists the work waiting, and says what it could not read", async () => {
    vi.mocked(loadHomeTasks).mockResolvedValue({
      tasks: [{ id: "refund:1", source: "refund", tag: "Refund", color: "danger", title: "Approve refund of $40.00 · H-1001", meta: "Approved first by Meera", links: [{ label: "Review", href: "/giving/payments" }] }],
      failures: [{ source: "deposits", tag: "Deposits", message: "the database could not be reached — check the connection and try again" }],
    } as never);
    const { ctx } = setup({ permissions: [] });
    const data = dataOf<{ count: number; tasks: unknown[]; could_not_load: unknown[] }>(await runCommand(ctx, "tasks.mine", {}));
    expect(data.count).toBe(1);
    expect(data.tasks[0]).toEqual({ id: "refund:1", area: "Refund", title: "Approve refund of $40.00 · H-1001", detail: "Approved first by Meera", open: [{ label: "Review", href: "/giving/payments" }] });
    expect(data.could_not_load).toEqual([{ area: "Deposits", reason: "the database could not be reached — check the connection and try again" }]);
  });

  it("says so when nothing is waiting", async () => {
    vi.mocked(loadHomeTasks).mockResolvedValue({ tasks: [], failures: [] });
    const { ctx } = setup();
    expect(await runCommand(ctx, "tasks.mine", {})).toMatchObject({ ok: true, message: "Nothing is waiting." });
  });

  it("is cleaned for Niva: a child's full name in a task title does not get through", async () => {
    vi.mocked(loadHomeTasks).mockResolvedValue({
      tasks: [{ id: "pathshala:1", source: "pathshala", tag: "Pathshala", color: "purple", title: "Sign-off for Zoya Shah", meta: "Level 2", links: [] }],
      failures: [],
    } as never);
    const { ctx } = setup({ via: "assistant" });
    expect(JSON.stringify(await runCommand(ctx, "tasks.mine", {}))).not.toContain("Zoya Shah");
  });
});

// ---------------------------------------------------------------------------
describe("events.upcoming", () => {
  it("lists upcoming events, leaving out past and cancelled ones", async () => {
    const { ctx } = setup();
    const data = dataOf<{ count: number; events: { id: string; number: string; name: string; status: string; who_can_rsvp: string; capacity: number | null; venue: string | null }[] }>(
      await runCommand(ctx, "events.upcoming", {}),
    );
    expect(data.events.map((e) => e.name).sort()).toEqual(["Diwali Dinner", "Garba Night"]);
    const diwali = data.events.find((e) => e.id === DIWALI)!;
    expect(diwali).toMatchObject({ number: "EV-12", status: "RSVP open", who_can_rsvp: "Everyone", capacity: 300, venue: "Main Hall" });
    expect(data.events.map((e) => e.id)).not.toContain(PICNIC);
    expect(data.events.map((e) => e.id)).not.toContain(CANCELLED);
  });

  it("looks only as far ahead as asked", async () => {
    const { ctx } = setup();
    const r = await runCommand(ctx, "events.upcoming", { days: 3 });
    expect(r).toMatchObject({ ok: true, data: { count: 0 }, message: "No events in the next 3 days." });
    expect(await runCommand(ctx, "events.upcoming", { days: 400 })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("is off when the Events module is off", async () => {
    const { session } = setup();
    const ctx = testContext({ session: fakeSession({ db: session.db, permissions: ALL_PERMISSIONS, modulesOff: ["events"] }), registry: catalogRegistry() });
    expect(await runCommand(ctx, "events.upcoming", {})).toMatchObject({ ok: false, code: "module_off" });
  });
});

// ---------------------------------------------------------------------------
describe("giving.pledges_behind", () => {
  const TODAY = "2026-10-10";
  const pledges = communityWithChildren().tables.pledges as never[];

  it("counts a pledge behind when it is past its due date, or 30 days after it was made when it has none", () => {
    const all = summarizeBehind(pledges, TODAY, "America/Chicago", 1);
    expect(all.ranked.map(([id, h]) => [id, h.open, h.oldest])).toEqual([
      ["hh-shah", 250000, 102],
      ["hh-mehta", 4500, 21],
    ]);
    expect(all).toMatchObject({ pledgesBehind: 2, totalOpen: 254500, households: 2 });
    expect(summarizeBehind(pledges, TODAY, "America/Chicago", 30).ranked.map(([id]) => id)).toEqual(["hh-shah"]);
  });

  it("keeps money in whole cents, and leaves out a pledge that is paid", () => {
    const rows = [{ id: "a", household_id: "h", amount_cents: 10001, paid_cents: 10001, pledged_at: "2026-01-01T00:00:00Z", due_on: "2026-02-01" }, { id: "b", household_id: "h", amount_cents: 333, paid_cents: 1, pledged_at: "2026-01-01T00:00:00Z", due_on: "2026-02-01" }];
    expect(summarizeBehind(rows, TODAY, "America/Chicago", 1).totalOpen).toBe(332);
  });

  it("lists households as cards, biggest balance first, adults only, with dollars", async () => {
    const { ctx } = setup();
    const data = dataOf<{ households_behind: number; total_open_cents: number; total_open: string; showing: { household: Record<string, unknown>; open: string; open_cents: number; oldest_days_overdue: number; pledges_behind: number }[] }>(
      await runCommand(ctx, "giving.pledges_behind", {}),
    );
    expect(data).toMatchObject({ households_behind: 2, total_open_cents: 254500, total_open: "$2,545.00" });
    expect(data.showing.map((s) => s.household.household_number)).toEqual(["H-1001", "H-1003"]);
    expect(data.showing[0]).toMatchObject({ open: "$2,500.00", open_cents: 250000, oldest_days_overdue: 102, pledges_behind: 1 });
    expect(data.showing[0].household).toMatchObject({ adults: ["Priya Shah", "Rahul Shah"], household_name: "Shah, Priya, Rahul" });
    const text = JSON.stringify(data);
    for (const word of [...CHILDREN.first, "date_of_birth"]) expect(text).not.toContain(word);
  });

  it("says when nobody is behind, and respects the limit", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "giving.pledges_behind", { min_days_overdue: 500 })).toMatchObject({ ok: true, message: "Nobody is behind on pledges." });
    expect(await runCommand(ctx, "giving.pledges_behind", { limit: 1 })).toMatchObject({ ok: true, message: "Showing 1 of 2 households." });
  });

  it("explains a database problem, never a silently shorter list", async () => {
    const { ctx } = setup({ world: { ...communityWithChildren(), failTables: { pledges: { code: "42501", message: "permission denied" } } } });
    expect(await runCommand(ctx, "giving.pledges_behind", {})).toMatchObject({ ok: false, error: "Could not read the pledges — you don't have permission to make this change." });
  });
});

// ---------------------------------------------------------------------------
describe("accounting.month_close_blockers", () => {
  it("lists what blocks the lock, as the Month-end close screen reads it", async () => {
    const { ctx } = setup();
    const data = dataOf<{ month: string; locked: boolean; ready_to_lock: boolean; blockers: { item: string; why: string }[]; done: string[] }>(await runCommand(ctx, "accounting.month_close_blockers", {}));
    expect(data.month).toBe("October 2026");
    expect(data).toMatchObject({ locked: false, ready_to_lock: false });
    expect(data.blockers.map((b) => b.item)).toEqual(["Payment payouts matched to bank deposits", "Refunds reviewed and approved", "Pledge statements generated"]);
    expect(data.done).toEqual(["All QuickBooks exceptions cleared"]);
  });

  it("names refunds that still wait for two approvals", async () => {
    const world = communityWithChildren();
    world.rpc.flagged_refund_count = 2;
    const { ctx } = setup({ world });
    const data = dataOf<{ blockers: { item: string; why: string }[] }>(await runCommand(ctx, "accounting.month_close_blockers", {}));
    expect(data.blockers.find((b) => b.item === "Refunds reviewed and approved")!.why).toContain("2 refunds made in Stripe or PayPal wait for two approvals");
  });

  it("says ready when every item is done, and locked when the month is closed", async () => {
    const world = communityWithChildren();
    world.tables.accounting_periods = [{ center_id: "center-1", period_month: "2026-09-01", status: "open", checklist: { payouts_matched: true, refunds_reviewed: true, statements_generated: true } }];
    const { ctx } = setup({ world });
    const ready = await runCommand(ctx, "accounting.month_close_blockers", { month: "2026-09-15" });
    expect(ready).toMatchObject({ ok: true, data: { month: "September 2026", ready_to_lock: true, blockers: [] }, message: "Nothing is blocking the lock for September 2026." });
    world.tables.accounting_periods[0].status = "closed";
    expect(await runCommand(ctx, "accounting.month_close_blockers", { month: "2026-09-15" })).toMatchObject({ ok: true, data: { locked: true, ready_to_lock: false }, message: "September 2026 is already locked." });
  });

  it("says when it could not count the QuickBooks exceptions, instead of calling them zero", async () => {
    const { ctx } = setup({ world: { ...communityWithChildren(), failTables: { ledger_postings: { code: "42501", message: "permission denied" } } } });
    const data = dataOf<{ blockers: { item: string; why: string }[] }>(await runCommand(ctx, "accounting.month_close_blockers", {}));
    expect(data.blockers[0]).toEqual({ item: "All QuickBooks exceptions cleared", why: "Could not count the exceptions" });
  });

  it("needs the month-end permission", async () => {
    const { ctx } = setup({ permissions: ["people.view"] });
    expect(await runCommand(ctx, "accounting.month_close_blockers", {})).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("reminder wording", () => {
  const event = { name: "Diwali Dinner", starts_at: "2026-10-24T23:30:00Z", venue: "Main Hall" };
  const center = { name: "Jain Society", short_name: "JSH" };

  it("is the same every time for the same event", () => {
    const a = draftReminder({ kind: "event_reminder", language: "gu", event, tz: "America/Chicago", center });
    const b = draftReminder({ kind: "event_reminder", language: "gu", event, tz: "America/Chicago", center });
    expect(a).toEqual(b);
  });

  it("fills the English wording of the platform's RSVP confirmation", () => {
    const d = draftReminder({ kind: "rsvp_confirmation", language: "en", event, tz: "America/Chicago", center });
    expect(d).toMatchObject({ subject: "Please confirm Diwali Dinner", source: "built_in" });
    expect(d.body).toBe("Your family is signed up for Diwali Dinner on Saturday, October 24 at 6:30 PM. Please confirm that you are coming.");
  });

  it("speaks Gujarati and Hindi, with the event, the time and the venue in place", () => {
    const gu = draftReminder({ kind: "event_reminder", language: "gu", event, tz: "America/Chicago", center });
    const hi = draftReminder({ kind: "event_reminder", language: "hi", event, tz: "America/Chicago", center });
    expect(gu.subject).toBe("યાદ અપાવવા માટે: Diwali Dinner");
    expect(gu.body).toContain("Diwali Dinner");
    expect(gu.body).toContain("6:30 PM વાગ્યે");
    expect(gu.body).toContain("સ્થળ: Main Hall.");
    expect(gu.body).toMatch(/[઀-૿]/);
    expect(hi.subject).toBe("अनुस्मारक: Diwali Dinner");
    expect(hi.body).toContain("6:30 pm बजे");
    expect(hi.body).toContain("स्थान: Main Hall।");
    expect(hi.body).toMatch(/[ऀ-ॿ]/);
    for (const d of [gu, hi]) expect(d.body).not.toMatch(/\{\{|\}\}/);
  });

  it("leaves the venue out when there is none, and says when the date is not set", () => {
    const d = draftReminder({ kind: "event_reminder", language: "en", event: { ...event, venue: null }, tz: "America/Chicago", center });
    expect(d.body).toBe("This is a reminder that Diwali Dinner is on Saturday, October 24 at 6:30 PM. We look forward to seeing you.");
    expect(whenText(null, "America/Chicago", "hi")).toMatch(/अभी तय नहीं हुई/);
  });

  it("uses a community's saved template when there is one, and says what it could not fill", () => {
    const d = draftReminder({ kind: "rsvp_confirmation", language: "en", event, tz: "America/Chicago", center, saved: { subject: "{{center_short_name}}: {{event}}", body: "See you at {{venue}} on {{when}}. {{unknown_thing}}" } });
    expect(d).toMatchObject({ source: "community_template", subject: "JSH: Diwali Dinner", unfilled: ["unknown_thing"] });
    expect(d.body).toBe("See you at Main Hall on Saturday, October 24 at 6:30 PM. {{unknown_thing}}");
    expect(fillTemplate("{{a}} {{b}}", { a: "1" })).toEqual({ text: "1 {{b}}", unfilled: ["b"] });
  });

  it("picks the community's own template over the platform's, then the newest", () => {
    const rows = [
      { language: "gu", subject: "platform", body: "p", center_id: null, version: 9 },
      { language: "gu", subject: "mine old", body: "m1", center_id: "center-1", version: 1 },
      { language: "gu", subject: "mine new", body: "m2", center_id: "center-1", version: 2 },
      { language: "fr", subject: "x", body: "x", center_id: null, version: 1 },
    ];
    const saved = pickSaved(rows, "center-1");
    expect(saved.get("gu")).toEqual({ subject: "mine new", body: "m2" });
    expect(saved.has("en")).toBe(false);
  });
});

describe("messages.draft_reminder", () => {
  it("drafts the reminder in all three languages, and sends nothing", async () => {
    const { ctx, db } = setup();
    const r = await runCommand(ctx, "messages.draft_reminder", { event_id: DIWALI });
    const data = dataOf<{ event: { name: string }; drafts: { language: string; subject: string; body: string; source: string }[]; sent: boolean; notes: string[] }>(r);
    expect(data.event.name).toBe("Diwali Dinner");
    expect(data.drafts.map((d) => d.language)).toEqual(["en", "gu", "hi"]);
    expect(data.sent).toBe(false);
    expect(data.notes.join(" ")).toContain("Ask someone who reads the language");
    expect(r).toMatchObject({ message: "This is a draft. Nothing has been sent or scheduled." });
    expect(db.calls.every((c) => c.op === "select")).toBe(true);
    expect(db.rpcCalls.map((c) => c.fn)).toEqual([]);
  });

  it("drafts one language, or an RSVP confirmation from the saved template", async () => {
    const world = communityWithChildren();
    world.tables.message_templates = [
      { key: "rsvp_confirmation", channel: "push", language: "gu", subject: "ખાતરી: {{event}}", body: "{{event}} {{when}}", center_id: "center-1", version: 1 },
    ];
    const { ctx } = setup({ world });
    const data = dataOf<{ drafts: { language: string; source: string; subject: string }[] }>(await runCommand(ctx, "messages.draft_reminder", { event_id: DIWALI, kind: "rsvp_confirmation", language: "gu" }));
    expect(data.drafts).toEqual([expect.objectContaining({ language: "gu", source: "community_template", subject: "ખાતરી: Diwali Dinner" })]);
  });

  it("says when the saved templates could not be read, and still drafts", async () => {
    const { ctx } = setup({ world: { ...communityWithChildren(), failTables: { message_templates: { code: "42501", message: "permission denied" } } } });
    const data = dataOf<{ drafts: unknown[]; notes: string[] }>(await runCommand(ctx, "messages.draft_reminder", { event_id: DIWALI, kind: "rsvp_confirmation" }));
    expect(data.drafts).toHaveLength(3);
    expect(data.notes[0]).toBe("Could not read the community's saved templates, so this uses the wording built into Weaver.");
  });

  it("explains an event that is missing or cancelled", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "messages.draft_reminder", { event_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9999" })).toMatchObject({ ok: false, error: "That event was not found, or you can't see it." });
    expect(await runCommand(ctx, "messages.draft_reminder", { event_id: CANCELLED })).toMatchObject({ ok: false, error: "Cancelled Quiz is cancelled, so there is nothing to remind families about." });
  });
});

// ---------------------------------------------------------------------------
describe("events.draft_change", () => {
  it("shows before and after, and changes nothing", async () => {
    const { ctx, db } = setup();
    const r = await runCommand(ctx, "events.draft_change", { event_id: DIWALI, field: "venue", value: "Hall B" });
    expect(r).toMatchObject({
      ok: true,
      data: { event: { id: DIWALI, name: "Diwali Dinner" }, field: "venue", label: "Venue", before: "Main Hall", after: "Hall B", changed: true },
      message: "Nothing has been changed yet.",
    });
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("reads each kind of value the way the builder does", async () => {
    const { ctx } = setup();
    const show = async (field: string, value: string) => (await runCommand(ctx, "events.draft_change", { event_id: DIWALI, field, value })) as { ok: boolean; data?: { before: string; after: string }; error?: string };
    expect((await show("capacity", "")).data).toMatchObject({ before: "300", after: "No limit" });
    expect((await show("capacity", "250")).data).toMatchObject({ after: "250" });
    expect((await show("confirmation_hours_before", "0")).data).toMatchObject({ before: "24 hours before the event", after: "Off" });
    expect((await show("waitlist_enabled", "no")).data).toMatchObject({ before: "Yes", after: "No" });
    expect((await show("starts_at", "2026-10-24T19:00")).data).toMatchObject({ after: "Sat, Oct 24, 7:00 PM" });
    expect((await show("ends_at", "")).data).toMatchObject({ after: "Not set" });
    expect((await show("description", "")).data).toMatchObject({ before: "Dinner and aarti", after: "Not set" });
  });

  it("refuses what the builder would refuse, in a sentence", async () => {
    const { ctx } = setup();
    const err = async (field: string, value: string) => ((await runCommand(ctx, "events.draft_change", { event_id: DIWALI, field, value })) as { error: string }).error;
    expect(await err("name", "")).toBe("Event name is required.");
    expect(await err("capacity", "many")).toBe("Capacity must be a whole number.");
    expect(await err("capacity", "-5")).toBe("Capacity must be a whole number.");
    expect(await err("confirmation_hours_before", "500")).toBe("Confirmation reminder must be at most 336.");
    expect(await err("starts_at", "next Friday")).toBe("Starts must be a date and time like 2026-11-08T11:30.");
    expect(await err("starts_at", "2026-02-31T10:00")).toBe("Starts must be a date and time like 2026-11-08T11:30.");
    expect(await err("waitlist_enabled", "maybe")).toBe("Waitlist must be yes or no.");
    expect(await err("starts_at", "2026-10-26T10:00")).toBe("The event must end after it starts. Change the end time as well, or choose a later one.");
  });

  it("will not take a field it does not own (price, status, owner)", async () => {
    const { ctx } = setup();
    for (const field of ["member_price_cents", "status", "owner_person_id", "confidential", "lunch_starts_at"]) {
      expect(await runCommand(ctx, "events.draft_change", { event_id: DIWALI, field, value: "1" })).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it("leaves a finished or cancelled event to the Events screen", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "events.draft_change", { event_id: PICNIC, field: "venue", value: "Hall" })).toMatchObject({
      ok: false,
      error: "Old Picnic is completed, so Niva will not change it. If it really needs fixing, do it on the Events screen.",
    });
  });

  it("says when there is nothing to change", async () => {
    const { ctx } = setup();
    expect(await runCommand(ctx, "events.draft_change", { event_id: DIWALI, field: "venue", value: "Main Hall" })).toMatchObject({ ok: true, data: { changed: false }, message: "Diwali Dinner already has that venue." });
  });

  it("needs the event permission", async () => {
    const { ctx } = setup({ permissions: ["events.view"] });
    expect(await runCommand(ctx, "events.draft_change", { event_id: DIWALI, field: "venue", value: "Hall" })).toMatchObject({ ok: false, code: "no_access" });
  });
});

describe("events.set_field (confirm, off until the owner switches it on)", () => {
  const ENABLED = { assistant: { tools: { "events.set_field": true } } };

  it("is not available to Niva until switched on", async () => {
    const { ctx } = setup({ via: "assistant" });
    expect(await runCommand(ctx, "events.set_field", { event_id: DIWALI, field: "venue", value: "Hall B" })).toMatchObject({ ok: false, code: "switched_off" });
  });

  it("asks first, showing before and after, and does not write", async () => {
    const { ctx, db } = setup({ via: "assistant", rules: ENABLED });
    const r = await runCommand(ctx, "events.set_field", { event_id: DIWALI, field: "venue", value: "Hall B" });
    expect(r).toMatchObject({
      ok: true,
      needsConfirmation: true,
      confirmText: "Yes, change the venue of Diwali Dinner",
      preview: {
        summary: "Change the venue of Diwali Dinner.",
        lines: [{ label: "Venue", before: "Main Hall", after: "Hall B" }],
        warnings: ["Families who already RSVP'd will see the new detail in the app. Nothing is sent to them automatically."],
      },
    });
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("writes the one detail once the person confirms, and refreshes the Events screens", async () => {
    const { ctx, db } = setup({ via: "assistant", rules: ENABLED });
    const t = (await runCommand(ctx, "events.set_field", { event_id: DIWALI, field: "venue", value: "Hall B" })) as { proposalId: string; inputHash: string };
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: true, message: "Changed the venue of Diwali Dinner from Main Hall to Hall B.", data: { changed: true, before: "Main Hall", after: "Hall B" } });
    const writes = db.calls.filter((c) => c.op === "update");
    expect(writes).toEqual([{ table: "events", op: "update", patch: { venue: "Hall B" }, ids: [DIWALI] }]);
    expect(revalidatePath).toHaveBeenCalledWith("/events", "layout");
    // A second confirmation does nothing.
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: false });
    expect(db.calls.filter((c) => c.op === "update")).toHaveLength(1);
  });

  it("stores a date as the moment it means in the community's time zone", async () => {
    const { ctx, db } = setup({ rules: ENABLED });
    const t = (await runCommand(ctx, "events.set_field", { event_id: DIWALI, field: "starts_at", value: "2026-10-24T19:00" })) as { proposalId: string; inputHash: string };
    await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(db.calls.find((c) => c.op === "update")!.patch).toEqual({ starts_at: "2026-10-25T00:00:00.000Z" });
  });

  it("reads the event again when confirmed, so a change in between is not overwritten blindly", async () => {
    const world = communityWithChildren();
    const { ctx } = setup({ world, rules: ENABLED });
    const t = (await runCommand(ctx, "events.set_field", { event_id: DIWALI, field: "venue", value: "Hall B" })) as { proposalId: string; inputHash: string };
    // Someone else completes the event before the person confirms.
    world.tables.events[0].status = "completed";
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, error: "Diwali Dinner is completed, so Niva will not change it. If it really needs fixing, do it on the Events screen." });
    expect(world.tables.events[0].venue).toBe("Main Hall");
  });

  it("says when the value is already what is asked", async () => {
    const { ctx, db } = setup({ rules: ENABLED });
    const t = (await runCommand(ctx, "events.set_field", { event_id: DIWALI, field: "venue", value: "Main Hall" })) as { proposalId: string; inputHash: string; preview: { warnings: string[] } };
    expect(t.preview.warnings).toContain("It already has this value, so nothing would change.");
    expect(await confirmProposal(ctx, t.proposalId, t.inputHash)).toMatchObject({ ok: true, message: "Diwali Dinner already had that venue, so nothing changed." });
    expect(db.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("explains a database refusal and does not say it saved", async () => {
    const world = communityWithChildren();
    const { ctx } = setup({ world, rules: ENABLED });
    const t = (await runCommand(ctx, "events.set_field", { event_id: DIWALI, field: "venue", value: "Hall B" })) as { proposalId: string; inputHash: string };
    // The database refuses the write (the fake reads its options when called).
    world.failUpdates = { events: { code: "42501", message: "new row violates row-level security policy" } };
    const r = await confirmProposal(ctx, t.proposalId, t.inputHash);
    expect(r).toMatchObject({ ok: false, error: "Could not change the event — you don't have permission to make this change." });
    expect(JSON.stringify(r)).not.toMatch(/Changed the/);
    expect(world.tables.events[0].venue).toBe("Main Hall");
  });
});

// ---------------------------------------------------------------------------
// The check that fails if a child's name reaches a result (decision D2).
// ---------------------------------------------------------------------------
describe("no command result reaches a model with a child in it", () => {
  /** The People commands take real ids, so they run against their own community (a UUID world with children in it) in people-reads.test.ts. */
  const OWN_WORLD = new Set(PEOPLE_COMMANDS.map((c) => c.key));

  /** A plausible input for every command in the catalog. A new command must be added here, or this file fails. */
  const SAMPLE_INPUT: Record<string, unknown> = {
    "people.search": { query: "Shah" },
    "tasks.mine": {},
    "events.upcoming": {},
    "events.summary": { event_id: DIWALI },
    "events.readiness": { event_id: DIWALI },
    "events.audience_preview": { event_id: DIWALI },
    "events.rsvps": { event_id: DIWALI },
    "events.clone_draft": { find: "Old Picnic", new_date: "2027-06-01" },
    "events.set_status": { event_id: DIWALI, status: "rsvp_closed" },
    "events.set_rsvp_status": { event_id: DIWALI, rsvp_id: EV.rsvpShah, status: "cancelled" },
    "events.assign_volunteer": { event_id: DIWALI, shift_id: EV.shiftFood, person_ids: EV.adult },
    "events.create_from_clone": { source_event_id: PICNIC, new_date: "2027-06-01" },
    "giving.pledges_behind": {},
    "accounting.month_close_blockers": {},
    "messages.draft_reminder": { event_id: DIWALI },
    "events.draft_change": { event_id: DIWALI, field: "venue", value: "Hall for Zoya Shah" },
    "events.set_field": { event_id: DIWALI, field: "venue", value: "Hall for Zoya Shah" },
  };

  it("has a sample input for every command in the catalog", () => {
    for (const c of CATALOG) if (!OWN_WORLD.has(c.key)) expect(Object.keys(SAMPLE_INPUT), `Add a sample input for ${c.key} so the child check covers it.`).toContain(c.key);
  });

  for (const command of CATALOG.filter((c) => !OWN_WORLD.has(c.key))) {
    it(`${command.key}: nothing about a child in what Niva is given`, async () => {
      vi.mocked(loadHomeTasks).mockResolvedValue({
        tasks: [{ id: "x:1", source: "pathshala", tag: "Pathshala", color: "purple", title: "Sign-off for Zoya Shah", meta: "Aarav Patel is waiting", links: [] }],
        failures: [],
      } as never);
      // Every confirm command is switched on here, so the card Niva would show for it is checked too.
      const on = Object.fromEntries(CATALOG.filter((c) => c.level === "confirm").map((c) => [c.key, true]));
      const { ctx } = setup({ via: "assistant", world: addEventsWorld(communityWithChildren()), rules: { assistant: { tools: on } } });
      const result = await runCommand(ctx, command.key, SAMPLE_INPUT[command.key]);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const text = JSON.stringify(result);
      for (const name of [...CHILDREN.full, ...CHILDREN.first]) expect(text, `${name} reached a result of ${command.key}`).not.toContain(name);
      expect(text).not.toContain("2018-05-05");
      expect(text).not.toContain("date_of_birth");
    });
  }
});

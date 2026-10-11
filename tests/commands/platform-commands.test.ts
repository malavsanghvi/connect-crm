import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/experiences-db", () => ({
  loadExperiences: vi.fn(async () => ({
    status: "ok",
    experiences: [
      { key: "jain_center", label: "Jain Center" },
      { key: "community_center", label: "Community Center" },
    ],
  })),
}));

import { CATALOG } from "@/lib/commands/catalog";
import { PLATFORM_COMMANDS } from "@/lib/commands/catalog/platform";
import { commandAvailability } from "@/lib/commands/enabled";
import { CommandRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";
import type { CommandRunResult, CommandVia } from "@/lib/commands/types";
import { suggestionsFor } from "@/lib/assistant/context";

import { CHILDREN, fakeDb, fakeSession, testContext } from "./helpers";

const SA = "12900000-0000-4000-8000-0000000000c2";
const SB = "12900000-0000-4000-8000-0000000000c3";
const LIVE = "12900000-0000-4000-8000-0000000000c1";

const CENTERS = [
  { id: LIVE, slug: "g129-live", name: "G129 Live Sangh" },
  { id: SA, slug: "g129-sandbox-a", name: "G129 Sandbox A" },
  { id: SB, slug: "g129-sandbox-b", name: "G129 Sandbox B" },
];

const WAITING = {
  as_of: "2026-10-10T15:00:00Z",
  counts: { golive: 1, promote: 1, verification: 1, access_requests: 1, readiness: 2, access_requests_waiting_on_them: 1 },
  items: [
    { kind: "golive", center_id: SA, slug: "g129-sandbox-a", community: "G129 Sandbox A", since: "2026-10-05T15:00:00Z", detail: "Asked to go live. It needs a first approval.", more: [] },
    { kind: "promote", center_id: SB, slug: "g129-sandbox-b", community: "G129 Sandbox B", since: "2026-10-08T15:00:00Z", detail: "Approved to go live. The sandbox can be moved to production.", more: [] },
    { kind: "verification", center_id: SA, slug: "g129-sandbox-a", community: "G129 Sandbox A", since: "2026-10-07T15:00:00Z", detail: "Sent its nonprofit papers for review.", more: [] },
    { kind: "access_request", center_id: null, slug: null, community: "G129 Fremont Jain Sangh", since: "2026-10-09T15:00:00Z", detail: "temple, Fremont, CA", more: [] },
    { kind: "readiness", center_id: SA, slug: "g129-sandbox-a", community: "G129 Sandbox A", since: "2026-09-20T15:00:00Z", detail: "3 of 13 go-live checks do not pass yet.", more: ["Setup data complete: Add your address.", "Legal documents: Publish your terms."] },
  ],
  consent: [
    { center_id: LIVE, slug: "g129-live", community: "G129 Live Sangh", environment: "production", activity_recording: "on", shares_with_weaver: false, support_access_until: null },
    { center_id: SA, slug: "g129-sandbox-a", community: "G129 Sandbox A", environment: "sandbox", activity_recording: "not_agreed", shares_with_weaver: false, support_access_until: "2026-10-12T15:00:00Z" },
  ],
};

const SUMMARY_A = {
  community: { id: SA, slug: "g129-sandbox-a", name: "G129 Sandbox A", status: "onboarding", environment: "sandbox", kind: "jain_center", tradition: "jain", time_zone: "America/Chicago", created_at: "2026-09-01T10:00:00Z", moved_to_production_as: null, owner: "Ada Owner" },
  size: { households: 12, people: 31, signed_in_accounts: 5, active_memberships: 3 },
  setup: { done: 4, total: 9 },
  readiness: { passing: 10, total: 13, failing: [{ check: "Setup data complete", detail: "Add your address." }, { check: "Legal documents", detail: "Publish your terms." }] },
  go_live: { status: "requested", requested_at: "2026-10-05T15:00:00Z", first_approved: false, second_approved: false },
  verification: { status: "submitted", submitted_at: "2026-10-07T15:00:00Z", verified_at: null },
  consent: { activity_recording: "not_agreed", shares_with_weaver: false, support_access_until: "2026-10-12T15:00:00Z", niva_actions_switched_on: 0 },
  modules_off: ["store"],
  ways_to_pay: ["zelle", "check"],
  portal_addresses: 1,
  last_staff_activity_at: "2026-10-09T20:00:00Z",
};

const KIND_PREVIEW = {
  center_name: "G129 Sandbox A",
  from: { key: "jain_center", label: "Jain Center" },
  to: { key: "community_center", label: "Community Center", active: true },
  changed: true,
  hidden: [{ module: "pathshala", label: "Pathshala", text: "Pathshala would be hidden. Its records stay." }],
  available: [],
  paths_kept: 0,
  summary: ["G129 Sandbox A would change from Jain Center to Community Center.", "Pathshala would be hidden. Its records stay."],
};

function setup(opts: { platform?: boolean; via?: CommandVia; permissions?: string[]; isOwner?: boolean; rpc?: Record<string, unknown>; failRpc?: Record<string, { code?: string; message: string }> } = {}) {
  const db = fakeDb({
    tables: { centers: CENTERS },
    rpc: (opts.rpc ?? {
      platform_waiting: WAITING,
      platform_community_summary: (a: Record<string, unknown>) => (a.p_center === SA ? SUMMARY_A : null),
      category_change_preview: KIND_PREVIEW,
    }) as never,
    failRpc: opts.failRpc,
  });
  const session = fakeSession({ db, permissions: opts.permissions ?? [], isPlatformAdmin: opts.platform ?? true, isOwner: opts.isOwner ?? false });
  const registry = new CommandRegistry();
  for (const c of PLATFORM_COMMANDS) registry.register(c);
  const ctx = testContext({ session, registry, via: opts.via ?? "screen", minorNames: CHILDREN.full });
  return { ctx, db, session, registry };
}

const dataOf = <T,>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
describe("the Platform commands", () => {
  it("are two reads, one preview and twelve things only the Weaver team does; none asks the person to confirm", () => {
    expect(PLATFORM_COMMANDS.map((c) => `${c.key}:${c.level}`)).toEqual([
      "platform.waiting:read",
      "platform.community_summary:read",
      "platform.preview_kind_change:draft",
      "platform.change_kind:only_you",
      "platform.decide_access_request:only_you",
      "platform.decide_go_live:only_you",
      "platform.decide_verification:only_you",
      "platform.set_limits_and_addresses:only_you",
      "platform.set_community_switches:only_you",
      "platform.pause_ways_to_pay:only_you",
      "platform.create_sandbox:only_you",
      "platform.manage_sandbox_codes:only_you",
      "platform.end_support_access:only_you",
      "platform.publish_agreement:only_you",
      "platform.run_platform_setup:only_you",
    ]);
    // "Confirm" commands on the Platform console are only_you or off: there is no confirm level here at all.
    expect(PLATFORM_COMMANDS.filter((c) => c.level === "confirm")).toEqual([]);
    for (const c of PLATFORM_COMMANDS) {
      expect(c.platformOnly, c.key).toBe(true);
      expect(c.key, c.key).toMatch(/^platform\./);
      expect(c.description.length, c.key).toBeGreaterThan(80);
      expect(`${c.title} ${c.description}`, c.key).not.toMatch(/\bbid\b/i);
      if (c.level === "only_you") {
        expect(c.execute, c.key).toBeUndefined();
        expect(c.pointTo?.href, c.key).toMatch(/^\/platform/);
      }
    }
  });

  it("cover every Server Action of the Platform console", () => {
    const covered = PLATFORM_COMMANDS.flatMap((c) => c.covers ?? []);
    expect(covered).toHaveLength(new Set(covered).size);
    expect(covered).toHaveLength(27);
    expect(covered).toEqual(expect.arrayContaining(["src/app/(app)/platform/centers/[id]/actions.ts#changeKindAction", "src/app/(app)/platform/onboarding-actions.ts#decideGoliveAction"]));
  });
});

// ---------------------------------------------------------------------------
describe("Platform commands are never offered to anyone outside the Weaver team", () => {
  const platformKeys = PLATFORM_COMMANDS.map((c) => c.key);

  it("not listed, not given to Niva, not available, whatever roles and permissions the person holds", () => {
    // The community's owner holds every permission; a person can even hold every permission key by name.
    const everything = ["people.view", "people.manage", "giving.view", "giving.manage", "events.manage", "settings.manage", "reports.view", "dashboard"];
    const { session, registry } = setup({ platform: false, permissions: everything, isOwner: true });
    for (const via of ["screen", "palette", "assistant"] as const) {
      expect(registry.list(session, via).map((c) => c.key), via).toEqual([]);
    }
    expect(registry.modelTools(session)).toEqual([]);
    for (const c of PLATFORM_COMMANDS) {
      expect(commandAvailability(c, session, "assistant")).toMatchObject({ ok: false, code: "no_access" });
    }
    // The whole catalog, not just this file's registry.
    const all = new CommandRegistry();
    for (const c of CATALOG) all.register(c);
    expect(all.list(session, "screen").map((c) => c.key).filter((k) => k.startsWith("platform."))).toEqual([]);
    expect(all.modelTools(session).map((t) => t.name).filter((n) => n.startsWith("platform_"))).toEqual([]);
  });

  it("offered to the Weaver team, in every door", () => {
    const { session, registry } = setup({ platform: true });
    for (const via of ["screen", "palette", "assistant"] as const) {
      expect(registry.list(session, via).map((c) => c.key), via).toEqual(platformKeys);
    }
    expect(registry.modelTools(session).map((t) => t.name)).toContain("platform_waiting");
  });

  it("refused when run, with no database call, and the refusal is a plain sentence", async () => {
    const { ctx, db } = setup({ platform: false, permissions: ["settings.manage"], isOwner: true, via: "assistant" });
    for (const key of ["platform.waiting", "platform.community_summary", "platform.preview_kind_change", "platform.change_kind"]) {
      const r = await runCommand(ctx, key, { community: "g129-sandbox-a", kind: "community_center" });
      expect(r, key).toMatchObject({ ok: false, code: "no_access" });
      expect(r.ok ? "" : r.error, key).toMatch(/only the Weaver team \(platform admins\) can do this\.$/);
    }
    expect(db.rpcCalls).toEqual([]);
    expect(db.calls).toEqual([]);
  });

  it("and the sentences Niva suggests on the Platform screens are not shown to them either", () => {
    const nonPlatform = new Set(["tasks.mine", "people.search", "events.upcoming", "reports.overview"]);
    const text = suggestionsFor("/platform", undefined, nonPlatform).join(" ");
    expect(text).not.toMatch(/waiting for us|go-live review|community with address|kind of organization/);
    const platform = new Set(PLATFORM_COMMANDS.map((c) => c.key));
    // The community in the example is the one the Weaver team is looking at, never a fixed one; with no address known there is none.
    expect(suggestionsFor("/platform", undefined, platform, { communitySlug: "houston-chamber" })).toEqual([
      "Who is waiting for us, and what is missing?",
      "Which sandboxes are waiting for a go-live review?",
      "Summarise the community with address houston-chamber",
    ]);
    expect(suggestionsFor("/platform", undefined, platform)).toEqual([
      "Who is waiting for us, and what is missing?",
      "Which sandboxes are waiting for a go-live review?",
      "What would changing a community's kind of organization do?",
    ]);
  });
});

// ---------------------------------------------------------------------------
describe("platform.waiting", () => {
  it("says who is waiting, since when, what is missing and where to deal with it", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{
      counts: Record<string, number>;
      waiting: { kind: string; community: string; address: string | null; waiting_since: string | null; days_waiting: number | null; what: string; details: string[]; where: { href: string } }[];
      consent: { community: string; kind: string; activity_recording: string; shares_with_weaver: boolean; support_access: string }[];
    }>(await runCommand(ctx, "platform.waiting", {}));
    expect(db.rpcCalls).toEqual([{ fn: "platform_waiting", args: { p_limit: 25 } }]);
    expect(d.counts).toEqual({
      go_live_requests: 1,
      approved_waiting_to_move: 1,
      nonprofit_papers: 1,
      access_requests: 1,
      communities_with_failing_checks: 2,
      access_requests_waiting_on_them: 1,
    });
    expect(d.waiting[0]).toMatchObject({
      kind: "Go-live request",
      community: "G129 Sandbox A",
      address: "g129-sandbox-a",
      waiting_since: "Oct 5, 2026",
      days_waiting: 5,
      what: "Asked to go live. It needs a first approval.",
      where: { href: "/platform/go-live" },
    });
    expect(d.waiting[1]).toMatchObject({ kind: "Approved, waiting to move to production", where: { href: "/platform/go-live" } });
    expect(d.waiting[2].where.href).toBe("/platform/verification");
    expect(d.waiting[3]).toMatchObject({ kind: "New request for access", address: null, where: { href: "/platform/requests" } });
    expect(d.waiting[4]).toMatchObject({ kind: "Go-live checks not passing", details: ["Setup data complete: Add your address.", "Legal documents: Publish your terms."], where: { href: "/platform/pipeline" } });
    expect(d.consent).toEqual([
      { community: "G129 Live Sangh", address: "g129-live", kind: "Community", activity_recording: "On", shares_with_weaver: false, support_access: "None open" },
      { community: "G129 Sandbox A", address: "g129-sandbox-a", kind: "Sandbox", activity_recording: "Not agreed yet", shares_with_weaver: false, support_access: "Open until Oct 12, 2026" },
    ]);
  });

  it("passes the limit on, and says when nobody is waiting", async () => {
    const { ctx, db } = setup({ rpc: { platform_waiting: { counts: {}, items: [], consent: [] } } });
    const r = await runCommand(ctx, "platform.waiting", { limit: 3 });
    expect(db.rpcCalls[0].args).toEqual({ p_limit: 3 });
    expect(r).toMatchObject({ ok: true, message: "Nobody is waiting for the team right now." });
    expect(await runCommand(ctx, "platform.waiting", { limit: 0 })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("explains a failure and never shows an empty inbox for it", async () => {
    const { ctx } = setup({ failRpc: { platform_waiting: { code: "XX000", message: "boom" } } });
    const r = await runCommand(ctx, "platform.waiting", {});
    expect(r).toMatchObject({ ok: false, code: "failed" });
    expect(r.ok ? "" : r.error).toMatch(/^Could not read who is waiting/);
  });

  it("keeps contact details and members out: nothing in the answer to a model but communities", async () => {
    const { ctx } = setup({ via: "assistant" });
    const text = JSON.stringify(await runCommand(ctx, "platform.waiting", {}));
    expect(text).not.toMatch(/@|\+1|date_of_birth|display_name/);
    for (const name of [...CHILDREN.full, ...CHILDREN.first]) expect(text).not.toContain(name);
  });
});

// ---------------------------------------------------------------------------
describe("platform.community_summary", () => {
  it("finds a community by address, name or id, and tells the whole story in numbers and sentences", async () => {
    for (const asked of ["g129-sandbox-a", "G129 Sandbox A", SA, "sandbox a"]) {
      const { ctx, db } = setup();
      const r = await runCommand(ctx, "platform.community_summary", { community: asked });
      expect(r.ok, asked).toBe(true);
      expect(db.rpcCalls, asked).toEqual([{ fn: "platform_community_summary", args: { p_center: SA } }]);
    }
    const { ctx } = setup();
    const d = dataOf<{
      community: string;
      kind: string;
      status: string;
      sandbox: boolean;
      size: Record<string, number>;
      go_live_request: string;
      nonprofit_papers: string;
      consent: Record<string, unknown>;
      go_live_checks: { passing: number; total: number; failing: unknown[] };
      in_words: string[];
    }>(await runCommand(ctx, "platform.community_summary", { community: "g129-sandbox-a" }));
    expect(d).toMatchObject({ community: "G129 Sandbox A", kind: "Jain Center", status: "setting up", sandbox: true });
    expect(d.size).toEqual({ households: 12, people: 31, signed_in_accounts: 5, active_memberships: 3 });
    expect(d.go_live_checks).toMatchObject({ passing: 10, total: 13 });
    expect(d.go_live_request).toBe("asked to go live and is waiting for a first approval");
    expect(d.nonprofit_papers).toBe("has sent its nonprofit papers and they are waiting for review");
    expect(d.consent).toEqual({ activity_recording: "Not agreed yet", shares_with_weaver: false, support_access: "Open until Oct 12, 2026", niva_actions_switched_on: 0 });
    expect(d.in_words).toEqual([
      "G129 Sandbox A is a sandbox of kind Jain Center, setting up.",
      "12 households and 31 people; 5 have signed in; 3 active memberships.",
      "Setup: 4 of 9 required steps are done.",
      "2 of 13 go-live checks do not pass: Setup data complete; Legal documents.",
      "It asked to go live and is waiting for a first approval.",
      "It has sent its nonprofit papers and they are waiting for review.",
      "Its administrator has not agreed to record how the portal is used.",
      "Modules switched off: store.",
    ]);
  });

  it("asks which one when the words match two, and says so when there is none", async () => {
    const { ctx, db } = setup();
    const two = await runCommand(ctx, "platform.community_summary", { community: "sandbox" });
    expect(two).toMatchObject({ ok: false, error: 'More than one community matches "sandbox": G129 Sandbox A (g129-sandbox-a), G129 Sandbox B (g129-sandbox-b). Which one?' });
    const none = await runCommand(ctx, "platform.community_summary", { community: "nowhere" });
    expect(none).toMatchObject({ ok: false, error: 'There is no community called "nowhere". Use its address (like riverside), its name or its id.' });
    expect(db.rpcCalls).toEqual([]);
  });

  it("says there is no such community when the database answers null for it", async () => {
    const { ctx } = setup();
    const r = await runCommand(ctx, "platform.community_summary", { community: "g129-live" });
    expect(r).toMatchObject({ ok: false, error: 'There is no community called "g129-live".' });
  });
});

// ---------------------------------------------------------------------------
describe("platform.preview_kind_change", () => {
  it("shows what changing the kind would do, changes nothing, and points to the screen that does it", async () => {
    const { ctx, db } = setup();
    const d = dataOf<{ community: string; changed: boolean; hidden: { label: string }[]; summary: string[]; next_step: string }>(
      await runCommand(ctx, "platform.preview_kind_change", { community: "g129-sandbox-a", kind: "community_center" }),
    );
    expect(db.rpcCalls).toEqual([{ fn: "category_change_preview", args: { p_center: SA, p_category: "community_center" } }]);
    expect(db.calls.filter((c) => c.op === "update")).toEqual([]);
    expect(d).toMatchObject({ community: "G129 Sandbox A", changed: true });
    expect(d.hidden[0].label).toBe("Pathshala");
    expect(d.summary[0]).toBe("G129 Sandbox A would change from Jain Center to Community Center.");
    expect(d.next_step).toMatch(/say why and enter your security code/);
  });

  it("explains a refusal and an answer it cannot read", async () => {
    const refused = setup({ failRpc: { category_change_preview: { code: "42501", message: "nope" } } });
    const a = await runCommand(refused.ctx, "platform.preview_kind_change", { community: "g129-sandbox-a", kind: "community_center" });
    expect(a).toMatchObject({ ok: false });
    expect(a.ok ? "" : a.error).toMatch(/^Could not preview the change/);
    const odd = setup({ rpc: { category_change_preview: { surprise: true } } });
    const b = await runCommand(odd.ctx, "platform.preview_kind_change", { community: "g129-sandbox-a", kind: "community_center" });
    expect(b).toMatchObject({ ok: false, error: "The database answered in a form this page does not understand. Reload and try again." });
  });
});

// ---------------------------------------------------------------------------
describe("what only the Weaver team does", () => {
  it("is a sentence and a place, never an action", async () => {
    const { ctx, db } = setup({ via: "assistant" });
    const r = await runCommand(ctx, "platform.change_kind", {});
    expect(r).toMatchObject({ ok: false, code: "only_you", onlyYou: { href: "/platform" } });
    const g = await runCommand(ctx, "platform.decide_go_live", {});
    expect(g).toMatchObject({ ok: false, code: "only_you", onlyYou: { href: "/platform/go-live" } });
    expect(db.calls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });
});

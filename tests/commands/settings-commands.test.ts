import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { SETTINGS_COMMANDS } from "@/lib/commands/catalog/settings";
import { runCommand } from "@/lib/commands/run";
import type { CommandRunResult } from "@/lib/commands/types";

import { addSettingsWorld, asAdmin, EVENT, G, U } from "./settings-world";

const dataOf = <T,>(r: CommandRunResult): T => {
  if (!r.ok || r.needsConfirmation) throw new Error(`expected data, got ${JSON.stringify(r)}`);
  return r.data as T;
};
const messageOf = (r: CommandRunResult): string => (r.ok && !r.needsConfirmation ? (r.message ?? "") : "");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
describe("the Settings commands", () => {
  it("are listed in the order a person would meet them: five reads, one draft, three changes and nine only-you ones", () => {
    expect(SETTINGS_COMMANDS.map((c) => `${c.key}:${c.level}`)).toEqual([
      "settings.setup_status:read",
      "settings.role_holders:read",
      "settings.who_can_access:read",
      "settings.integrations_health:read",
      "settings.modules_state:read",
      "settings.draft_role_grant:draft",
      "settings.grant_role:confirm",
      "settings.revoke_role:confirm",
      "settings.set_module:confirm",
      "settings.enter_secret:only_you",
      "settings.accept_agreements:only_you",
      "settings.connect_quickbooks:only_you",
      "settings.connect_payments:only_you",
      "settings.change_domain_records:only_you",
      "settings.confirm_as_owner:only_you",
      "settings.send_nonprofit_proof:only_you",
      "settings.go_live:only_you",
      "settings.second_approval:only_you",
    ]);
  });

  it("have a plain title and a description written for a model, and never the word bid", () => {
    for (const c of SETTINGS_COMMANDS) {
      expect(c.title.length, c.key).toBeGreaterThan(8);
      expect(c.description.length, c.key).toBeGreaterThan(80);
      expect(`${c.title} ${c.description}`, c.key).not.toMatch(/\bbid\b/i);
    }
  });

  it("ask for the permission of the screen they stand for", () => {
    const need = Object.fromEntries(SETTINGS_COMMANDS.map((c) => [c.key, c.permission]));
    expect(need).toMatchObject({
      "settings.setup_status": "setup",
      "settings.role_holders": "roles",
      "settings.who_can_access": "roles",
      "settings.draft_role_grant": "roles",
      "settings.integrations_health": "integrations",
      "settings.modules_state": "centerSettings",
    });
  });
});

// ---------------------------------------------------------------------------
describe("settings.setup_status", () => {
  it("says what is left before go-live, with who owns it and where to fix it", async () => {
    const { ctx, writes } = asAdmin();
    const r = await runCommand(ctx, "settings.setup_status", {});
    const data = dataOf<{
      summary: string;
      steps: Record<string, number>;
      left: { step: string; overdue: boolean; owner: string | null; fix_at: { href: string } | null }[];
      go_live_checks: { failing: number; failing_list: { check: string; what_is_missing: string; fix_at: { href: string } | null }[] };
      go_live: { request: string; owner_confirmations_missing: string[] };
    }>(r);
    expect(data.steps).toEqual({ done: 1, total: 4, percent_done: 25, waiting_on_a_provider: 1, waiting_for_weaver_review: 0, overdue: 1 });
    expect(data.left.map((s) => s.step)).toEqual(["Connect payments", "Register texting", "A screen that is not built yet"]);
    expect(data.left[0]).toMatchObject({ overdue: true, owner: "Meera Admin", fix_at: { href: "/settings/payments" } });
    expect(data.left[2].fix_at).toBeNull();
    expect(data.go_live_checks.failing).toBe(2);
    expect(data.go_live_checks.failing_list.map((c) => c.check)).toEqual(["Agreements accepted", expect.stringContaining("Payments connected with a")]);
    expect(data.go_live_checks.failing_list[0]).toMatchObject({ what_is_missing: "The terms of service have not been accepted yet.", fix_at: { href: "/settings/agreements" } });
    expect(data.go_live).toEqual({ request: "Not requested", owner_confirmations_missing: ["Staff trained", "Sandbox health check green", "Pilot done"], where: { label: "Setup › Go-live", href: "/setup/go-live" } });
    expect(messageOf(r)).toContain("1 of 4 setup steps are done (25%)");
    expect(messageOf(r)).toContain("Going live is the owner's decision");
    expect(writes).toEqual([]);
  });

  it("knows which of the owner's confirmations are made and where the request stands", async () => {
    const world = addSettingsWorld({ tables: { golive_requests: [{ center_id: "center-1", status: "requested", requested_at: "2026-10-09T10:00:00Z" }], center_attestations: [{ center_id: "center-1", key: "staff_trained" }] } });
    const { ctx } = asAdmin({ world });
    const data = dataOf<{ go_live: { request: string; owner_confirmations_missing: string[] } }>(await runCommand(ctx, "settings.setup_status", {}));
    expect(data.go_live).toMatchObject({ request: "Waiting for approvals", owner_confirmations_missing: ["Sandbox health check green", "Pilot done"] });
  });

  it("leaves out the go-live request for a community that is already live", async () => {
    const live = asAdmin({ session: { center: { id: "center-1", slug: "jsh", name: "Jain Society", short_name: "JSH", time_zone: "America/Chicago", currency: "USD", branding: {}, feature_flags: {}, rules: {}, status: "active", environment: "production" } } });
    expect(dataOf<{ go_live: unknown }>(await runCommand(live.ctx, "settings.setup_status", {})).go_live).toBeNull();
  });

  it("is refused to someone without the setup permission, and explains a database failure in plain words without the technical detail", async () => {
    const denied = asAdmin({ permissions: ["people.view"] });
    expect(await runCommand(denied.ctx, "settings.setup_status", {})).toMatchObject({ ok: false, code: "no_access" });
    const broken = asAdmin({ world: addSettingsWorld({ failRpc: { setup_checklist: { code: "XX000", message: "relation app.step_defs does not exist" } } }) });
    const r = await runCommand(broken.ctx, "settings.setup_status", {});
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/^Could not read the setup checklist/);
  });
});

// ---------------------------------------------------------------------------
describe("settings.role_holders", () => {
  type Holders = {
    role_name: string;
    what_it_allows: string[];
    needs_a_second_person: boolean;
    holders: { name: string; member_number: string | null; household_number: string | null; scope: string; until: string | null; status: string }[];
    waiting_for_a_second_person: { name: string }[];
    not_shown: number;
  };

  it("names who holds the role, with the numbers that tell namesakes apart, and who is still waiting for a second person", async () => {
    const { ctx, writes } = asAdmin();
    const r = await runCommand(ctx, "settings.role_holders", { role: "the treasurer role" });
    const data = dataOf<Holders>(r);
    expect(data.role_name).toBe("Treasurer");
    expect(data.needs_a_second_person).toBe(true);
    expect(data.what_it_allows.join(" ")).toMatch(/pledges and payments/i);
    expect(data.holders).toEqual([{ grant_id: G.priya, name: "Priya Shah", member_number: "1042", household_number: "H-1001", role_name: "Treasurer", scope: "The whole community", until: null, status: "active" }]);
    expect(data.waiting_for_a_second_person.map((h) => h.name)).toEqual(["Rahul Shah"]);
    expect(messageOf(r)).toBe("1 person holds Treasurer: Priya Shah. 1 more is waiting for a second person's approval.");
    expect(writes).toEqual([]);
  });

  it("says a role given for one event, and the last day it works", async () => {
    const { ctx } = asAdmin();
    const data = dataOf<Holders>(await runCommand(ctx, "settings.role_holders", { role: "event manager" }));
    // Nikhil: the event only. Aarav holds it too but nothing confirms he is an adult, so he is counted and never named.
    expect(data.holders).toHaveLength(1);
    expect(data.holders[0]).toMatchObject({ name: "Nikhil Patel", scope: "Event: Diwali Dinner", until: "2026-12-30" });
    expect(data.not_shown).toBe(1);
    expect(JSON.stringify(data)).not.toContain("Aarav");
  });

  it("lists every role with how many people hold it when no role is named", async () => {
    const { ctx } = asAdmin();
    const data = dataOf<{ roles: { role_name: string; people: number; waiting_for_a_second_person: number }[] }>(await runCommand(ctx, "settings.role_holders", {}));
    expect(data.roles.map((r) => r.role_name)).toEqual(["Center admin", "Treasurer", "Finance volunteer", "Event manager", "Volunteer coordinator"]);
    expect(data.roles.find((r) => r.role_name === "Treasurer")).toMatchObject({ people: 1, waiting_for_a_second_person: 1 });
    expect(data.roles.find((r) => r.role_name === "Finance volunteer")).toMatchObject({ people: 0 });
  });

  it("asks which one when the words fit several roles, and says so plainly when none fits", async () => {
    const { ctx } = asAdmin();
    const some = await runCommand(ctx, "settings.role_holders", { role: "finance" });
    expect(dataOf<{ role_name: string }>(some).role_name).toBe("Finance volunteer");
    const several = await runCommand(ctx, "settings.role_holders", { role: "volunteer" });
    expect(dataOf<{ which_one: string[] }>(several).which_one).toEqual(["Finance volunteer", "Volunteer coordinator"]);
    expect(messageOf(several)).toBe("That could be Finance volunteer and Volunteer coordinator. Which one do you mean?");
    const none = await runCommand(ctx, "settings.role_holders", { role: "zebra" });
    expect(none).toMatchObject({ ok: false });
    expect(none.ok ? "" : none.error).toBe('I could not find a role called "zebra". The roles are: Center admin, Treasurer, Finance volunteer, Event manager and Volunteer coordinator.');
  });

  it("never names a child to the assistant, and needs the roles permission", async () => {
    const { ctx } = asAdmin({ via: "assistant" });
    const r = await runCommand(ctx, "settings.role_holders", { role: "event manager" });
    expect(JSON.stringify(r)).not.toMatch(/Aarav|Zoya|Tia Mehta/);
    const denied = asAdmin({ permissions: ["settings.manage"] });
    expect(await runCommand(denied.ctx, "settings.role_holders", {})).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("settings.who_can_access", () => {
  type Who = { question: string; what_it_means: string; roles: { role_name: string; people: string[]; waiting_for_a_second_person: number }[]; people_in_total: number; owner: { name: string } | null; not_shown: number };

  it("answers 'who can see payments?' with the roles, the adults who hold them and the owner, in words", async () => {
    const { ctx, writes } = asAdmin();
    const r = await runCommand(ctx, "settings.who_can_access", { area: "payments" });
    const data = dataOf<Who>(r);
    expect(data.question).toBe("Who can see payments and gifts?");
    expect(data.what_it_means).toMatch(/^A role lets a person see payments and gifts when it has at least one of these rights: /);
    expect(data.what_it_means).toMatch(/pledges and payments/i);
    // Center admin has giving.view: Anita (the owner is an administrator too) and Meera; Treasurer: Priya, with Rahul waiting.
    expect(data.roles.map((x) => [x.role_name, x.people, x.waiting_for_a_second_person])).toEqual([
      ["Center admin", ["Anita Mehta", "Meera Admin"], 0],
      ["Treasurer", ["Priya Shah"], 1],
    ]);
    expect(data.people_in_total).toBe(3);
    expect(data.owner).toMatchObject({ name: "Anita Mehta" });
    expect(messageOf(r)).toContain("3 people can see payments and gifts: Anita Mehta, Meera Admin and Priya Shah.");
    expect(messageOf(r)).toContain("Anyone still waiting for approval does not have the right yet");
    expect(writes).toEqual([]);
  });

  it("does not count a role given for one event as a right across the community", async () => {
    const { ctx } = asAdmin();
    const data = dataOf<Who>(await runCommand(ctx, "settings.who_can_access", { area: "run_events" }));
    // Nikhil's grant is for one event; Aarav is not named. Nobody holds it community-wide.
    expect(data.people_in_total).toBe(0);
    expect(data.not_shown).toBe(1);
    expect(data.owner).toMatchObject({ name: "Anita Mehta" });
    expect(data.roles).toEqual([]);
  });

  it("refuses an area it does not know, with the list of what it can answer", async () => {
    const { ctx } = asAdmin();
    const r = await runCommand(ctx, "settings.who_can_access", { area: "everything" });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(r.ok ? "" : r.error).toMatch(/^Could not look up who can see or do something — area must be one of: payments, pledges, /);
  });
});

// ---------------------------------------------------------------------------
describe("settings.integrations_health", () => {
  const connections = [
    { center_id: "center-1", provider: "quickbooks_online", status: "connected", display_name: "Jain Society Inc", settings: { basis: "accrual", refresh_token: "rt-SECRET-123" }, connected_at: "2026-09-01T00:00:00Z", token_expires_at: null, last_error: null },
    { center_id: "center-1", provider: "twilio", status: "error", display_name: null, settings: {}, connected_at: null, token_expires_at: null, last_error: "Authenticate failed with token sk_live_abcdefghijklmnop" },
  ];
  const world = () =>
    addSettingsWorld({
      tables: {
        integration_connections: connections,
        email_domains: [{ center_id: "center-1", domain: "jsh.org", status: "pending", last_error: null, created_at: "2026-09-01" }],
        texting_registrations: [{ center_id: "center-1", kind: "10dlc", status: "rejected", detail: { reviewer_note: "The sample messages do not name the community." } }],
      },
    });

  type Health = {
    summary: string;
    needs_attention: number;
    services: { service: string; status: string; working: boolean; in_words: string; fix_at: { href: string } | null }[];
    email_domains: { domain: string; status: string }[];
    texting: { carrier_status: string; why_texts_may_not_go_out: string[] };
  };

  it("says in plain words which services work, why the others do not, and where to fix them", async () => {
    const { ctx, writes } = asAdmin({ world: world() });
    const r = await runCommand(ctx, "settings.integrations_health", {});
    const data = dataOf<Health>(r);
    const by = (name: string) => data.services.find((s) => s.service === name)!;
    expect(by("QuickBooks Online")).toMatchObject({ status: "Connected", working: true, fix_at: null });
    expect(by("QuickBooks Online").in_words).toBe("Jain Society Inc · accrual basis");
    expect(by("Payments")).toMatchObject({ status: "Not connected", working: false, fix_at: { href: "/settings/payments" } });
    expect(by("US business texting (10DLC)")).toMatchObject({ status: "Error", working: false, fix_at: { href: "/settings/texting" } });
    expect(data.email_domains).toEqual([expect.objectContaining({ domain: "jsh.org", status: "Waiting for DNS" })]);
    expect(data.texting.carrier_status).toBe("Rejected");
    expect(data.texting.why_texts_may_not_go_out[0]).toContain("rejected: The sample messages do not name the community.");
    expect(writes).toEqual([]);
  });

  it("never returns a key, a token or a secret, whoever asks", async () => {
    for (const via of ["screen", "assistant"] as const) {
      const { ctx } = asAdmin({ world: world(), via });
      const text = JSON.stringify(await runCommand(ctx, "settings.integrations_health", {}));
      expect(text, via).not.toContain("rt-SECRET-123");
      expect(text, via).not.toContain("refresh_token");
      expect(text, via).not.toContain("sk_live_abcdefghijklmnop");
    }
  });

  it("needs the integrations permission", async () => {
    const { ctx } = asAdmin({ world: world(), permissions: ["settings.manage"] });
    expect(await runCommand(ctx, "settings.integrations_health", {})).toMatchObject({ ok: false, code: "no_access" });
  });
});

// ---------------------------------------------------------------------------
describe("settings.modules_state", () => {
  type Modules = { on: number; off: number; modules: { module: string; key: string; is_on: boolean; always_on: boolean; needs: string[]; cannot_switch_because: string | null; last_change: string | null; reason: string | null }[]; not_offered_to_this_kind_of_organization: string[] };

  it("says which areas are on, which are off and why, and what stops a switch", async () => {
    const { ctx, writes } = asAdmin();
    const r = await runCommand(ctx, "settings.modules_state", {});
    const data = dataOf<Modules>(r);
    expect(data.on).toBe(3);
    expect(data.off).toBe(1);
    const by = (key: string) => data.modules.find((m) => m.key === key)!;
    expect(by("people")).toMatchObject({ always_on: true, cannot_switch_because: "It is a core area and is always on." });
    expect(by("giving").cannot_switch_because).toBeNull();
    expect(by("bolis")).toMatchObject({ is_on: false, needs: ["Pledges & donations"], last_change: "Switched off Oct 3, 2026 by Meera Admin", reason: "We do not hold boli auctions." });
    expect(data.not_offered_to_this_kind_of_organization).toEqual(["Labh"]);
    expect(messageOf(r)).toBe("3 of 4 modules are on. Off: Bolis.");
    expect(writes).toEqual([]);
  });

  it("explains when the database does not have module switches yet", async () => {
    const { ctx } = asAdmin({ world: addSettingsWorld({ failRpc: { module_states: { code: "42883", message: "function app.module_states(uuid) does not exist" } } }) });
    const r = await runCommand(ctx, "settings.modules_state", {});
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/arrive with the next database update/);
  });
});

// ---------------------------------------------------------------------------
describe("settings.draft_role_grant", () => {
  type Draft =
    | { stage: "choose_person"; candidates: { user_id: string; name: string; member_number: string | null; household: { household_number: string | null; city: string | null; adults: string[] } | null }[]; not_signed_in_yet: { name: string }[]; hidden_because_under_18_or_unclear: number }
    | { stage: "which_role"; which_one: string[] }
    | { stage: "ready"; grant: { person: { name: string }; role_key: string; role_name: string; scope: string; scope_id: string | null; last_day: string | null; lasts: string; waits_for_a_second_person: boolean }; where: { href: string } };

  it("never picks a person by name: it returns everyone with that name, each with their household card", async () => {
    const { ctx, writes } = asAdmin();
    const r = await runCommand(ctx, "settings.draft_role_grant", { person: "Priya Shah", role: "treasurer", for_months: 12 });
    const data = dataOf<Extract<Draft, { stage: "choose_person" }>>(r);
    expect(data.stage).toBe("choose_person");
    expect(data.candidates.map((c) => [c.name, c.member_number, c.household?.household_number, c.household?.city])).toEqual([
      ["Priya Shah", "1042", "H-1001", "Naperville"],
      ["Priya Shah", "2077", "H-1004", "Plainfield"],
    ]);
    // The card shows the adults of the household only.
    expect(data.candidates[0].household?.adults).toEqual(["Priya Shah", "Rahul Shah"]);
    expect(messageOf(r)).toBe("I found 2 people. Which one do you mean? Nothing has been given yet.");
    expect(writes).toEqual([]);
  });

  it("shows one match too, so the person can see whose household it is before going on", async () => {
    const { ctx } = asAdmin();
    const r = await runCommand(ctx, "settings.draft_role_grant", { person: "1042", role: "treasurer" });
    expect(messageOf(r)).toContain("I found one person: Priya Shah (Priya Shah & Rahul Shah · H-1001 · ID 2041 · Naperville). Is this who you mean? Nothing has been given yet.");
  });

  it("leaves out children, and says who has not signed in yet", async () => {
    const { ctx } = asAdmin();
    const kids = dataOf<Extract<Draft, { stage: "choose_person" }>>(await runCommand(ctx, "settings.draft_role_grant", { person: "Zoya", role: "treasurer" }));
    expect(kids.candidates).toEqual([]);
    expect(kids.hidden_because_under_18_or_unclear).toBe(1);
    expect(JSON.stringify(kids)).not.toContain("Zoya");
    const dev = await runCommand(ctx, "settings.draft_role_grant", { person: "Dev", role: "treasurer" });
    expect(dataOf<Extract<Draft, { stage: "choose_person" }>>(dev).not_signed_in_yet).toEqual([{ name: "Dev Kapoor", member_number: "3001" }]);
    expect(messageOf(dev)).toBe("Dev Kapoor has not signed in to Weaver yet, so a role cannot be given. Invite them first in Settings › Team.");
  });

  it("prepares 'the treasurer role for a year' as a card that waits for a second person, and gives nothing", async () => {
    const { ctx, writes } = asAdmin();
    const r = await runCommand(ctx, "settings.draft_role_grant", { user_id: U.priya2, role: "treasurer", for_months: 12, reason: "Takes over the books" });
    const data = dataOf<Extract<Draft, { stage: "ready" }>>(r);
    expect(data.stage).toBe("ready");
    expect(data.grant).toMatchObject({
      person: { name: "Priya Shah", member_number: "2077", household: { household_number: "H-1004", city: "Plainfield" } },
      role_key: "treasurer",
      role_name: "Treasurer",
      scope: "The whole community",
      scope_id: null,
      last_day: "2027-10-09",
      lasts: "until October 9, 2027",
      reason: "Takes over the books",
      waits_for_a_second_person: true,
    });
    expect(data.where.href).toBe("/settings/roles");
    expect(messageOf(r)).toBe(
      "Nothing has been given yet. This is what is prepared: Treasurer for Priya Shah (Priya Shah · H-1004 · ID 2077 · Plainfield), for the whole community, until October 9, 2027. Treasurer needs a second person: it would wait as pending until a different administrator approves it.",
    );
    expect(writes).toEqual([]);
  });

  it("prepares a role that starts at once, for one event, with no second person", async () => {
    const { ctx } = asAdmin();
    const data = dataOf<Extract<Draft, { stage: "ready" }>>(await runCommand(ctx, "settings.draft_role_grant", { user_id: U.priya, role: "event manager", scope_kind: "event", scope_id: EVENT }));
    expect(data.grant).toMatchObject({ role_key: "event_manager", scope: "Event: Diwali Dinner", scope_id: EVENT, last_day: null, lasts: "until someone takes it away", waits_for_a_second_person: false });
  });

  it("asks which role when the words fit several, and offers only roles this person may give", async () => {
    const { ctx } = asAdmin();
    const which = dataOf<Extract<Draft, { stage: "which_role" }>>(await runCommand(ctx, "settings.draft_role_grant", { user_id: U.priya2, role: "volunteer" }));
    expect(which.which_one).toEqual(["Finance volunteer", "Volunteer coordinator"]);
    // The platform admin role is not offered to a community administrator: "admin" is the Center admin role.
    const admin = dataOf<Extract<Draft, { stage: "ready" }>>(await runCommand(ctx, "settings.draft_role_grant", { user_id: U.priya2, role: "admin" }));
    expect(admin.grant.role_key).toBe("center_admin");
    const platform = await runCommand(ctx, "settings.draft_role_grant", { user_id: U.priya, role: "platform admin" });
    expect(platform.ok ? "" : platform.error).toBe("Platform admin is a platform role: only the Weaver platform team gives it.");
    const family = await runCommand(ctx, "settings.draft_role_grant", { user_id: U.priya, role: "primary adult" });
    expect(family.ok ? "" : family.error).toBe("Primary adult comes from household relationships, so it is not given as a role.");
  });

  it("refuses what the Roles screen refuses, in plain words, and still writes nothing", async () => {
    const { ctx, writes } = asAdmin();
    const say = async (input: Record<string, unknown>) => {
      const r = await runCommand(ctx, "settings.draft_role_grant", { role: "treasurer", ...input });
      return r.ok ? `OK ${JSON.stringify(r.needsConfirmation ? "confirm" : "ran")}` : r.error;
    };
    expect(await say({})).toBe("Say who the role is for: a name, a member number or an email. After the person has chosen from the people shown, pass their id instead.");
    expect(await say({ user_id: U.admin })).toBe("Nobody can give themselves a role. A different administrator has to do this.");
    expect(await say({ user_id: U.priya })).toBe("This person already holds Treasurer for that scope.");
    expect(await say({ user_id: U.nobody })).toBe("That person has not signed in to Weaver yet, so a role cannot be given. Invite them first in Settings › Team.");
    expect(await say({ user_id: U.aarav })).toBe("Roles are only given to adults. Please do this on the Roles screen if it is right.");
    expect(await say({ user_id: U.priya2, ends_on: "2020-01-01" })).toBe("Could not grant the role — the end date is in the past.");
    expect(await say({ user_id: U.priya2, ends_on: "2030-01-01", for_months: 6 })).toBe("Give an end date or a number of months, not both.");
    expect(await say({ user_id: U.priya2, scope_kind: "event" })).toBe("Could not grant the role — choose which event it is for.");
    expect(await say({ user_id: U.priya2, scope_kind: "zone", scope_id: "9a000000-0000-4000-8000-0000000000aa" })).toBe("Could not grant the role — that zone was not found.");
    expect(await say({ user_id: U.priya2, scope_id: EVENT })).toBe("A role for the whole community has no event, class or zone. Leave that out, or choose event, class or zone.");
    expect(await say({ user_id: U.priya2, role: "zebra" })).toMatch(/^I could not find a role called "zebra"\./);
    expect(writes).toEqual([]);
  });

  it("needs the roles permission", async () => {
    const { ctx } = asAdmin({ permissions: ["settings.manage"] });
    expect(await runCommand(ctx, "settings.draft_role_grant", { person: "Priya", role: "treasurer" })).toMatchObject({ ok: false, code: "no_access" });
  });

  it("shows the assistant no child: not as a candidate, not in a household card", async () => {
    const { ctx } = asAdmin({ via: "assistant" });
    const r = await runCommand(ctx, "settings.draft_role_grant", { person: "Shah", role: "treasurer" });
    expect(JSON.stringify(r)).not.toContain("Zoya");
    expect(dataOf<{ candidates: unknown[] }>(r).candidates).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
describe("the things only the person can do", () => {
  const CASES: [string, string, string][] = [
    ["settings.enter_secret", "/settings/integrations", "secure box"],
    ["settings.accept_agreements", "/settings/agreements", "accepts it"],
    ["settings.connect_quickbooks", "/accounting/qbo/setup", "sign in to QuickBooks yourself"],
    ["settings.connect_payments", "/settings/payments", "sign in to your own account"],
    ["settings.change_domain_records", "/settings/email", "controls the domain"],
    ["settings.confirm_as_owner", "/setup/go-live", "owner presses Confirm"],
    ["settings.send_nonprofit_proof", "/setup/organization", "Send for review"],
    ["settings.go_live", "/setup/go-live", "owner requests go-live"],
    ["settings.second_approval", "/settings/roles?show=pending", "different administrator"],
  ];

  it.each(CASES)("%s answers with a link and a sentence, and never touches the database", async (key, href, words) => {
    const { ctx, db, writes } = asAdmin({ permissions: ["settings.manage", "roles.manage", "integrations.manage", "integrations.view", "giving.view"], via: "assistant" });
    const r = await runCommand(ctx, key, {});
    expect(r).toMatchObject({ ok: false, code: "only_you", onlyYou: { href } });
    if (!r.ok) {
      expect(r.onlyYou?.label).toContain(words);
      expect(r.error).toMatch(/is something only you can do\. Open /);
      expect(r.error).not.toMatch(/\.\.$/);
    }
    expect(writes).toEqual([]);
    expect(db.calls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("have no execute, so no door can ever run them", () => {
    for (const c of SETTINGS_COMMANDS.filter((c) => c.level === "only_you")) {
      expect(c.execute, c.key).toBeUndefined();
      expect(c.pointTo?.href.startsWith("/"), c.key).toBe(true);
    }
  });

  it("stand in for the Server Actions the person still does on the screen", () => {
    const covered = SETTINGS_COMMANDS.flatMap((c) => c.covers ?? []);
    expect(covered).toEqual(
      expect.arrayContaining([
        "src/app/(app)/settings/roles/actions.ts#approveGrantAction",
        "src/app/(app)/setup/go-live/actions.ts#requestGoliveAction",
        "src/app/(app)/setup/go-live/actions.ts#attestAction",
        "src/app/(app)/settings/integrations/actions.ts#setSecretAction",
      ]),
    );
  });
});

// `screenOnly`: a command only the person's own screen may run. The registry never offers it to Niva or to the palette, the
// community cannot switch it on, and a model's tool list never contains it. (Used for work that must not go through a model, like
// anything about a learner, decision D2.) The screen reaches it through runScreenCommand / runCommandFromScreen as for any command.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/data/home-tasks", () => ({ loadHomeTasks: vi.fn() }));

import { confirmToolChoices } from "@/lib/assistant/choices";
import { commandInfo } from "@/lib/assistant/present";
import { commandEventToActivity } from "@/lib/commands/activity";
import { CATALOG } from "@/lib/commands/catalog";
import { runCommandFromScreen } from "@/lib/commands/catalog/events/bridge";
import { defineCommand } from "@/lib/commands/define";
import { commandAvailability } from "@/lib/commands/enabled";
import { CommandRegistry, defaultRegistry } from "@/lib/commands/registry";
import { runCommand } from "@/lib/commands/run";
import { f, object } from "@/lib/commands/schema";
import { CommandError } from "@/lib/commands/types";
import type { CommandEvent } from "@/lib/commands/types";

import { fakeSession, testContext } from "./helpers";

const input = object({ thing: f.uuid("A thing.") });
const SCREEN_ONLY = defineCommand<{ thing: string }, undefined>({
  key: "demo.screen_thing",
  title: "Change a thing on the screen",
  description: "Changes a thing. Only a person on the screen does this; it is never offered to Niva or the palette.",
  level: "confirm",
  permission: "pathshala",
  screenOnly: true,
  input,
  async execute(_ctx, inp) {
    if (inp.thing === "00000000-0000-4000-8000-000000000000") throw new CommandError("Not that one.");
    return { ok: true, data: undefined, message: "Done on the screen." };
  },
});
const NORMAL = defineCommand({
  key: "demo.look_at_thing",
  title: "Look at a thing",
  description: "Looks at a thing. Reads only; it changes nothing at all.",
  level: "read",
  permission: "pathshala",
  input: object({}),
  async execute() {
    return { ok: true, data: { fine: true } };
  },
});

const THING = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c9999";
const session = () => fakeSession({ permissions: ["pathshala.view"], center: { ...fakeSession().center, rules: { assistant: { enabled: true, tools: { "demo.screen_thing": true } } } } });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a screenOnly command", () => {
  it("is available on the screen and nowhere else, even when the community has switched it on", () => {
    const s = session();
    expect(commandAvailability(SCREEN_ONLY, s, "screen")).toEqual({ ok: true });
    for (const via of ["assistant", "palette"] as const) {
      expect(commandAvailability(SCREEN_ONLY, s, via)).toEqual({
        ok: false,
        code: "screen_only",
        error: "Niva does not change a thing on the screen. That is done on the screen, by a person.",
      });
    }
    expect(commandAvailability(NORMAL, s, "assistant")).toEqual({ ok: true });
  });

  it("still asks for the permission first", () => {
    const none = fakeSession({ permissions: [] });
    expect(commandAvailability(SCREEN_ONLY, none, "assistant")).toMatchObject({ ok: false, code: "no_access" });
  });

  it("is never in the list for Niva or the palette, and never in a model's tool list", () => {
    const r = new CommandRegistry();
    r.register(SCREEN_ONLY);
    r.register(NORMAL);
    const s = session();
    expect(r.list(s, "assistant").map((c) => c.key)).toEqual(["demo.look_at_thing"]);
    expect(r.list(s, "palette").map((c) => c.key)).toEqual(["demo.look_at_thing"]);
    expect(r.list(s, "screen").map((c) => c.key).sort()).toEqual(["demo.look_at_thing", "demo.screen_thing"]);
    expect(r.modelTools(s).map((t) => t.name)).toEqual(["demo_look_at_thing"]);
  });

  it("is refused by name when Niva or the palette tries to run it, and nothing is proposed", async () => {
    const r = new CommandRegistry();
    r.register(SCREEN_ONLY);
    const ctx = testContext({ session: session(), registry: r, via: "assistant" });
    const result = await runCommand(ctx, "demo.screen_thing", { thing: THING });
    expect(result).toMatchObject({ ok: false, code: "screen_only", error: "Niva does not change a thing on the screen. That is done on the screen, by a person." });
    // The palette runs commands through the same door.
    expect(await runCommand({ ...ctx, via: "palette" }, "demo.screen_thing", { thing: THING })).toMatchObject({ ok: false, code: "screen_only" });
  });

  it("runs from the screen's own button, with the command's own sentences", async () => {
    expect(await runCommandFromScreen(SCREEN_ONLY, session(), { thing: THING })).toEqual({ ok: true, message: "Done on the screen.", data: undefined });
    expect(await runCommandFromScreen(SCREEN_ONLY, session(), { thing: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: "Not that one." });
  });

  it("has no switch for the owner to tick in Platform › Niva for admins", () => {
    defaultRegistry.register(SCREEN_ONLY);
    const keys = confirmToolChoices({}).map((c) => c.key);
    expect(keys).not.toContain("demo.screen_thing");
    expect(keys).toContain("events.set_field");
  });

  it("is recorded in the activity stream as a refusal, with a word from the closed list", () => {
    const event: CommandEvent = {
      key: "demo.screen_thing",
      level: "confirm",
      via: "assistant",
      outcome: "denied",
      code: "screen_only",
      durationMs: 5,
      at: "2026-10-10T15:00:00.000Z",
      centerId: "center-1",
      userId: "user-1",
      personId: null,
      roles: [],
      requestId: "r",
      inputKeys: ["thing"],
    };
    expect(commandEventToActivity(event)).toMatchObject({ outcome: "error", error_code: "no_permission", via: "assistant" });
  });

  it("is described to the palette like any other (it is simply never listed for it)", () => {
    expect(commandInfo(SCREEN_ONLY)).toMatchObject({ key: "demo.screen_thing", area: "demo", level: "confirm" });
  });
});

describe("the real catalog", () => {
  it("never offers a screenOnly command to Niva, whatever the role or the community's switches", () => {
    const registry = new CommandRegistry();
    for (const c of CATALOG) registry.register(c);
    const everything = fakeSession({
      permissions: ["*"],
      isPlatformAdmin: true,
      center: { ...fakeSession().center, rules: { assistant: { enabled: true, tools: Object.fromEntries(CATALOG.map((c) => [c.key, true])) } } },
    });
    const screenOnly = CATALOG.filter((c) => c.screenOnly).map((c) => c.key);
    const offered = new Set(registry.modelTools(everything).map((t) => t.name));
    for (const key of screenOnly) expect(offered.has(key.replace(".", "_")), key).toBe(false);
    for (const c of registry.list(everything, "assistant")) expect(c.screenOnly, c.key).toBeFalsy();
    // And every command that touches a learner would have to be one of them: none of the catalog's tools takes a learner as input.
    for (const t of registry.modelTools(everything)) {
      expect(Object.keys(t.input_schema.properties).join(" "), t.name).not.toMatch(/learner|student|enroll|attendance|homework/i);
    }
  });
});

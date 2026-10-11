import { describe, expect, it } from "vitest";

import { defineCommand } from "@/lib/commands/define";
import { assistantToolSetting, commandAvailability, isCommandEnabled, toolSettingKey } from "@/lib/commands/enabled";
import { CommandRegistry, commandKeyFromToolName, toolName } from "@/lib/commands/registry";
import { f, object } from "@/lib/commands/schema";

import { fakeSession } from "./helpers";

const ok = async () => ({ ok: true as const, data: { done: true } });

const readEvents = defineCommand({ key: "events.look", title: "Look at events", description: "Look at events.", level: "read", permission: "events", module: "events", input: object({}), execute: ok });
const readGiving = defineCommand({ key: "giving.look", title: "Look at giving", description: "Look at giving.", level: "read", permission: "pledges", module: "giving", input: object({ limit: f.withDefault(f.integer("How many.", { min: 1, max: 5 }), 3) }), execute: ok });
const draftComms = defineCommand({ key: "messages.write", title: "Write a message", description: "Write a message.", level: "draft", permission: "commsDraft", module: "comms", input: object({}), execute: ok });
const confirmEvents = defineCommand({ key: "events.change", title: "Change an event", description: "Change an event.", level: "confirm", permission: "eventsManage", module: "events", input: object({ name: f.string("The name.") }), execute: ok });
const onlyYou = defineCommand({ key: "settings.token", title: "Enter a token", description: "Enter a token.", level: "only_you", permission: "centerSettings", input: object({}), pointTo: { label: "Open Settings, Texting.", href: "/settings/texting" } });

function registry() {
  const r = new CommandRegistry();
  for (const c of [readEvents, readGiving, draftComms, confirmEvents, onlyYou]) r.register(c);
  return r;
}

describe("registering commands", () => {
  it("refuses a key that is not area.verb", () => {
    for (const key of ["search", "People.search", "people.search.all", "people.", ".search", "people-search.x"]) {
      expect(() => new CommandRegistry().register({ ...readEvents, key })).toThrow(/area\.verb/);
    }
  });
  it("refuses two commands with the same key", () => {
    const r = new CommandRegistry();
    r.register(readEvents);
    expect(() => r.register(readEvents)).toThrow(/already registered/);
  });
  it("refuses an only_you command that can run, and one that does not say where", () => {
    expect(() => new CommandRegistry().register({ ...onlyYou, execute: ok })).toThrow(/never runs/);
    expect(() => new CommandRegistry().register({ ...onlyYou, pointTo: undefined })).toThrow(/pointTo/);
  });
  it("refuses a read or confirm command with nothing to run", () => {
    expect(() => new CommandRegistry().register({ ...readEvents, execute: undefined })).toThrow(/execute/);
  });
  it("refuses a confirm command that is on by default: the owner switches those on", () => {
    expect(() => new CommandRegistry().register({ ...confirmEvents, enabledByDefault: true })).toThrow(/cannot be on by default/);
  });
});

describe("what a person may use", () => {
  it("shows only the commands the person's permissions allow", () => {
    const r = registry();
    const eventsViewer = fakeSession({ permissions: ["events.view"] });
    expect(r.list(eventsViewer).map((c) => c.key)).toEqual(["events.look"]);
    const manager = fakeSession({ permissions: ["events.manage", "comms.send"] });
    expect(r.list(manager).map((c) => c.key).sort()).toEqual(["events.change", "events.look", "messages.write"]);
    const nobody = fakeSession({ permissions: [] });
    expect(r.list(nobody)).toEqual([]);
  });

  it("gives a platform administrator everything that can run, and the owner what their permissions say", () => {
    const r = registry();
    expect(r.list(fakeSession({ isPlatformAdmin: true })).map((c) => c.key)).toHaveLength(4 + 1);
    expect(r.list(fakeSession({ isOwner: true, permissions: ["giving.view"] })).map((c) => c.key)).toEqual(["giving.look"]);
  });

  it("hides a command whose module is switched off, and says why in a sentence", () => {
    const r = registry();
    const session = fakeSession({ permissions: ["events.view", "giving.view"], modulesOff: ["giving"] });
    expect(r.list(session).map((c) => c.key)).toEqual(["events.look"]);
    const refusal = commandAvailability(readGiving, session, "screen");
    expect(refusal).toMatchObject({ ok: false, code: "module_off" });
    expect((refusal as { error: string }).error).toMatch(/switched off for Jain Society/);
  });

  it("says what permission is missing", () => {
    const refusal = commandAvailability(confirmEvents, fakeSession({ permissions: ["events.view"] }), "screen");
    expect(refusal).toEqual({ ok: false, code: "no_access", error: "Could not change an event — you don't have permission (needs events.manage)." });
  });
});

describe("the community's switch for Niva", () => {
  const manager = (rules: unknown) => fakeSession({ permissions: ["events.manage", "events.view"], center: { ...fakeSession().center, rules } });

  it("has read and draft commands on and confirm commands off until someone switches them on", () => {
    expect(isCommandEnabled(readEvents, {})).toBe(true);
    expect(isCommandEnabled(draftComms, {})).toBe(true);
    expect(isCommandEnabled(confirmEvents, {})).toBe(false);
  });

  it("reads the setting assistant.tools.<key> from the community's rules, flat or nested", () => {
    expect(toolSettingKey("events.change")).toBe("assistant.tools.events.change");
    expect(assistantToolSetting({ assistant: { tools: { "events.change": true } } }, "events.change")).toBe(true);
    expect(assistantToolSetting({ assistant: { tools: { events: { change: false } } } }, "events.change")).toBe(false);
    expect(assistantToolSetting({ assistant: { tools: { "events.change": "yes" } } }, "events.change")).toBeNull();
    expect(assistantToolSetting({}, "events.change")).toBeNull();
    expect(assistantToolSetting(null, "events.change")).toBeNull();
  });

  it("keeps a confirm command out of Niva's tools until switched on, but not out of the person's own hands", () => {
    const r = registry();
    const off = manager({});
    expect(r.list(off, "assistant").map((c) => c.key)).toEqual(["events.look"]);
    expect(r.list(off, "screen").map((c) => c.key).sort()).toEqual(["events.change", "events.look"]);
    expect(commandAvailability(confirmEvents, off, "assistant")).toMatchObject({ ok: false, code: "switched_off" });
    const on = manager({ assistant: { tools: { "events.change": true } } });
    expect(r.list(on, "assistant").map((c) => c.key).sort()).toEqual(["events.change", "events.look"]);
  });

  it("lets a community switch a read command off for Niva", () => {
    const r = registry();
    const session = manager({ assistant: { tools: { "events.look": false } } });
    expect(r.list(session, "assistant")).toEqual([]);
    expect(r.list(session, "palette").map((c) => c.key)).toContain("events.look");
  });
});

describe("the tool list for a model", () => {
  it("names tools without dots, and finds the command again from the name", () => {
    expect(toolName("events.set_field")).toBe("events_set_field");
    expect(commandKeyFromToolName("events_set_field")).toBe("events.set_field");
    expect(commandKeyFromToolName("giving_pledges_behind")).toBe("giving.pledges_behind");
  });

  it("has the shape a model API takes: name, description, input_schema, nothing else", () => {
    const tools = registry().modelTools(fakeSession({ permissions: ["events.manage", "events.view", "giving.view", "comms.send", "settings.manage"], center: { ...fakeSession().center, rules: { assistant: { tools: { "events.change": true } } } } }));
    expect(tools.map((t) => t.name).sort()).toEqual(["events_change", "events_look", "giving_look", "messages_write", "settings_token"]);
    for (const t of tools) {
      expect(Object.keys(t).sort()).toEqual(["description", "input_schema", "name"]);
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.input_schema).toMatchObject({ type: "object", additionalProperties: false });
      expect(Array.isArray(t.input_schema.required)).toBe(true);
      expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.giving_look.input_schema.properties.limit).toMatchObject({ type: "integer", default: 3 });
    expect(byName.giving_look.input_schema.required).toEqual([]);
    expect(byName.events_change.input_schema.required).toEqual(["name"]);
  });

  it("tells the model what each level means", () => {
    const session = fakeSession({ permissions: ["events.manage", "comms.send", "settings.manage"], center: { ...fakeSession().center, rules: { assistant: { tools: { "events.change": true } } } } });
    const byName = Object.fromEntries(registry().modelTools(session).map((t) => [t.name, t.description]));
    expect(byName.messages_write).toContain("Draft only: nothing is changed or sent.");
    expect(byName.events_change).toContain("asks the person to confirm first");
    expect(byName.settings_token).toContain("tells the person where to do it themselves");
  });

  it("offers a model nothing the person may not use", () => {
    expect(registry().modelTools(fakeSession({ permissions: [] }))).toEqual([]);
  });
});

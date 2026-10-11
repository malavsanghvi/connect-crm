import { describe, expect, it } from "vitest";

import {
  LEVEL_LABEL,
  buildPalette,
  buildRunInput,
  describeRun,
  flattenGroups,
  navEntries,
  scoreText,
  type NavEntry,
} from "@/lib/assistant/palette";
import { modKeyLabel, shortcutFor, trapIndex } from "@/lib/assistant/shortcuts";

import { sampleCommands } from "./fake-server";

const nav: NavEntry[] = [
  { label: "Giving › Payments", group: "Giving", href: "/giving/payments" },
  { label: "Events", group: "Events", href: "/events" },
  { label: "People › Households", group: "People", href: "/households" },
];

const titles = (query: string, commands = sampleCommands, entries = nav) =>
  flattenGroups(buildPalette(commands, entries, query)).map((i) => (i.kind === "command" ? i.command.title : i.label));

describe("palette filtering", () => {
  it("with nothing typed, lists every command grouped by area, then a few pages", () => {
    const groups = buildPalette(sampleCommands, nav, "");
    expect(groups.map((g) => g.key)).toEqual(["tasks", "people", "giving", "accounting", "events", "messages", "go"]);
    expect(groups.map((g) => g.label)).toEqual(["My tasks", "People", "Giving", "Accounting", "Events", "Messages", "Go to"]);
    expect(flattenGroups(groups).filter((i) => i.kind === "command")).toHaveLength(sampleCommands.length);
  });

  it("matches words in the title, the description or the area, in any order", () => {
    expect(titles("pledges")).toContain("Show who is behind on pledges");
    expect(titles("behind pledges")).toEqual(["Show who is behind on pledges"]);
    expect(titles("gujarati")).toEqual(["Draft an event reminder"]);
    expect(titles("giving")).toContain("Show who is behind on pledges");
    expect(titles("xyzzy")).toEqual([]);
  });

  it("is not case sensitive and ignores extra spaces", () => {
    expect(titles("  PLEDGES  ")).toEqual(titles("pledges"));
  });

  it("a match at the start of the title beats a match later on or in the description", () => {
    const list = titles("show");
    expect(list[0].startsWith("Show")).toBe(true);
    expect(scoreText(["event"], "Draft an event reminder", "")).toBeGreaterThan(scoreText(["event"], "Draft something", "an event")); // title beats description
    expect(scoreText(["draft"], "Draft an event reminder", "")).toBeGreaterThan(scoreText(["event"], "Draft an event reminder", ""));
  });

  it("finds pages by name too, and says where they are", () => {
    const groups = buildPalette(sampleCommands, nav, "payments");
    const go = groups.find((g) => g.key === "go");
    expect(go?.items.map((i) => (i.kind === "go" ? i.href : ""))).toEqual(["/giving/payments"]);
  });

  it("shows only the commands it was given (a role that cannot use a command never sees it)", () => {
    const some = sampleCommands.filter((c) => c.area !== "giving");
    expect(titles("pledges", some)).toEqual([]);
  });

  it("puts areas it does not know after the known ones", () => {
    const odd = [...sampleCommands, { ...sampleCommands[0], key: "zzz.thing", title: "Zzz thing", area: "zebra" }];
    const keys = buildPalette(odd, [], "").map((g) => g.key);
    expect(keys.at(-1)).toBe("zebra");
  });

  it("names the four levels in plain words", () => {
    expect(LEVEL_LABEL).toEqual({ read: "Look", draft: "Prepare", confirm: "Needs your OK", only_you: "Only you" });
    expect(titles("needs your ok")).toEqual(["Change a detail of an event"]);
  });

  it("limits the pages shown when nothing is typed", () => {
    const many: NavEntry[] = Array.from({ length: 30 }, (_, i) => ({ label: `Page ${i}`, group: "Pages", href: `/p${i}` }));
    const go = buildPalette([], many, "").find((g) => g.key === "go");
    expect(go?.items.length).toBe(6);
  });
});

describe("pages from the shell's visible navigation", () => {
  it("flattens modules and tabs, naming a tab by its module unless they share a name", () => {
    expect(
      navEntries([
        { label: "Home", tabs: [{ href: "/", label: "Home" }] },
        { label: "Giving", tabs: [{ href: "/giving/payments", label: "Payments" }, { href: "/giving/payments", label: "Payments again" }] },
      ]),
    ).toEqual([
      { label: "Home", group: "Home", href: "/" },
      { label: "Giving › Payments", group: "Giving", href: "/giving/payments" },
    ]);
  });
});

describe("the tiny form", () => {
  const fields = sampleCommands.find((c) => c.key === "events.set_field")!.fields;

  it("builds the input a command takes", () => {
    expect(buildRunInput(fields, { field: "venue", value: "  Main Hall " })).toEqual({ ok: true, input: { field: "venue", value: "Main Hall" } });
  });

  it("leaves out empty optional fields and converts numbers", () => {
    const f = sampleCommands.find((c) => c.key === "giving.pledges_behind")!.fields;
    expect(buildRunInput(f, {})).toEqual({ ok: true, input: {} });
    expect(buildRunInput(f, { min_days_overdue: "30" })).toEqual({ ok: true, input: { min_days_overdue: 30 } });
  });

  it("explains each problem in plain English", () => {
    const res = buildRunInput(fields, { field: "colour", value: "" });
    expect(res).toEqual({ ok: false, errors: { field: "Pick one of the choices for “What to change”.", value: "Fill in “New value”." } });
    const f = sampleCommands.find((c) => c.key === "giving.pledges_behind")!.fields;
    expect(buildRunInput(f, { min_days_overdue: "soon" })).toEqual({ ok: false, errors: { min_days_overdue: "“Days overdue” must be a number." } });
    expect(buildRunInput([{ name: "d", label: "Date", type: "date", required: true }], { d: "31/12/2026" })).toMatchObject({ ok: false });
    expect(buildRunInput([{ name: "d", label: "Date", type: "date", required: true }], { d: "2026-02-30" })).toMatchObject({ ok: false });
    expect(buildRunInput([{ name: "d", label: "Date", type: "date", required: true }], { d: "2026-10-31" })).toEqual({ ok: true, input: { d: "2026-10-31" } });
  });

  it("describes a run for the panel", () => {
    expect(describeRun({ title: "Change a detail of an event", fields }, { field: "venue", value: "Main Hall" })).toBe("Change a detail of an event: venue, Main Hall");
    expect(describeRun({ title: "Show my tasks", fields: [] }, {})).toBe("Show my tasks");
  });
});

describe("shortcuts", () => {
  const key = (k: string, over: Partial<Parameters<typeof shortcutFor>[0]> = {}) => ({ key: k, metaKey: false, ctrlKey: true, altKey: false, shiftKey: false, ...over });
  it("Ctrl or Command with K opens the palette and with J the panel", () => {
    expect(shortcutFor(key("k"))).toBe("palette");
    expect(shortcutFor(key("K", { ctrlKey: false, metaKey: true }))).toBe("palette");
    expect(shortcutFor(key("j"))).toBe("panel");
  });
  it("ignores other keys and combinations that belong to the browser", () => {
    expect(shortcutFor(key("k", { ctrlKey: false }))).toBeNull();
    expect(shortcutFor(key("k", { shiftKey: true }))).toBeNull();
    expect(shortcutFor(key("k", { altKey: true }))).toBeNull();
    expect(shortcutFor(key("p"))).toBeNull();
  });
  it("shows the right modifier name", () => {
    expect(modKeyLabel("MacIntel")).toBe("⌘");
    expect(modKeyLabel("Win32")).toBe("Ctrl");
  });
  it("wraps focus at both ends of a trap", () => {
    expect(trapIndex(3, 2, false)).toBe(0);
    expect(trapIndex(3, 0, true)).toBe(2);
    expect(trapIndex(3, 1, false)).toBe(2);
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
    expect(trapIndex(0, -1, false)).toBeNull();
  });
});

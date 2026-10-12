import { describe, expect, it, vi } from "vitest";

import type { MinorNameSource, MinorSession } from "@/lib/commands/child-filter";
import { defaultLayout, layoutPeople, type PosterLayout } from "@/lib/events/flyer-layout";
import { NAMES_NOT_CHECKED_NOTE, NAME_MATCHES_CHILD_NOTE, flyerNameNotes } from "@/lib/events/flyer-names";

const session = { db: {}, center: { id: "c1", time_zone: "UTC" } } as unknown as MinorSession;
const sourceOf = (names: string[]): MinorNameSource & { calls: number } => {
  const s = { calls: 0, namesOfMinors: async () => (s.calls++, names) };
  return s;
};
const layout = (over: Partial<PosterLayout> = {}): PosterLayout => ({ ...defaultLayout("notice", { headline: "Community Supper" }), ...over });

describe("the names typed into a layout", () => {
  it("are the host card's names and the contacts' names, unless the block is switched off", () => {
    const l = layout({ host: { label: "Hosted by", names: "The Okafor Family" }, contacts: [{ name: "Dana Whitfield", detail: "555" }, { name: "", detail: "555" }] });
    expect(layoutPeople(l)).toEqual(["The Okafor Family", "Dana Whitfield"]);
    expect(layoutPeople({ ...l, off: ["host"] })).toEqual(["Dana Whitfield"]);
    expect(layoutPeople({ ...l, off: ["host", "contacts"] })).toEqual([]);
  });
});

describe("flyerNameNotes: a reminder, never a block", () => {
  const l = layout({ host: { label: "Hosted by", names: "The Okafor Family" }, contacts: [{ name: "Dana Whitfield", detail: "555-0142" }] });

  it("says nothing, and does not even look, when no name is typed", async () => {
    const src = sourceOf(["Aarav Shah"]);
    expect(await flyerNameNotes(session, layout(), src)).toEqual([]);
    expect(await flyerNameNotes(session, undefined, src)).toEqual([]);
    expect(src.calls).toBe(0);
  });

  it("says nothing when no name matches a child", async () => {
    expect(await flyerNameNotes(session, l, sourceOf(["Aarav Shah", "Mia Brown"]))).toEqual([]);
  });

  it("warns without saying which name when one matches a child, in any culture", async () => {
    const notes = await flyerNameNotes(session, layout({ contacts: [{ name: "Aarav Shah", detail: "555" }] }), sourceOf(["Aarav Shah"]));
    expect(notes).toEqual([NAME_MATCHES_CHILD_NOTE]);
    expect(notes.join(" ")).not.toMatch(/Aarav|Shah/);
    expect(await flyerNameNotes(session, layout({ host: { label: "", names: "અનિલ મહેતા" } }), sourceOf(["મહેતા અનિલ"]))).toEqual([NAME_MATCHES_CHILD_NOTE]);
  });

  it("says plainly that the check could not run, and logs why", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken: MinorNameSource = { namesOfMinors: async () => Promise.reject(new Error("database down")) };
    expect(await flyerNameNotes(session, l, broken)).toEqual([NAMES_NOT_CHECKED_NOTE]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

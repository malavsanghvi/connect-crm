import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ dbWithReason: vi.fn() }));

import { SCREEN_ONLY_ON_SCREEN, updatePerson } from "@/lib/commands/catalog/people/update-person";
import { filterChildren, minorNameEntry } from "@/lib/commands/child-filter";
import { CONFLICT_PREFIX, expectText } from "@/lib/people-v2/inline-edit";
import { dbWithReason } from "@/lib/session";

import { ID, peopleContext, peopleDb } from "./commands/people-fixture";

// people.update_person with the five details that were read-only: the name a person goes by, interests, expertise areas, the best time to
// call and the daily learning goal. They are set on the People screen only (Niva does not change them), a child's record holds none of
// them except the preferred name, and a list is compared and saved like any other value (`expect`, `reason`, no change when nothing changed).

function world(opts: { via?: "screen" | "assistant" } = {}) {
  const { db, tables } = peopleDb();
  vi.mocked(dbWithReason).mockResolvedValue(db as never);
  const ctx = peopleContext({ via: opts.via ?? "screen", db });
  return { db, tables, ctx };
}
type Tables = ReturnType<typeof world>["tables"];
const person = (tables: Tables, id: string) => tables.people.find((r) => r.id === id) as Record<string, unknown>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(dbWithReason).mockReset();
});

describe("the name a person goes by", () => {
  it("is set, in any script, and cleared with nothing", async () => {
    const { ctx, tables } = world();
    const r = await updatePerson.execute!(ctx, { id: ID.priya, preferred_name: "प्रिया", expect: expectText({ preferred_name: "" }) });
    expect(r).toMatchObject({ ok: true, message: "Saved Priya's profile (preferred name) · audit logged" });
    expect(person(tables, ID.priya).preferred_name).toBe("प्रिया");
    await updatePerson.execute!(ctx, { id: ID.priya, preferred_name: "", expect: expectText({ preferred_name: "प्रिया" }) });
    expect(person(tables, ID.priya).preferred_name).toBeNull();
  });

  it("is allowed on a child's record: it is the one of the five a child can have", async () => {
    const { ctx, tables } = world();
    const r = await updatePerson.execute!(ctx, { id: ID.zoya, preferred_name: "Zo" });
    expect(r).toMatchObject({ ok: true });
    expect(person(tables, ID.zoya).preferred_name).toBe("Zo");
  });

  it("carries the reason into the audit, and a change is a conflict when someone else already changed it", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).preferred_name = "Pia"; // Ravi changed it
    await expect(updatePerson.execute!(ctx, { id: ID.priya, preferred_name: "Sami", expect: expectText({ preferred_name: "" }) })).rejects.toThrow(CONFLICT_PREFIX);
    expect(person(tables, ID.priya).preferred_name).toBe("Pia");
    await updatePerson.execute!(ctx, { id: ID.priya, preferred_name: "Sami", expect: expectText({ preferred_name: "Pia" }), reason: "Undo of preferred name change" });
    expect(vi.mocked(dbWithReason).mock.calls[0][1]).toBe("Undo of preferred name change");
  });
});

describe("interests and expertise areas", () => {
  it("saves a list as an array, from the stored JSON the screen sends, in any script", async () => {
    const { ctx, tables } = world();
    const r = await updatePerson.execute!(ctx, { id: ID.priya, interests: '["chess","茶道","ગુજરાતી"]', expect: expectText({ interests: "" }) });
    expect(r).toMatchObject({ ok: true, message: "Saved Priya's profile (interests) · audit logged" });
    expect(person(tables, ID.priya).interests).toEqual(["chess", "茶道", "ગુજરાતી"]);
  });

  it("also takes plain text with commas, and drops a repeat in another letter case", async () => {
    const { ctx, tables } = world();
    await updatePerson.execute!(ctx, { id: ID.rahul, expertise_tags: "Law, tax; LAW\nаудит" });
    expect(person(tables, ID.rahul).expertise_tags).toEqual(["Law", "tax", "аудит"]);
  });

  it("is no change when the list is the same in another order and letter case", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).interests = ["Chess", "art"];
    const r = await updatePerson.execute!(ctx, { id: ID.priya, interests: '["ART","chess"]', expect: expectText({ interests: '["Chess","art"]' }) });
    expect(r).toEqual({ ok: true, data: undefined, message: "No changes to save." });
    expect(person(tables, ID.priya).interests).toEqual(["Chess", "art"]);
  });

  it("clears with an empty value", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).interests = ["chess"];
    await updatePerson.execute!(ctx, { id: ID.priya, interests: "", expect: expectText({ interests: '["chess"]' }) });
    expect(person(tables, ID.priya).interests).toEqual([]);
  });

  it("refuses, and changes nothing, when someone else changed the list first", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).interests = ["chess"];
    person(tables, ID.priya).interests = ["chess", "hiking"]; // Ravi added one meanwhile
    const err = await updatePerson.execute!(ctx, { id: ID.priya, interests: '["chess","art"]', expect: expectText({ interests: '["chess"]' }) }).catch((e: Error) => e);
    expect((err as Error).message.startsWith(CONFLICT_PREFIX)).toBe(true);
    expect((err as Error).message).toContain("interests");
    expect(person(tables, ID.priya).interests).toEqual(["chess", "hiking"]);
    expect(dbWithReason).not.toHaveBeenCalled();
  });

  it("says in words when a list is too long or too big", async () => {
    const { ctx, tables } = world();
    await expect(updatePerson.execute!(ctx, { id: ID.priya, interests: Array.from({ length: 21 }, (_, i) => `n${i}`).join(",") })).rejects.toThrow(
      "Could not save the profile — Add at most 20 interests.",
    );
    await expect(updatePerson.execute!(ctx, { id: ID.priya, expertise_tags: "x".repeat(51) })).rejects.toThrow(/^Could not save the profile — Each expertise area can be 50 characters at most/);
    expect(person(tables, ID.priya).interests).toBeUndefined();
  });

  it("shows the before and after of a list in the preview, as words", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).interests = ["chess"];
    const p = await updatePerson.preview!(ctx, { id: ID.priya, interests: '["chess","art"]' });
    expect(p.lines).toEqual([{ label: "interests", before: "chess", after: "chess, art" }]);
  });
});

describe("the best time to call and the daily goal", () => {
  it("are saved as the database takes them", async () => {
    const { ctx, tables } = world();
    const r = await updatePerson.execute!(ctx, { id: ID.priya, best_call_time: "Evening", gyan_daily_minutes: "10", expect: expectText({ best_call_time: "", gyan_daily_minutes: "" }) });
    expect(r).toMatchObject({ ok: true, message: "Saved Priya's profile (best time to call and daily learning goal) · audit logged" });
    expect(person(tables, ID.priya)).toMatchObject({ best_call_time: "evening", gyan_daily_minutes: 10 });
    await updatePerson.execute!(ctx, { id: ID.priya, best_call_time: "", gyan_daily_minutes: "" });
    expect(person(tables, ID.priya)).toMatchObject({ best_call_time: null, gyan_daily_minutes: null });
  });

  it("refuse a value the database would not take, in words", async () => {
    const { ctx } = world();
    await expect(updatePerson.execute!(ctx, { id: ID.priya, best_call_time: "midnight" })).rejects.toThrow("Could not save the profile — Choose morning, afternoon or evening.");
    await expect(updatePerson.execute!(ctx, { id: ID.priya, gyan_daily_minutes: "12" })).rejects.toThrow("Could not save the profile — Choose 5, 10 or 15 minutes a day.");
  });

  it("are a conflict when someone else changed them, and none when they set the same", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).gyan_daily_minutes = 15;
    await expect(updatePerson.execute!(ctx, { id: ID.priya, gyan_daily_minutes: "5", expect: expectText({ gyan_daily_minutes: "10" }) })).rejects.toThrow(CONFLICT_PREFIX);
    const r = await updatePerson.execute!(ctx, { id: ID.priya, gyan_daily_minutes: "15", expect: expectText({ gyan_daily_minutes: "10" }) });
    expect(r).toMatchObject({ message: "No changes to save." });
  });
});

describe("a child's record (D2)", () => {
  const HOLD = /^Could not save the profile — a child's record does not hold /;

  it("holds none of interests, expertise areas, call time or daily goal, whoever asks", async () => {
    const { ctx, tables } = world();
    await expect(updatePerson.execute!(ctx, { id: ID.zoya, interests: "chess" })).rejects.toThrow(HOLD);
    await expect(updatePerson.execute!(ctx, { id: ID.zoya, expertise_tags: "law" })).rejects.toThrow(HOLD);
    await expect(updatePerson.execute!(ctx, { id: ID.zoya, best_call_time: "morning" })).rejects.toThrow(HOLD);
    await expect(updatePerson.execute!(ctx, { id: ID.zoya, gyan_daily_minutes: "5" })).rejects.toThrow(HOLD);
    expect(person(tables, ID.zoya).interests).toBeUndefined();
    expect(dbWithReason).not.toHaveBeenCalled();
  });

  it("says which of them, in words", async () => {
    const { ctx } = world();
    await expect(updatePerson.execute!(ctx, { id: ID.zoya, interests: "chess", best_call_time: "morning" })).rejects.toThrow(
      "does not hold interests and best time to call. Only a preferred name can be set for a child.",
    );
  });

  it("includes a child with no birth date on file whose household role is child", async () => {
    const { ctx } = world();
    await expect(updatePerson.execute!(ctx, { id: ID.aarav, interests: "chess" })).rejects.toThrow(HOLD);
  });

  it("includes an adult whose birth date is changed to a child's in the same save", async () => {
    const { ctx, tables } = world();
    await expect(updatePerson.execute!(ctx, { id: ID.rahul, date_of_birth: "03/04/2018", interests: "chess" })).rejects.toThrow(HOLD);
    expect(person(tables, ID.rahul).interests).toBeUndefined();
    expect(person(tables, ID.rahul).date_of_birth).toBe("1982-07-19");
  });

  it("still lets the same adult have them once the birth date is an adult's", async () => {
    const { ctx, tables } = world();
    const r = await updatePerson.execute!(ctx, { id: ID.rahul, date_of_birth: "07/19/1982", interests: "chess" });
    expect(r).toMatchObject({ ok: true });
    expect(person(tables, ID.rahul).interests).toEqual(["chess"]);
  });
});

describe("a child's preferred name never goes toward an AI provider (D2)", () => {
  it("is one of the names the child filter removes from any text, in any script", () => {
    const zoya = minorNameEntry({ first_name: "Zoya", last_name: "Shah", preferred_name: "Zo" });
    const filtered = filterChildren({ note: "Zo said hello, and so did Zoya Shah." }, { minorNames: [zoya] });
    expect(JSON.stringify(filtered.value)).not.toMatch(/Zo/);
    expect(filtered.removed).toBeGreaterThan(0);
    const aarav = minorNameEntry({ first_name: "आरव", last_name: "पटेल", preferred_name: "आरू" });
    expect(JSON.stringify(filterChildren({ text: "आरू आया था" }, { minorNames: [aarav] }).value)).not.toContain("आरू");
  });
});

describe("Niva does not change them", () => {
  it("is told they are set on the People screen, for an adult too, and nothing is written", async () => {
    const { ctx, tables } = world({ via: "assistant" });
    for (const input of [{ preferred_name: "Pia" }, { interests: "chess" }, { expertise_tags: "law" }, { best_call_time: "morning" }, { gyan_daily_minutes: "5" }]) {
      await expect(updatePerson.execute!(ctx, { id: ID.priya, ...input })).rejects.toThrow(SCREEN_ONLY_ON_SCREEN);
    }
    expect(person(tables, ID.priya).preferred_name).toBeNull();
    expect(dbWithReason).not.toHaveBeenCalled();
  });

  it("keeps the details it may change working", async () => {
    const { ctx, tables } = world({ via: "assistant" });
    const r = await updatePerson.execute!(ctx, { id: ID.priya, profession: "Doctor" });
    expect(r).toMatchObject({ ok: true });
    expect(person(tables, ID.priya).profession).toBe("Doctor");
  });

  it("marks each of the five inputs as screen only in what Niva is shown", () => {
    const shape = (updatePerson.input as unknown as { shape: Record<string, { description: string }> }).shape;
    for (const k of ["preferred_name", "interests", "expertise_tags", "best_call_time", "gyan_daily_minutes"]) {
      expect(shape[k].description.startsWith("Screen only:")).toBe(true);
      expect(shape[k].description).toMatch(/Niva does not change (it|them)\.$/);
    }
  });
});

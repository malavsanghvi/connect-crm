import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ dbWithReason: vi.fn() }));

import { updateHousehold } from "@/lib/commands/catalog/people/update-household";
import { updatePerson } from "@/lib/commands/catalog/people/update-person";
import { CONFLICT_PREFIX, expectText } from "@/lib/people-v2/inline-edit";
import { dbWithReason } from "@/lib/session";

import { ID, peopleContext, peopleDb } from "./commands/people-fixture";

// `expect` (the value the person saw) and `reason` on the two update commands: additive, optional, and what the Family page's
// click-to-edit sends. Callers that send neither behave exactly as before (tests/commands/people-writes.test.ts).

function world(opts: { via?: "screen" | "assistant" } = {}) {
  const { db, tables } = peopleDb();
  vi.mocked(dbWithReason).mockResolvedValue(db as never);
  const ctx = peopleContext({ via: opts.via ?? "screen", db });
  return { db, tables, ctx };
}

const person = (tables: ReturnType<typeof world>["tables"], id: string) => tables.people.find((r) => r.id === id) as Record<string, unknown>;
const household = (tables: ReturnType<typeof world>["tables"], id: string) => tables.households.find((r) => r.id === id) as Record<string, unknown>;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(dbWithReason).mockReset();
});

describe("people.update_person with expect and reason", () => {
  it("saves when the value is still the one the person saw, and the write carries the reason", async () => {
    const { ctx, tables } = world();
    const r = await updatePerson.execute!(ctx, {
      id: ID.priya,
      phone_e164: "(512) 555-0188",
      expect: expectText({ phone_e164: "+15125550101" }),
      reason: "Verified from ID",
    });
    expect(r).toMatchObject({ ok: true, message: "Saved Priya's profile (mobile) · audit logged" });
    expect(person(tables, ID.priya).phone_e164).toBe("+15125550188");
    expect(dbWithReason).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dbWithReason).mock.calls[0][1]).toBe("Verified from ID");
  });

  it("refuses, and changes nothing, when someone else changed the value first", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).phone_e164 = "+18325550199"; // Ravi changed it
    const err = await updatePerson.execute!(ctx, { id: ID.priya, phone_e164: "(512) 555-0188", expect: expectText({ phone_e164: "+15125550101" }) }).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message.startsWith(CONFLICT_PREFIX)).toBe(true);
    expect((err as Error).message).toContain("mobile");
    expect(person(tables, ID.priya).phone_e164).toBe("+18325550199");
    expect(dbWithReason).not.toHaveBeenCalled();
  });

  it("is no conflict when the other change was to a field this edit does not touch", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).profession = "Surgeon"; // someone else changed the profession
    const r = await updatePerson.execute!(ctx, {
      id: ID.priya,
      phone_e164: "(512) 555-0188",
      expect: expectText({ phone_e164: "+15125550101", profession: "Engineer" }),
    });
    expect(r).toMatchObject({ ok: true });
    expect(person(tables, ID.priya)).toMatchObject({ phone_e164: "+15125550188", profession: "Surgeon" });
  });

  it("is no conflict when someone else already made the same change", async () => {
    const { ctx, tables } = world();
    person(tables, ID.priya).phone_e164 = "+15125550188";
    const r = await updatePerson.execute!(ctx, { id: ID.priya, phone_e164: "(512) 555-0188", expect: expectText({ phone_e164: "+15125550101" }) });
    expect(r).toEqual({ ok: true, data: undefined, message: "No changes to save." });
  });

  it("checks the relationship against the one on file", async () => {
    const { ctx, tables } = world();
    const members = tables.household_members as Record<string, unknown>[];
    members.find((m) => m.person_id === ID.rahul)!.role = "parent"; // changed meanwhile
    await expect(
      updatePerson.execute!(ctx, { id: ID.rahul, household_id: ID.hhShah, role: "sibling", expect: expectText({ role: "spouse" }) }),
    ).rejects.toThrow(CONFLICT_PREFIX);
    expect(members.find((m) => m.person_id === ID.rahul)!.role).toBe("parent");
    const ok = await updatePerson.execute!(ctx, { id: ID.rahul, household_id: ID.hhShah, role: "sibling", expect: expectText({ role: "parent" }) });
    expect(ok).toMatchObject({ ok: true });
    expect(members.find((m) => m.person_id === ID.rahul)!.role).toBe("sibling");
  });

  it("refuses an expectation that is not JSON, in words", async () => {
    const { ctx } = world();
    await expect(updatePerson.execute!(ctx, { id: ID.priya, profession: "Doctor", expect: "the old one" })).rejects.toThrow(
      /^Could not save the profile — the value you saw \(expect\) must be JSON/,
    );
  });

  it("takes a name in another script, with the reason that explains it", async () => {
    const { ctx, tables } = world();
    const r = await updatePerson.execute!(ctx, {
      id: ID.priya,
      first_name: "Айгуль",
      last_name: "Сатпаева",
      expect: expectText({ first_name: "Priya", last_name: "Shah" }),
      reason: "Legal name change",
    });
    expect(r).toMatchObject({ ok: true });
    expect(person(tables, ID.priya)).toMatchObject({ first_name: "Айгуль", last_name: "Сатпаева" });
    expect(vi.mocked(dbWithReason).mock.calls[0][1]).toBe("Legal name change");
  });

  it("does not ask for the reason header when no reason was given, and cuts a very long one", async () => {
    const { ctx } = world();
    await updatePerson.execute!(ctx, { id: ID.priya, profession: "Doctor" });
    expect(dbWithReason).not.toHaveBeenCalled();
    await updatePerson.execute!(ctx, { id: ID.priya, profession: "Nurse", reason: "x".repeat(900) });
    expect(String(vi.mocked(dbWithReason).mock.calls[0][1]).length).toBe(300);
  });

  it("still keeps the children's records away from Niva when it sends these", async () => {
    const { ctx } = world({ via: "assistant" });
    await expect(updatePerson.execute!(ctx, { id: ID.zoya, profession: "x", expect: expectText({ profession: "" }) })).rejects.toThrow(
      /does not work with children's records/,
    );
  });
});

describe("people.update_household with expect and reason", () => {
  it("saves an address change the person saw, with the reason", async () => {
    const { ctx, tables } = world();
    const r = await updateHousehold.execute!(ctx, { id: ID.hhShah, city: "Round Rock", expect: expectText({ city: "Austin" }), reason: "Correction" });
    expect(r).toMatchObject({ ok: true });
    expect(household(tables, ID.hhShah).city).toBe("Round Rock");
    expect(vi.mocked(dbWithReason).mock.calls[0][1]).toBe("Correction");
  });

  it("refuses when any line of the address changed under the person", async () => {
    const { ctx, tables } = world();
    household(tables, ID.hhShah).address_line1 = "9 Elm Street";
    const err = await updateHousehold.execute!(ctx, {
      id: ID.hhShah,
      address_line1: "2 Oak St",
      city: "Round Rock",
      expect: expectText({ address_line1: "1 Oak St", city: "Austin" }),
    }).catch((e: Error) => e);
    expect((err as Error).message.startsWith(CONFLICT_PREFIX)).toBe(true);
    expect((err as Error).message).toContain("street address");
    expect(household(tables, ID.hhShah)).toMatchObject({ address_line1: "9 Elm Street", city: "Austin" });
  });

  it("does not write the household note: it is not an input of the command, so nothing changes", async () => {
    const { ctx, tables } = world();
    household(tables, ID.hhShah).notes = "Prefers evening calls.";
    const r = await updateHousehold.execute!(ctx, { id: ID.hhShah, notes: "Changed" } as never);
    expect(r).toMatchObject({ ok: true, message: "No changes to save." });
    expect(household(tables, ID.hhShah).notes).toBe("Prefers evening calls.");
  });

  it("checks a switch the way it is saved: on or off", async () => {
    const { ctx, tables } = world();
    household(tables, ID.hhShah).directory_opt_in = true;
    household(tables, ID.hhShah).physical_mail_opt_in = true;
    const turned = await updateHousehold.execute!(ctx, { id: ID.hhShah, physical_mail_opt_in: "off", expect: expectText({ physical_mail_opt_in: "on" }) });
    expect(turned).toMatchObject({ ok: true });
    expect(household(tables, ID.hhShah).physical_mail_opt_in).toBe(false);
  });

  it("a tier change keeps its own reason and the household write only carries a reason when one was given", async () => {
    const { ctx } = world();
    await updateHousehold.execute!(ctx, { id: ID.hhShah, city: "Round Rock" });
    expect(dbWithReason).not.toHaveBeenCalled();
  });
});

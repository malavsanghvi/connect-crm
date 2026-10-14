import { describe, expect, it } from "vitest";

import { f, object, type Infer } from "@/lib/commands/schema";

describe("command input schema", () => {
  const schema = object({
    event_id: f.uuid("The event."),
    venue: f.optional(f.string("The venue.", { min: 0, max: 20 })),
    days: f.withDefault(f.integer("Days.", { min: 1, max: 30 }), 7),
    kind: f.enum("Which.", ["a", "b"] as const),
    on: f.optional(f.boolean("Yes or no.")),
    day: f.optional(f.date("A day.")),
  });
  const good = { event_id: "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1001", kind: "a" };

  it("reads a good input and fills defaults", () => {
    const r = schema.parse(good);
    expect(r).toEqual({ ok: true, value: { event_id: good.event_id, kind: "a", days: 7 } });
    const typed: Infer<typeof schema> = (r as { value: Infer<typeof schema> }).value;
    expect(typed.days).toBe(7);
  });

  it("says what is wrong in a sentence, naming the field in words", () => {
    expect(schema.parse({ kind: "a" })).toEqual({ ok: false, error: "Event is required." });
    expect(schema.parse({ ...good, event_id: "nope" })).toEqual({ ok: false, error: "Event is not a valid id." });
    expect(schema.parse({ ...good, kind: "c" })).toEqual({ ok: false, error: "Kind must be one of: a, b." });
    expect(schema.parse({ ...good, days: 99 })).toEqual({ ok: false, error: "Days must be at most 30." });
    expect(schema.parse({ ...good, days: 2.5 })).toEqual({ ok: false, error: "Days must be a whole number." });
    expect(schema.parse({ ...good, venue: "x".repeat(21) })).toEqual({ ok: false, error: "Venue can be at most 20 characters." });
    expect(schema.parse({ ...good, day: "2026-02-31" })).toEqual({ ok: false, error: "Day must be a date like 2026-10-25." });
    expect(schema.parse({ ...good, on: "maybe" })).toEqual({ ok: false, error: "On must be yes or no." });
  });

  it("refuses a value the command does not take", () => {
    expect(schema.parse({ ...good, person_id: "x" })).toEqual({ ok: false, error: 'This action does not take "person_id".' });
    expect(schema.parse("text")).toEqual({ ok: false, error: "The details for this action must be a set of named values." });
  });

  it("accepts numbers and booleans sent as text, as a form or a model might", () => {
    const r = schema.parse({ ...good, days: "12", on: "yes" });
    expect(r).toMatchObject({ ok: true, value: { days: 12, on: true } });
  });

  it("allows an empty string where the field allows it (clearing a value)", () => {
    expect(schema.parse({ ...good, venue: "" })).toMatchObject({ ok: true, value: { venue: "" } });
  });

  it("describes itself as a JSON schema for a model", () => {
    const json = schema.json();
    expect(json.type).toBe("object");
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(["event_id", "kind"]);
    expect(json.properties.kind).toMatchObject({ type: "string", enum: ["a", "b"] });
    expect(json.properties.days).toMatchObject({ type: "integer", minimum: 1, maximum: 30, default: 7 });
    expect(json.properties.event_id).toMatchObject({ format: "uuid" });
    expect(() => JSON.stringify(json)).not.toThrow();
  });
});

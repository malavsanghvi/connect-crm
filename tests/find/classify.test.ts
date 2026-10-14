import { describe, expect, it } from "vitest";

import { classifyInput, isQuestion, looksLikePhone } from "@/lib/find/classify";

const vocab = { zones: [{ id: "z1", name: "North Riverside" }, { id: "z2", name: "Old Town" }], year: 2026 };
const kind = (text: string) => classifyInput(text, vocab).kind;

describe("classifyInput: what was typed is read by rules", () => {
  it("reads a name in any script as a name", () => {
    for (const t of ["Sam", "Sam Nakamura", "Sofia Fernandez", "田中", "田中 太郎", "प्रिया शर्मा", "محمد الحسن", "Николай Иванов", "O'Brien", "Howard Lee"]) {
      expect(kind(t), t).toBe("name");
    }
  });

  it("reads an email address (also a part of one)", () => {
    expect(kind("ana@lopezbakery.example")).toBe("email");
    expect(kind("ana@lop")).toBe("email");
    expect(kind("@lopezbakery.example")).toBe("email");
  });

  it("reads phone numbers in any format, and the last digits with formatting", () => {
    for (const t of ["+1 415 555 0134", "(415) 555-0134", "415.555.0134", "4155550134", "555-0142", "+44 20 7946 0958", "415 555"]) {
      expect(kind(t), t).toBe("phone");
    }
    expect(classifyInput("(415) 555-0134").digits).toBe("4155550134");
  });

  it("reads numbers and codes as identifiers: member and household numbers, old and system IDs, QuickBooks ids", () => {
    for (const t of ["1042", "0417", "417", "20417", "JSH-H-2041", "T-0417", "QB-88412", "M-10482", "member 417", "household no. 0212", "QuickBooks 88412"]) {
      expect(kind(t), t).toBe("identifier");
    }
    // The words that only say what kind of number it is are not part of what is looked up.
    expect(classifyInput("member 417").search).toBe("417");
    expect(classifyInput("household no. 0212").search).toBe("0212");
    expect(classifyInput("T-0417").shape).toBe("code");
    expect(classifyInput("1042").shape).toBe("number");
  });

  it("reads a quoted or capitalised bank payer name as an identifier, and a single capital word as a name", () => {
    expect(kind("LOPEZ BAKERY LLC")).toBe("identifier");
    expect(classifyInput("LOPEZ BAKERY LLC").shape).toBe("payer");
    expect(classifyInput('"Lopez Bakery"').search).toBe("Lopez Bakery");
    expect(kind("LOPEZ")).toBe("name");
    expect(kind("Lopez Bakery")).toBe("name");
  });

  it("reads a question: starts with who, what, which, how, when, why, show or list, or ends with a question mark", () => {
    for (const t of ["who owes more than $100?", "What events are coming up", "which families are in North", "how many adults have no email", "when did Sam join", "why is this household flagged", "show families in North", "list life members", "open balance over 100?", "Sam Nakamura?"]) {
      expect(kind(t), t).toBe("question");
      expect(isQuestion(t)).toBe(true);
    }
    // A word that merely starts like one is not a question.
    for (const t of ["Howard", "Whoopi Lee", "Listing Road", "Showalter family"]) expect(kind(t), t).toBe("name");
  });

  it("reads a sentence the People filters understand as a filter, when it has two words or more", () => {
    expect(kind("open balance over 500")).toBe("filter");
    expect(kind("life members")).toBe("filter");
    expect(kind("memberships ending in 30 days")).toBe("filter");
    expect(kind("families in North Riverside with an open balance")).toBe("filter");
    expect(kind("no rsvp this year")).toBe("filter");
  });

  it("does not read one word, or a name that merely contains an area's name, as a filter", () => {
    expect(kind("Riverside")).toBe("name");
    expect(kind("Old")).toBe("name");
    expect(classifyInput("North Riverside").kind).toBe("name"); // an area alone is a place a name might hold, not a list
  });

  it("returns an empty name for nothing", () => {
    expect(classifyInput("   ")).toMatchObject({ kind: "name", text: "", search: "" });
  });

  it("phone detection needs 4 digits and either 7 or more digits or phone punctuation", () => {
    expect(looksLikePhone("0142")).toBe(false);
    expect(looksLikePhone("5550142")).toBe(true);
    expect(looksLikePhone("555-0142")).toBe(true);
    expect(looksLikePhone("12")).toBe(false);
    expect(looksLikePhone("ab 555-0142")).toBe(false);
  });
});

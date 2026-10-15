import { describe, expect, it } from "vitest";

import { childLabel, maskEmail, maskName, maskPhone } from "@/lib/mask";

// The same table as supabase/tests/822_rsvp_contact_test.sql (section A) and docs/RSVP_WITHOUT_LOGIN.md section 4. The database does the
// real masking; this twin is for the portal's preview and for these tests, and the two must agree.
const NAMES: [string, string][] = [
  ["Malav", "M***v"],
  ["Al", "A*"],
  ["Jo", "J*"],
  ["A", "*"],
  ["Raj", "R**"],
  ["Anil", "A**l"],
  ["Priya Shah", "P***a S**h"],
  ["Mary Ann", "M**y A**"],
  ["Jean-Luc", "J**n-L**"],
  ["O'Brien", "*'B***n"],
  ["J. R. R.", "*. *. *."],
  ["José", "J**é"],
  ["Zoë", "Z**"],
  ["李伟", "李*"],
  ["王小明", "王**"],
  ["محمد", "م**د"],
  ["माला", "मा*"],
  ["માલવ", "મા**"],
  ["", ""],
  ["Jose" + String.fromCharCode(0x301), "J**é"],
];

const EMAILS: [string, string | null][] = [
  ["name@gmail.com", "n***@g***.com"],
  ["a@gmail.com", "***@g***.com"],
  ["Name@Gmail.com", "n***@g***.com"],
  ["malav.sanghavi@mail.company.co.uk", "m***@m***.c***.c***.uk"],
  ["mira822@family.test", "m***@f***.test"],
  ["not an email", null],
  ["", null],
  ["a@b", null],
];

const PHONES: [string, string | null][] = [
  ["+13125550187", "+1 *** *** **87"],
  ["+1 (312) 555-0187", "+1 *** *** **87"],
  ["3125550187", "+1 *** *** **87"],
  ["+442071234567", "+**********67"],
  ["12345", null],
  ["", null],
];

describe("maskName", () => {
  it.each(NAMES)("%s → %s", (input, expected) => {
    expect(maskName(input)).toBe(expected);
  });

  it("the owner's example M**AV hides 2 of 5 letters (40%); the rule hides 3 of 5 (M***v)", () => {
    expect([..."M**AV"].filter((c) => c === "*").length / 5).toBe(0.4);
    expect([...maskName("Malav")].filter((c) => c === "*").length / 5).toBeGreaterThanOrEqual(0.5);
  });

  it("keeps the length and hides at least half of every word, for any word", () => {
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(Math.random() * 30);
      const word = Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
      const masked = maskName(word);
      const stars = [...masked].filter((c) => c === "*").length;
      expect(masked).toHaveLength(n);
      expect(stars * 2).toBeGreaterThanOrEqual(n);
      if (n >= 4) {
        expect(masked[0]).toBe(word[0]);
        expect(masked[n - 1]).toBe(word[n - 1]);
      }
    }
  });

  it("null and undefined give an empty name", () => {
    expect(maskName(null)).toBe("");
    expect(maskName(undefined)).toBe("");
  });
});

describe("maskEmail", () => {
  it.each(EMAILS)("%s → %s", (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });
});

describe("maskPhone", () => {
  it.each(PHONES)("%s → %s", (input, expected) => {
    expect(maskPhone(input)).toBe(expected);
  });
});

describe("childLabel", () => {
  it("is a number, never a name or an age", () => {
    expect(childLabel(1)).toBe("Child 1");
    expect(childLabel(2)).toBe("Child 2");
  });
});

import { describe, expect, it } from "vitest";

import { CHILD_NAME_REPLACEMENT as M, compileMinorNames, foldName, type MinorNameEntry } from "@/lib/commands/minor-names";

// A property test for decision D2: however a known child's name is mangled (invisible characters inside it, upper and lower case,
// written in either Unicode form, a suffix or a prefix glued on, digits, an address around it, its words run together or apart),
// the cleaned text no longer holds the name. The mangling stays inside what the filter promises: a name of five letters or more is
// found anywhere; four letters where a word starts; three as a whole word; scripts written without spaces anywhere.

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INVISIBLE = ["​", "‌", "‍", "⁠", "﻿", "­", "‎", "‏", "ㅤ", "️", "͏", "᠋", "\u{e0041}"];

type Subject = {
  name: string;
  entry: MinorNameEntry;
  /** How long its longest word is, in letters: 5 or more is found anywhere, 4 where a word starts, 3 as a whole word. */
  reach: "anywhere" | "start" | "whole";
  /** Whether letter case means anything in its script. */
  cased: boolean;
  /** Whether it is made of two words that may run together or be pulled apart. */
  twoWords?: boolean;
};

const kid = (given: string, family = "Shah"): MinorNameEntry => ({ full: [`${given} ${family}`], words: [given] });

const SUBJECTS: Subject[] = [
  { name: "Aarav", entry: kid("Aarav"), reach: "anywhere", cased: true },
  { name: "Anita", entry: kid("Anita", "Mehta"), reach: "anywhere", cased: true },
  { name: "Kishan", entry: kid("Kishan", "Patel"), reach: "anywhere", cased: true },
  { name: "Nguyễn", entry: kid("Nguyễn", "Tran"), reach: "anywhere", cased: true },
  { name: "Abdulrahman", entry: "Abdulrahman", reach: "anywhere", cased: true },
  { name: "Mary Ann", entry: "Mary Ann", reach: "start", cased: true, twoWords: true },
  { name: "María José", entry: "María José", reach: "anywhere", cased: true, twoWords: true },
  { name: "Zoya", entry: kid("Zoya"), reach: "start", cased: true },
  { name: "Aaro", entry: kid("Aaro", "Virtanen"), reach: "start", cased: true },
  { name: "Dev", entry: kid("Dev"), reach: "whole", cased: true },
  { name: "Павел", entry: kid("Павел", "Иванов"), reach: "anywhere", cased: true },
  { name: "Любовь", entry: kid("Любовь", "Иванова"), reach: "anywhere", cased: true },
  { name: "كريم", entry: "كريم", reach: "anywhere", cased: false },
  { name: "عبد الرحمن", entry: "عبد الرحمن", reach: "anywhere", cased: false, twoWords: true },
  { name: "דוד", entry: "דוד", reach: "anywhere", cased: false },
  { name: "გიორგი", entry: "გიორგი", reach: "anywhere", cased: false },
  { name: "Արամ", entry: "Արամ", reach: "start", cased: false },
  { name: "அர்ஜுன்", entry: "அர்ஜுன்", reach: "anywhere", cased: false },
  { name: "આરવ", entry: "આરવ", reach: "anywhere", cased: false },
  { name: "王伟", entry: { full: ["伟 王"], words: ["伟"] }, reach: "anywhere", cased: false },
  { name: "김민준", entry: "김민준", reach: "anywhere", cased: false },
  { name: "田中太郎", entry: "田中太郎", reach: "anywhere", cased: false },
  { name: "สมชาย", entry: "สมชาย", reach: "anywhere", cased: false },
];

/** What is left of a text once the replacement is out and only the letters of the name's kind remain, folded. */
const squash = (s: string): string => foldName(s.split(M).join(" ")).replace(/[^\p{L}\p{N}\p{M}]+/gu, "");

const SUFFIXES_LONG = ["", "12", "2015", "ni", "ji", "bhai", "x", "_final.pdf", "@gmail.com", ".png", "'s", "ほ", "同学", "님", "ครับ", "-shah", " and Priya Shah"];
const SUFFIXES_START = SUFFIXES_LONG;
const SUFFIXES_WHOLE = ["", "12", "2015", "_x", "-x", ".pdf", "@x.org", ", ok", " ok", "Shah", "a", "ji", "bhai", "ni"];
const PREFIXES_LONG = ["", "xx", "Team", "#", "my_", "12", "x.", "https://school.example.org/", "Mr", "同学"];
const PREFIXES_BOUNDARY = ["", "#", "_", "12", "x.", "@", " ", "https://school.example.org/students/"];

function mangle(s: Subject, rand: () => number): string {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  let chars = Array.from(s.name);
  // Case: every letter may change.
  if (s.cased && rand() < 0.6) chars = chars.map((c) => (rand() < 0.5 ? c.toUpperCase() : c.toLowerCase()));
  // Invisible characters inside the name (never before its first letter or after its last: that is outside the name).
  const inserts = rand() < 0.7 ? 1 + Math.floor(rand() * 3) : 0;
  for (let i = 0; i < inserts && chars.length > 1; i += 1) chars.splice(1 + Math.floor(rand() * (chars.length - 1)), 0, pick(INVISIBLE));
  let text = chars.join("");
  // Two words: run together, hyphenated, joined by an underscore, or written with a capital for the second.
  if (s.twoWords && rand() < 0.7) {
    const how = pick(["", "-", "_", "."]);
    text = text.replace(/ /, how);
  }
  // Written as letters plus marks, or as precomposed letters.
  text = rand() < 0.5 ? text.normalize("NFD") : text.normalize("NFC");
  const wholeOrStart = s.reach !== "anywhere";
  const prefix = pick(wholeOrStart ? PREFIXES_BOUNDARY : PREFIXES_LONG);
  const suffix = pick(s.reach === "whole" ? SUFFIXES_WHOLE : s.reach === "start" ? SUFFIXES_START : SUFFIXES_LONG);
  return `${prefix}${text}${suffix}`;
}

describe("a known child's name never gets through, whatever is done to it", () => {
  for (const [index, s] of SUBJECTS.entries()) {
    it(`${s.name} (${s.reach})`, () => {
      const scanner = compileMinorNames([s.entry, kid("Rohan", "Desai")]);
      const rand = rng(1000 + index);
      const want = squash(s.name);
      for (let n = 0; n < 60; n += 1) {
        const text = mangle(s, rand);
        const out = scanner.redact(text).text;
        const shown = `${JSON.stringify(text)} -> ${JSON.stringify(out)}`;
        expect(out, shown).toContain(M);
        // For a name with two words the words run together: if one of them is still there the other is too, so look for the whole.
        expect(squash(out), shown).not.toContain(want);
        expect(scanner.find(out), shown).toEqual([]);
        expect(scanner.redact(out).text, shown).toBe(out);
      }
    });
  }

  it("leaves other people's names alone in the same text", () => {
    const scanner = compileMinorNames([kid("Aarav")]);
    const rand = rng(7);
    for (let n = 0; n < 40; n += 1) {
      const text = `${mangle(SUBJECTS[0], rand)} Priya Shah and Rahul Desai`;
      const out = scanner.redact(text).text;
      expect(out, text).toContain("Priya Shah and Rahul Desai");
    }
  });
});

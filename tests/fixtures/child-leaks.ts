// Every way a child's name was found, by an adversarial review of the first culture-neutral filter, to get through it. Each case is a
// child (as the database source gives one), a text that carries the name, and what must be gone from the text once it is cleaned.
// Used by tests/child-leaks.test.ts and by the sweep in tests/commands/child-safeguards-any-culture.test.ts.

import type { MinorNameEntry } from "@/lib/commands/minor-names";

export type LeakCase = {
  /** The review's number for this kind of leak (1 to 12; see docs/DECISIONS.md D2). */
  group: number;
  /** The children of the community (only the first is the one the text is about). */
  children: MinorNameEntry[];
  text: string;
  /** Lower-case pieces that must not be left in the cleaned text, once invisible characters are removed. */
  gone: string[];
};

const kid = (given: string, family = "Shah"): MinorNameEntry => ({ full: [`${given} ${family}`.trim()], words: [given] });
const bare = (name: string): MinorNameEntry => name;

export const LEAK_CASES: LeakCase[] = [
  // 1. Latin names glued to digits, punctuation, other words and endings
  { group: 1, children: [kid("Aarav")], text: "Aarav12", gone: ["aarav"] },
  { group: 1, children: [kid("Aarav")], text: "aarav2015@gmail.com", gone: ["aarav", "2015"] },
  { group: 1, children: [kid("Aarav")], text: "AaravShah_x.pdf", gone: ["aarav"] },
  { group: 1, children: [kid("Zoya")], text: "ZoyaShah", gone: ["zoya"] },
  { group: 1, children: [kid("Zoya")], text: "zoya_shah_2015.png", gone: ["zoya"] },
  { group: 1, children: [kid("Aarav")], text: "#TeamAarav", gone: ["aarav"] },
  { group: 1, children: [kid("Zoya")], text: "#TeamZoya", gone: ["zoya"] },
  { group: 1, children: [kid("Aarav")], text: "https://school.example.org/students/aarav-shah/profile?id=7", gone: ["aarav"] },
  { group: 1, children: [kid("Aarav")], text: "Aaravni", gone: ["aarav"] },
  { group: 1, children: [kid("Aarav")], text: "Aaravji is here", gone: ["aarav"] },
  { group: 1, children: [kid("Kishan", "Mehta")], text: "Kishanbhai", gone: ["kishan"] },
  { group: 1, children: [kid("Jan", "Kowalski")], text: "Jana", gone: ["jana"] },
  { group: 1, children: [kid("Ali", "Yilmaz")], text: "Alinin kitabi", gone: ["alinin"] },
  { group: 1, children: [kid("Aaro", "Virtanen")], text: "Aaron kirja", gone: ["aaron"] },
  { group: 1, children: [bare("გიორგი")], text: "გიორგის წიგნი", gone: ["გიორგი"] },
  { group: 1, children: [bare("Արամ")], text: "Արամի գիրքը", gone: ["արամ"] },
  { group: 1, children: [kid("Zoya")], text: "ZOYA", gone: ["zoya"] },
  // 2. Latin glued to Chinese, Japanese, Korean, Thai
  { group: 2, children: [kid("Aarav")], text: "Aaravくん", gone: ["aarav"] },
  { group: 2, children: [kid("Aarav")], text: "Aarav님", gone: ["aarav"] },
  { group: 2, children: [kid("Aarav")], text: "Aarav同学", gone: ["aarav"] },
  { group: 2, children: [kid("Aarav")], text: "คุณAaravครับ", gone: ["aarav"] },
  { group: 2, children: [kid("Zoya")], text: "Zoyaさん", gone: ["zoya"] },
  // 3. Format characters inside a name
  ...["​", "­", "‌", "‍", "⁠", "﻿", "‎", "ㅤ", "️", "͏", "᠋", "\u{e0041}"].map(
    (c): LeakCase => ({ group: 3, children: [kid("Aarav")], text: `Aa${c}rav`, gone: ["aarav"] }),
  ),
  { group: 3, children: [kid("Zoya", "Shah")], text: "Zo​ya Sh­ah", gone: ["zoya"] },
  { group: 3, children: [kid("Zoya", "Shah")], text: "Z‌o‍y⁠a", gone: ["zoya"] },
  // 4. Tamil and Malayalam lose the final virama when a suffix is added
  { group: 4, children: [bare("அர்ஜுன்")], text: "அர்ஜுனுக்கு", gone: ["அர்ஜுன"] },
  { group: 4, children: [bare("குமார்")], text: "குமாரை", gone: ["குமார"] },
  { group: 4, children: [bare("അർജുൻ")], text: "അർജുന്റെ", gone: ["അർജുന"] },
  // 5. Russian names that lose or gain a vowel
  { group: 5, children: [bare("Павел")], text: "Павла", gone: ["павл"] },
  { group: 5, children: [bare("Лев")], text: "Льва", gone: ["льв"] },
  { group: 5, children: [bare("Любовь")], text: "Любви", gone: ["любв"] },
  { group: 5, children: [bare("Зоя")], text: "Зою", gone: ["зою"] },
  // 6. Letter variants, joined and spaced forms, spelling variants
  { group: 6, children: [bare("كريم")], text: "کریم", gone: ["کریم", "كريم"] },
  { group: 6, children: [bare("علي")], text: "علی", gone: ["علی", "علي"] },
  { group: 6, children: [bare("علي")], text: "على", gone: ["على"] },
  { group: 6, children: [bare("فاطمة")], text: "فاطمه", gone: ["فاطمه"] },
  { group: 6, children: [bare("علي")], text: "عـلـي", gone: ["علي"] },
  { group: 6, children: [bare("علي رضا")], text: "علی‌رضا", gone: ["رضا"] },
  { group: 6, children: [bare("عبد الرحمن")], text: "عبدالرحمن", gone: ["رحمن"] },
  { group: 6, children: [bare("عبدالرحمن")], text: "عبد الرحمن", gone: ["رحمن"] },
  { group: 6, children: [bare("Abdul Rahman")], text: "Abdulrahman", gone: ["abdulrahman"] },
  { group: 6, children: [bare("Abdulrahman")], text: "Abdul Rahman", gone: ["rahman"] },
  { group: 6, children: [bare("Abdulrahman")], text: "Abdul-Rahman", gone: ["rahman"] },
  { group: 6, children: [bare("MaryAnn")], text: "Mary Ann", gone: ["mary"] },
  { group: 6, children: [bare("Mary Ann")], text: "MaryAnn", gone: ["mary"] },
  { group: 6, children: [bare("MaryAnn")], text: "Mary-Ann", gone: ["mary"] },
  { group: 6, children: [bare("Muhammad")], text: "Mohammed", gone: ["mohammed"] },
  { group: 6, children: [bare("Mohammed")], text: "Muhammad", gone: ["muhammad"] },
  { group: 6, children: [bare("Jürgen")], text: "Juergen", gone: ["juergen"] },
  { group: 6, children: [bare("Juergen")], text: "Jürgen", gone: ["jürgen", "jurgen"] },
  { group: 6, children: [bare("Søren")], text: "Soeren", gone: ["soeren"] },
  { group: 6, children: [bare("Soeren")], text: "Sören", gone: ["sören"] },
  // 7. A one-character given name, Traditional and Simplified, Korean written as separate letters
  { group: 7, children: [{ full: ["伟 王"], words: ["伟"] }], text: "小伟", gone: ["伟"] },
  { group: 7, children: [{ full: ["伟 王"], words: ["伟"] }], text: "王 伟", gone: ["伟"] },
  { group: 7, children: [{ full: ["伟 王"], words: ["伟"] }], text: "王偉", gone: ["偉", "伟"] },
  { group: 7, children: [{ full: ["伟 王"], words: ["伟"] }], text: "伟的作业", gone: ["伟"] },
  { group: 7, children: [{ full: ["偉 王"], words: ["偉"] }], text: "王伟", gone: ["伟"] },
  { group: 7, children: [{ full: ["민준 김"], words: ["민준"] }], text: "김민준".normalize("NFD"), gone: ["민준", "김민준".normalize("NFD")] },
  { group: 7, children: [{ full: ["민준 김"], words: ["민준"] }], text: "김민준.png".normalize("NFD"), gone: ["민준"] },
];

/** The cleaned text with what cannot be seen taken out and the letters made comparable, for the "gone" checks. */
export function seen(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[​-‏­⁠-⁤﻿ㅤـ︀-️͏᠋-᠏]|\u{e0000}|[\u{e0001}-\u{e007f}]/gu, "")
    .toLowerCase();
}

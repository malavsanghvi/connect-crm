import { describe, expect, it } from "vitest";

import { CHILD_NAME_REPLACEMENT as M, compileMinorNames, foldName, nameTokens, type MinorNameEntry } from "@/lib/commands/minor-names";

// Decision D2 in any culture: the names of people under 18 are found whatever the order, the number of words, the script or the
// accents. These are the names the first version missed (it knew "given names, then one family name, with a space between").

const redact = (entries: MinorNameEntry[], text: string): string => compileMinorNames(entries).redact(text).text;
const hidden = (entries: MinorNameEntry[], text: string, ...names: string[]): void => {
  const out = redact(entries, text);
  expect(out, text).toContain(M);
  for (const name of names) expect(out.toLowerCase(), `${text} -> ${out}`).not.toContain(name.toLowerCase());
};
/** A child the way the database gives one in a household whose adults share the family name. */
const shared = (given: string, family: string): MinorNameEntry => ({ full: [`${given} ${family}`], words: [given] });

describe("folding", () => {
  it("ignores case, accents, width and the way an accent is written", () => {
    expect(foldName("María José")).toBe("maria jose");
    expect(foldName("María")).toBe("maria");
    expect(foldName("ＷＡＮＧ")).toBe("wang");
    expect(foldName("Nguyễn Văn Đức")).toBe("nguyen van duc");
    expect(foldName("Łukasz Ørsted")).toBe("lukasz orsted");
    expect(foldName("Σωκράτης")).toBe("σωκρατησ");
    expect(foldName("Дмитрий")).toBe("дмитрии");
  });
  it("keeps the vowel signs of Indic scripts, which are letters", () => {
    expect(foldName("આરવ")).toBe("આરવ");
    expect(foldName("आरव")).toBe("आरव");
  });
  it("splits a name into words and drops apostrophes inside them", () => {
    expect(nameTokens("María José García-López")).toEqual(["maria", "jose", "garcia", "lopez"]);
    expect(nameTokens("Ana D’Souza")).toEqual(["ana", "dsouza"]);
    expect(nameTokens("Shah, Zoya")).toEqual(["shah", "zoya"]);
  });
});

describe("a name whose parts are not known (every word counts, in any order)", () => {
  it("finds a family-name-first child in either order, in any case, with or without the comma", () => {
    for (const text of ["Wang Wei", "wei wang", "WANG  WEI", "Wang-Wei", "Wei's class", "Wang’s class", "Hello Wei!", "wang"]) hidden(["Wang Wei"], text, "wang", "wei");
  });
  it("finds a name written in full-width letters", () => {
    hidden(["Wang Wei"], "ＷＡＮＧ ＷＥＩ is here", "ｗａｎｇ", "wang");
  });
  it("finds a name without spaces (Chinese, Japanese, Korean) wherever it sits in the sentence", () => {
    expect(redact(["王伟"], "王伟的作业")).toBe(`${M}的作业`);
    expect(redact(["王伟"], "老师说王伟迟到了")).toBe(`老师说${M}迟到了`);
    expect(redact(["김민준"], "김민준은 학교에 갔다")).toBe(`${M}은 학교에 갔다`);
    expect(redact(["田中太郎"], "田中太郎さんの席")).toBe(`${M}さんの席`);
  });
  it("finds a single name (a mononym) as a word, and not inside a longer word", () => {
    for (const text of ["Aarav", "AARAV's pledge", "ask aarav, please", "Aarav."]) hidden(["Aarav"], text, "aarav");
    // Five letters or more: also inside a longer word, an address or a file name (a different person called Aaravind is removed too).
    expect(redact(["Aarav"], "Aaravind is an adult")).toBe(`${M} is an adult`);
    expect(redact(["Dev"], "Device and Devon")).toBe("Device and Devon");
    expect(redact(["Sukarno"], "Sukarno")).toBe(M);
  });
  it("finds two given names and two family names, in any order, with accents or without", () => {
    const name = "María José García López";
    for (const text of ["María José García López", "Maria Jose Garcia Lopez", "LÓPEZ GARCÍA, JOSÉ MARÍA", "garcía-lópez maría", "José", "Lopez"]) hidden([name], text, "maria", "jose", "garcia", "lopez");
    expect(redact([name], "Lopa and Marcia")).toBe("Lopa and Marcia");
    expect(redact([name], "Lopes")).toBe(M); // the Portuguese spelling of López
  });
  it("merges a whole name into one removal instead of one per word", () => {
    expect(redact(["María José García López"], "Pickup for María José García López at 5")).toBe(`Pickup for ${M} at 5`);
    expect(redact(["Wang Wei"], "Pickup for Wei Wang at 5")).toBe(`Pickup for ${M} at 5`);
  });
  it("finds a name with a particle, with or without it, and never the particle on its own", () => {
    for (const text of ["Ahmad bin Ali", "Ahmad Ali", "Ali bin Ahmad", "ahmad"]) hidden(["Ahmad bin Ali"], text, "ahmad");
    expect(redact(["Ahmad bin Ali"], "Put it in the bin")).toBe("Put it in the bin");
    expect(redact(["Ahmad bin Ali"], "Ahmad bin Ali was here")).toBe(`${M} was here`);
    expect(redact(["Rahul Shah Jr."], "Rahul Shah Jr. and a jr")).not.toContain("Rahul");
    expect(redact(["Rahul Shah Jr."], "a jr")).toBe("a jr");
  });
  it("finds a Vietnamese name written with or without its marks", () => {
    for (const text of ["Nguyễn Văn An", "nguyen van an", "NGUYỄN VĂN AN", "An Nguyen"]) hidden(["Nguyễn Văn An"], text, "nguyen", "nguyễn");
  });
  it("finds Gujarati and Hindi names with an ending stuck on them, and Russian names in another case", () => {
    expect(redact(["આરવ શાહ"], "આરવની ટીમ")).toBe(`${M}ની ટીમ`);
    expect(redact(["आरव पटेल"], "आरव की कक्षा")).toBe(`${M} की कक्षा`);
    expect(redact(["Зоя Иванова"], "Зою видели в классе")).toBe(`${M} видели в классе`);
    expect(redact(["Αλέξανδρος Παππάς"], "ο Αλέξανδρου")).not.toContain("Αλέξανδρου");
  });
  it("finds a name in Turkish and English possessives", () => {
    expect(redact(["Zoya"], "Zoya'nın ve Zoya’s")).toBe(`${M} ve ${M}`);
  });
  it("does not remove part of a longer Latin word", () => {
    expect(redact(["Ann Lee"], "The annual meeting in Leeds with Joann")).toBe("The annual meeting in Leeds with Joann");
  });
});

describe("a name the database gives in parts (a family name the household's adults share names the family, not the child)", () => {
  const zoya = shared("Zoya", "Shah");

  it("removes the child, and leaves an adult with the same family name whole", () => {
    expect(redact([zoya], "Priya Shah and Rahul Shah came with Zoya Shah")).toBe(`Priya Shah and Rahul Shah came with ${M}`);
    expect(redact([zoya], "Shah, Zoya")).toBe(`Shah, ${M}`);
    expect(redact([zoya], "Zoya Shah, Priya Shah")).toBe(`${M}, Priya Shah`);
    expect(redact([zoya], "The Shah family")).toBe("The Shah family");
  });
  it("does not run across a sentence or a list into an adult's name", () => {
    expect(redact([zoya], "Sent to Priya Shah. Zoya Shah is in Pathshala.")).toBe(`Sent to Priya Shah. ${M} is in Pathshala.`);
    expect(redact([zoya], "Priya Shah, Zoya Shah")).toBe(`Priya Shah, ${M}`);
    expect(redact([zoya], "Priya Shah - Zoya Shah")).toBe(`Priya Shah - ${M}`);
  });
  it("removes a family-name-first child whose family word the household does not share", () => {
    // Stored first "Wang", last "Wei" (family first); the adults are "Wang Jun": nothing shares "Wei", so it counts on its own.
    const wei: MinorNameEntry = { full: ["Wang Wei"], words: ["Wang", "Wei"] };
    for (const text of ["Wang Wei", "Wei Wang", "Wei is sick", "Wang's class"]) hidden([wei], text, "wei", "wang");
  });
  it("removes a Chinese child by the whole name, and not the family character or a longer word", () => {
    const wei: MinorNameEntry = { full: ["伟 王"], words: ["伟"] };
    expect(redact([wei], "王伟的作业")).toBe(`${M}的作业`);
    expect(redact([wei], "伟王")).toBe(M);
    expect(redact([wei], "王 伟")).toBe(M);
    expect(redact([wei], "王老师")).toBe("王老师");
    expect(redact([wei], "伟大")).toBe("伟大");
  });
  it("removes a nickname on its own, and the nickname with the family name", () => {
    const entry: MinorNameEntry = { full: ["Zoya Shah", "Zo Shah"], words: ["Zoya", "Zo"] };
    for (const text of ["Zo", "Zo Shah", "Zoya", "ZO's"]) hidden([entry], text, "zo");
  });
  it("takes a word two children share, and a word a child shares with an adult, from the adult too (the trade-off, on purpose)", () => {
    const rahul = shared("Rahul", "Shah");
    expect(redact([rahul], "Rahul Patel and Rahul Shah")).toBe(`${M} Patel and ${M}`);
    expect(redact([rahul], "Priya Shah")).toBe("Priya Shah");
  });
  it("counts the people it took out", () => {
    const scanner = compileMinorNames([zoya, "Aarav"]);
    expect(scanner.redact("Zoya Shah and Aarav; Priya Shah")).toEqual({ text: `${M} and ${M}; Priya Shah`, count: 2 });
    expect(scanner.mentions("Zoya's class")).toBe(true);
    expect(scanner.mentions("Priya's class")).toBe(false);
    expect(scanner.mentions(null)).toBe(false);
    expect(compileMinorNames([]).redact("Zoya")).toEqual({ text: "Zoya", count: 0 });
  });
});

describe("what was already replaced is left alone", () => {
  it("does not touch the replacement, even for a child named like its words", () => {
    const names = compileMinorNames(["Not Shown", "Child A"]);
    expect(names.redact(`${M} and ${M}`).text).toBe(`${M} and ${M}`);
    expect(names.leaked({ x: `${M} and ${M}` })).toEqual([]);
    expect(names.redact(`Not ${M} Shown`).text).toBe(`${M} ${M} ${M}`);
  });
  it("gives the same answer when run twice", () => {
    const names = compileMinorNames([shared("Zoya", "Shah"), "王伟", "Aarav"]);
    const once = names.redact("Zoya Shah, 王伟 and Aarav came").text;
    expect(names.redact(once).text).toBe(once);
  });
});

describe("checking a finished result", () => {
  it("names the children still readable, keys included, and whole names in any order", () => {
    const names = compileMinorNames([{ full: ["Wang Wei"], words: [] }, "Aarav", { full: ["伟 王"], words: [] }]);
    expect(names.leaked({ ok: "nothing here" })).toEqual([]);
    expect(names.leaked({ list: ["Wei Wang"] })).toEqual(["Wang Wei"]);
    expect(names.leaked({ "Aarav Patel": 1 })).toEqual(["Aarav"]);
    expect(names.leaked({ note: "王 伟" })).toEqual(["伟 王"]);
    expect(names.leaked("Wang and Wei, separately")).toEqual([]);
  });
});

describe("a large community", () => {
  it("handles thousands of children in a large result in a fraction of a second", () => {
    const given = ["Aarav", "Zoya", "Wei", "María", "Ahmad", "Sukarno", "Priya", "Tia", "Dev", "Meera"];
    const entries: MinorNameEntry[] = [];
    for (let i = 0; i < 3000; i += 1) entries.push({ full: [`${given[i % 10]}${i} Family${i % 400}`], words: [`${given[i % 10]}${i}`] });
    const scanner = compileMinorNames(entries);
    const text = Array.from({ length: 4000 }, (_, i) => `Household ${i}: Priya Shah, Rahul Shah, Aarav${i} Family${i % 400} pledged $250 for the Diwali dinner`).join("\n");
    const started = Date.now();
    const { count } = scanner.redact(text);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(count).toBeGreaterThan(0);
  });

  it("handles thousands of children written without spaces just as quickly", () => {
    const han = (n: number) => String.fromCodePoint(0x4e00 + n);
    const entries: MinorNameEntry[] = [];
    for (let i = 0; i < 3000; i += 1) entries.push({ full: [`${han(i % 700)}${han((i * 7) % 900)} ${han(i % 90)}`], words: [`${han(i % 700)}${han((i * 7) % 900)}`] });
    const scanner = compileMinorNames(entries);
    const line = (i: number) => `第${i}户: ${han(i % 90)}老师 ${han(i % 700)}${han((i * 7) % 900)}的作业, Priya Shah pledged $250 for the dinner`;
    const text = Array.from({ length: 4000 }, (_, i) => line(i)).join(" | ");
    const started = Date.now();
    const { text: out, count } = scanner.redact(text);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(count).toBeGreaterThanOrEqual(3000);
    expect(out).not.toContain(`${han(5)}${han(35)}的作业`);
    expect(out).toContain("Priya Shah pledged $250");
  });
});

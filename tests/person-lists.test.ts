import { describe, expect, it } from "vitest";

import {
  LIST_MAX_CHARS,
  LIST_MAX_ITEMS,
  addTyping,
  checkList,
  cleanItem,
  decodeList,
  draftParts,
  encodeList,
  isListField,
  listDisplay,
  listKey,
  listToDraft,
  parseListInput,
  removeChip,
  sameList,
  takeBackChip,
  typeIntoDraft,
  uniqueItems,
} from "@/lib/person-lists";

// The list-valued columns of a person (interests, expertise areas): how a list is stored in the editors, checked, compared and typed.
// Built for every organization: the items are in any script, and nothing here knows a community.

describe("an item", () => {
  it("is cleaned: one space between words, no control characters, composed form", () => {
    expect(cleanItem("  Board \t games \n")).toBe("Board games");
    expect(cleanItem("Café")).toBe("Café"); // e + combining accent becomes the single letter
    expect(cleanItem("   ")).toBe("");
  });

  it("is the same item in another letter case, in any script that has case", () => {
    expect(uniqueItems(["Chess", "chess", "CHESS", "Art"])).toEqual(["Chess", "Art"]);
    expect(uniqueItems(["Шахматы", "шахматы"])).toEqual(["Шахматы"]);
    expect(uniqueItems(["ગુજરાતી", "ગુજરાતી", "茶道", "الشطرنج"])).toEqual(["ગુજરાતી", "茶道", "الشطرنج"]);
    expect(uniqueItems(["", "  ", "x"])).toEqual(["x"]);
  });
});

describe("reading a list from what is on file", () => {
  it("takes the database array, the stored JSON, plain text, or nothing", () => {
    expect(decodeList(["a", "b"])).toEqual(["a", "b"]);
    expect(decodeList('["a","b"]')).toEqual(["a", "b"]);
    expect(decodeList("a, b; c")).toEqual(["a", "b", "c"]);
    expect(decodeList("")).toEqual([]);
    expect(decodeList(null)).toEqual([]);
    expect(decodeList(undefined)).toEqual([]);
    expect(decodeList(42)).toEqual([]);
    expect(decodeList([1, "x", null])).toEqual(["x"]);
  });

  it("never refuses what is already on file: a broken JSON text is no list", () => {
    expect(decodeList('["a"')).toEqual([]);
    expect(decodeList("[1,2]")).toEqual([]);
  });

  it("stores a list as JSON, and none as an empty text", () => {
    expect(encodeList(["chess", "ગુજરાતી"])).toBe('["chess","ગુજરાતી"]');
    expect(encodeList([])).toBe("");
    expect(encodeList(["  ", ""])).toBe("");
    expect(decodeList(encodeList(["a, b", "c"]))).toEqual(["a, b", "c"]); // a comma inside a stored item survives
  });

  it("shows a list in one line", () => {
    expect(listDisplay(["chess", "茶道"])).toBe("chess, 茶道");
    expect(listDisplay("")).toBe("");
  });
});

describe("a list that did not change is not a change", () => {
  it("ignores order and letter case, and treats nothing, [] and an empty text alike", () => {
    expect(sameList(["a", "B"], ["b", "A"])).toBe(true);
    expect(sameList('["a","b"]', ["B", "a"])).toBe(true);
    expect(sameList([], "")).toBe(true);
    expect(sameList(null, [])).toBe(true);
    expect(sameList(["a"], ["a", "b"])).toBe(false);
    expect(sameList(["茶道"], ["俳句"])).toBe(false);
  });
});

describe("checking what is typed or sent", () => {
  it("takes commas, semicolons, new lines and the full-width and Arabic forms", () => {
    expect(parseListInput("interests", "chess, art; music\ngarden")).toEqual({ ok: true, value: ["chess", "art", "music", "garden"] });
    expect(parseListInput("interests", "茶道、俳句，書道；華道")).toEqual({ ok: true, value: ["茶道", "俳句", "書道", "華道"] });
    expect(parseListInput("interests", "الشطرنج، الرسم")).toEqual({ ok: true, value: ["الشطرنج", "الرسم"] });
    expect(parseListInput("interests", '["chess","Chess","art"]')).toEqual({ ok: true, value: ["chess", "art"] });
  });

  it("clears with nothing", () => {
    expect(parseListInput("expertise_tags", "")).toEqual({ ok: true, value: [] });
    expect(parseListInput("expertise_tags", "  ,  ")).toEqual({ ok: true, value: [] });
  });

  it("says in words when there are too many, when one is too long, and when the JSON is broken", () => {
    const many = Array.from({ length: LIST_MAX_ITEMS + 1 }, (_, i) => `item ${i}`).join(", ");
    expect(parseListInput("interests", many)).toEqual({ ok: false, error: `Add at most ${LIST_MAX_ITEMS} interests` });
    expect(parseListInput("expertise_tags", many)).toEqual({ ok: false, error: `Add at most ${LIST_MAX_ITEMS} expertise areas` });
    const long = "x".repeat(LIST_MAX_CHARS + 1);
    const r = parseListInput("interests", `ok, ${long}`);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error).toMatch(/^Each interest can be 50 characters at most: "x+…" is too long$/);
    expect(parseListInput("interests", '["a"')).toEqual({ ok: false, error: "The interests were not understood" });
    expect(parseListInput("interests", '["a", 3]')).toEqual({ ok: false, error: "The interests were not understood" });
  });

  it("counts characters, not code units: 50 emoji or rare characters fit", () => {
    const fifty = "𠮷".repeat(LIST_MAX_CHARS);
    expect(checkList("interests", [fifty])).toEqual({ ok: true, value: [fifty] });
    expect(checkList("interests", [`${fifty}𠮷`]).ok).toBe(false);
  });

  it("knows which columns are lists", () => {
    expect(isListField("interests")).toBe(true);
    expect(isListField("expertise_tags")).toBe(true);
    expect(isListField("profession")).toBe(false);
  });
});

describe("the editor's draft: one item per line, the last line is what is being typed", () => {
  it("starts with every item a chip and nothing typed", () => {
    expect(listToDraft('["chess","art"]')).toBe("chess\nart\n");
    expect(draftParts(listToDraft('["chess","art"]'))).toEqual({ chips: ["chess", "art"], typing: "" });
    expect(listToDraft("")).toBe("");
    expect(draftParts("")).toEqual({ chips: [], typing: "" });
  });

  it("turns a comma into a chip and keeps what follows in the input", () => {
    let draft = "";
    draft = typeIntoDraft(draft, "c");
    draft = typeIntoDraft(draft, "chess");
    expect(draftParts(draft)).toEqual({ chips: [], typing: "chess" });
    draft = typeIntoDraft(draft, "chess,");
    expect(draftParts(draft)).toEqual({ chips: ["chess"], typing: "" });
    draft = typeIntoDraft(draft, "art");
    expect(draftParts(draft)).toEqual({ chips: ["chess"], typing: "art" });
  });

  it("makes several chips of a pasted list, and ignores a chip that is already there", () => {
    const draft = typeIntoDraft("chess\n", "Chess, 茶道、俳句, ");
    expect(draftParts(draft)).toEqual({ chips: ["chess", "茶道", "俳句"], typing: "" });
  });

  it("Enter with something typed makes it a chip; with nothing typed it changes nothing", () => {
    expect(draftParts(addTyping(typeIntoDraft("chess\n", "ગુજરાતી")))).toEqual({ chips: ["chess", "ગુજરાતી"], typing: "" });
    expect(addTyping("chess\n")).toBe("chess\n");
  });

  it("keys: Enter with something typed adds it, Enter on an empty line is left to save, Backspace takes a chip back, composing does nothing", () => {
    expect(listKey({ key: "Enter" }, "chess\nart")).toBe("chess\nart\n");
    expect(listKey({ key: "Enter" }, "chess\n")).toBeNull(); // nothing typed: the editor's Enter saves
    expect(listKey({ key: "Enter" }, "")).toBeNull();
    expect(listKey({ key: "Enter", isComposing: true }, "茶")).toBeNull(); // a word still being composed is not cut short
    expect(listKey({ key: "Backspace" }, "chess\nart\n")).toBe("chess\nart");
    expect(listKey({ key: "Backspace" }, "chess\nar")).toBeNull(); // deleting a letter is the input's own
    expect(listKey({ key: "Backspace" }, "")).toBeNull();
    expect(listKey({ key: "a" }, "chess\n")).toBeNull();
  });

  it("removes a chip, and Backspace on an empty input takes the last chip back to be corrected", () => {
    expect(draftParts(removeChip("a\nb\nc\nty", 1))).toEqual({ chips: ["a", "c"], typing: "ty" });
    expect(draftParts(takeBackChip("a\nb\n"))).toEqual({ chips: ["a"], typing: "b" });
    expect(takeBackChip("a\nb\nstill typing")).toBe("a\nb\nstill typing");
    expect(takeBackChip("")).toBe("");
  });
});

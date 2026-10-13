// The list-valued columns of a person (interests, expertise areas): how a list is kept in the editors, checked, compared and shown.
// Pure: no server imports and no React, so the form parser, the command, the browser editor and the tests share one set of rules.
//
// A list is a text[] in the database. On the Family page and the slide-over every value is text (`Values`), so a list is held as
//
//   stored  a JSON array of the items, or "" for none:           ["chess","ગુજરાતી"]
//   draft   one item per line, then the line being typed:        "chess\nગુજરાતી\nmus"  (the chips, and what is still being typed)
//
// An item is one short piece of text in any script. Two items that differ only in capital letters are the same item, and the order
// of the items is not a change. Nothing here knows a community, a faith or a language.

export const LIST_FIELDS = ["interests", "expertise_tags"] as const;
export type ListField = (typeof LIST_FIELDS)[number];

export function isListField(key: string): key is ListField {
  return (LIST_FIELDS as readonly string[]).includes(key);
}

export const LIST_MAX_ITEMS = 20;
export const LIST_MAX_CHARS = 50;

const WORDS: Record<ListField, { one: string; many: string }> = {
  interests: { one: "interest", many: "interests" },
  expertise_tags: { one: "expertise area", many: "expertise areas" },
};

/** What an item of this list is called, for sentences ("Each interest can be 50 characters at most"). */
export function listWords(key: ListField): { one: string; many: string } {
  return WORDS[key];
}

/** What ends an item when it is typed or pasted: a comma, a semicolon or a new line, in their full-width and Arabic forms too. */
export const LIST_SEPARATORS = /[,;\r\n،؛、，；]+/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** One item as it is kept: Unicode-normalised, control characters and runs of spaces made one space, trimmed. */
export function cleanItem(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const sameKey = (s: string) => s.toLowerCase();

/** The items cleaned, empty ones dropped, and a repeat (in any letter case) dropped. The first spelling stays. */
export function uniqueItems(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = cleanItem(raw);
    if (!item) continue;
    const key = sameKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * A list from whatever holds it: the database's array, the stored JSON text, or plain text with separators. Anything else is no list.
 * Tolerant on purpose: this reads what is already on file, so it never refuses.
 */
export function decodeList(value: unknown): string[] {
  if (Array.isArray(value)) return uniqueItems(value.filter((x): x is string => typeof x === "string"));
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const data: unknown = JSON.parse(text);
      return Array.isArray(data) ? uniqueItems(data.filter((x): x is string => typeof x === "string")) : [];
    } catch {
      return [];
    }
  }
  return uniqueItems(text.split(LIST_SEPARATORS));
}

/** The stored text of a list: a JSON array, or "" for none. */
export function encodeList(items: readonly string[]): string {
  const list = uniqueItems(items);
  return list.length ? JSON.stringify(list) : "";
}

/** A list as one comparable text: same items in any order and any letter case give the same text; no items give "". */
export function listComparable(value: unknown): string {
  const items = decodeList(value).map(sameKey).sort();
  return items.length ? JSON.stringify(items) : "";
}

/** True when two lists hold the same items (order and letter case do not matter). */
export function sameList(a: unknown, b: unknown): boolean {
  return listComparable(a) === listComparable(b);
}

/** "chess, gardening": a list in one line, for showing. */
export function listDisplay(value: unknown): string {
  return decodeList(value).join(", ");
}

const short = (s: string) => (Array.from(s).length > 24 ? `${Array.from(s).slice(0, 24).join("")}…` : s);

/** The limits, in plain words. The list given is returned cleaned (no empty or repeated items). */
export function checkList(key: ListField, items: readonly string[]): Parsed<string[]> {
  const w = WORDS[key];
  const list = uniqueItems(items);
  if (list.length > LIST_MAX_ITEMS) return { ok: false, error: `Add at most ${LIST_MAX_ITEMS} ${w.many}` };
  const long = list.find((x) => Array.from(x).length > LIST_MAX_CHARS);
  if (long) return { ok: false, error: `Each ${w.one} can be ${LIST_MAX_CHARS} characters at most: "${short(long)}" is too long` };
  return { ok: true, value: list };
}

/** What a form or a command is given for a list: the stored JSON text, or plain text with commas, semicolons or lines. Empty clears. */
export function parseListInput(key: ListField, raw: string): Parsed<string[]> {
  const text = raw.trim();
  if (text.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `The ${WORDS[key].many} were not understood` };
    }
    if (!Array.isArray(data) || data.some((x) => typeof x !== "string")) return { ok: false, error: `The ${WORDS[key].many} were not understood` };
    return checkList(key, data as string[]);
  }
  return checkList(key, text.split(LIST_SEPARATORS));
}

// ---------------------------------------------------------------------------
// The editor's draft: one item per line, the last line is what is being typed
// ---------------------------------------------------------------------------
/** The draft an editor starts from: every item is a chip, nothing is being typed. */
export function listToDraft(stored: unknown): string {
  const items = decodeList(stored);
  return items.length ? `${items.join("\n")}\n` : "";
}

/** The chips of a draft (its complete lines) and the text still being typed (its last line). */
export function draftParts(draft: string): { chips: string[]; typing: string } {
  const lines = draft.split("\n");
  const typing = lines.pop() ?? "";
  return { chips: lines.filter((l) => l.trim() !== ""), typing };
}

/** All the items a draft holds, the one still being typed included (leaving the field or pressing Enter keeps it). */
export function draftItems(draft: string): string[] {
  return draft.split("\n");
}

export function draftWith(chips: readonly string[], typing: string): string {
  return [...chips, typing].join("\n");
}

/**
 * What the editor does when the input changes: a separator in the text closes an item (it becomes a chip, unless that chip is already
 * there), and what follows it stays in the input. Pasting "chess, art; music" makes three chips.
 */
export function typeIntoDraft(draft: string, typed: string): string {
  const { chips } = draftParts(draft);
  const parts = typed.split(LIST_SEPARATORS);
  // What follows the last separator stays in the input; a space typed after a comma is not part of the next item.
  const typing = (parts.pop() ?? "").trimStart();
  const next = [...chips];
  const seen = new Set(next.map((c) => sameKey(cleanItem(c))));
  for (const p of parts) {
    const item = cleanItem(p);
    if (!item || seen.has(sameKey(item))) continue;
    seen.add(sameKey(item));
    next.push(item);
  }
  return draftWith(next, typing);
}

/** Enter in the input with something typed: it becomes a chip. */
export function addTyping(draft: string): string {
  return typeIntoDraft(draft, `${draftParts(draft).typing},`);
}

/**
 * A key pressed in the editor's input: the new draft when the key edits the list, or null when the editor's own keys (Enter saves,
 * Esc cancels) should have it. Enter with something typed makes a chip, Enter on an empty line saves; Backspace on an empty input
 * takes the last chip back. Nothing happens while an input method is composing (a Japanese or Korean word is not cut short).
 */
export function listKey(key: { key: string; isComposing?: boolean }, draft: string): string | null {
  if (key.isComposing) return null;
  const { chips, typing } = draftParts(draft);
  if (key.key === "Enter" && typing.trim() !== "") return addTyping(draft);
  if (key.key === "Backspace" && typing === "" && chips.length > 0) return takeBackChip(draft);
  return null;
}

export function removeChip(draft: string, index: number): string {
  const { chips, typing } = draftParts(draft);
  return draftWith(
    chips.filter((_, i) => i !== index),
    typing,
  );
}

/** Backspace in an empty input: the last chip goes back into the input to be corrected. */
export function takeBackChip(draft: string): string {
  const { chips, typing } = draftParts(draft);
  if (typing !== "" || chips.length === 0) return draft;
  return draftWith(chips.slice(0, -1), chips[chips.length - 1]);
}

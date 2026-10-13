// Interests (people.interests) are a fixed choice, not free text: the member app keeps the keys of its INTEREST_CATALOG and nothing else
// (on the member's next profile save it drops every other value), so staff pick from those keys (INTEREST_CATALOG in
// src/lib/profile-details.ts, the one list in this repo) and a typed word would be lost without a sound.
//
// A value on file that is not one of the keys (imported, or from an older version) is neither dropped nor added to: it is shown as a
// chip staff can remove, it stays unless they do, and it can never be chosen again once removed. The commands accept only the keys
// for a new value.
//
// Pure: shared by the form parser, the command, the editor and the tests. The stored text and the draft are those of
// src/lib/person-lists.ts (a JSON array, and one item per line).

import { decodeList, draftParts, listToDraft, uniqueItems } from "@/lib/person-lists";
import { INTEREST_CATALOG, INTEREST_KEYS, interestLabels, type InterestKey } from "@/lib/profile-details";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const fold = (s: string) => s.trim().toLowerCase();

const BY_WORD = new Map<string, InterestKey>([
  ...INTEREST_CATALOG.map((i) => [fold(i.key), i.key] as const),
  ...INTEREST_CATALOG.map((i) => [fold(i.label), i.key] as const),
]);

/** The key an item stands for ("Youth", "youth" and " YOUTH " are all `youth`), or null when it is not one of the app's keys. */
export function interestKey(item: string): InterestKey | null {
  return BY_WORD.get(fold(item)) ?? null;
}

/** The name staff read for an item: the key's label, or a value that is not a key as it was written. */
export function interestLabel(item: string): string {
  const key = interestKey(item);
  return key ? (interestLabels([key])[0] ?? item) : item;
}

/** The keys chosen (in the app's order) and the values on file that are not keys (as written, in the order stored). */
export function splitInterests(value: unknown): { chosen: InterestKey[]; legacy: string[] } {
  const items = decodeList(value);
  const keys = new Set(items.map(interestKey).filter((k): k is InterestKey => k !== null));
  return { chosen: INTEREST_KEYS.filter((k) => keys.has(k)), legacy: items.filter((i) => interestKey(i) === null) };
}

/** "Events, Youth": the chosen keys by their labels, then any older value as written. */
export function interestsDisplay(value: unknown): string {
  const { chosen, legacy } = splitInterests(value);
  return [...chosen.map(interestLabel), ...legacy].join(", ");
}

/** The editor's draft: the chosen keys and the older values, one per line (nothing is being typed). */
export function interestsToDraft(stored: unknown): string {
  const { chosen, legacy } = splitInterests(stored);
  return listToDraft([...chosen, ...legacy]);
}

const choiceList = () => INTEREST_CATALOG.map((i) => i.label);

function phrase(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The interests a save may write. `onFile` are the values already on the person's record: one of them may stay (and is kept as it
 * is). Anything else must be one of the app's keys; a word outside them is refused in words, never saved and never dropped. The keys
 * come back in the app's order, then the values that stay.
 */
export function checkInterests(items: readonly string[], onFile: readonly string[] = []): Parsed<string[]> {
  const list = uniqueItems(items);
  const stays = new Map(uniqueItems(onFile).map((i) => [fold(i), i] as const));
  const keys = new Set<InterestKey>();
  const legacy: string[] = [];
  const refused: string[] = [];
  for (const item of list) {
    const key = interestKey(item);
    if (key) keys.add(key);
    else if (stays.has(fold(item))) legacy.push(stays.get(fold(item)) as string);
    else refused.push(item);
  }
  if (refused.length > 0) {
    const shown = refused.slice(0, 3).map((r) => `"${Array.from(r).slice(0, 24).join("")}"`);
    return { ok: false, error: `Choose interests from the list: ${phrase(choiceList())} (${phrase(shown)} ${refused.length > 1 ? "are" : "is"} not on it)` };
  }
  return { ok: true, value: [...INTEREST_KEYS.filter((k) => keys.has(k)), ...uniqueItems(legacy)] };
}

/** Choose or unchoose a key in the draft. An older value is untouched. */
export function toggleInterestDraft(draft: string, key: InterestKey): string {
  const { chips } = draftParts(draft);
  const has = chips.some((c) => interestKey(c) === key);
  const next = has ? chips.filter((c) => interestKey(c) !== key) : [...chips, key];
  return next.length ? `${next.join("\n")}\n` : "";
}

/** Take an older value out of the draft. */
export function removeLegacyDraft(draft: string, item: string): string {
  const { chips } = draftParts(draft);
  const next = chips.filter((c) => fold(c) !== fold(item));
  return next.length ? `${next.join("\n")}\n` : "";
}

/**
 * Whether a change can be undone from the toast. Putting back an older value that was just removed would be adding a value that is
 * not one of the keys, which a save refuses: so a change that removed one is not offered an Undo (History keeps what it was).
 */
export function canUndoInterests(before: unknown, after: unknown): boolean {
  const kept = new Set(decodeList(after).map(fold));
  return splitInterests(before).legacy.every((i) => kept.has(fold(i)));
}

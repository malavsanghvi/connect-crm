// Home shortcuts (centers.rules.home.shortcuts): the round buttons the member
// app shows on Home, under the "Today at {center}" card. Pure — the Settings ›
// Member app card, its Server Action, the rules validation and the tests share it.
//
// Stored as an ordered list of keys. Key absent → all five, in the order below.
// Empty list → no strip. Unknown keys are ignored when read (the member app does
// the same), so an older app never breaks on a newer key.

export const HOME_SHORTCUTS = [
  { key: "learn", label: "Learn", module: "gyan_path", opens: "The member's next Gyan Path lesson (the goal list once every level is done)" },
  { key: "playlist", label: "Playlist", module: "content", opens: "Plays My playlist; when it is empty, the most-liked stavans (and says so)" },
  { key: "photos", label: "Event photos", module: "content", opens: "Events › Photos" },
  { key: "recipe", label: "Jain recipe", module: "content", opens: "A random fully Jain recipe from the media library" },
  { key: "podcast", label: "Podcast", module: "content", opens: "Starts a random podcast from the media library" },
] as const;

export type HomeShortcutKey = (typeof HOME_SHORTCUTS)[number]["key"];
export type HomeShortcutDef = (typeof HOME_SHORTCUTS)[number];

export const HOME_SHORTCUT_KEYS: readonly HomeShortcutKey[] = HOME_SHORTCUTS.map((s) => s.key);

export function isHomeShortcutKey(v: unknown): v is HomeShortcutKey {
  return typeof v === "string" && (HOME_SHORTCUT_KEYS as readonly string[]).includes(v);
}

export function homeShortcutDef(key: HomeShortcutKey): HomeShortcutDef {
  return HOME_SHORTCUTS.find((s) => s.key === key)!;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The shortcuts members see, in order (absent → all five; unknown and repeated keys ignored). */
export function readHomeShortcuts(rules: unknown): HomeShortcutKey[] {
  const home = isObj(rules) ? rules.home : undefined;
  const stored = isObj(home) ? home.shortcuts : undefined;
  if (!Array.isArray(stored)) return [...HOME_SHORTCUT_KEYS];
  const out: HomeShortcutKey[] = [];
  for (const k of stored) if (isHomeShortcutKey(k) && !out.includes(k)) out.push(k);
  return out;
}

export type HomeShortcutRow = { key: HomeShortcutKey; on: boolean };

/** The card's rows: the shown shortcuts in their order, then the hidden ones in the default order. */
export function homeShortcutRows(rules: unknown): HomeShortcutRow[] {
  const shown = readHomeShortcuts(rules);
  return [...shown.map((key) => ({ key, on: true })), ...HOME_SHORTCUT_KEYS.filter((k) => !shown.includes(k)).map((key) => ({ key, on: false }))];
}

/** The keys to store for the card's rows (the ones switched on, top to bottom). */
export function shownShortcuts(rows: readonly HomeShortcutRow[]): HomeShortcutKey[] {
  return rows.filter((r) => r.on).map((r) => r.key);
}

/** Move row `index` up (-1) or down (+1); out-of-range moves leave the rows as they are. */
export function moveShortcut(rows: readonly HomeShortcutRow[], index: number, by: -1 | 1): HomeShortcutRow[] {
  const to = index + by;
  if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) return [...rows];
  const next = [...rows];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** "Save · N changes": shortcuts switched on or off, plus one when the order of the rest changed. */
export function homeShortcutChanges(before: readonly HomeShortcutKey[], after: readonly HomeShortcutKey[]): number {
  const toggled = HOME_SHORTCUT_KEYS.filter((k) => before.includes(k) !== after.includes(k)).length;
  const kept = (list: readonly HomeShortcutKey[]) => list.filter((k) => before.includes(k) && after.includes(k)).join(",");
  return toggled + (kept(before) === kept(after) ? 0 : 1);
}

/** The form's posted shortcut keys (switched-on rows, in order) → the list to store, or what is wrong with it. */
export function parseHomeShortcuts(values: readonly string[]): { ok: true; shortcuts: HomeShortcutKey[] } | { ok: false; error: string } {
  const out: HomeShortcutKey[] = [];
  for (const v of values) {
    if (!isHomeShortcutKey(v)) return { ok: false, error: `"${v}" is not a Home shortcut. Reload the page and try again.` };
    if (out.includes(v)) return { ok: false, error: `${homeShortcutDef(v).label} is listed twice. Reload the page and try again.` };
    out.push(v);
  }
  return { ok: true, shortcuts: out };
}

/** "Learn, Playlist and Podcast" / "none". */
export function describeShortcuts(keys: readonly HomeShortcutKey[]): string {
  const labels = keys.map((k) => homeShortcutDef(k).label);
  if (labels.length === 0) return "none";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

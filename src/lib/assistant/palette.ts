// The ⌘K palette's brain: which commands and pages match what was typed, grouped by area, and how a tiny form turns into the
// input a command takes. Pure. It works with no AI key because it only uses the command list the server hands out.

import type { CommandInfo, CommandLevel } from "./protocol";

export const LEVEL_LABEL: Record<CommandLevel, string> = {
  read: "Look",
  draft: "Prepare",
  confirm: "Needs your OK",
  only_you: "Only you",
};

export const LEVEL_HINT: Record<CommandLevel, string> = {
  read: "Shows you something. Nothing changes.",
  draft: "Prepares something for you. Nothing changes.",
  confirm: "Shows what would happen first. It only happens when you press the button.",
  only_you: "Only you can do this. Niva points you to the place.",
};

export const AREA_LABEL: Record<string, string> = {
  people: "People",
  giving: "Giving",
  events: "Events",
  messages: "Messages",
  accounting: "Accounting",
  reports: "Reports",
  platform: "Platform",
  tasks: "My tasks",
};

const AREA_ORDER = ["tasks", "people", "giving", "accounting", "events", "messages", "reports", "platform"];

export function areaLabel(area: string): string {
  return AREA_LABEL[area] ?? (area ? area.charAt(0).toUpperCase() + area.slice(1) : "Other");
}

/** A page the person may open (from their allowed nav tabs). */
export type NavEntry = { label: string; group: string; href: string };

export type PaletteItem =
  | { kind: "command"; id: string; command: CommandInfo }
  | { kind: "go"; id: string; label: string; group: string; href: string };

export type PaletteGroup = { key: string; label: string; items: PaletteItem[] };

const GO_LIMIT_EMPTY = 6;
const GO_LIMIT_QUERY = 8;

function tokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Higher is a better match; 0 means no match. Every typed word must be found somewhere. */
export function scoreText(words: string[], title: string, rest: string): number {
  if (words.length === 0) return 1;
  const t = title.toLowerCase();
  const r = rest.toLowerCase();
  let total = 0;
  for (const w of words) {
    let s = 0;
    if (t.startsWith(w)) s = 6;
    else if (t.split(/[^a-z0-9$]+/).some((x) => x.startsWith(w))) s = 4;
    else if (t.includes(w)) s = 3;
    else if (r.split(/[^a-z0-9$]+/).some((x) => x.startsWith(w))) s = 2;
    else if (r.includes(w)) s = 1;
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

/** The commands (and pages) that match the query, grouped: one group per area, then "Go to". Best match first inside a group. */
export function buildPalette(commands: readonly CommandInfo[], nav: readonly NavEntry[], query: string): PaletteGroup[] {
  const words = tokens(query);
  const byArea = new Map<string, { item: PaletteItem; score: number; order: number }[]>();
  commands.forEach((command, order) => {
    const score = scoreText(words, command.title, `${command.description} ${command.key} ${areaLabel(command.area)} ${LEVEL_LABEL[command.level]}`);
    if (score === 0) return;
    const list = byArea.get(command.area) ?? [];
    list.push({ item: { kind: "command", id: `cmd:${command.key}`, command }, score, order });
    byArea.set(command.area, list);
  });

  const areas = [...byArea.keys()].sort((a, b) => {
    const ia = AREA_ORDER.indexOf(a);
    const ib = AREA_ORDER.indexOf(b);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    return a.localeCompare(b);
  });
  const groups: PaletteGroup[] = areas.map((area) => ({
    key: area,
    label: areaLabel(area),
    items: (byArea.get(area) ?? []).sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.item),
  }));

  const goMatches = nav
    .map((entry, order) => ({ entry, order, score: scoreText(words, entry.label, `${entry.group} ${entry.href}`) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, words.length === 0 ? GO_LIMIT_EMPTY : GO_LIMIT_QUERY);
  if (goMatches.length > 0) {
    groups.push({
      key: "go",
      label: "Go to",
      items: goMatches.map(({ entry }) => ({ kind: "go", id: `go:${entry.href}`, label: entry.label, group: entry.group, href: entry.href })),
    });
  }
  return groups;
}

export function flattenGroups(groups: readonly PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((g) => g.items);
}

/** The pages the person's role may open, flattened for the palette ("Giving › Payments"). The shell passes its visible nav. */
export function navEntries(modules: readonly { label: string; tabs: readonly { href: string; label: string }[] }[]): NavEntry[] {
  const seen = new Set<string>();
  const out: NavEntry[] = [];
  for (const m of modules) {
    for (const t of m.tabs) {
      if (seen.has(t.href)) continue;
      seen.add(t.href);
      out.push({ label: t.label === m.label ? t.label : `${m.label} › ${t.label}`, group: m.label, href: t.href });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The tiny form
// ---------------------------------------------------------------------------
export type RunInputResult = { ok: true; input: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Turns what was typed into the input a command takes. Empty optional fields are left out. Errors are plain English per field. */
export function buildRunInput(fields: CommandInfo["fields"], values: Record<string, string>): RunInputResult {
  const input: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = (values[f.name] ?? "").trim();
    if (!raw) {
      if (f.required) errors[f.name] = `Fill in “${f.label}”.`;
      continue;
    }
    switch (f.type) {
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n)) errors[f.name] = `“${f.label}” must be a number.`;
        else input[f.name] = n;
        break;
      }
      case "date":
        if (!validDate(raw)) errors[f.name] = `“${f.label}” must be a date.`;
        else input[f.name] = raw;
        break;
      case "choice":
        if (f.choices && !f.choices.includes(raw)) errors[f.name] = `Pick one of the choices for “${f.label}”.`;
        else input[f.name] = raw;
        break;
      default:
        input[f.name] = raw;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, input };
}

/** "Search people and households: 1042" for the line the panel shows after a palette run. */
export function describeRun(command: Pick<CommandInfo, "title" | "fields">, input: Record<string, unknown>): string {
  const bits = command.fields
    .map((f) => (input[f.name] === undefined ? null : String(input[f.name])))
    .filter((v): v is string => Boolean(v));
  return bits.length > 0 ? `${command.title}: ${bits.join(", ")}` : command.title;
}

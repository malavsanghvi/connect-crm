// The front door's screen model (Setup › Guided onboarding › Bring your data in; board 1 of
// docs/handoff/prototypes/onboarding-data/Main.dc.html): the steps, the plan's facts and suggested route, the QuickBooks
// tile's state and what Niva can see. Pure: the page reads the database, this turns what it read into words.
//
// Built for every organization: every word about the community comes from its kind (the module names it uses) and its
// own records; nothing names a tradition, a community or a language.

import { kindOrganization } from "@/lib/kind";

import { plural } from "./recognise";

export type StepState = "done" | "now" | "todo";
export type FrontStep = { n: number; title: string; sub: string; state: StepState };

/** The four steps of bringing data in, in order (the board's left column). Only the first is built today. */
export const FRONT_STEPS: readonly { title: string; sub: string }[] = [
  { title: "Choose how", sub: "Drop it, connect it or use a template" },
  { title: "Bring it in", sub: "Niva reads it and asks only what it must" },
  { title: "Review", sub: "See exactly what will happen" },
  { title: "Ready", sub: "Make it good, then switch over" },
];

export function frontSteps(current = 1): FrontStep[] {
  return FRONT_STEPS.map((s, i) => {
    const n = i + 1;
    return { n, ...s, state: n < current ? "done" : n === current ? "now" : "todo" };
  });
}

/** One earlier import, as Guided onboarding's questions list them (app.resolve_runs): counts only. */
export type ImportCount = { entity: string; entityLabel: string; rows: number; loaded: boolean };

/** The QuickBooks connection, as far as this person may see it. */
export type QboState =
  | { state: "connected"; name: string | null; expiring: boolean }
  | { state: "not_connected" }
  | { state: "problem"; detail: string | null }
  | { state: "no_access" }
  | { state: "off"; moduleLabel: string; offered: boolean }
  | { state: "error"; message: string };

export type FrontInput = {
  communityName: string;
  kindLabel: string;
  /** The kind's name for its people module ("Members & families", "Members" …). */
  peopleLabel: string;
  /** The giving module, in the kind's words; null when the kind does not offer it. */
  giving: { label: string; on: boolean } | null;
  /** Other modules the kind offers that hold data worth bringing in, with their switch. */
  otherModules: readonly { label: string; on: boolean }[];
  imports: { ok: true; list: readonly ImportCount[] } | { ok: false; error: string };
  qbo: QboState;
};

export type QboTile = { status: string; tone: "ok" | "warn" | "bad" | "muted"; detail: string; canOpen: boolean };

export type FrontModel = {
  communityName: string;
  greeting: string;
  facts: string[];
  route: string;
  steps: FrontStep[];
  importsError: string | null;
  qbo: QboTile;
  /** Counts and shapes Niva could be shown: never a name, a contact detail or anything about a child. */
  sees: string[];
};

const PEOPLE_ENTITIES = new Set(["households", "people", "members", "persons", "families"]);
const GIVING_ENTITIES = new Set(["payments", "donations", "gifts", "pledges"]);

export function qboTile(q: QboState): QboTile {
  switch (q.state) {
    case "connected":
      return q.expiring
        ? { status: "Connected · renew soon", tone: "warn", detail: q.name ?? "Your QuickBooks company", canOpen: true }
        : { status: "Connected", tone: "ok", detail: q.name ?? "Your QuickBooks company", canOpen: true };
    case "not_connected":
      return { status: "Not connected", tone: "muted", detail: "Connect it in Accounting › QuickBooks setup.", canOpen: true };
    case "problem":
      return { status: "Needs attention", tone: "bad", detail: q.detail ? `Last error: ${q.detail}` : "The connection reported an error.", canOpen: true };
    case "no_access":
      return { status: "You can't see this connection", tone: "muted", detail: "Someone who looks after integrations can check it.", canOpen: false };
    case "off":
      return q.offered
        ? { status: `${q.moduleLabel} is switched off`, tone: "muted", detail: "QuickBooks belongs to it.", canOpen: false }
        : { status: "Not part of your organization", tone: "muted", detail: `${q.moduleLabel} is not offered to your kind of organization.`, canOpen: false };
    case "error":
      return { status: "Could not check", tone: "bad", detail: q.message, canOpen: false };
  }
}

/** Rows per kind of record, largest first ("Households: 612 rows"). */
function rowsByLabel(list: readonly ImportCount[]): { label: string; rows: number }[] {
  const by = new Map<string, number>();
  for (const i of list) {
    const label = i.entityLabel.trim() || i.entity;
    by.set(label, (by.get(label) ?? 0) + Math.max(0, i.rows));
  }
  return [...by.entries()].map(([label, rows]) => ({ label, rows })).sort((a, b) => b.rows - a.rows || a.label.localeCompare(b.label));
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function buildFrontDoor(input: FrontInput): FrontModel {
  const list = input.imports.ok ? input.imports.list : [];
  const peopleIn = list.some((i) => i.loaded && PEOPLE_ENTITIES.has(i.entity));
  const givingIn = list.some((i) => i.loaded && GIVING_ENTITIES.has(i.entity));
  const people = lower(input.peopleLabel);

  const facts: string[] = [kindOrganization(input.kindLabel)];
  if (input.imports.ok) {
    if (list.length === 0) facts.push("Nothing loaded yet");
    else {
      facts.push(`${plural(list.length, "import")} so far`);
      for (const r of rowsByLabel(list).slice(0, 2)) facts.push(`${plural(r.rows, "row")} of ${lower(r.label)}`);
    }
  }
  if (input.qbo.state === "connected") facts.push("QuickBooks connected");
  else if (input.qbo.state === "not_connected") facts.push("QuickBooks not connected");
  if (input.giving) facts.push(`${input.giving.label}: ${input.giving.on ? "on" : "off"}`);
  for (const m of input.otherModules) facts.push(`${m.label}: ${m.on ? "on" : "off"}`);

  // In load order: people first, then giving, then the households' own check. What is already in is said first.
  const done: string[] = [];
  const todo: string[] = [];
  if (peopleIn) done.push(`your ${people}`);
  else todo.push(`bring in your ${people}, from a file or the template`);
  if (input.giving?.on) {
    if (givingIn) done.push("your past donations");
    else todo.push("add past donations");
  }
  todo.push("let households check their own details (coming next)");
  let route = `${done.length > 0 ? `${done.join(" and ")} are in; next, ` : ""}${todo.join(", then ")}.`;
  const unused = [...(input.giving && !input.giving.on ? [input.giving] : []), ...input.otherModules.filter((m) => !m.on)].map((m) => m.label);
  if (unused.length > 0) route += ` Modules you do not use, such as ${unused.slice(0, 2).join(" and ")}, are left out.`;

  const sees: string[] = [];
  if (!input.imports.ok) sees.push("Weaver could not count your imports just now, so there is nothing to show Niva.");
  else if (list.length === 0) sees.push("Nothing has been loaded yet, so there is nothing for Niva to count.");
  else {
    const total = list.reduce((s, i) => s + Math.max(0, i.rows), 0);
    sees.push(`${plural(list.length, "import")} so far, ${plural(total, "row")} in all.`);
    for (const r of rowsByLabel(list)) sees.push(`${r.label}: ${plural(r.rows, "row")}.`);
  }

  return {
    communityName: input.communityName,
    greeting: `Happy to. Here is a suggested route for ${input.communityName}, from what Weaver already knows. Give me anything you have: I will say what each file is, ask only what I cannot tell, and save nothing until you say so.`,
    facts,
    route,
    steps: frontSteps(1),
    importsError: input.imports.ok ? null : input.imports.error,
    qbo: qboTile(input.qbo),
    sees,
  };
}


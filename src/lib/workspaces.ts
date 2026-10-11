// The eleven workspaces of the redesigned portal (docs/ADMIN_REDESIGN.md "The new shape"), as a map over the existing NAV modules.
// Pure: no React and no server-only imports, so the rail, the phone bar and the tests all read the same thing.
//
// Nothing here decides who may see what. A workspace is shown when at least one of its modules has a tab the person can open,
// and that is decided by visibleNav / canOpenTab in permissions.ts, exactly as for the classic sidebar (modules switched off,
// sandbox-only and platform-only tabs, kind features, roles in any scope all behave as they do today).

import { kindName, kindTerm, type KindProfile } from "@/lib/kind";
import { schoolWord } from "@/lib/kind-samples";
import {
  NAV,
  activeModule,
  visibleNav,
  type ScopedContext,
  type VisibleModule,
  type VisibleTab,
} from "@/lib/permissions";

export type WorkspaceKey =
  | "today"
  | "people"
  | "giving"
  | "events"
  | "messages"
  | "learning"
  | "store"
  | "content"
  | "reports"
  | "settings"
  | "platform";

export type WorkspaceDef = {
  key: WorkspaceKey;
  /** Short, so it fits under an icon in an 88px rail. */
  label: string;
  /** NAV module keys that belong here, in the order the workspace opens them (the first one the person can use wins). */
  modules: readonly string[];
  /** SVG path data for a 24x24 outline icon (stroke, no fill), drawn in the current text colour. */
  icon: string;
  /** "end" workspaces sit at the bottom of the rail, apart from the rest. */
  placement: "start" | "end";
  /**
   * The workspace's own page (the New look's workspace page), opened from the rail instead of the first module page when the person
   * can open `module`. Only the rail and the phone bar use it; they exist in the New look alone.
   */
  home?: { module: string; href: string };
};

export const WORKSPACES: readonly WorkspaceDef[] = [
  { key: "today", label: "Today", modules: ["home"], icon: "M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z", placement: "start" },
  {
    key: "people",
    label: "People",
    modules: ["people"],
    icon: "M15.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M4.5 21c0-3.9 3.4-6 7.5-6s7.5 2.1 7.5 6",
    placement: "start",
  },
  {
    key: "giving",
    label: "Giving",
    modules: ["giving", "bolis", "accounting"],
    home: { module: "giving", href: "/giving" },
    icon: "M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z",
    placement: "start",
  },
  { key: "events", label: "Events", modules: ["events", "calendar"], icon: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4", placement: "start" },
  { key: "messages", label: "Messages", modules: ["comms"], icon: "M3 5h18v14H3z M3 6l9 7 9-7", placement: "start" },
  { key: "learning", label: "Learning", modules: ["pathshala"], icon: "M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z M4 5v15 M8 7h7", placement: "start" },
  { key: "store", label: "Store", modules: ["store"], icon: "M5 8h14l-1 12H6z M9 8a3 3 0 0 1 6 0", placement: "start" },
  { key: "content", label: "Content", modules: ["content"], icon: "M6 3h9l4 4v14H6z M14 3v5h5 M9 13h6 M9 17h6", placement: "start" },
  { key: "reports", label: "Reports", modules: ["reports"], icon: "M4 20h16 M7 20v-9 M12 20V5 M17 20v-6", placement: "start" },
  {
    key: "settings",
    label: "Settings",
    modules: ["setup", "settings"],
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2",
    placement: "end",
  },
  { key: "platform", label: "Platform", modules: ["platform"], icon: "M4 5h16v6H4z M4 13h16v6H4z M8 8h.01 M8 16h.01", placement: "end" },
];

export type VisibleWorkspace = {
  key: WorkspaceKey;
  label: string;
  /** Where the rail link goes: the first page the person can open in the workspace (a module's own landing page when it has one). */
  href: string;
  icon: string;
  placement: "start" | "end";
  /** URL prefixes of every module here, so the rail can tell which workspace a page belongs to. */
  paths: string[];
  /** Every tab the person can open in the workspace. */
  tabs: VisibleTab[];
  /** The modules (with their own tabs) the person can open in the workspace, in the workspace's order. */
  modules: VisibleModule[];
};

const OWNER = new Map<string, WorkspaceDef>(WORKSPACES.flatMap((w) => w.modules.map((m) => [m, w] as const)));

/** The longest a rail label may be before the generic word is used instead (the rail is 88px wide). */
const RAIL_LABEL_MAX = 14;

type LabelKind = Pick<KindProfile, "terms" | "modules">;

/**
 * The rail's word for a workspace in this organization's kind. Giving, Learning and Store carry the kind's own words (the pay tab's
 * word, the school's name, the store's name) when it has them and they fit; every other label, and any workspace for a caller that
 * does not know the kind, is the generic one.
 */
export function workspaceLabel(key: WorkspaceKey, kind?: LabelKind): string {
  const generic = WORKSPACES.find((w) => w.key === key)?.label ?? "";
  if (!kind) return generic;
  let own = "";
  if (key === "giving") {
    // The member app's tab says "Give"; the staff area of giving is "Giving". Any other word is the kind's own ("Pay").
    const word = kindTerm(kind, "give_tab", "");
    own = word.toLowerCase() === "give" ? "" : word;
  } else if (key === "learning") {
    own = schoolWord(kind) ?? "";
  } else if (key === "store") {
    own = kindName(kind, "store", "");
  }
  return own !== "" && own.length <= RAIL_LABEL_MAX ? own : generic;
}

/** The workspace a NAV module belongs to. */
export function workspaceOfModule(moduleKey: string): WorkspaceKey | undefined {
  return OWNER.get(moduleKey)?.key;
}

/** The workspaces over a list of modules the person can already open (from visibleNav). A workspace with none of its modules is left out. */
export function workspacesFor(modules: readonly VisibleModule[], kind?: LabelKind): VisibleWorkspace[] {
  return WORKSPACES.flatMap((w) => {
    const mine = w.modules.flatMap((key) => modules.filter((m) => m.key === key));
    if (mine.length === 0) return [];
    return [
      {
        key: w.key,
        label: workspaceLabel(w.key, kind),
        href: w.home && mine.some((m) => m.key === w.home?.module) ? w.home.href : mine[0].href,
        icon: w.icon,
        placement: w.placement,
        paths: mine.flatMap((m) => m.paths),
        tabs: mine.flatMap((m) => m.tabs),
        modules: mine,
      },
    ];
  });
}

/** The workspaces this person can open: the same gating as the classic sidebar. */
export function visibleWorkspaces(ctx: ScopedContext): VisibleWorkspace[] {
  return workspacesFor(visibleNav(ctx), ctx.kind);
}

/** The workspace a URL belongs to (the longest matching page or prefix wins, as for modules). */
export function activeWorkspace<W extends { paths: string[]; tabs: { href: string }[] }>(workspaces: W[], pathname: string): W | undefined {
  return activeModule(workspaces, pathname);
}

/** The modules of one workspace that the person can open (what the sub-navigation shows when a workspace holds several). */
export function modulesInWorkspace(key: WorkspaceKey, modules: readonly VisibleModule[]): VisibleModule[] {
  const def = WORKSPACES.find((w) => w.key === key);
  if (!def) return [];
  return def.modules.flatMap((k) => modules.filter((m) => m.key === k));
}

/** Workspaces on the phone's bottom bar; every other workspace goes in the "More" sheet. */
export const PHONE_BAR_KEYS: readonly WorkspaceKey[] = ["today", "people", "giving", "events"];

export function phoneBar<W extends { key: WorkspaceKey }>(workspaces: readonly W[]): { bar: W[]; more: W[] } {
  return {
    bar: workspaces.filter((w) => PHONE_BAR_KEYS.includes(w.key)),
    more: workspaces.filter((w) => !PHONE_BAR_KEYS.includes(w.key)),
  };
}

/**
 * Checks the map against NAV. Every tab of every NAV module must be in exactly one workspace, and every module a workspace names
 * must exist. Returns plain sentences for what is wrong (empty when the map is complete); a test fails on any.
 */
export function workspaceCoverageProblems(): string[] {
  const problems: string[] = [];
  const navKeys = new Set(NAV.map((m) => m.key));
  for (const w of WORKSPACES) {
    for (const key of w.modules) {
      if (!navKeys.has(key)) problems.push(`Workspace "${w.label}" names the module "${key}", which is not in NAV.`);
    }
  }
  for (const m of NAV) {
    const owners = WORKSPACES.filter((w) => w.modules.includes(m.key));
    for (const t of m.tabs) {
      if (owners.length === 0) problems.push(`The tab "${t.label}" (${t.href}) of the module "${m.key}" is in no workspace.`);
      if (owners.length > 1) problems.push(`The tab "${t.label}" (${t.href}) of the module "${m.key}" is in ${owners.length} workspaces: ${owners.map((o) => o.label).join(", ")}.`);
    }
  }
  const seen = new Set<string>();
  for (const w of WORKSPACES) {
    if (seen.has(w.key)) problems.push(`The workspace key "${w.key}" is used twice.`);
    seen.add(w.key);
  }
  return problems;
}

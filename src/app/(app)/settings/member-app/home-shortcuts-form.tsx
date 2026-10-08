"use client";

import { useState } from "react";

import { Toggle } from "@/components/controls";
import { Card, buttonClass } from "@/components/ui";
import { homeShortcutChanges, homeShortcutDef, moveShortcut, shownShortcuts, type HomeShortcutKey, type HomeShortcutRow } from "@/lib/home-shortcuts";

import { SettingsForm } from "../_components/settings-form";
import { saveHomeShortcutsAction } from "./actions";

/**
 * Settings › Member app › Home shortcuts: which round buttons the member app shows on Home and in
 * what order (centers.rules.home.shortcuts). Saved like every rules form: versioned, so two
 * admins never overwrite each other.
 */
export function HomeShortcutsCard({
  initial,
  kept = [],
  opens,
  version,
  centerName,
  moduleNotes,
  canEdit,
}: {
  initial: HomeShortcutRow[];
  /** Shortcuts this kind of organization does not have but that are stored as shown: saved again unchanged. */
  kept?: HomeShortcutKey[];
  /** What each shortcut opens, in the organization's words. */
  opens?: Partial<Record<HomeShortcutKey, string>>;
  version: number | null;
  centerName: string;
  /** Per shortcut: why members do not see it even when it is on (its module is switched off). */
  moduleNotes: Partial<Record<HomeShortcutKey, string>>;
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const dirty = homeShortcutChanges(shownShortcuts(initial), shownShortcuts(rows));
  // Where each shown shortcut sits in the strip (1, 2, …); hidden ones have none.
  const positions = rows.map((r, i) => (r.on ? rows.slice(0, i + 1).filter((x) => x.on).length : null));
  return (
    <Card
      span={12}
      title="Home shortcuts"
      description={`Round buttons on Home in the member app, just under “Today at ${centerName}”. Members swipe sideways when they do not all fit.`}
    >
      <SettingsForm action={saveHomeShortcutsAction} version={version} dirty={dirty} readOnly={!canEdit} readOnlyNote="Only people with settings.manage can change the Home shortcuts.">
        {[...shownShortcuts(rows), ...kept].map((k) => (
          <input key={k} type="hidden" name="shortcut" value={k} />
        ))}
        <ol className="divide-y divide-line-soft rounded-[10px] border border-line" aria-label="Home shortcuts, in the order members see them">
          {rows.map((r, i) => {
            const def = homeShortcutDef(r.key);
            const note = moduleNotes[r.key];
            const position = positions[i];
            return (
              <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                <span className="w-6 text-center font-mono text-[13px] font-bold text-navy">
                  {position ? <span title={`Position ${position} in the strip`}>{position}</span> : <span aria-hidden>–</span>}
                </span>
                <div className="min-w-[12rem] flex-1">
                  <p className="text-[14px] font-bold text-ink">{def.label}</p>
                  <p className="text-[12px] text-muted">{opens?.[r.key] ?? def.opens}</p>
                  {note && r.on ? <p className="text-[12px] font-semibold text-brown">{note}</p> : null}
                </div>
                <Toggle
                  label={`Show ${def.label} on Home`}
                  checked={r.on}
                  onChange={(on) => setRows(rows.map((x) => (x.key === r.key ? { ...x, on } : x)))}
                  onNote="Shown"
                  offNote="Hidden"
                  disabled={!canEdit}
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    aria-label={`Move ${def.label} up`}
                    disabled={!canEdit || i === 0}
                    onClick={() => setRows(moveShortcut(rows, i, -1))}
                    className={buttonClass("ghost", "sm")}
                  >
                    ↑ Up
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${def.label} down`}
                    disabled={!canEdit || i === rows.length - 1}
                    onClick={() => setRows(moveShortcut(rows, i, 1))}
                    className={buttonClass("ghost", "sm")}
                  >
                    ↓ Down
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="crm-hint mt-2">
          Hidden shortcuts stay listed so you can bring them back. With every shortcut hidden, Home shows no strip. When the library has nothing for a
          shortcut yet (no recipes, no podcasts), members see a short note saying so.
        </p>
      </SettingsForm>
    </Card>
  );
}

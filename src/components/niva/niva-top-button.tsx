"use client";

import { buttonClass } from "@/components/ui";

import { useNiva } from "./niva-context";
import { Sparkle } from "./sparkle";
import { useModKey } from "./use-mod-key";

/** The top-bar button that opens Niva's panel. Shows nothing unless Niva is switched on for this community. */
export function NivaTopButton() {
  const niva = useNiva();
  const modKey = useModKey();
  if (!niva || !niva.enabled) return null;
  return (
    <button
      type="button"
      onClick={niva.toggleDock}
      aria-expanded={niva.dockOpen}
      aria-controls="niva-panel"
      title={`Ask Niva (${modKey}+J)`}
      className={`${buttonClass("ghost", "sm")} shrink-0`}
    >
      <span className="text-navy">
        <Sparkle />
      </span>
      <span className="hidden sm:inline">Niva</span>
      <span className="sr-only">: open or close Niva, shortcut {modKey} and J</span>
    </button>
  );
}

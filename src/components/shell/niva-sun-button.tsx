"use client";

import { useNiva } from "@/components/niva/niva-context";
import { Sparkle } from "@/components/niva/sparkle";
import { useModKey } from "@/components/niva/use-mod-key";

/**
 * Niva's button in the redesigned shell (the rail and the phone's bottom bar): the sun gradient, which the look keeps for Niva only.
 * It opens and closes the same panel as the top-bar button and shows nothing unless Niva is on for this community.
 */
export function NivaSunButton({ variant }: { variant: "rail" | "bar" }) {
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
      className={`v2-niva v2-niva-${variant}`}
    >
      <span className="v2-niva-orb">
        <Sparkle className="h-5 w-5" />
      </span>
      <span className="v2-nav-label">Niva</span>
      <span className="sr-only">: open or close Niva, shortcut {modKey} and J</span>
    </button>
  );
}

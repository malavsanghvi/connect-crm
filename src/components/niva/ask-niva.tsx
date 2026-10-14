"use client";

import { buttonClass } from "@/components/ui";

import { useNiva } from "./niva-context";
import { Sparkle } from "./sparkle";

/**
 * A small "Ask Niva" button any screen can place next to a row, a number or a field:
 *
 *   <AskNiva prompt="Who is behind on pledges?" />
 *
 * It opens Niva's panel and asks the sentence for the person. It shows nothing when Niva is off or has no chat yet, so a screen
 * can place it without checking. Keep the sentence free of names of children (D2): describe the kind of thing, not the person.
 */
export function AskNiva({ prompt, label = "Ask Niva", className = "" }: { prompt: string; label?: string; className?: string }) {
  const niva = useNiva();
  if (!niva || !niva.enabled || !niva.aiReady) return null;
  return (
    <button
      type="button"
      onClick={() => niva.ask(prompt)}
      aria-label={`${label}: ${prompt}`}
      title={prompt}
      className={`${buttonClass("ghost", "sm")} ${className}`.trim()}
    >
      <span className="text-saffron">
        <Sparkle />
      </span>
      {label}
    </button>
  );
}

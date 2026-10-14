"use client";

import Link from "next/link";

import { useNiva } from "@/components/niva/niva-context";
import { ComingNext } from "@/components/onboarding-front/parts";
import type { GivingPrompt } from "@/lib/data/giving-workspace";

const ROW = "flex min-h-[44px] w-full items-center gap-2 rounded-[14px] border border-line bg-white px-3.5 py-2 text-left text-[14px] font-semibold text-ink no-underline";

/**
 * "Other things you can ask here": with Niva on (and a model), each one opens Niva's panel and asks it for the person. Without
 * Niva each one opens the screen where it is done, so it is never an empty promise. One with no command yet is shown, switched off.
 */
export function SidePrompts({ prompts }: { prompts: readonly GivingPrompt[] }) {
  const niva = useNiva();
  const asks = Boolean(niva && niva.enabled && niva.aiReady);
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {prompts.map((p) => (
        <li key={p.text}>
          {p.comingNext || !p.href ? (
            <span className={`${ROW} cursor-not-allowed justify-between bg-ground text-muted`} aria-disabled="true">
              <span>{p.text}</span>
              <span className="flex-none whitespace-nowrap">
                <ComingNext />
              </span>
            </span>
          ) : asks ? (
            <button type="button" onClick={() => niva?.ask(p.text)} className={`${ROW} hover:bg-navy-50`} aria-label={`Ask Niva: ${p.text}`}>
              {p.text}
            </button>
          ) : (
            <Link href={p.href} className={`${ROW} hover:bg-navy-50`}>
              {p.text}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

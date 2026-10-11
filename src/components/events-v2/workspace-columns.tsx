"use client";

import type { ReactNode } from "react";

import { useNiva } from "@/components/niva/niva-context";

/**
 * The event on the left, Niva's column for this event on the right, as the board draws it (wide screens: the column is 470px,
 * full height beside the page, under the top bar). When Niva's own panel is open beside the page there is no room for both, so
 * the column moves under the event. Phones and narrower screens always stack.
 */
export function WorkspaceColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  const niva = useNiva();
  const docked = !!niva && niva.enabled && niva.dockOpen;
  return (
    <div data-docked={docked ? "true" : "false"} className={`group/ws flex flex-col gap-6 ${docked ? "" : "xl:-mb-10 xl:-mr-7 xl:-mt-[22px] xl:flex-row xl:items-start xl:gap-0"}`}>
      <div className={`flex min-w-0 flex-1 flex-col gap-[18px] ${docked ? "" : "xl:pb-10 xl:pr-9 xl:pt-[26px]"}`}>{main}</div>
      <div className={docked ? "" : "xl:sticky xl:top-16 xl:h-[calc(100vh-64px)] xl:w-[470px] xl:shrink-0"}>{side}</div>
    </div>
  );
}

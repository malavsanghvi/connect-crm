"use client";

import { useSyncExternalStore } from "react";

import { modKeyLabel } from "@/lib/assistant/shortcuts";

const subscribeNever = () => () => {};

/** "⌘" on a Mac, "Ctrl" elsewhere, for the hints next to the buttons ("Ctrl" until the page is in the browser). */
export function useModKey(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => modKeyLabel(navigator.platform ?? ""),
    () => "Ctrl",
  );
}

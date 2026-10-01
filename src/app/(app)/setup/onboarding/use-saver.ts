"use client";

import { useState } from "react";

import { SaveQueue, type SaveStatus } from "@/lib/onboarding/save-queue";

import { saveProgressAction } from "./actions";

export type { SaveStatus };

/** The wizard's saver: a SaveQueue (src/lib/onboarding/save-queue.ts) whose status the page shows. */
export function useSaver() {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [queue] = useState(() => new SaveQueue(saveProgressAction, setStatus));
  return { status, queue };
}

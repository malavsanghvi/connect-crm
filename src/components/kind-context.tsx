"use client";

import { createContext, useContext, type ReactNode } from "react";

import { NEUTRAL_KIND, type KindProfile } from "@/lib/kind";

const KindContext = createContext<KindProfile>(NEUTRAL_KIND);

/**
 * The organization's kind (Jain Temple, Church, Chamber of commerce …) for client components that choose their words or
 * options by it (the flyer occasions, for one). The portal shell provides it; outside the shell the neutral kind is assumed
 * (no faith's words), never a guessed one.
 */
export function KindProvider({ kind, children }: { kind: KindProfile; children: ReactNode }) {
  return <KindContext.Provider value={kind}>{children}</KindContext.Provider>;
}

export function useKind(): KindProfile {
  return useContext(KindContext);
}

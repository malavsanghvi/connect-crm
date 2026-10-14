"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Look } from "@/lib/look";

const LookContext = createContext<Look>("classic");

/** Tells client components which look the portal is in. Set once by AppShell; outside it the look is "classic". */
export function LookProvider({ look, children }: { look: Look; children: ReactNode }) {
  return <LookContext.Provider value={look}>{children}</LookContext.Provider>;
}

export function useLook(): Look {
  return useContext(LookContext);
}

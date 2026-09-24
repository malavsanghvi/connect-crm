import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** governance module: a direct URL shows "switched off" when the center has turned it off. */
export default function Layout({ children }: { children: ReactNode }) {
  return <ModuleGate module="governance">{children}</ModuleGate>;
}

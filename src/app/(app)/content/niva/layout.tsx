import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** niva module: a direct URL shows "switched off" when the center has turned it off. */
export default function NivaLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="niva">{children}</ModuleGate>;
}

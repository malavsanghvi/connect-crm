import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** bolis module: a direct URL shows "switched off" when the center has turned it off. */
export default function BolisLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="bolis">{children}</ModuleGate>;
}

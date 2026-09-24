import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** reports module: a direct URL shows "switched off" when the center has turned it off. */
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="reports">{children}</ModuleGate>;
}

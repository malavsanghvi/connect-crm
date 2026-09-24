import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** jain_way module: a direct URL shows "switched off" when the center has turned it off. */
export default function PracticesLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="jain_way">{children}</ModuleGate>;
}

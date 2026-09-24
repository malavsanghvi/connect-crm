import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** volunteers module: a direct URL shows "switched off" when the center has turned it off. */
export default function VolunteersLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="volunteers">{children}</ModuleGate>;
}

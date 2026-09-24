import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** giving module: a direct URL shows "switched off" when the center has turned it off. */
export default function GivingLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="giving">{children}</ModuleGate>;
}

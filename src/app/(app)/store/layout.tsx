import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** store module: a direct URL shows "switched off" when the center has turned it off. */
export default function StoreLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="store">{children}</ModuleGate>;
}

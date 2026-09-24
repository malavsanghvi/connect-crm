import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** accounting module: a direct URL shows "switched off" when the center has turned it off. */
export default function AccountingLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="accounting">{children}</ModuleGate>;
}

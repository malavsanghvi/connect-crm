import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** Recurring gifts is an add-on of Giving (0741): a direct URL shows "switched off" (or "not part of this kind") when it is off. */
export default function RecurringLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="giving_recurring">{children}</ModuleGate>;
}

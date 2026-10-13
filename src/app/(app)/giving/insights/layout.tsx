import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** giving_insights module (0741): a direct URL shows "switched off" when the community has turned Insights off. */
export default function GivingInsightsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="giving_insights">{children}</ModuleGate>;
}

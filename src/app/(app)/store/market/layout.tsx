import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** market module (a Marketplace product): a direct URL says the Community Market is not on until Weaver grants it (0830). */
export default function CommunityMarketLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="market">{children}</ModuleGate>;
}

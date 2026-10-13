import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** WeCare (module `care`, 0750): a direct URL says the product is not on when Weaver has not turned it on, or the community paused it. */
export default function CareLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="care">{children}</ModuleGate>;
}

import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** Gift matching is CatchTheMatch (module `matching`, 0750): a direct URL says it is not on, and where to ask, when it is off. */
export default function GiftMatchingLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="matching">{children}</ModuleGate>;
}

import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** comms module: a direct URL shows "switched off" when the center has turned it off. */
export default function CommsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="comms">{children}</ModuleGate>;
}

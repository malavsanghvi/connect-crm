import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** membership module: a direct URL shows "switched off" when the center has turned it off. */
export default function VotingLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="membership">{children}</ModuleGate>;
}

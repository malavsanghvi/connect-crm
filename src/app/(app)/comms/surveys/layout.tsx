import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** surveys module: a direct URL shows "switched off" when the center has turned it off. */
export default function SurveysLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="surveys">{children}</ModuleGate>;
}

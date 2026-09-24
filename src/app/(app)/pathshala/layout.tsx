import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** pathshala module: a direct URL shows "switched off" when the center has turned it off. */
export default function PathshalaLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="pathshala">{children}</ModuleGate>;
}

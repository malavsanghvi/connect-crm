import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** gyan_path module: a direct URL shows "switched off" when the center has turned it off. */
export default function GyanPathLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="gyan_path">{children}</ModuleGate>;
}

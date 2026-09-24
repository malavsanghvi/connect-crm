import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** content module: a direct URL shows "switched off" when the center has turned it off. */
export default function ContentLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="content">{children}</ModuleGate>;
}

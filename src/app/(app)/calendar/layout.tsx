import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** calendar module: a direct URL shows "switched off" when the center has turned it off. */
export default function CalendarLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="calendar">{children}</ModuleGate>;
}

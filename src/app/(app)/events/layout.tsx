import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** events module: a direct URL shows "switched off" when the center has turned it off. */
export default function EventsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="events">{children}</ModuleGate>;
}

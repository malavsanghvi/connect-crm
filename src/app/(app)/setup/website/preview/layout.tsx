import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** The website draft's preview is WeaverSite (module `website`, 0751): a direct URL says so when it is not on. */
export default function WebsiteDraftPreviewLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="website">{children}</ModuleGate>;
}

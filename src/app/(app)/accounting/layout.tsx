import type { ReactNode } from "react";

import { GivingTabsScope } from "@/components/giving-today/giving-tabs-scope";
import { ModuleGate } from "@/components/module-gate";

/**
 * accounting module: a direct URL shows "switched off" when the center has turned it off. In the New look the pages are
 * Giving › Books and draw Giving's one tab row.
 */
export default function AccountingLayout({ children }: { children: ReactNode }) {
  return (
    <GivingTabsScope>
      <ModuleGate module="accounting">{children}</ModuleGate>
    </GivingTabsScope>
  );
}

import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** giving_proofs module (0865): a direct URL shows "switched off" when the community has turned Payment proofs off. */
export default function GivingProofsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="giving_proofs">{children}</ModuleGate>;
}

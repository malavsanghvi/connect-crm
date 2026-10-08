import type { ReactNode } from "react";

import { KindGate } from "@/components/module-gate";

/** Labh fulfillment is part of a Jain Center's giving, not of every kind of organization: a direct URL says so. */
export default function LabhLayout({ children }: { children: ReactNode }) {
  return <KindGate feature="labh" label="Labh fulfillment">{children}</KindGate>;
}

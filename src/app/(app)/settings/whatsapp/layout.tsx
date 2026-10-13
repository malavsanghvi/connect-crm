import type { ReactNode } from "react";

import { ModuleGate } from "@/components/module-gate";

/** The WhatsApp Business account is CommunityConnect (module `channels`, 0751): a direct URL says so when it is not on. */
export default function WhatsAppSettingsLayout({ children }: { children: ReactNode }) {
  return <ModuleGate module="channels">{children}</ModuleGate>;
}

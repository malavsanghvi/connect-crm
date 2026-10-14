// What the panel is told about THIS community: how it writes money and days, which payment ways it has switched on and which modules
// are off. It comes from the community's own row and settings; nothing here names a community, a country or a payment provider.

import { communityFormat } from "@/lib/community-format";
import { enabledPaymentPlugins } from "@/lib/payments/plugins/enabled";
import type { CrmSession } from "@/lib/session";

import type { CommunityHints } from "./protocol";

/** The hints the commands answer carries. The community's address goes only to the Weaver team. */
export async function communityHints(session: Pick<CrmSession, "db" | "center" | "isPlatformAdmin" | "isOwner" | "modulesOff" | "permissions">): Promise<CommunityHints> {
  const fmt = communityFormat(session.center);
  return {
    currency: fmt.currency,
    locale: fmt.locale,
    paymentPlugins: await enabledPaymentPlugins(session),
    modulesOff: [...session.modulesOff],
    ...(session.isPlatformAdmin ? { slug: session.center.slug } : {}),
  };
}

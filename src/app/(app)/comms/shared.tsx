import type { ReactNode } from "react";

import { NoAccess, PageHeader } from "@/components/ui";
import type { AudienceNames } from "@/lib/comms";
import type { AudienceOptions } from "@/lib/data/content-comms";
import { canAccess, type AccessKey } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export function CommsHeader({ sub, actions }: { sub: ReactNode; actions?: ReactNode }) {
  return <PageHeader title="Communications" description={sub} actions={actions} />;
}

/** Header + "You don't have access" when the user cannot open this tab. */
export function commsGate(session: CrmSession, access: AccessKey, sub: ReactNode): ReactNode | null {
  if (canAccess(session, access)) return null;
  return (
    <>
      <CommsHeader sub={sub} />
      <NoAccess area="Communications" access={access} />
    </>
  );
}

export function audienceNames(o: AudienceOptions): AudienceNames {
  return {
    zones: new Map(o.zones.map((z) => [z.id, z.name])),
    classes: new Map(o.classes.map((c) => [c.id, c.name])),
    events: new Map(o.events.map((e) => [e.id, e.name])),
    classCount: o.classes.length,
  };
}

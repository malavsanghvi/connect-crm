import type { ReactNode } from "react";

import { AskNiva } from "@/components/niva/ask-niva";
import { NoAccess, PageHeader } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/** Every Content tab: title "Content", the tab's own prototype sub-line, pill actions on the right, and "Ask Niva" (it shows nothing when Niva is off). */
export function ContentHeader({ sub, actions }: { sub: ReactNode; actions?: ReactNode }) {
  return (
    <PageHeader
      title="Content"
      description={sub}
      actions={
        <>
          {actions}
          <AskNiva prompt="What needs attention in Content: what is waiting in the approval queue, and are Niva's sources up to date?" />
        </>
      }
    />
  );
}

/** The header plus "You don't have access" when the user holds no content permission. */
export function contentGate(session: CrmSession, sub: ReactNode): ReactNode | null {
  if (canAccess(session, "content")) return null;
  return (
    <>
      <ContentHeader sub={sub} />
      <NoAccess area="Content" access="content" />
    </>
  );
}

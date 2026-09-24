import type { ReactNode } from "react";

import { NoAccess, PageHeader } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/** Every Content tab: title "Content", the tab's own prototype sub-line, pill actions on the right. */
export function ContentHeader({ sub, actions }: { sub: ReactNode; actions?: ReactNode }) {
  return <PageHeader title="Content" description={sub} actions={actions} />;
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

import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AccountMappingView } from "@/components/books/account-mapping";
import { Alert, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { loadAccountMapping } from "@/lib/data/books-mapping";
import { LOOK_COOKIE, parseLook } from "@/lib/look";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Account mapping" };

// Books › Account mapping (migration 0779). In the New look it is one of Books' views under Giving's tab row (the
// /accounting layout draws them, src/lib/books/views.ts); in the classic look it is a tab of Accounting.
export default async function AccountMappingPage() {
  const session = await getSession();
  const v2 = parseLook((await cookies()).get(LOOK_COOKIE)?.value) === "v2";
  const header = v2 ? (
    <PageHeader title="Books" description="Account mapping · which QuickBooks account each fund and kind of money posts to, and every change to it" />
  ) : (
    <PageHeader
      title="Accounting"
      description="Account mapping: which QuickBooks account each fund and each other kind of money posts to, each fund's class, each bank account's register, and every change to them"
    />
  );
  if (!canAccess(session, "qboMapping")) {
    return (
      <>
        {header}
        <NoAccess area="Account mapping" access="qboMapping" />
      </>
    );
  }
  const part = await loadAccountMapping(session);
  return (
    <>
      {header}
      {part.state === "ok" ? (
        <AccountMappingView data={part.data} timeZone={session.center.time_zone} />
      ) : part.state === "error" ? (
        <QueryError what="the account mapping" error={{ message: part.error }} retryHref="/accounting/qbo/mapping" />
      ) : part.state === "off" ? (
        <Alert tone="info" title="Accounting is switched off">
          QuickBooks is not used here, so there is no account mapping.
        </Alert>
      ) : (
        <NoAccess area="Account mapping" access="qboMapping" />
      )}
    </>
  );
}

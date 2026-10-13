import Link from "next/link";

import { BoliTable } from "@/app/(app)/bolis/boli-table";
import { loadBoliList } from "@/app/(app)/bolis/list-data";
import { QueryError, buttonClass } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

/**
 * The Bolis view of Giving › Campaigns & opportunities (New look, slice 6): the digital bolis as the Bolis screen lists them, a
 * row opening that screen's drawer (entries, close). Entering and closing a boli stay on the Bolis screens, unchanged.
 */
export async function BolisView({ session, label }: { session: CrmSession; label: string }) {
  const list = await loadBoliList(session, "digital");
  const { center } = session;
  const manage = canAccess(session, "bolisManage");
  return (
    <section aria-labelledby="bolis-view" className="rounded-[18px] border border-line bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bolis-view" className="m-0 font-display text-[20px] font-semibold text-ink">
          {label}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Link href="/bolis/upload" className={buttonClass("ghost", "sm")}>
            In-person upload
          </Link>
          <Link href="/bolis" className={buttonClass(manage ? "primary" : "ghost", "sm")}>
            {manage ? `Open ${label}: new, entries, close` : `Open ${label}`}
          </Link>
        </div>
      </div>
      <p className="m-0 mt-1 text-[13px] text-muted">First recorded pledge wins; every entry is kept. Open a row to see its entries.</p>
      <div className="mt-3">
        {list.bolisError ? (
          <QueryError what={label.toLowerCase()} error={list.bolisError} retryHref="/giving/campaigns?view=bolis" />
        ) : (
          <>
            {list.totalsError ? <p className="m-0 mb-2 text-xs text-muted">Top pledges and entry counts need bolis.view; your role sees the list only.</p> : null}
            <BoliTable list={list} basePath="/bolis" selectedId={undefined} timeZone={center.time_zone} currency={center.currency} emptyTitle={`No digital ${label.toLowerCase()} yet`} />
          </>
        )}
      </div>
    </section>
  );
}

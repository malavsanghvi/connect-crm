import type { Metadata } from "next";

import { BlockGrid, Card, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { boliRuleDefaults } from "@/lib/bolis";
import { identifierRules } from "@/lib/center-rules";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { BoliDrawer } from "./boli-drawer";
import { BoliForm } from "./boli-form";
import { BoliTable } from "./boli-table";
import { loadBoliDrawer } from "./drawer-data";
import { loadBoliList } from "./list-data";

export const metadata: Metadata = { title: "Bolis" };

export default async function DigitalBolisPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader title="Bolis" description="First recorded pledge wins; every entry is kept so the center can accommodate interested families" />
  );
  if (!canAccess(session, "bolis")) {
    return (
      <>
        {header}
        <NoAccess area="Bolis" access="bolis" />
      </>
    );
  }
  const sp = await searchParams;
  const selected = param(sp, "boli");
  const { center } = session;
  const [list, drawer] = await Promise.all([loadBoliList(session, "digital"), loadBoliDrawer(session, selected)]);
  const defaults = boliRuleDefaults(center.rules);
  const ids = identifierRules(center.rules);
  const manage = canAccess(session, "bolisManage");

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={12} title="Digital bolis" padded={false}>
          {list.bolisError ? (
            <div className="p-2">
              <QueryError what="bolis" error={list.bolisError} retryHref="/bolis" />
            </div>
          ) : (
            <>
              {list.totalsError ? (
                <p className="px-2.5 pb-2 text-xs text-muted">Top pledges and entry counts need bolis.view; your role sees the bolis only.</p>
              ) : null}
              <BoliTable
                list={list}
                basePath="/bolis"
                selectedId={selected}
                timeZone={center.time_zone}
                currency={center.currency}
                emptyTitle="No digital bolis yet"
              />
            </>
          )}
        </Card>
        {manage ? (
          <Card span={12} title="New digital boli">
            <BoliForm
              boli={null}
              events={list.events}
              timeZone={center.time_zone}
              defaultStepCents={defaults.stepCents}
              defaultSoftMinutes={defaults.softCloseMinutes}
            />
          </Card>
        ) : null}
      </BlockGrid>
      <BoliDrawer
        data={drawer.ok ? drawer.data : null}
        error={drawer.ok ? null : drawer.error}
        can={{ manage, record: canAccess(session, "bolisRecord"), draftMessages: canAccess(session, "commsDraft") }}
        events={list.events}
        labels={{ orgMemberLabel: ids.orgMemberLabel, orgHouseholdLabel: ids.orgHouseholdLabel }}
        timeZone={center.time_zone}
        currency={center.currency}
        defaultStepCents={defaults.stepCents}
        defaultSoftMinutes={defaults.softCloseMinutes}
      />
    </>
  );
}

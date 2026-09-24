import type { Metadata } from "next";

import { BlockGrid, Card, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { boliRuleDefaults } from "@/lib/bolis";
import { identifierRules } from "@/lib/center-rules";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { BoliDrawer } from "../boli-drawer";
import { BoliTable } from "../boli-table";
import { loadBoliDrawer } from "../drawer-data";
import { loadBoliList } from "../list-data";
import { BoliUpload } from "./boli-upload";

export const metadata: Metadata = { title: "In-person bolis" };

export default async function InPersonUploadPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Bolis" description="Record results of bolis called in the hall, one by one or in bulk" />;
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
  const [list, drawer] = await Promise.all([loadBoliList(session, "in_person"), loadBoliDrawer(session, selected)]);
  const defaults = boliRuleDefaults(center.rules);
  const ids = identifierRules(center.rules);
  const manage = canAccess(session, "bolisManage");
  const example = list.bolis.find((b) => b.status !== "closed" && b.status !== "settled");

  return (
    <>
      {header}
      <BlockGrid>
        <BoliUpload
          canUpload={manage}
          currency={center.currency}
          templateExample={
            example ? { boli: example.name, event: example.event_id ? (list.events.find((e) => e.id === example.event_id)?.name ?? "") : "" } : undefined
          }
        />
        <Card span={12} title="In-person bolis" description="Listed with the time each is called · open one to record pledges one by one" padded={false}>
          {list.bolisError ? (
            <div className="p-2">
              <QueryError what="in-person bolis" error={list.bolisError} retryHref="/bolis/upload" />
            </div>
          ) : (
            <BoliTable
              list={list}
              basePath="/bolis/upload"
              selectedId={selected}
              timeZone={center.time_zone}
              currency={center.currency}
              cutoffLabel="Called at"
              emptyTitle="No in-person bolis listed yet — add one on Digital bolis with Type: In-person"
            />
          )}
        </Card>
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

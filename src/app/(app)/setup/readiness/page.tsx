import type { Metadata } from "next";

import { Alert, Card, KpiGrid, QueryError, Stat } from "@/components/ui";
import { getSession } from "@/lib/session";
import { mergeReadiness } from "@/lib/setup";

import { SetupHeader, setupGate } from "../_components/setup-ui";
import { ReadinessTable } from "./readiness-table";

export const metadata: Metadata = { title: "Go-live readiness · Setup" };

const SUB = "the 13 checks before Community Connect approves going live · automatic where possible, with the evidence";

export default async function ReadinessPage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Go-live readiness");
  if (gate) return gate;
  const res = await session.db.rpc("readiness", { p_center: session.center.id });
  if (res.error) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="the readiness checks" error={res.error} retryHref="/setup/readiness" />
      </>
    );
  }
  const rows = mergeReadiness(res.data ?? []);
  const pass = rows.filter((r) => r.state === "pass").length;
  const fail = rows.filter((r) => r.state === "fail").length;
  const notBuilt = rows.filter((r) => r.state === "not_built").length;

  return (
    <>
      <SetupHeader session={session} sub={SUB} />
      <div className="mb-4">
        <KpiGrid cols={3}>
          <Stat label="Pass" value={`${pass} of ${rows.length}`} tone="success" hint="Checked just now" />
          <Stat label="Do not pass yet" value={fail} tone={fail > 0 ? "danger" : "ink"} hint="Each says what is missing" />
          <Stat label="Not built yet" value={notBuilt} tone="ink" hint="These checks arrive with later releases" />
        </KpiGrid>
      </div>
      {notBuilt > 0 ? (
        <div className="mb-4">
          <Alert tone="info" title="Some checks are not built yet">
            They are listed so the whole go-live picture is visible. Community Connect confirms them by hand until they are automatic.
          </Alert>
        </div>
      ) : null}
      <Card title="Readiness checks" description="Plan Step 8 · Community Connect approves, and the organization goes live" padded={false}>
        <ReadinessTable rows={rows} />
      </Card>
    </>
  );
}

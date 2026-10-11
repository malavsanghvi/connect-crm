import type { Metadata } from "next";

import { BlockGrid, Card, NoAccess, PageHeader, QueryError, StatusText } from "@/components/ui";
import { consentFromStatus } from "@/lib/activity/consent";
import { buildLabelMap, groupIdeas, summariseUsage, type IdeaRow, type UsageRow } from "@/lib/activity/ideas";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ConsentPanel } from "./consent-panel";
import { IdeaList, UsagePanel } from "./ideas-view";

export const metadata: Metadata = { title: "Automation ideas · Settings" };
export const dynamic = "force-dynamic";

const HERE = "/settings/automation";

/**
 * Settings › Automation ideas (B91). The top panel is the community's agreement to activity recording (owner decisions
 * 2026-10-11): nothing is noted until its administrator agrees. Only once the community has agreed AND recording is on does the
 * page list the repeated work the miner found (app.automation_candidates, already limited by the database to ideas from at
 * least 3 people) in plain English, to accept or set aside, and a counts-only summary of how the community uses Weaver
 * (app.activity_usage). Nothing here shows a person, an amount or anything anyone typed. Weaver staff see the state, and a
 * community's ideas only where it chose to share; they never answer for it.
 */
export default async function AutomationIdeasPage() {
  const session = await getSession();
  const { db, center } = session;
  const header = (
    <PageHeader
      title="Settings"
      description="Automation ideas · repeated work Weaver noticed in how people use it here, and what could be automated"
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Automation ideas" access="centerSettings" />
      </>
    );
  }

  const status = await db.rpc("activity_status", { p_center: center.id });
  if (status.error) {
    console.error("[settings/automation] could not read the recording state:", status.error);
    return (
      <>
        {header}
        <QueryError what="whether Weaver is recording for this community" error={status.error} retryHref={HERE} />
      </>
    );
  }
  const consent = consentFromStatus(status.data, center.rules);
  const weaver = session.isPlatformAdmin;
  const panel = <ConsentPanel consent={consent} tz={center.time_zone} canDecide={!weaver} centerId={center.id} />;

  if (!consent.agreed) {
    return (
      <>
        {header}
        <BlockGrid>{panel}</BlockGrid>
      </>
    );
  }
  if (!consent.recording) {
    return (
      <>
        {header}
        <BlockGrid>
          {panel}
          <Card span={12} title="Recording is switched off at the moment">
            <p className="text-[13px]">
              Weaver is not noting how this community uses it right now, so there are no new ideas. Your agreement is still on file. If you did not expect this, ask the Weaver team.
            </p>
          </Card>
        </BlockGrid>
      </>
    );
  }
  if (weaver && !consent.share) {
    return (
      <>
        {header}
        <BlockGrid>
          {panel}
          <Card span={12} title="Not shared with Weaver">
            <p className="text-[13px]">This community has not agreed to let Weaver staff see its ideas or counts, so they are not shown here.</p>
          </Card>
        </BlockGrid>
      </>
    );
  }

  const [candidates, catalog, roles, usage] = await Promise.all([
    db
      .from("automation_candidates")
      .select("id, role_key, pattern, support, distinct_actors, median_seconds, minutes_per_month, score, suggested_kind, status, last_seen")
      .eq("center_id", center.id)
      .order("score", { ascending: false }),
    db.from("activity_catalog").select("key, label, surface"),
    db.from("roles").select("key, name"),
    db.rpc("activity_usage", { p_center: center.id, p_days: 30 }),
  ]);

  if (roles.error) console.error("[settings/automation] could not read the role names (role keys are shown instead):", roles.error);
  const labels = buildLabelMap(catalog.data ?? []);
  const roleNames = Object.fromEntries((roles.data ?? []).map((r) => [r.key, r.name]));

  const ideasProblem = candidates.error ?? catalog.error ?? null;
  if (ideasProblem) console.error("[settings/automation] could not load the ideas:", ideasProblem);
  const groups = ideasProblem ? null : groupIdeas((candidates.data ?? []) as IdeaRow[], labels, roleNames);
  const canAnswer = !weaver;

  return (
    <>
      {header}
      <BlockGrid>
        {panel}
        <Card span={12} title="Recording is on" description="Which screens and actions people use here, how long they take and whether they worked · never names, amounts, notes or anything typed">
          <p className="text-[13px]">
            Now: <StatusText tone="ok">On</StatusText> · Each night Weaver looks for the same few steps done again and again, and lists them below once at least 3 people do them.
            Accepting an idea does not change anything by itself.
          </p>
        </Card>

        {ideasProblem || !groups ? (
          <div className="col-span-12">
            <QueryError what="the automation ideas" error={ideasProblem} retryHref={HERE} />
          </div>
        ) : (
          <>
            <IdeaList
              span={12}
              canAnswer={canAnswer}
              title="Ideas to look at"
              description="Repeated work Weaver noticed · accept the ones worth building, set aside the rest"
              cards={groups.fresh}
              empty="No ideas yet. Weaver needs the same steps done at least 5 times by at least 3 people before it suggests anything, and looks once a night."
            />
            <IdeaList span={12} canAnswer={canAnswer} title="Ideas you accepted" cards={groups.accepted} empty="Nothing accepted yet." />
            {groups.dismissed.length > 0 ? (
              <IdeaList
                span={12}
                canAnswer={canAnswer}
                title="Ideas you set aside"
                description="Marked not useful · bring one back if you change your mind"
                cards={groups.dismissed}
                empty=""
              />
            ) : null}
          </>
        )}

        {usage.error ? (
          <div className="col-span-12">
            {usage.error.code === "42501" ? (
              <Card title="How the community uses Weaver">
                <p className="text-[13px]">You don&apos;t have access to this area.</p>
              </Card>
            ) : (
              <QueryError what="how the community uses Weaver" error={usage.error} retryHref={HERE} />
            )}
          </div>
        ) : (
          <UsagePanel usage={summariseUsage((usage.data ?? []) as UsageRow[], labels)} />
        )}
      </BlockGrid>
    </>
  );
}

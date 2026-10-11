import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, NoAccess, PageHeader, QueryError, StatusText } from "@/components/ui";
import { buildLabelMap, groupIdeas, summariseUsage, type IdeaRow, type UsageRow } from "@/lib/activity/ideas";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { IdeaList, UsagePanel } from "./ideas-view";

export const metadata: Metadata = { title: "Automation ideas · Settings" };
export const dynamic = "force-dynamic";

const HERE = "/settings/automation";

/** What app.activity_status says about recording for this community (Json: { enabled, ... }). */
function recordingIsOn(status: unknown): boolean {
  return typeof status === "object" && status !== null && (status as { enabled?: unknown }).enabled === true;
}

/**
 * Settings › Automation ideas (B91). While Weaver is not recording for this community the page says so and nothing else.
 * While it is, it lists the repeated work the miner found (app.automation_candidates, already limited by the database to
 * ideas from at least 3 people) in plain English, to accept or set aside, and a counts-only summary of how the community
 * uses Weaver (app.activity_usage). Nothing here shows a person, an amount or anything anyone typed.
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

  if (!recordingIsOn(status.data)) {
    return (
      <>
        {header}
        <Card title="Weaver is not recording" description="Nothing about how people use Weaver here is being collected">
          <p className="text-[13px]">Weaver is not recording how this community uses it. A Weaver administrator can switch this on after your agreement.</p>
          <p className="crm-hint mt-2">
            When it is on, Weaver notes which screens and actions people use, how long they take and whether they worked, never names, amounts, notes or anything typed. It
            then suggests the repeated work that could be automated, and you decide which suggestions are useful.
          </p>
          {session.isPlatformAdmin ? (
            <p className="mt-3 text-[13px]">
              <Link href={`/platform/centers/${center.id}`} className="crm-link">
                Platform › Centers › {center.name}
              </Link>{" "}
              has the switch.
            </p>
          ) : null}
        </Card>
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

  return (
    <>
      {header}
      <BlockGrid>
        <Card
          span={12}
          title="Recording is on"
          description="Weaver notes which screens and actions people use here, how long they take and whether they worked · never names, amounts, notes or anything typed"
        >
          <p className="text-[13px]">
            Now: <StatusText tone="ok">On</StatusText> · People under 18, Weaver administrators and anyone who opted out are never recorded. Each night Weaver looks for the same few steps
            done again and again, and lists them below once at least 3 people do them. Accepting an idea does not change anything by itself.
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
              title="Ideas to look at"
              description="Repeated work Weaver noticed · accept the ones worth building, set aside the rest"
              cards={groups.fresh}
              empty="No ideas yet. Weaver needs the same steps done at least 5 times by at least 3 people before it suggests anything, and looks once a night."
            />
            <IdeaList span={12} title="Ideas you accepted" cards={groups.accepted} empty="Nothing accepted yet." />
            {groups.dismissed.length > 0 ? (
              <IdeaList span={12} title="Ideas you set aside" description="Marked not useful · bring one back if you change your mind" cards={groups.dismissed} empty="" />
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

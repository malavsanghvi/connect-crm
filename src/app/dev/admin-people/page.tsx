import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KindProvider } from "@/components/kind-context";
import { PeopleWorkspace } from "@/components/people-v2/people-workspace";
import { HistoryAccessProvider } from "@/components/record-history";
import { LookProvider } from "@/components/shell/look-context";
import { ModulesProvider } from "@/components/shell/module-tabs";
import { ShellV2 } from "@/components/shell/shell-v2";
import { StepUpProvider } from "@/components/step-up";
import { ToastProvider } from "@/components/toast";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { NEUTRAL_KIND } from "@/lib/kind";
import { peopleView } from "@/lib/people-v2/model";
import { visibleNav } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { navFooter, tenantBranding } from "@/lib/shell";
import { workspacesFor } from "@/lib/workspaces";

import { SAMPLE_COMMUNITY, sampleModel } from "./fixtures";
import { PreviewNiva } from "./preview-niva";

export const metadata: Metadata = { title: "People · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** A made-up signed-in person at a made-up neutral organization: only what the shell needs to draw itself. */
function sampleSession(): CrmSession {
  return {
    permissions: ["people.view", "people.manage", "people.approve", "giving.view", "events.view", "comms.view", "reports.view"],
    isPlatformAdmin: false,
    isOwner: false,
    userId: "dev-user",
    email: "secretary@example.org",
    center: {
      id: "dev-center",
      slug: "riverside",
      name: SAMPLE_COMMUNITY,
      short_name: "RNA",
      time_zone: "America/Chicago",
      currency: "USD",
      country: "US",
      branding: {},
      feature_flags: {},
      rules: {},
      status: "active",
      environment: "production",
    },
    person: { id: "dev-person", name: "Grace Mwangi", memberNumber: "0101" },
    roles: [{ key: "membership", name: "Membership coordinator", scopeKind: "center" }],
    grants: [{ role_key: "membership", scope_kind: "center", scope_id: null }],
    requestId: "dev",
    modulesOff: [],
    modulesStatus: "ok",
    kind: NEUTRAL_KIND,
    kindStatus: "ok",
    aal: "aal2",
    amr: [],
    centerSource: "default",
    switchable: [],
  } as unknown as CrmSession;
}

/**
 * DEV ONLY. The People workspace (new look) inside the new shell, with invented sample data for a neutral organization, drawn
 * without a database or a session so it can be checked and screenshotted. `?hh=<id>` opens a household card (a sheet on a phone),
 * `?view=people|reviews|duplicates` shows the other views, `?niva=off` shows the page with Niva switched off, `?merge=on` as if the
 * organization had ticked Niva's merge actions. Returns notFound() in production.
 */
export default async function AdminPeoplePreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const niva = one(sp.niva) !== "off";
  const session = sampleSession();
  const modules = visibleNav(session);
  const model = sampleModel({ view: peopleView(one(sp.view)), hh: one(sp.hh) ?? null, niva });

  return (
    <ToastProvider>
      <StepUpProvider>
        <HistoryAccessProvider allowed={false}>
          <KindProvider kind={session.kind}>
            <ModulesProvider modules={modules}>
              <PreviewNiva enabled={niva} mergeTicked={one(sp.merge) === "on"}>
                <LookProvider look="v2">
                  <ShellV2
                    session={session}
                    workspaces={workspacesFor(modules, session.kind).map((w) => (w.key === "people" ? { ...w, paths: [...w.paths, "/dev/admin-people"] } : w))}
                    branding={tenantBranding(session.center)}
                    name={session.person?.name ?? "Signed in"}
                    roleLabels={["Membership coordinator"]}
                    noStaffRoles={false}
                    canSearch
                    footer={navFooter(session)}
                    todayBadge="3"
                    todayBadgeLabel="3 tasks waiting"
                  >
                    <PeopleWorkspace model={model} />
                  </ShellV2>
                </LookProvider>
              </PreviewNiva>
            </ModulesProvider>
          </KindProvider>
        </HistoryAccessProvider>
      </StepUpProvider>
    </ToastProvider>
  );
}

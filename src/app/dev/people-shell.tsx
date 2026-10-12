import type { ReactNode } from "react";

import { KindProvider } from "@/components/kind-context";
import { HistoryAccessProvider } from "@/components/record-history";
import { LookProvider } from "@/components/shell/look-context";
import { ModulesProvider } from "@/components/shell/module-tabs";
import { ShellV2 } from "@/components/shell/shell-v2";
import { StepUpProvider } from "@/components/step-up";
import { ToastProvider } from "@/components/toast";
import { NEUTRAL_KIND } from "@/lib/kind";
import { visibleNav } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { navFooter, tenantBranding } from "@/lib/shell";
import { workspacesFor } from "@/lib/workspaces";

import { PreviewNiva } from "./admin-people/preview-niva";

// DEV ONLY. The New look's frame (top bar, rail, phone bar) around a People page, for a made-up signed-in person at a made-up
// neutral organization: only what the shell needs to draw itself. Used by /dev/people-family and /dev/people-slideover.

function sampleSession(community: string): CrmSession {
  return {
    permissions: ["people.view", "people.manage", "people.approve", "giving.view", "events.view", "comms.view", "reports.view"],
    isPlatformAdmin: false,
    isOwner: false,
    userId: "dev-user",
    email: "secretary@example.org",
    center: {
      id: "dev-center",
      slug: "riverside",
      name: community,
      short_name: "RC",
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

export function PreviewShell({ community, extraPath, children }: { community: string; extraPath: string; children: ReactNode }) {
  const session = sampleSession(community);
  const modules = visibleNav(session);
  return (
    <ToastProvider>
      <StepUpProvider>
        <HistoryAccessProvider allowed={false}>
          <KindProvider kind={session.kind}>
            <ModulesProvider modules={modules}>
              <PreviewNiva enabled mergeTicked={false}>
                <LookProvider look="v2">
                  <ShellV2
                    session={session}
                    workspaces={workspacesFor(modules, session.kind).map((w) => (w.key === "people" ? { ...w, paths: [...w.paths, extraPath] } : w))}
                    branding={tenantBranding(session.center)}
                    name={session.person?.name ?? "Signed in"}
                    roleLabels={["Membership coordinator"]}
                    noStaffRoles={false}
                    canSearch
                    footer={navFooter(session)}
                    todayBadge="3"
                    todayBadgeLabel="3 tasks waiting"
                  >
                    {children}
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

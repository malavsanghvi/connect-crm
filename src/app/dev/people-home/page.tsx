import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { KindProvider } from "@/components/kind-context";
import { PeopleHome } from "@/components/people-v2/people-home";
import { HistoryAccessProvider } from "@/components/record-history";
import { LookProvider } from "@/components/shell/look-context";
import { ModulesProvider } from "@/components/shell/module-tabs";
import { ShellV2 } from "@/components/shell/shell-v2";
import { StepUpProvider } from "@/components/step-up";
import { ToastProvider } from "@/components/toast";
import { NoAccess } from "@/components/ui";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { NEUTRAL_KIND } from "@/lib/kind";
import { visibleNav } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { navFooter, tenantBranding } from "@/lib/shell";
import { workspacesFor } from "@/lib/workspaces";

import { sampleHome, SAMPLE_COMMUNITY } from "./fixtures";
import { PreviewFind } from "./preview-find";

export const metadata: Metadata = { title: "People home · Dev preview" };

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
 * DEV ONLY. The People home (new look) inside the new shell, with invented sample data for a neutral organization and a find box that
 * runs the real matching and ranking over invented people. Returns notFound() in production.
 *   ?type=<text>&into=page|bar   type that into the big box (or the top bar's) after load
 *   ?niva=on|off|nokey           Niva's state          ?finance=on   as a person who may read finance
 *   ?fail=1 / ?problem=1         the lookup fails / part of it fails      ?recents=none   no recent families
 *   ?page=other                  any other page, to show the top-bar box   ?access=none   a role that cannot open People
 */
export default async function PeopleHomePreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const session = sampleSession();
  const modules = visibleNav(session);
  const niva = one(sp.niva) === "off" ? "off" : one(sp.niva) === "nokey" ? "nokey" : "on";
  const mode = { finance: one(sp.finance) === "on", fail: one(sp.fail) === "1", problem: one(sp.problem) === "1" };
  const model = sampleHome({ recents: one(sp.recents) !== "none", withInbox: true });

  const body =
    one(sp.access) === "none" ? (
      <>
        <h1 className="mb-4 font-display text-[30px] font-semibold text-ink">People</h1>
        <NoAccess area="People" access="households" />
      </>
    ) : one(sp.page) === "other" ? (
      <div className="mx-auto max-w-[900px]">
        <h1 className="m-0 font-display text-[30px] font-semibold text-ink">Any other page</h1>
        <p className="mt-2 text-[14px] text-muted">The find box sits in the top bar on every page. Press Ctrl K to jump to it.</p>
      </div>
    ) : (
      <PeopleHome model={model} />
    );

  return (
    <ToastProvider>
      <StepUpProvider>
        <HistoryAccessProvider allowed={false}>
          <KindProvider kind={session.kind}>
            <ModulesProvider modules={modules}>
              <PreviewFind mode={mode} niva={niva} type={one(sp.type) ?? null} into={one(sp.into) === "bar" ? "bar" : "page"}>
                <LookProvider look="v2">
                  <ShellV2
                    session={session}
                    workspaces={workspacesFor(modules, session.kind).map((w) => (w.key === "people" ? { ...w, paths: [...w.paths, "/dev/people-home"] } : w))}
                    branding={tenantBranding(session.center)}
                    name={session.person?.name ?? "Signed in"}
                    roleLabels={["Membership coordinator"]}
                    noStaffRoles={false}
                    canSearch
                    footer={navFooter(session)}
                    todayBadge="3"
                    todayBadgeLabel="3 tasks waiting"
                  >
                    {body}
                  </ShellV2>
                </LookProvider>
              </PreviewFind>
            </ModulesProvider>
          </KindProvider>
        </HistoryAccessProvider>
      </StepUpProvider>
    </ToastProvider>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";

import { WeaverMark } from "@/components/brand/weaver-mark";
import { ActivityBeacon } from "@/components/shell/activity-beacon";
import { CenterSwitcher, SandboxWatermark } from "@/components/shell/center-switcher";
import { GlobalSearch } from "@/components/shell/global-search";
import { NivaSunButton } from "@/components/shell/niva-sun-button";
import { PhoneBar } from "@/components/shell/phone-bar";
import { TenantMark } from "@/components/shell/tenant-mark";
import { UserMenuV2 } from "@/components/shell/user-menu-v2";
import { WorkspaceRail } from "@/components/shell/workspace-rail";
import { NivaBoundary } from "@/components/niva/niva-boundary";
import { NivaDock } from "@/components/niva/niva-dock";
import { activityRecordingOn } from "@/lib/activity/enabled";
import { PRODUCT_NAME } from "@/lib/brand";
import type { CrmSession } from "@/lib/session";
import type { TenantBranding } from "@/lib/shell";
import { initials, roleSummary } from "@/lib/shell";
import type { VisibleWorkspace } from "@/lib/workspaces";

/**
 * The redesigned portal shell (look "v2", chosen per person): a 64px top bar over an 88px rail of workspaces, the page, and
 * Niva's panel beside it; under 768px the rail becomes a bottom bar. Only the frame changes. The pages, their tabs, the
 * permissions behind them and Niva's own parts are the ones the classic shell uses (AppShell holds the providers they need).
 */
export function ShellV2({
  session,
  workspaces,
  branding,
  name,
  roleLabels,
  noStaffRoles,
  canSearch,
  footer,
  todayBadge,
  todayBadgeLabel,
  children,
}: {
  session: CrmSession;
  workspaces: VisibleWorkspace[];
  branding: TenantBranding;
  name: string;
  roleLabels: string[];
  noStaffRoles: boolean;
  canSearch: boolean;
  footer: string;
  todayBadge: string | null;
  todayBadgeLabel?: string;
  children: ReactNode;
}) {
  const center = session.center;
  const sandbox = center.environment === "sandbox";
  // More than one organization (or a platform admin, who can open any): the pill becomes the switcher.
  const switchable = session.switchable.some((c) => c.slug !== center.slug);
  const items = workspaces.map(({ key, label, href, icon, placement, paths, tabs }) => ({ key, label, href, icon, placement, paths, tabs }));
  const userInitials = initials(name, 1);

  return (
    <div data-look="v2" className="v2-shell flex min-h-screen flex-col">
      <a href="#v2-main" className="v2-skip">
        Skip to the page
      </a>
      {sandbox ? <SandboxWatermark name={center.name} /> : null}
      {/* Screen visits go to the activity stream only when the community has turned recording on. */}
      <ActivityBeacon centerId={center.id} enabled={activityRecordingOn(center.rules)} />
      <header className="v2-topbar sticky top-0 z-30">
        <Link href="/" className="v2-topbar-home no-underline" aria-label={`${PRODUCT_NAME} home, ${center.name}`}>
          <TenantMark branding={branding} name={center.name} size={40} />
        </Link>
        <span className="v2-product hidden items-center gap-2 xl:inline-flex" aria-hidden="true">
          <WeaverMark className="h-7 w-7" />
          {PRODUCT_NAME}
        </span>
        {switchable ? (
          <CenterSwitcher
            current={{ slug: center.slug, name: center.name }}
            centers={session.switchable.map((c) => ({ slug: c.slug, name: c.name, environment: c.environment, status: c.status }))}
            platformLink={session.isPlatformAdmin}
          />
        ) : session.isPlatformAdmin ? (
          <Link href="/platform" className="cc-center-pill hidden no-underline lg:inline-flex" title="Open Platform › Centers">
            Center: {center.name} ▾
          </Link>
        ) : (
          <span className="cc-center-pill hidden lg:inline-flex" title={`${center.name} · ${center.time_zone}`}>
            {center.name}
          </span>
        )}
        <div className="hidden min-w-0 flex-1 justify-center md:flex">{canSearch ? <GlobalSearch /> : null}</div>
        <div className="flex-1 md:hidden" />
        {/* Niva has one way in on this look: the rail item (the bottom bar on a phone) and Ctrl+J. */}
        <UserMenuV2 name={name} email={session.email} role={roleSummary(session)} roles={roleLabels} initials={userInitials} />
      </header>

      <div className="flex flex-1">
        <WorkspaceRail
          workspaces={items}
          todayBadge={todayBadge}
          todayBadgeLabel={todayBadgeLabel}
          account={
            <Link href="/account/security" className="v2-rail-avatar no-underline" aria-label={`Your account, ${name}`} title="Two-step verification, phone and sessions">
              <span aria-hidden="true" className="cc-avatar">
                {userInitials}
              </span>
            </Link>
          }
        >
          <NivaBoundary name="rail button">
            <NivaSunButton variant="rail" />
          </NivaBoundary>
        </WorkspaceRail>

        <main id="v2-main" tabIndex={-1} className="v2-main min-w-0 flex-1 px-4 pb-28 pt-[22px] sm:px-7 md:pb-10">
          {noStaffRoles ? (
            <div className="mb-4 rounded-[10px] border border-saffron/40 bg-saffron-50 px-4 py-3 text-[13px] text-brown-900">
              You are signed in but hold no staff role at {center.name}, so most areas are hidden. Ask your center
              admin to grant you a role (for example treasurer or membership coordinator).
            </div>
          ) : null}
          {children}
        </main>
        <NivaBoundary name="panel">
          <NivaDock />
        </NivaBoundary>
      </div>

      <PhoneBar workspaces={items} todayBadge={todayBadge} todayBadgeLabel={todayBadgeLabel} footer={footer}>
        <NivaBoundary name="bottom bar button">
          <NivaSunButton variant="bar" />
        </NivaBoundary>
      </PhoneBar>
    </div>
  );
}

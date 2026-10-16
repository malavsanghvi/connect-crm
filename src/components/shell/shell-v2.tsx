import Link from "next/link";
import type { ReactNode } from "react";

import { WeaverMark } from "@/components/brand/weaver-mark";
import { ActivityBeacon } from "@/components/shell/activity-beacon";
import { CenterSwitcher, SandboxWatermark } from "@/components/shell/center-switcher";
import { FamilyVisitTracker } from "@/components/people-v2/find/family-visit-tracker";
import { FindBox } from "@/components/people-v2/find/find-box";
import { GivingSheetsProvider } from "@/components/giving-actions/provider";
import { NivaSunButton } from "@/components/shell/niva-sun-button";
import { PhoneBar } from "@/components/shell/phone-bar";
import { RecordNavProvider } from "@/components/shell/record-nav";
import { SectionPanel } from "@/components/shell/section-panel";
import { TenantMark } from "@/components/shell/tenant-mark";
import { UserMenuV2 } from "@/components/shell/user-menu-v2";
import { TopGear } from "@/components/shell/top-gear";
import { WorkspaceMenu } from "@/components/shell/workspace-menu";
import { NivaBoundary } from "@/components/niva/niva-boundary";
import { NivaDock } from "@/components/niva/niva-dock";
import { NivaTopButton } from "@/components/niva/niva-top-button";
import { activityRecordingOn } from "@/lib/activity/enabled";
import { recentCookieName } from "@/lib/find/recents";
import { canFindGiving, givingSheetContext } from "@/lib/giving-actions/context";
import { PRODUCT_NAME } from "@/lib/brand";
import type { PanelPref } from "@/lib/panel-pref";
import type { CrmSession } from "@/lib/session";
import type { TenantBranding } from "@/lib/shell";
import { initials, roleSummary } from "@/lib/shell";
import type { VisibleWorkspace } from "@/lib/workspaces";
import { sectionsFor } from "@/lib/workspace-sections";

/**
 * The redesigned portal shell (look "v2", chosen per person), Option A of docs/CRM_NAV_REDESIGN_PLAN.md: a 48px top bar (the
 * community's mark, organization, the workspaces with a More menu, find, Niva, Settings, the account), the open workspace's sections
 * in a collapsible panel on the left, the page, and Niva's panel beside it. Under 768px the workspaces move to a bottom bar and under
 * 1024px the pages keep their own tab rows instead of the panel. Only the frame changes. The pages, their tabs, the permissions
 * behind them and Niva's own parts are the ones the classic shell uses (AppShell holds the providers they need).
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
  panel = "auto",
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
  /** Whether this person keeps the left panel open, collapsed, or has not chosen. */
  panel?: PanelPref;
  children: ReactNode;
}) {
  const center = session.center;
  const sandbox = center.environment === "sandbox";
  // More than one organization (or a platform admin, who can open any): the pill becomes the switcher.
  const switchable = session.switchable.some((c) => c.slug !== center.slug);
  const items = workspaces.map(({ key, label, href, icon, placement, paths, tabs }) => ({ key, label, href, icon, placement, paths, tabs }));
  const sections = sectionsFor(workspaces, session);
  const settings = items.find((w) => w.key === "settings");
  const platform = items.find((w) => w.key === "platform");
  const userInitials = initials(name, 1);
  // The find box remembers the families this person opens (in this browser) for the People home.
  const recentCookie = recentCookieName(session.userId, center.id);
  // Giving's sheets open in place on every page of this look (Record payment, a family's giving); null when the person has no Giving.
  const givingSheets = givingSheetContext(session);
  // The box also serves people who only work with Giving (a finance volunteer): it then finds Giving's things only.
  const showFind = canSearch || canFindGiving(session);

  return (
    <GivingSheetsProvider ctx={givingSheets}>
    <div data-look="v2" data-shell-frame="top" className="v2-shell flex min-h-screen flex-col">
      <a href="#v2-main" className="v2-skip">
        Skip to the page
      </a>
      {sandbox ? <SandboxWatermark name={center.name} /> : null}
      {/* Screen visits go to the activity stream only when the community has turned recording on. */}
      <ActivityBeacon centerId={center.id} enabled={activityRecordingOn(center.rules)} />
      <header className="v2-top sticky top-0 z-30">
        <Link href="/" className="v2-top-home no-underline" aria-label={`${PRODUCT_NAME} home, ${center.name}`}>
          <TenantMark branding={branding} name={center.name} size={32} />
        </Link>
        <span className="v2-product hidden items-center gap-2 xl:inline-flex" aria-hidden="true">
          <WeaverMark className="h-6 w-6" />
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
        <div className="hidden min-w-0 flex-1 md:flex">
          <WorkspaceMenu workspaces={items} todayBadge={todayBadge} todayBadgeLabel={todayBadgeLabel} />
        </div>
        <div className="hidden w-[170px] shrink-0 md:block lg:w-[220px] xl:w-[300px]">{showFind ? <FindBox variant="bar" cookieName={recentCookie} /> : null}</div>
        {canSearch ? <FamilyVisitTracker cookieName={recentCookie} /> : null}
        <div className="flex-1 md:hidden" />
        {/* Niva has two ways in on this look: this button (the bottom bar on a phone) and Ctrl+J. */}
        <div className="hidden md:block">
          <NivaBoundary name="top bar button">
            <NivaTopButton />
          </NivaBoundary>
        </div>
        {settings ? <TopGear workspaces={items} target={settings} /> : null}
        <UserMenuV2
          name={name}
          email={session.email}
          role={roleSummary(session)}
          roles={roleLabels}
          initials={userInitials}
          links={platform ? [{ label: platform.label, href: platform.href }] : undefined}
        />
      </header>

      <RecordNavProvider>
      <div className="flex flex-1">
        <SectionPanel workspaces={items} sections={sections} initial={panel} />

        <main id="v2-main" tabIndex={-1} className="v2-main min-w-0 flex-1 px-4 pb-28 pt-[22px] sm:px-7 md:pb-10">
          {noStaffRoles ? (
            <div className="mb-4 rounded-field border border-warning-200 bg-warning-50 px-4 py-3 text-[13px] text-warning-ink">
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
      </RecordNavProvider>

      <PhoneBar workspaces={items} todayBadge={todayBadge} todayBadgeLabel={todayBadgeLabel} footer={footer}>
        <NivaBoundary name="bottom bar button">
          <NivaSunButton variant="bar" />
        </NivaBoundary>
      </PhoneBar>
    </div>
    </GivingSheetsProvider>
  );
}

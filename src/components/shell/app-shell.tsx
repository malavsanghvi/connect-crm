import Link from "next/link";
import type { ReactNode } from "react";

import { GlobalSearch } from "@/components/shell/global-search";
import { MobileNav } from "@/components/shell/mobile-nav";
import { ModulesProvider } from "@/components/shell/module-tabs";
import { ModuleNav } from "@/components/shell/nav-link";
import { TenantMark } from "@/components/shell/tenant-mark";
import { UserMenu } from "@/components/shell/user-menu";
import { HistoryAccessProvider } from "@/components/record-history";
import { StepUpProvider } from "@/components/step-up";
import { ToastProvider } from "@/components/toast";
import { PRODUCT_NAME } from "@/lib/brand";
import type { TaskCount } from "@/lib/data/home-tasks";
import { canAccess, visibleNav } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";
import { initials, navFooter, roleSummary, tenantBranding } from "@/lib/shell";

function homeBadge(tasks: TaskCount): { badge: string | null; label?: string } {
  if (!tasks) return { badge: null };
  if (!tasks.ok) return { badge: "!", label: tasks.error };
  if (tasks.count === 0) return { badge: null };
  return { badge: tasks.count > 99 ? "99+" : String(tasks.count), label: `${tasks.count} task${tasks.count === 1 ? "" : "s"} waiting` };
}

/**
 * The portal shell, as in the prototype: a white 60px top bar (tenant mark,
 * product name, center pill, search, user) over a white 220px flat sidebar
 * of modules with a role footer. Each module's pages are its tabs.
 */
export function AppShell({ session, tasks, children }: { session: CrmSession; tasks: TaskCount; children: ReactNode }) {
  const modules = visibleNav(session);
  const center = session.center;
  const branding = tenantBranding(center);
  const name = session.person?.name ?? session.email ?? "Signed in";
  const roleLabels = session.roles.map((r) => (r.scopeKind === "center" ? r.name : `${r.name} (${r.scopeKind})`));
  // A class teacher or event volunteer holds only scoped roles: not "no role".
  const noStaffRoles = session.permissions.length === 0 && !session.isPlatformAdmin && session.grants.length === 0;
  const home = homeBadge(tasks);
  const canSearch = canAccess(session, "households");

  const footer = navFooter(session);

  return (
    <ToastProvider>
      <StepUpProvider>
      <HistoryAccessProvider allowed={canAccess(session, "audit")}>
      <ModulesProvider modules={modules}>
        <div className="flex min-h-screen flex-col">
          <header className="cc-topbar sticky top-0 z-30 px-3 sm:px-5">
            <MobileNav modules={modules} homeBadge={home.badge} homeBadgeLabel={home.label} footer={footer} />
            <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3.5 no-underline" aria-label={`${PRODUCT_NAME} home`}>
              <TenantMark branding={branding} name={center.name} />
              <span className="cc-product hidden sm:inline">{PRODUCT_NAME}</span>
            </Link>
            {session.isPlatformAdmin ? (
              <Link href="/platform" className="cc-center-pill hidden no-underline xl:inline-flex" title="Open Platform › Centers">
                Center: {center.name} ▾
              </Link>
            ) : (
              <span className="cc-center-pill hidden xl:inline-flex" title={`${center.name} · ${center.time_zone}`}>
                {center.name}
              </span>
            )}
            <div className="hidden min-w-0 flex-1 justify-center md:flex">{canSearch ? <GlobalSearch /> : null}</div>
            <div className="flex-1 md:hidden" />
            <UserMenu
              name={name}
              email={session.email}
              role={roleSummary(session)}
              roles={roleLabels}
              initials={initials(name, 1)}
            />
          </header>

          <div className="flex flex-1">
            <aside className="cc-sidebar sticky top-[60px] hidden h-[calc(100vh-60px)] shrink-0 overflow-y-auto lg:flex">
              <ModuleNav modules={modules} homeBadge={home.badge} homeBadgeLabel={home.label} />
              <div className="flex-grow" />
              <p className="cc-nav-foot">{footer}</p>
            </aside>

            <main className="min-w-0 flex-1 px-4 pb-10 pt-[22px] sm:px-7">
              {noStaffRoles ? (
                <div className="mb-4 rounded-[10px] border border-saffron/40 bg-saffron-50 px-4 py-3 text-[13px] text-brown-900">
                  You are signed in but hold no staff role at {center.name}, so most areas are hidden. Ask your center
                  admin to grant you a role (for example treasurer or membership coordinator).
                </div>
              ) : null}
              {children}
            </main>
          </div>
        </div>
      </ModulesProvider>
      </HistoryAccessProvider>
      </StepUpProvider>
    </ToastProvider>
  );
}

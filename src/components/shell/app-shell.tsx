import Link from "next/link";
import type { ReactNode } from "react";

import { NavLink } from "@/components/shell/nav-link";
import { UserMenu } from "@/components/shell/user-menu";
import { visibleNav } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

export function AppShell({ session, children }: { session: CrmSession; children: ReactNode }) {
  const nav = visibleNav(session);
  const center = session.center;
  const name = session.person?.name ?? session.email ?? "Signed in";
  const roleLabels = session.roles.map((r) => (r.scopeKind === "center" ? r.name : `${r.name} (${r.scopeKind})`));
  const noStaffRoles = session.permissions.length === 0 && !session.isPlatformAdmin;

  const navList = (
    <nav aria-label="Main" className="space-y-5">
      {nav.map((section) => (
        <div key={section.title}>
          <p className="mb-1 px-3 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-white/50">
            {section.title}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href} label={item.label} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto bg-navy px-3 py-5 lg:block">
        <Link href="/" className="mb-6 block px-3">
          <span className="block font-display text-xl font-semibold text-white">Connect CRM</span>
          <span className="block text-xs text-white/60">System of record</span>
        </Link>
        {navList}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between gap-3 border-b border-line bg-ground/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <details className="relative lg:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-lg border border-line-strong bg-white px-3 text-sm font-semibold">
                Menu
              </summary>
              <div className="absolute left-0 z-20 mt-1 max-h-[80vh] w-72 overflow-y-auto rounded-xl bg-navy p-3 shadow-lg">
                {navList}
              </div>
            </details>
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-semibold text-navy">{center.name}</p>
              <p className="truncate text-xs text-muted">
                {center.short_name ?? center.slug.toUpperCase()} · {center.time_zone}
              </p>
            </div>
          </div>
          <UserMenu name={name} email={session.email} roles={roleLabels} />
        </header>

        <main className="mx-auto w-full max-w-[88rem] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {noStaffRoles ? (
            <div className="mb-6 rounded-lg border border-saffron/40 bg-saffron-50 px-4 py-3 text-sm text-brown">
              You are signed in but hold no staff role at {center.name}, so most areas are hidden. Ask your center admin
              to grant you a role (for example treasurer or membership coordinator).
            </div>
          ) : null}
          {children}
        </main>
      </div>
    </div>
  );
}

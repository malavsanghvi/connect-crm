"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { activeModule, activeTabHref, type VisibleModule } from "@/lib/permissions";

const ModulesContext = createContext<VisibleModule[] | null>(null);

/** Gives client components the modules (and tabs) this user can open. Set once by AppShell. */
export function ModulesProvider({ modules, children }: { modules: VisibleModule[]; children: ReactNode }) {
  return <ModulesContext.Provider value={modules}>{children}</ModulesContext.Provider>;
}

export function useModules(): VisibleModule[] | null {
  return useContext(ModulesContext);
}

/**
 * The module's tab strip (prototype: underline, 3px navy when active,
 * 14px/700). Each tab is one of the module's existing pages. Shown only when
 * the module has more than one tab the user can open. PageHeader renders it
 * under the page title, so title → tabs → content, as in the prototype.
 */
export function ModuleTabs() {
  const modules = useModules();
  const pathname = usePathname();
  if (!modules) return null;
  const mod = activeModule(modules, pathname);
  if (!mod || mod.tabs.length < 2) return null;
  const active = activeTabHref(mod.tabs, pathname);
  return (
    <nav aria-label={`${mod.label} sections`} className="cc-tabs mt-4">
      {mod.tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined} className="cc-tab">
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

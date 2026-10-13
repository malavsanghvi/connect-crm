"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { GivingTabRow, useGivingTabs } from "@/components/giving-today/giving-tabs";
import { useKind } from "@/components/kind-context";
import { useLook } from "@/components/shell/look-context";
import { activeModule, activeTabHref, pathUnder, type VisibleModule } from "@/lib/permissions";
import { modulesInWorkspace, workspaceLabel as labelOfWorkspace, workspaceOfModule } from "@/lib/workspaces";

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
  const look = useLook();
  const kind = useKind();
  const givingTabs = useGivingTabs();
  // Giving in the New look has ONE tab row (Today, Pledges, Payments, Bank …), handed down by the /giving layout.
  if (look === "v2" && givingTabs && givingTabs.length >= 2 && pathUnder(pathname, "/giving")) {
    return <GivingTabRow tabs={givingTabs} className="mt-4" />;
  }
  if (!modules) return null;
  const mod = activeModule(modules, pathname);
  if (!mod) return null;
  const active = activeTabHref(mod.tabs, pathname);
  // In the redesigned look one workspace can hold several modules (Giving: Giving, Bolis, Accounting). The modules stay
  // reachable from this row, and each module keeps its own tab strip below it.
  const workspaceKey = look === "v2" ? workspaceOfModule(mod.key) : undefined;
  const areas = workspaceKey ? modulesInWorkspace(workspaceKey, modules) : [];
  const workspaceLabel = workspaceKey ? labelOfWorkspace(workspaceKey, kind) : "";
  const showTabs = mod.tabs.length >= 2;
  if (areas.length < 2 && !showTabs) return null;
  return (
    <>
      {areas.length >= 2 ? (
        <nav aria-label={`${workspaceLabel} areas`} className="v2-areas mt-4">
          {areas.map((m) => (
            <Link key={m.key} href={m.href} aria-current={m.key === mod.key ? "page" : undefined} className="v2-area">
              {m.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {showTabs ? (
        <nav aria-label={`${mod.label} sections`} className={`cc-tabs ${areas.length >= 2 ? "mt-2" : "mt-4"}`}>
          {mod.tabs.map((t) => (
            <Link key={t.href} href={t.href} aria-current={t.href === active ? "page" : undefined} className="cc-tab">
              {t.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}

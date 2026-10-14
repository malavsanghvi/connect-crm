"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { WorkspaceIcon } from "@/components/shell/workspace-icon";
import { activeWorkspace, type VisibleWorkspace } from "@/lib/workspaces";

/** What the rail needs of a workspace (plain data, so a server component can hand it over). */
export type RailWorkspace = Pick<VisibleWorkspace, "key" | "label" | "href" | "icon" | "placement" | "paths"> & { tabs: { href: string }[] };

/** The key of the workspace the current page is in, if any. */
export function useActiveWorkspaceKey(workspaces: RailWorkspace[]): string | undefined {
  const pathname = usePathname();
  return activeWorkspace(workspaces, pathname)?.key;
}

function RailLink({ w, active, badge, badgeLabel }: { w: RailWorkspace; active: boolean; badge?: string | null; badgeLabel?: string }) {
  return (
    <Link href={w.href} aria-current={active ? "page" : undefined} className="v2-nav-item" data-spotlight={`nav-${w.key}`}>
      <span className="relative">
        <WorkspaceIcon path={w.icon} />
        {badge ? (
          <span className="v2-nav-badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </span>
      <span className="v2-nav-label">{w.label}</span>
      {badge && badgeLabel ? <span className="sr-only">, {badgeLabel}</span> : null}
    </Link>
  );
}

/**
 * The 88px rail of workspaces (from md up; phones get the bottom bar). Icon over label, the current workspace tinted blue, Settings
 * and Platform apart at the bottom of the list, and below them Niva's button above the person's account link. The workspaces are the ones this person may open, nothing more.
 */
export function WorkspaceRail({
  workspaces,
  todayBadge,
  todayBadgeLabel,
  account,
  children,
}: {
  workspaces: RailWorkspace[];
  todayBadge?: string | null;
  todayBadgeLabel?: string;
  /** The person's account link, shown last. */
  account: ReactNode;
  /** Niva's button, shown above the account link. */
  children?: ReactNode;
}) {
  const activeKey = useActiveWorkspaceKey(workspaces);
  const start = workspaces.filter((w) => w.placement === "start");
  const end = workspaces.filter((w) => w.placement === "end");
  const item = (w: RailWorkspace) => (
    <li key={w.key}>
      <RailLink w={w} active={w.key === activeKey} badge={w.key === "today" ? todayBadge : null} badgeLabel={todayBadgeLabel} />
    </li>
  );
  return (
    <div className="v2-rail hidden md:flex">
      <nav aria-label="Workspaces" className="v2-rail-nav">
        {/* The list scrolls when the window is short; Settings and Platform stay in view below it. */}
        <ul className="v2-rail-list">{start.map(item)}</ul>
        {end.length > 0 ? <ul className="v2-rail-end">{end.map(item)}</ul> : null}
      </nav>
      <div className="v2-rail-foot">
        {children}
        {account}
      </div>
    </div>
  );
}

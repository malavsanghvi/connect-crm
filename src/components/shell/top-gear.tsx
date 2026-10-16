"use client";

import Link from "next/link";

import { WorkspaceIcon } from "@/components/shell/workspace-icon";
import { useActiveWorkspaceKey, type RailWorkspace } from "@/components/shell/workspace-rail";

/** The gear of the top bar: Settings, which has no room in the row of workspaces. Lit while a Settings page is open. */
export function TopGear({ workspaces, target }: { workspaces: RailWorkspace[]; target: RailWorkspace }) {
  const activeKey = useActiveWorkspaceKey(workspaces);
  return (
    <Link
      href={target.href}
      className="v2-top-icon hidden md:inline-flex"
      aria-label={target.label}
      aria-current={activeKey === target.key ? "page" : undefined}
      title={target.label}
      data-spotlight={`nav-${target.key}`}
    >
      <WorkspaceIcon name={target.icon} className="h-5 w-5" />
    </Link>
  );
}

import type { ReactNode } from "react";

import { loadSession } from "@/lib/session";

import { PathshalaHeader } from "../ui";
import { CommitteeTabs } from "./committee-tabs";

/**
 * The Pathshala committee (the EAMS replacement from connect-admin): year
 * planning, event checklists, concerns and resolutions. Not in the prototype;
 * kept as a Pathshala tab with its own sections as chips.
 */
export default async function CommitteeLayout({ children }: { children: ReactNode }) {
  const state = await loadSession();
  const modulesOff = state.status === "ok" ? (state.session.modulesOff ?? []) : [];
  return (
    <>
      <PathshalaHeader description="Committee · plan the Pathshala year, track actions, log concerns and vote on resolutions" />
      <CommitteeTabs modulesOff={modulesOff} />
      {children}
    </>
  );
}

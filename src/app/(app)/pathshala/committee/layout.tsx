import type { ReactNode } from "react";

import { PathshalaHeader } from "../ui";
import { CommitteeTabs } from "./committee-tabs";

/**
 * The Pathshala committee (the EAMS replacement from connect-admin): year
 * planning, event checklists, concerns and resolutions. Not in the prototype;
 * kept as a Pathshala tab with its own sections as chips.
 */
export default function CommitteeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PathshalaHeader description="Committee · plan the Pathshala year, track actions, log concerns and vote on resolutions" />
      <CommitteeTabs />
      {children}
    </>
  );
}

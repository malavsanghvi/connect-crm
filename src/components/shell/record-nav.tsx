"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// A record page (a household) hands its own sections to the shell's left panel (docs/CRM_NAV_REDESIGN_PLAN.md, slice 3). The panel is
// drawn by the shell, outside the page, so the page registers what it wants listed and the panel swaps its workspace list for it: a
// back link, the record's name and card line, its sections. The page leaves, the registration goes, and the workspace list is back.

export type RecordNavItem = { key: string; label: string; href: string; active: boolean };

export type RecordNavData = {
  title: string;
  /** The household card line (never a name alone). */
  subtitle: string;
  backHref: string;
  backLabel: string;
  items: RecordNavItem[];
};

type Ctx = { record: RecordNavData | null; setRecord: (r: RecordNavData | null) => void };
const RecordNavContext = createContext<Ctx>({ record: null, setRecord: () => {} });

export function RecordNavProvider({ children, initial = null }: { children: ReactNode; initial?: RecordNavData | null }) {
  const [record, setRecord] = useState<RecordNavData | null>(initial);
  const value = useMemo(() => ({ record, setRecord }), [record]);
  return <RecordNavContext.Provider value={value}>{children}</RecordNavContext.Provider>;
}

/** The registered record, or null on every other page. */
export function useRecordNav(): RecordNavData | null {
  return useContext(RecordNavContext).record;
}

/** Drawn by a record page: lists its sections in the left panel for as long as the page is open. Draws nothing itself. */
export function RecordNav(props: RecordNavData) {
  const { setRecord } = useContext(RecordNavContext);
  // The page sends plain data; compare it by content so a re-render with the same sections does not register again.
  const key = JSON.stringify(props);
  useEffect(() => {
    setRecord(JSON.parse(key) as RecordNavData);
    return () => setRecord(null);
  }, [key, setRecord]);
  return null;
}

"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { familyIdFromPath } from "@/lib/find/recents";

import { recordRecentFamily } from "./recent-cookie";

/**
 * Remembers every family page the person opens (from the box, a list, a link, anywhere) for the "Recent families" on the People home.
 * It draws nothing. One effect per page change.
 */
export function FamilyVisitTracker({ cookieName }: { cookieName: string }) {
  const pathname = usePathname();
  useEffect(() => {
    recordRecentFamily(cookieName, familyIdFromPath(pathname));
  }, [cookieName, pathname]);
  return null;
}

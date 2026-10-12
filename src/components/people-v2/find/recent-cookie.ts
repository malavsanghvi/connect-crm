"use client";

import { parseRecents, pushRecent, RECENT_MAX_AGE_SECONDS, serializeRecents } from "@/lib/find/recents";

// Writes the "recent families" cookie from the browser (see src/lib/find/recents.ts for why it is a cookie and what it holds).
// Never throws: a browser that blocks cookies simply does not remember, and nothing else changes.

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split("; ")) if (part.startsWith(prefix)) return decodeURIComponent(part.slice(prefix.length));
  return null;
}

export function recordRecentFamily(cookieName: string | null, familyId: string | null): void {
  if (!cookieName || !familyId) return;
  try {
    const next = pushRecent(parseRecents(readCookie(cookieName)), familyId);
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${cookieName}=${encodeURIComponent(serializeRecents(next))}; path=/; max-age=${RECENT_MAX_AGE_SECONDS}; samesite=lax${secure}`;
  } catch (error) {
    console.error("[find] could not remember the family you opened:", error);
  }
}

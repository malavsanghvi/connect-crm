import "server-only";

import type { Metadata } from "next";

import type { KindProfile } from "@/lib/kind";
import { loadSession } from "@/lib/session";

/**
 * A page title in the organization's own words (the store is "Satvik Store" for a Jain Center and "Store" for a chamber).
 * `build` gets the kind; when there is no session yet (signed out) it gets nothing and the plain fallback is used.
 */
export async function kindTitle(build: (kind: KindProfile) => string, fallback: string): Promise<Metadata> {
  const state = await loadSession();
  return { title: state.status === "ok" ? build(state.session.kind) : fallback };
}

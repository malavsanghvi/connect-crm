"use server";

// B20 (migration 0576): Content › Niva › Find a website's pages. Staff ask the background service to
// read a site's sitemap (app.niva_discover_site → worker niva.discover_site), see the list it saved
// (app.niva_discovery_status), and queue the pages they tick for import, at most 50 per call
// (app.niva_import_pages). Imported sections are still drafts that a content manager approves.
// content.draft or content.manage, as for "Import from a web page"; the database checks it again.

import { revalidatePath } from "next/cache";

import { failure, type ActionResult, type DbErrorLike } from "@/lib/errors";
import { IMPORT_BATCH, parseDiscoveryStatus, type DiscoveryStatus } from "@/lib/niva-site";
import { authorizeAction } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

// app.niva_discover_site and app.niva_discovery_status are new in 0576: until the generated types
// include them, they are called through the untyped signature (as lib/data/pathshala.ts does).
type RpcCaller = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: DbErrorLike | null }>;
const untyped = (db: AppSupabase) => db.rpc.bind(db) as unknown as RpcCaller;

async function readStatus(db: AppSupabase, centerId: string, doing: string): Promise<ActionResult<DiscoveryStatus>> {
  const { data, error } = await untyped(db)("niva_discovery_status", { p_center: centerId });
  if (error) return failure(`Could not ${doing}`, error);
  const status = parseDiscoveryStatus(data);
  if (!status) {
    console.error("[content/niva] niva_discovery_status returned an unexpected shape:", data);
    return { ok: false, error: `Could not ${doing} — the database answered in a shape this screen does not understand (has the latest migration been applied?).` };
  }
  return { ok: true, data: status };
}

/** The latest search for a website's pages and the list it found. */
export async function nivaSitePagesAction(): Promise<ActionResult<DiscoveryStatus>> {
  const doing = "load the website's pages";
  const auth = await authorizeAction("contentDraft", doing);
  if (!auth.ok) return auth;
  return readStatus(auth.session.db, auth.session.center.id, doing);
}

/** Ask the background service to read a website's sitemap. Returns the status with the new search in it. */
export async function discoverNivaSiteAction(url: string): Promise<ActionResult<DiscoveryStatus>> {
  const doing = "look for the website's pages";
  const auth = await authorizeAction("contentDraft", doing);
  if (!auth.ok) return auth;
  const address = typeof url === "string" ? url.trim() : "";
  if (!address) return { ok: false, error: `Could not ${doing} — type the website's address, for example https://www.example.org.` };
  const { db, center } = auth.session;
  const { error } = await untyped(db)("niva_discover_site", { p_center: center.id, p_url: address });
  if (error) return failure(`Could not ${doing}`, error);
  const message = "Looking for the website's pages. This usually takes under a minute.";
  // The search is queued either way; when the list cannot be read back right now, the screen asks again.
  const status = await readStatus(db, center.id, "load the website's pages");
  return status.ok ? { ok: true, message, data: status.data } : { ok: true, message };
}

/** Queue up to 50 of the listed pages for import (the screen sends larger choices 50 at a time). */
export async function importNivaSitePagesAction(urls: string[]): Promise<ActionResult<{ queued: number }>> {
  const doing = "import the chosen pages";
  const auth = await authorizeAction("contentDraft", doing);
  if (!auth.ok) return auth;
  const list = Array.isArray(urls) ? [...new Set(urls.filter((u): u is string => typeof u === "string").map((u) => u.trim()).filter(Boolean))] : [];
  if (list.length === 0) return { ok: false, error: `Could not ${doing} — tick at least one page.` };
  if (list.length > IMPORT_BATCH) return { ok: false, error: `Could not ${doing} — at most ${IMPORT_BATCH} pages go in one step (this was ${list.length}).` };
  const { data, error } = await auth.session.db.rpc("niva_import_pages", { p_center: auth.session.center.id, p_urls: list });
  if (error) return failure(`Could not ${doing}`, error);
  revalidatePath("/content/niva");
  return { ok: true, data: { queued: typeof data === "number" ? data : list.length } };
}

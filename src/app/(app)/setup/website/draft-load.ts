// Setup › Your website › the first draft: what the screens need from the database, in one place for the page, the preview and
// the actions. Reads go through app.site_draft_get (the draft, with or without its blocks) and app.site_draft_data (Weaver's own
// records); both check settings.manage themselves (migrations 0642, 0643). Every answer is parsed field by field, never trusted.

import { failure } from "@/lib/errors";
import { parseStoredDraft, summarizeDraft } from "@/lib/site-draft/parse";
import type { DraftSummary, StoredDraft } from "@/lib/site-draft/types";
import { parseWeaverData, type WeaverData } from "@/lib/site-draft/weaver";
import type { AppSupabase } from "@/lib/supabase/server";

export type LoadedDraft = { ok: true; draft: StoredDraft | null } | { ok: false; cause: unknown; error: string };

/** The stored draft (null when there is none yet). `withBlocks` false gives the pages and their counts only. */
export async function loadStoredDraft(db: AppSupabase, centerId: string, withBlocks: boolean, doing = "load the website draft"): Promise<LoadedDraft> {
  const res = await db.rpc("site_draft_get", { p_center: centerId, p_with_blocks: withBlocks });
  if (res.error) {
    const f = failure(`Could not ${doing}`, res.error);
    return { ok: false, cause: res.error, error: f.error };
  }
  if (res.data === null || res.data === undefined) return { ok: true, draft: null };
  const draft = parseStoredDraft(res.data);
  if (!draft) {
    console.error("[setup/website] site_draft_get returned an unexpected shape:", res.data);
    const error = `Could not ${doing} — the database answered in a shape this screen does not understand (has the latest migration been applied?).`;
    return { ok: false, cause: new Error(error), error };
  }
  return { ok: true, draft };
}

export type LoadedSummary = { ok: true; summary: DraftSummary | null } | { ok: false; cause: unknown; error: string };

/** One line per page for the Setup screen, or null when there is no draft. */
export async function loadDraftSummary(db: AppSupabase, centerId: string, doing = "load the website draft"): Promise<LoadedSummary> {
  const loaded = await loadStoredDraft(db, centerId, false, doing);
  if (!loaded.ok) return loaded;
  return { ok: true, summary: loaded.draft ? summarizeDraft(loaded.draft) : null };
}

export type LoadedWeaver = { ok: true; data: WeaverData } | { ok: false; error: string };

/** Weaver's own public-facing records of the organization (0643). */
export async function loadWeaverData(db: AppSupabase, centerId: string, doing: string): Promise<LoadedWeaver> {
  const res = await db.rpc("site_draft_data", { p_center: centerId });
  if (res.error) return failure(`Could not ${doing}`, res.error);
  const data = parseWeaverData(res.data);
  if (!data) {
    console.error("[setup/website] site_draft_data returned an unexpected shape:", res.data);
    return { ok: false, error: `Could not ${doing} — the database answered in a shape this screen does not understand (has the latest migration been applied?).` };
  }
  return { ok: true, data };
}

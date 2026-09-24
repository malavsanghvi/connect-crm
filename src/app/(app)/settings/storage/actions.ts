"use server";

import { revalidatePath } from "next/cache";

import { expectedVersion, writeCenterRules } from "@/lib/data/center-rules-write";
import type { ActionResult } from "@/lib/errors";
import { authorizeAction } from "@/lib/session";
import { parseRetentionDays } from "@/lib/setup";

/**
 * Settings › Storage: how long uploaded import files and Gyan Path recordings are kept
 * (centers.rules.storage.retention_days.<bucket>, read by app.storage_retention_days and
 * the worker's daily storage.retention job). The other areas' retention is fixed.
 */
export async function saveRetentionAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const bucket = String(fd.get("bucket") ?? "");
  const what = bucket === "imports" ? "the retention of import files" : bucket === "recordings" ? "the retention of recordings" : "the retention";
  const doing = `save ${what}`;
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  if (bucket !== "imports" && bucket !== "recordings") return { ok: false, error: `Could not ${doing} — only imports and recordings can be changed. Reload and try again.` };
  const expected = expectedVersion(fd.get("version"));
  if (expected === "invalid") return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };
  const days = parseRetentionDays(typeof fd.get("days") === "string" ? String(fd.get("days")) : null);
  if (!days.ok) return { ok: false, error: `Could not ${doing} — ${days.error}` };
  const result = await writeCenterRules(
    auth.session,
    { mode: "patch", rules: { storage: { retention_days: { [bucket]: days.value } } } },
    expected,
    what,
    (v) => `${bucket === "imports" ? "Import files" : "Recordings"} are kept ${days.value} days · rules version ${v} · audit logged`,
  );
  if (result.ok) {
    revalidatePath("/settings/storage");
    revalidatePath("/setup");
  }
  return result;
}

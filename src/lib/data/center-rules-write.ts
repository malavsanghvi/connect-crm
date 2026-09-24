import "server-only";

import { revalidatePath } from "next/cache";

import { validateRulesJson } from "@/lib/center-rules";
import { failure, type ActionResult } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";
import { applyRulesPatch, rulesVersion, type RulesObject } from "@/lib/settings-rules";

/** The version the form was opened on ("" = the rules were never versioned). */
export function expectedVersion(raw: FormDataEntryValue | null): number | null | "invalid" {
  const v = String(raw ?? "").trim();
  if (v === "") return null;
  return /^\d+$/.test(v) ? Number(v) : "invalid";
}

/**
 * Write rules to centers.rules for the signed-in center, versioned and
 * guarded: the save goes through only when the rules are still on the
 * version the form was opened on, so two admins never silently overwrite
 * each other. `mode: "patch"` merges the given keys; `mode: "replace"`
 * swaps the whole bag (the Advanced JSON editor). Every save bumps
 * rules.version. The centers audit trigger records the before/after.
 */
export async function writeCenterRules(
  session: CrmSession,
  change: { mode: "patch" | "replace"; rules: RulesObject },
  expected: number | null,
  what: string,
  successMessage: (version: number) => string,
): Promise<ActionResult> {
  const { db, center } = session;
  const current = await db.from("centers").select("rules").eq("id", center.id).maybeSingle();
  if (current.error) return failure(`Could not save the ${what}`, current.error);
  if (!current.data) return { ok: false, error: `Could not save the ${what} — the center could not be read (you may lack settings.manage).` };

  const nowVersion = rulesVersion(current.data.rules);
  if (nowVersion !== expected) {
    return {
      ok: false,
      error: `Could not save the ${what} — someone else saved the rules (now version ${nowVersion ?? 0}) after you opened this page. Reload to see their changes, then save again.`,
    };
  }

  const next =
    change.mode === "patch"
      ? applyRulesPatch(current.data.rules, change.rules)
      : { rules: { ...change.rules, version: (nowVersion ?? 0) + 1 }, version: (nowVersion ?? 0) + 1 };
  const checked = validateRulesJson(JSON.stringify(next.rules));
  if (!checked.ok) return { ok: false, error: `Could not save the ${what} — ${checked.errors.join(" ")}` };

  let update = db.from("centers").update({ rules: checked.value }).eq("id", center.id);
  update = nowVersion === null ? update.is("rules->>version", null) : update.eq("rules->>version", String(nowVersion));
  const { data, error } = await update.select("id");
  if (error) return failure(`Could not save the ${what}`, error);
  if (!data || data.length === 0) {
    const again = await db.from("centers").select("rules").eq("id", center.id).maybeSingle();
    if (again.error) console.error("[settings] re-reading the rules after a refused save failed:", again.error);
    const changed = !again.error && again.data && rulesVersion(again.data.rules) !== nowVersion;
    return {
      ok: false,
      error: changed
        ? `Could not save the ${what} — someone else saved the rules at the same moment. Reload to see their changes, then save again.`
        : `Could not save the ${what} — no change was saved (you may lack settings.manage).`,
    };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: successMessage(next.version) };
}

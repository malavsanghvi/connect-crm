"use server";

import { revalidatePath } from "next/cache";

import { isPlainObject, validateFlags, validateRulesJson } from "@/lib/center-rules";
import { expectedVersion, writeCenterRules } from "@/lib/data/center-rules-write";
import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction } from "@/lib/session";
import { isRulesSection, parseSection, SECTION_LABEL, type RulesSection } from "@/lib/settings-rules";

const TOAST: Partial<Record<RulesSection, string>> = {
  onboarding: "Onboarding fields · saved and audited",
  notifications: "Notification rules · saved and audited",
  security: "Security settings · saved and audited",
};

/** One Settings form (Rules blocks, Onboarding fields, Notifications, Security) → the keys it edits in centers.rules. */
export async function saveRulesSectionAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const section = formData.get("section");
  const what = isRulesSection(section) ? SECTION_LABEL[section] : "settings";
  const auth = await authorizeAction("centerSettings", `save the ${what}`);
  if (!auth.ok) return auth;
  if (!isRulesSection(section)) return { ok: false, error: "Could not save — the form did not say which settings it holds. Reload the page and try again." };
  const expected = expectedVersion(formData.get("version"));
  if (expected === "invalid") return { ok: false, error: `Could not save the ${what} — the page is out of date. Reload and try again.` };

  const parsed = parseSection(section, (name) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : null;
  });
  if (!parsed.ok) return { ok: false, error: `Could not save the ${what} — ${parsed.error}` };

  return writeCenterRules(auth.session, { mode: "patch", rules: parsed.patch }, expected, what, (v) =>
    TOAST[section] ? `${TOAST[section]} · version ${v}` : `Rules saved · version ${v}`,
  );
}

/** Advanced: replace the whole rule bag from the JSON editor (same checks, same version guard). */
export async function saveRulesJsonAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "save the rules");
  if (!auth.ok) return auth;
  const expected = expectedVersion(formData.get("version"));
  if (expected === "invalid") return { ok: false, error: "Could not save the rules — the page is out of date. Reload and try again." };
  const rules = validateRulesJson(String(formData.get("rules") ?? ""));
  if (!rules.ok) return { ok: false, error: `Could not save the rules — ${rules.errors.join(" ")}` };
  const { version: _ignored, ...rest } = rules.value;
  void _ignored;
  return writeCenterRules(auth.session, { mode: "replace", rules: rest }, expected, "rules", (v) => `Rules saved · version ${v}`);
}

function parseObject(text: string, what: string): { ok: true; value: { [k: string]: Json | undefined } } | { ok: false; error: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (!isPlainObject(v)) return { ok: false, error: `${what} must be a JSON object.` };
    return { ok: true, value: v };
  } catch (e) {
    console.error(`[settings] ${what} was not valid JSON:`, e);
    return { ok: false, error: `${what} is not valid JSON.` };
  }
}

const COLOR = /^#[0-9a-f]{6}$/i;

/** Branding (colours, fonts, logo) and feature flags — the center's look and switched-on modules. */
export async function saveBrandingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "save the branding and features");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;

  const branding = parseObject(String(formData.get("branding") ?? "{}"), "Branding");
  if (!branding.ok) return { ok: false, error: `Could not save — ${branding.error}` };
  for (const key of ["primary", "accent", "background"]) {
    const v = branding.value[key];
    if (v !== undefined && v !== null && v !== "" && (typeof v !== "string" || !COLOR.test(v))) {
      return { ok: false, error: `Could not save — the ${key} colour must look like #1B2C5C.` };
    }
  }
  const logo = branding.value.logo_url;
  if (typeof logo === "string" && logo && !/^https:\/\//i.test(logo)) {
    return { ok: false, error: "Could not save — the logo address must start with https://." };
  }

  const flags = parseObject(String(formData.get("feature_flags") ?? "{}"), "Feature flags");
  if (!flags.ok) return { ok: false, error: `Could not save — ${flags.error}` };
  const flagErrors = validateFlags(flags.value);
  if (flagErrors.length > 0) return { ok: false, error: `Could not save — ${flagErrors.join(" ")}` };

  const { data, error } = await db
    .from("centers")
    .update({ branding: branding.value, feature_flags: flags.value })
    .eq("id", center.id)
    .select("id");
  if (error) return failure("Could not save the branding and features", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not save the branding and features — no change was saved (you may lack settings.manage)." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Branding and features · saved and audited. The member and admin apps pick them up on their next load." };
}

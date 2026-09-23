"use server";

import { revalidatePath } from "next/cache";

import { isPlainObject, validateFlags, validateRulesJson } from "@/lib/center-rules";
import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction } from "@/lib/session";

function parseObject(text: string, what: string): { ok: true; value: { [k: string]: Json | undefined } } | { ok: false; error: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (!isPlainObject(v)) return { ok: false, error: `${what} must be a JSON object.` };
    return { ok: true, value: v };
  } catch {
    return { ok: false, error: `${what} is not valid JSON.` };
  }
}

const COLOR = /^#[0-9a-f]{6}$/i;

export async function saveCenterSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "save the center settings");
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

  const rules = validateRulesJson(String(formData.get("rules") ?? ""));
  if (!rules.ok) return { ok: false, error: `Could not save the rules — ${rules.errors.join(" ")}` };

  const { data, error } = await db
    .from("centers")
    .update({ branding: branding.value, feature_flags: flags.value, rules: rules.value })
    .eq("id", center.id)
    .select("id");
  if (error) return failure("Could not save the center settings", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not save the center settings — no change was saved (you may lack settings.manage)." };
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved. The member and admin apps pick up the new settings on their next load." };
}

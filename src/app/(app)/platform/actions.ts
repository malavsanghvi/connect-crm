"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseWizardStep, WIZARD_STEP_COUNT } from "@/lib/center-wizard";
import type { Json } from "@/lib/database.types";
import { failure, type ActionResult } from "@/lib/errors";
import { loadExperiences } from "@/lib/experiences-db";
import { isUuid } from "@/lib/search-params";
import { loadSession, type CrmSession } from "@/lib/session";
import { applyRulesPatch } from "@/lib/settings-rules";

async function platformSession(doing: string): Promise<{ ok: true; session: CrmSession } | { ok: false; error: string }> {
  const state = await loadSession();
  if (state.status === "signed_out") return { ok: false, error: `Could not ${doing} — your session has expired. Sign in again.` };
  if (state.status !== "ok") return { ok: false, error: `Could not ${doing} — the app could not load your session. Reload and try again.` };
  if (!state.session.isPlatformAdmin) return { ok: false, error: `Could not ${doing} — only platform admins can onboard centers.` };
  return { ok: true, session: state.session };
}

/**
 * Save one step of the new-center wizard. Step 1 creates the center (status
 * "onboarding") the first time; later steps update it. Each save records the
 * next step in rules.onboarding.wizard_step so the Centers list can show
 * "Onboarding · step N of 6". The centers audit trigger records every write.
 */
export async function saveWizardStepAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const step = Number(formData.get("step"));
  const auth = await platformSession("save this step");
  if (!auth.ok) return auth;
  const { db } = auth.session;
  if (!Number.isInteger(step) || step < 1 || step > WIZARD_STEP_COUNT) return { ok: false, error: "Could not save — unknown wizard step. Reload and try again." };
  const centerId = String(formData.get("center") ?? "");
  if (centerId && !isUuid(centerId)) return { ok: false, error: "Could not save — the center in the address is not valid. Start again from step 1." };
  if (!centerId && step !== 1) return { ok: false, error: "Could not save — start with step 1, where the center is created." };

  let current: { id: string; rules: Json; status: string; category_key: string } | null = null;
  if (centerId) {
    const res = await db.from("centers").select("id, rules, status, category_key").eq("id", centerId).maybeSingle();
    if (res.error) return failure("Could not save this step", res.error);
    if (!res.data) return { ok: false, error: "Could not save — that center was not found." };
    if (res.data.status !== "onboarding") return { ok: false, error: "Could not save — this center is no longer onboarding, so the wizard cannot change it." };
    current = res.data;
  }

  // The kind of organization is chosen when the center is created (step 1) and then fixed: the database refuses a
  // plain update of it. Step 2 asks for a tradition only when the kind keeps one.
  const kinds = step === 1 || step === 2 ? await loadExperiences(db) : null;
  if (kinds && kinds.status !== "ok") return { ok: false, error: "Could not save this step — the kinds of organization could not be loaded. Reload and try again." };
  const kindList = kinds?.status === "ok" ? kinds.experiences : [];
  const creating = step === 1 && !current;
  const parsed = parseWizardStep(
    step,
    (n) => {
      const v = formData.get(n);
      return typeof v === "string" ? v : null;
    },
    { kindRequired: creating, traditionNeeded: step === 2 ? kindList.find((k) => k.key === current?.category_key)?.usesTradition !== false : true },
  );
  if (!parsed.ok) return { ok: false, error: `Could not save this step — ${parsed.error}` };
  if (creating) {
    // This wizard creates a production organization, so the kind must be one that is switched on for live ones.
    const kind = kindList.find((k) => k.key === parsed.change.columns.category_key);
    if (!kind) return { ok: false, error: "Could not save this step — choose the kind of organization from the list." };
    if (!kind.active) {
      return {
        ok: false,
        error: `Could not save this step — ${kind.label} is not switched on for live organizations yet. Create a sandbox for it (Platform › New sandbox) to preview it.`,
      };
    }
  } else if (parsed.change.columns.category_key !== undefined) {
    // Never written after creation (changing it needs a reason and a fresh 2FA check, on the organization's own page).
    delete parsed.change.columns.category_key;
  }

  const nextStep = Math.min(step + 1, WIZARD_STEP_COUNT);
  const { rules } = applyRulesPatch(current?.rules ?? {}, { ...parsed.change.rules, onboarding: { ...(parsed.change.rules.onboarding as object | undefined), wizard_step: nextStep } });

  let id = centerId;
  if (!current) {
    const { data, error } = await db
      .from("centers")
      .insert({ ...parsed.change.columns, name: parsed.change.columns.name!, slug: parsed.change.columns.slug!, status: "onboarding", rules })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { ok: false, error: "Could not create the center — another center already uses that public URL. Choose a different one." };
      return failure("Could not create the center", error);
    }
    id = data.id;
  } else {
    const { data, error } = await db
      .from("centers")
      .update({ ...parsed.change.columns, rules })
      .eq("id", centerId)
      .eq("status", "onboarding")
      .select("id");
    if (error) {
      if (error.code === "23505") return { ok: false, error: "Could not save — another center already uses that public URL. Choose a different one." };
      return failure("Could not save this step", error);
    }
    if (!data || data.length === 0) return { ok: false, error: "Could not save this step — the center changed meanwhile. Reload and try again." };
  }
  revalidatePath("/platform");
  redirect(`/platform/new?center=${id}&step=${nextStep}&saved=${step}`);
}

/** Last step: mark the center Live. The go-live checks are the platform team's to confirm; the app does not verify them. */
export async function goLiveAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await platformSession("take the center live");
  if (!auth.ok) return auth;
  const centerId = String(formData.get("center") ?? "");
  if (!isUuid(centerId)) return { ok: false, error: "Could not take the center live — start from step 1 so the center exists first." };
  const { data, error } = await auth.session.db.from("centers").update({ status: "active" }).eq("id", centerId).eq("status", "onboarding").select("id, name");
  if (error) return failure("Could not take the center live", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not take the center live — it is not onboarding any more (already live, suspended or removed)." };
  revalidatePath("/platform");
  return { ok: true, message: `${data[0].name} is live` };
}

"use server";

import { revalidatePath } from "next/cache";

import { PLAN_GROUPS, checkPlan, parsePlan, parsePlanContext, skeletonPlan, toPayload, type PlanInput } from "@/lib/care/plan";
import { STEP_KINDS } from "@/lib/care/playbooks";
import { authorizeCare, careDbFailure, notUnderstood } from "@/lib/care/server";
import type { Json } from "@/lib/database.types";

// The care plan from the mission and Niva's tick (DonorDelight slice 8, connect-crm 0896). Only someone who manages DonorDelight drafts, edits and approves
// a plan, or ticks Niva (care.manage); the database is the real gate (app.care_can: no platform-admin branch). The shape and the words are checked here with
// the same rules as the database (a plan is never paired with an ask), then the database function runs AS THE SIGNED-IN PERSON. Nothing in a plan runs by
// itself, and an edit returns an approved plan to draft. Every one answers { ok, error } in plain words. Not recorded in the activity stream (W2).

export type PlanSave = { ok: true; message: string } | { ok: false; error: string };

const yearOk = (y: unknown): y is number => Number.isInteger(y) && (y as number) >= 2000 && (y as number) <= 2100;

function refresh(year: number): void {
  revalidatePath("/care/plan");
  revalidatePath(`/care/plan?year=${year}`);
}

/** Draft the year from the organization's mission, calendar, fiscal year and quiet periods. Refuses to replace a plan that has moments unless asked. */
export async function draftPlanAction(call: { year: number; replace?: boolean }): Promise<PlanSave> {
  const doing = "draft the plan";
  if (!call || !yearOk(call.year)) return notUnderstood(doing);
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const existing = await db.rpc("care_plan_get", { p_center: center.id, p_year: call.year });
  if (existing.error) return careDbFailure(doing, existing.error, "care plan");
  if (parsePlan(existing.data).items.length > 0 && call.replace !== true) {
    return { ok: false, error: `Could not ${doing} — there is already a plan for ${call.year}. Starting again replaces its moments, so say so. Nothing was changed.` };
  }
  const ctx = await db.rpc("care_plan_context", { p_center: center.id, p_year: call.year });
  if (ctx.error) return careDbFailure(doing, ctx.error, "care plan");
  const draft = skeletonPlan(parsePlanContext(ctx.data), call.year);
  const checked = checkPlan(call.year, draft);
  if (!checked.ok) return { ok: false, error: `Could not ${doing} — ${checked.error} Nothing was changed.` };
  const saved = await db.rpc("save_care_plan", { p_center: center.id, p_year: call.year, p_plan: toPayload(draft) as Json });
  if (saved.error) return careDbFailure(doing, saved.error, "care plan");
  refresh(call.year);
  return { ok: true, message: `Drafted ${draft.items.length} moments. Read them, change what you like, then approve the plan.` };
}

function looksLikePlan(p: unknown): p is PlanInput {
  if (!p || typeof p !== "object") return false;
  const x = p as Partial<PlanInput>;
  return (
    typeof x.summary === "string" &&
    Array.isArray(x.items) &&
    x.items.every(
      (i) =>
        i &&
        typeof i.on === "string" &&
        typeof i.title === "string" &&
        typeof i.note === "string" &&
        (PLAN_GROUPS as readonly string[]).includes(i.group) &&
        (STEP_KINDS as readonly string[]).includes(i.kind) &&
        (i.id === undefined || i.id === null || (typeof i.id === "string" && /^[a-z0-9]{6,36}$/.test(i.id))),
    )
  );
}

/** Save the edited plan as a draft (an approved plan goes back to draft until it is approved again). */
export async function savePlanAction(call: { year: number; plan: PlanInput }): Promise<PlanSave> {
  const doing = "save the plan";
  if (!call || !yearOk(call.year) || !looksLikePlan(call.plan)) return notUnderstood(doing);
  const checked = checkPlan(call.year, call.plan);
  if (!checked.ok) return { ok: false, error: `Could not ${doing} — ${checked.error} Nothing was changed.` };
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_plan", { p_center: auth.session.center.id, p_year: call.year, p_plan: toPayload(call.plan) as Json });
  if (res.error) return careDbFailure(doing, res.error, "care plan");
  refresh(call.year);
  return { ok: true, message: "Saved as a draft. Approve it when it is ready." };
}

export async function approvePlanAction(call: { year: number }): Promise<PlanSave> {
  const doing = "approve the plan";
  if (!call || !yearOk(call.year)) return notUnderstood(doing);
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("approve_care_plan", { p_center: auth.session.center.id, p_year: call.year });
  if (res.error) return careDbFailure(doing, res.error, "care plan");
  refresh(call.year);
  return { ok: true, message: "Approved." };
}

/** The organization's own tick: Niva may help with relationship care (it also needs iWeaver). */
export async function setNivaAction(call: { enabled: boolean }): Promise<PlanSave> {
  const doing = call?.enabled ? "let Niva help with relationship care" : "stop Niva helping with relationship care";
  if (!call || typeof call.enabled !== "boolean") return notUnderstood(doing);
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_niva", { p_center: auth.session.center.id, p_enabled: call.enabled });
  if (res.error) return careDbFailure(doing, res.error, "care niva");
  revalidatePath("/care/playbooks");
  return { ok: true, message: call.enabled ? "Niva may now help with relationship care." : "Niva no longer helps with relationship care." };
}

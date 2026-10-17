"use server";

import { revalidatePath } from "next/cache";

import { checkPlaybook, toPayload, TRIGGERS, STEP_KINDS, STEP_CHANNELS, type PlaybookInput } from "@/lib/care/playbooks";
import { authorizeCare, careDbFailure, notUnderstood } from "@/lib/care/server";
import type { Json } from "@/lib/database.types";
import { isUuid } from "@/lib/search-params";

// Playbooks and the weekly reminder (DonorDelight slice 5, connect-crm 0891 and 0893). Only someone who manages DonorDelight changes them
// (care.manage); the database is the real gate (app.care_can: no platform-admin branch). The SHAPE is checked here with the same rules and
// words as the database (checkPlaybook), then the database function runs AS THE SIGNED-IN PERSON. Every one answers { ok, error } in plain
// words and never says it worked when it did not. Not recorded in the activity stream (W2).

export type PlaybookSave = { ok: true; message: string } | { ok: false; error: string };

function refresh(): void {
  revalidatePath("/care/playbooks");
  revalidatePath("/care/week");
}

/** Copy the starter playbooks for this kind of organization that the community does not have yet. */
export async function installStartersAction(): Promise<PlaybookSave> {
  const doing = "add the starter playbooks";
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("install_care_starters", { p_center: auth.session.center.id });
  if (res.error) return careDbFailure(doing, res.error, "care playbooks");
  refresh();
  const n = Number(res.data) || 0;
  return { ok: true, message: n === 0 ? "You already have every starter playbook." : `Added ${n} starter ${n === 1 ? "playbook" : "playbooks"}.` };
}

function looksLikeInput(p: unknown): p is PlaybookInput {
  if (!p || typeof p !== "object") return false;
  const x = p as Partial<PlaybookInput>;
  return (
    typeof x.name === "string" &&
    typeof x.summary === "string" &&
    typeof x.trigger === "string" &&
    (TRIGGERS as readonly string[]).includes(x.trigger) &&
    Number.isInteger(x.windowDays) &&
    Number.isInteger(x.cooldownDays) &&
    typeof x.enabled === "boolean" &&
    Array.isArray(x.steps) &&
    x.steps.every(
      (s) =>
        s &&
        typeof s.title === "string" &&
        typeof s.why === "string" &&
        typeof s.draft === "string" &&
        Number.isInteger(s.afterDays) &&
        (STEP_KINDS as readonly string[]).includes(s.kind) &&
        (s.channel === null || (STEP_CHANNELS as readonly string[]).includes(s.channel as string)) &&
        (s.id === undefined || s.id === null || isUuid(s.id)),
    )
  );
}

/** Create or change one playbook (with its steps). */
export async function savePlaybookAction(input: PlaybookInput): Promise<PlaybookSave> {
  const doing = "save the playbook";
  if (!looksLikeInput(input) || (input.id !== undefined && input.id !== null && !isUuid(input.id))) return notUnderstood(doing);
  const checked = checkPlaybook(input);
  if (!checked.ok) return { ok: false, error: `Could not ${doing} — ${checked.error} Nothing was changed.` };
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_playbook", { p_center: auth.session.center.id, p_playbook: toPayload(input) as Json });
  if (res.error) return careDbFailure(doing, res.error, "care playbooks");
  refresh();
  return { ok: true, message: "Saved." };
}

/** Pause or resume one playbook. Nothing is deleted; a paused playbook offers no new task. */
export async function setPlaybookEnabledAction(call: { id: string; enabled: boolean }): Promise<PlaybookSave> {
  const doing = call?.enabled ? "resume the playbook" : "pause the playbook";
  if (!call || !isUuid(call.id) || typeof call.enabled !== "boolean") return notUnderstood(doing);
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("set_care_playbook_enabled", { p_playbook: call.id, p_enabled: call.enabled });
  if (res.error) return careDbFailure(doing, res.error, "care playbooks");
  refresh();
  return { ok: true, message: call.enabled ? "Resumed." : "Paused." };
}

/** The weekly "N care tasks" reminder to relationship owners: on or off, and the weekday. */
export async function saveWeekSettingsAction(call: { notify: boolean; dow: number }): Promise<PlaybookSave> {
  const doing = "save the weekly reminder";
  if (!call || typeof call.notify !== "boolean" || !Number.isInteger(call.dow) || call.dow < 0 || call.dow > 6) return notUnderstood(doing);
  const auth = await authorizeCare(doing, "manage");
  if (!auth.ok) return auth;
  const res = await auth.session.db.rpc("save_care_week_settings", { p_center: auth.session.center.id, p_notify: call.notify, p_dow: call.dow });
  if (res.error) return careDbFailure(doing, res.error, "care playbooks");
  refresh();
  return { ok: true, message: call.notify ? "Saved. Relationship owners will get the reminder." : "Saved. The weekly reminder is off." };
}

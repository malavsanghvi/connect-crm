"use server";

import { revalidatePath } from "next/cache";

import { confirmMatches } from "@/lib/demo";
import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction, dbWithReason } from "@/lib/session";

// Setup › Demo data (o-demo). The database refuses anything outside an open
// sandbox ("Demo data is only for sandboxes."), checks the permission, the
// typed short name and — for deleting — a fresh 2FA check (CCSTP: the form
// opens the step-up window and sends again). These checks only give a
// faster, plainer answer before the round trip.

const PACK = /^[a-z][a-z0-9_]{1,40}$/;

function readReason(fd: FormData): string {
  return String(fd.get("reason") ?? "").trim();
}

function refresh() {
  revalidatePath("/setup/demo");
  revalidatePath("/setup");
}

export async function activateDemoAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const doing = "load the demo pack";
  const auth = await authorizeAction("setup", doing);
  if (!auth.ok) return auth;
  const pack = String(fd.get("pack") ?? "");
  const reason = readReason(fd);
  if (!PACK.test(pack)) return { ok: false, error: `Could not ${doing} — choose a pack from the list.` };
  if (!reason) return { ok: false, error: `Could not ${doing} — give a reason (it goes in the audit log).` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = await dbWithReason(auth.session, reason);
  const { error } = await db.rpc("activate_demo_pack", { p_center: auth.session.center.id, p_pack: pack, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return { ok: true, message: "Loading the demo pack · the background service loads it step by step; this page shows the progress" };
}

async function clearOrReset(fd: FormData, op: "reset" | "clear"): Promise<ActionResult> {
  const doing = op === "reset" ? "reset the sandbox" : "clear the sandbox";
  const auth = await authorizeAction("setup", doing);
  if (!auth.ok) return auth;
  const { center } = auth.session;
  const word = (center.short_name ?? "").trim() || center.slug;
  const confirm = String(fd.get("confirm") ?? "");
  const reason = readReason(fd);
  const pack = String(fd.get("pack") ?? "");
  if (op === "reset" && !PACK.test(pack)) return { ok: false, error: `Could not ${doing} — choose a pack from the list.` };
  if (!confirmMatches(confirm, word)) return { ok: false, error: `Could not ${doing} — type ${word} to confirm. Nothing was changed.` };
  if (!reason) return { ok: false, error: `Could not ${doing} — give a reason (it goes in the audit log).` };
  if (reason.length > 500) return { ok: false, error: `Could not ${doing} — keep the reason under 500 characters.` };
  const db = await dbWithReason(auth.session, reason);
  const { error } =
    op === "reset"
      ? await db.rpc("reset_sandbox", { p_center: center.id, p_pack: pack, p_confirm: confirm, p_reason: reason })
      : await db.rpc("clear_sandbox", { p_center: center.id, p_confirm: confirm, p_reason: reason });
  if (error) return failure(`Could not ${doing}`, error);
  refresh();
  return {
    ok: true,
    message:
      op === "reset"
        ? "Resetting the sandbox · the background service clears it, then loads the demo pack again"
        : "Clearing the sandbox · the background service removes the records; your team, connections and agreements stay",
  };
}

export async function resetSandboxAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return clearOrReset(fd, "reset");
}

export async function clearSandboxAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return clearOrReset(fd, "clear");
}

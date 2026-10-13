"use server";

import { revalidatePath } from "next/cache";

import { runScreenCommand } from "@/lib/commands/screen";
import { failure, type ActionResult } from "@/lib/errors";
import { isModuleKey, moduleDef } from "@/lib/modules";
import { authorizeAction, dbWithReason } from "@/lib/session";

// Settings › Marketplace (connect-crm 0753). Requests and "tell me when it is ready" are the community's settings managers'
// (app.marketplace_request / marketplace_request_cancel / marketplace_notify_me check settings.manage themselves); pausing and
// resuming is the community's own module switch, the `settings.set_module` command that Settings › Modules runs too
// (app.set_module_enabled, a fresh 2FA check: the screen asks for the code and retries). Every failure says what failed.

const KEY = /^[a-z][a-z0-9_]{1,39}$/;

function done(): void {
  revalidatePath("/settings/marketplace");
}

/** Ask Weaver for a product, with a note on what it is for. The note is kept on the screen if this fails. */
export async function requestProductAction(product: string, name: string, noteInput: string): Promise<ActionResult> {
  const doing = "send the request";
  if (!KEY.test(product)) return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };
  const note = String(noteInput ?? "").trim();
  if (!note) return { ok: false, error: `Could not ${doing} — say what your community will use ${name} for. A sentence is enough.` };
  if (note.length > 500) return { ok: false, error: `Could not ${doing} — keep the note under 500 characters.` };
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  const db = await dbWithReason(session, `Requested ${name}: ${note}`);
  const { error } = await db.rpc("marketplace_request", { p_center: session.center.id, p_product: product, p_note: note });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: `${name} requested. Weaver checks the request and turns it on.` };
}

export async function cancelRequestAction(product: string, name: string): Promise<ActionResult> {
  const doing = "cancel the request";
  if (!KEY.test(product)) return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  const db = await dbWithReason(session, `Request for ${name} cancelled`);
  const { error } = await db.rpc("marketplace_request_cancel", { p_center: session.center.id, p_product: product });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: `The request for ${name} is cancelled.` };
}

export async function notifyMeAction(product: string, name: string): Promise<ActionResult> {
  const doing = "ask to be told when it is ready";
  if (!KEY.test(product)) return { ok: false, error: `Could not ${doing} — the page is out of date. Reload and try again.` };
  const auth = await authorizeAction("centerSettings", doing);
  if (!auth.ok) return auth;
  const { session } = auth;
  const db = await dbWithReason(session, `Asked to be told when ${name} is ready`);
  const { error } = await db.rpc("marketplace_notify_me", { p_center: session.center.id, p_product: product });
  if (error) return failure(`Could not ${doing}`, error);
  done();
  return { ok: true, message: `We will tell your admins when ${name} is ready.` };
}

/**
 * Pause or resume a product: the community's own switch for its module (the same command as Settings › Modules, with a reason
 * that says where it came from). Pausing hides it for everyone in the community; nothing is deleted.
 */
export async function pauseProductAction(moduleKey: string, name: string, pause: boolean): Promise<ActionResult> {
  const verb = pause ? "pause" : "resume";
  if (!isModuleKey(moduleKey)) return { ok: false, error: `Could not ${verb} ${name} — the page is out of date. Reload and try again.` };
  const res = await runScreenCommand(
    "settings.set_module",
    { module: moduleKey, enabled: !pause, reason: pause ? "Paused in Settings › Marketplace" : "Resumed in Settings › Marketplace" },
    `${verb} ${name || moduleDef(moduleKey).label}`,
  );
  if (!res.ok) return res;
  done();
  return { ok: true, message: pause ? `${name} is paused. Nothing is deleted; resume it at any time.` : `${name} is on again.` };
}

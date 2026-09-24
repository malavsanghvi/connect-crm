"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { loadSession } from "@/lib/session";

// Settings › Agreements (stream o-security). The owner accepts Community
// Connect's agreements (app.accept_org_agreement records who, which version,
// when, IP and browser); platform admins publish the texts.

export async function acceptAgreementAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: "Could not accept the agreement — your session has expired. Sign in again." };
  const { db, center } = state.session;
  const id = String(formData.get("document_id") ?? "");
  const title = String(formData.get("title") ?? "the agreement");
  if (!isUuid(id)) return { ok: false, error: "Could not accept the agreement — it was not found. Reload the page." };
  if (formData.get("confirm") !== "on") {
    return { ok: false, error: `Could not accept ${title} — tick the box to confirm you have read it and accept it for ${center.name}.` };
  }
  const { error } = await db.rpc("accept_org_agreement", { p_center: center.id, p_document: id });
  if (error) return failure(`Could not accept ${title}`, error);
  revalidatePath("/settings/agreements");
  return { ok: true, message: `${title} accepted for ${center.name} · recorded with your name, the version, the time and your IP address` };
}

export async function publishPlatformDocumentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const state = await loadSession();
  if (state.status !== "ok") return { ok: false, error: "Could not publish — your session has expired. Sign in again." };
  if (!state.session.isPlatformAdmin) return { ok: false, error: "Could not publish — only the Community Connect team publishes platform agreements." };
  const id = String(formData.get("document_id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not publish — the document was not found." };
  const { error } = await state.session.db.rpc("publish_platform_document", { p_document: id });
  if (error) return failure("Could not publish the agreement", error);
  revalidatePath("/settings/agreements");
  return { ok: true, message: "Published · every organization's owner can now accept this version" };
}

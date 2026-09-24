"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { RECEIPT_KINDS, isReceiptKind } from "@/lib/giving";
import { authorizeAction } from "@/lib/session";

/** Save a receipt template (0022 receipt_templates: one per center and kind; audited). */
export async function saveReceiptTemplateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("receiptTemplates", "save the template");
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const kind = String(formData.get("kind") ?? "");
  const signedBy = String(formData.get("signed_by") ?? "").trim();
  const note = String(formData.get("personal_note") ?? "").trim();
  if (!isReceiptKind(kind)) return { ok: false, error: "Could not save the template — choose which template." };
  if (signedBy.length > 160 || note.length > 500) return { ok: false, error: "Could not save the template — the text is too long." };
  const { error } = await db
    .from("receipt_templates")
    .upsert({ center_id: center.id, kind, signed_by: signedBy || null, personal_note: note || null }, { onConflict: "center_id,kind" });
  if (error) return failure("Could not save the template", error);
  revalidatePath("/giving/statements");
  return { ok: true, message: `${RECEIPT_KINDS.find((k) => k.kind === kind)?.label} template saved · audit logged` };
}

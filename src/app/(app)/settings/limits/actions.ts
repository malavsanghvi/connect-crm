"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction, dbWithReason } from "@/lib/session";

const CHANNELS = new Set(["email", "sms", "whatsapp", "push"]);
const CHANNEL_LABEL: Record<string, string> = { email: "email", sms: "text", whatsapp: "WhatsApp", push: "push" };

/**
 * Add a test recipient (app.sandbox_test_recipients, settings.manage). The
 * database normalizes the address, allows 10 per community (CCENT) and keeps
 * it unverified: the sender service confirms it (a code sent to it) before a
 * sandbox may message it.
 */
export async function addTestRecipientAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const channel = String(formData.get("channel") ?? "");
  const address = String(formData.get("address") ?? "").trim();
  if (!CHANNELS.has(channel)) return { ok: false, error: "Could not add the test recipient — choose email, text, WhatsApp or push." };
  if (!address) return { ok: false, error: `Could not add the test recipient — enter the ${CHANNEL_LABEL[channel]} address.` };
  const auth = await authorizeAction("centerSettings", "add a test recipient");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, `Test recipient added (${CHANNEL_LABEL[channel]})`);
  const { error } = await db.from("sandbox_test_recipients").insert({ center_id: auth.session.center.id, channel, address });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Could not add the test recipient — that address is already on the list." };
    return failure("Could not add the test recipient", error);
  }
  revalidatePath("/settings/limits");
  return { ok: true, message: "Test recipient added · it can receive messages once it is verified" };
}

export async function removeTestRecipientAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const auth = await authorizeAction("centerSettings", "remove the test recipient");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, "Test recipient removed");
  const { data, error } = await db.from("sandbox_test_recipients").delete().eq("id", id).eq("center_id", auth.session.center.id).select("id");
  if (error) return failure("Could not remove the test recipient", error);
  if (!data || data.length === 0) return { ok: false, error: "Could not remove the test recipient — it was already removed. Reload to see the list." };
  revalidatePath("/settings/limits");
  return { ok: true, message: "Test recipient removed" };
}

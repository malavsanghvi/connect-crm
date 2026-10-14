import "server-only";

import { availableChannels, type ChannelFacts, type CommsChannel } from "@/lib/comms-templates";
import type { Tables } from "@/lib/database.types";
import type { DbErrorLike } from "@/lib/errors";
import { isModuleEnabled } from "@/lib/modules";
import type { CrmSession } from "@/lib/session";
import type { AppSupabase } from "@/lib/supabase/server";

/**
 * Which channels the community has set up, from Settings › Texting and › WhatsApp. When a read fails the unsure channels are left out
 * (text and WhatsApp get no action) and the error comes back so the page can say so: never a silent "not set up".
 */
export async function loadChannels(
  db: AppSupabase,
  session: Pick<CrmSession, "modulesOff" | "center">,
): Promise<{ facts: ChannelFacts; available: CommsChannel[]; error: DbErrorLike | null }> {
  const centerId = session.center.id;
  const [texting, whatsapp] = await Promise.all([
    db.from("texting_registrations").select("id", { count: "exact", head: true }).eq("center_id", centerId).eq("status", "approved"),
    db.from("whatsapp_accounts").select("status").eq("center_id", centerId).maybeSingle(),
  ]);
  const error = texting.error ?? whatsapp.error ?? null;
  if (error) console.error("[comms] could not read which channels are set up:", error);
  const facts: ChannelFacts = {
    textingApproved: !texting.error && (texting.count ?? 0) > 0,
    whatsappAccountApproved: !whatsapp.error && whatsapp.data?.status === "approved",
    whatsappProductOn: isModuleEnabled(session, "channels"),
  };
  return { facts, available: availableChannels(facts), error };
}

export type TemplateRecord = Tables<"comms_templates">;

/** The community's saved templates, newest change first (RLS: comms.send in the community). */
export async function loadTemplates(db: AppSupabase, centerId: string): Promise<{ data: TemplateRecord[]; error: DbErrorLike | null }> {
  const { data, error } = await db.from("comms_templates").select("*").eq("center_id", centerId).order("updated_at", { ascending: false }).limit(200);
  return { data: data ?? [], error };
}

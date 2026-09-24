// Audience JSON for comms campaigns (comms_campaigns.audience jsonb).
// The segment definition is resolved to recipients by the notification
// worker; this app only builds and describes it.

export type Audience =
  | { all_members: true }
  | { zone_ids: string[] }
  | { pathshala_class_ids: string[]; include: "parents" }
  | { event_id: string; rsvp_statuses: string[] }
  | Record<string, unknown>;

export type AudiencePreset = "all_members" | "zone" | "pathshala_class" | "event_rsvps" | "custom";

export function buildAudience(
  preset: AudiencePreset,
  input: { zoneIds?: string[]; classIds?: string[]; eventId?: string | null; rsvpStatuses?: string[]; customJson?: string },
): { ok: true; audience: Audience } | { ok: false; error: string } {
  switch (preset) {
    case "all_members":
      return { ok: true, audience: { all_members: true } };
    case "zone":
      if (!input.zoneIds?.length) return { ok: false, error: "Choose at least one zone." };
      return { ok: true, audience: { zone_ids: input.zoneIds } };
    case "pathshala_class":
      if (!input.classIds?.length) return { ok: false, error: "Choose at least one Pathshala class." };
      return { ok: true, audience: { pathshala_class_ids: input.classIds, include: "parents" } };
    case "event_rsvps":
      if (!input.eventId) return { ok: false, error: "Choose the event whose RSVPs should receive this." };
      return {
        ok: true,
        audience: { event_id: input.eventId, rsvp_statuses: input.rsvpStatuses?.length ? input.rsvpStatuses : ["rsvpd", "confirmed", "attended"] },
      };
    case "custom": {
      try {
        const parsed = JSON.parse(input.customJson ?? "");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return { ok: false, error: "The audience must be a JSON object, for example {\"zone_ids\": [\"…\"]}." };
        }
        return { ok: true, audience: parsed as Audience };
      } catch {
        return { ok: false, error: "The audience JSON could not be read. Check the brackets and quotes." };
      }
    }
  }
}

/** Sends to all members need a second approver (FEATURE_TRACEABILITY: Newsletters). */
export function requiresSecondApprover(audience: unknown): boolean {
  return Boolean(audience && typeof audience === "object" && (audience as Record<string, unknown>).all_members === true);
}

export function describeAudience(
  audience: unknown,
  names: { zones?: Map<string, string>; classes?: Map<string, string>; events?: Map<string, string> } = {},
): string {
  if (!audience || typeof audience !== "object") return "No audience";
  const a = audience as Record<string, unknown>;
  if (a.all_members === true) return "All members";
  const list = (ids: unknown, m?: Map<string, string>) =>
    Array.isArray(ids) ? ids.map((id) => m?.get(String(id)) ?? "Unknown").join(", ") : "";
  if (Array.isArray(a.zone_ids)) return `Zone: ${list(a.zone_ids, names.zones)}`;
  if (Array.isArray(a.pathshala_class_ids)) return `Pathshala parents: ${list(a.pathshala_class_ids, names.classes)}`;
  if (typeof a.event_id === "string") return `RSVPs for ${names.events?.get(a.event_id) ?? "an event"}`;
  return "Custom segment";
}

export function presetOf(audience: unknown): AudiencePreset {
  if (!audience || typeof audience !== "object") return "all_members";
  const a = audience as Record<string, unknown>;
  if (a.all_members === true) return "all_members";
  if (Array.isArray(a.zone_ids)) return "zone";
  if (Array.isArray(a.pathshala_class_ids)) return "pathshala_class";
  if (typeof a.event_id === "string") return "event_rsvps";
  return "custom";
}

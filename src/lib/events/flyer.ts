// Event flyers: the default AI prompt (pure, no server imports — an admin
// can edit it before generating) and the shared polling-state shape used by
// the flyer panel client component and its server actions. Mirrors the
// import module's AiState (src/app/(app)/settings/import/actions.ts).

export type FlyerSource = "manual" | "ai";

/** The events.flyer_source column, read defensively (it is a plain `text` column at the DB). */
export function readFlyerSource(v: string | null): FlyerSource | null {
  return v === "manual" || v === "ai" ? v : null;
}

export type FlyerPromptInput = {
  name: string;
  description: string;
  venue: string;
  /** Already formatted for display, e.g. "Sat, Nov 8, 2026, 6:00 PM" — this module does no date math. */
  startsAtText: string | null;
  audienceText: string;
  centerName: string;
};

const MAX_PROMPT_CHARS = 2000;

/** A reasonable starting prompt built from the event's own public fields; the admin can edit it before generating. */
export function buildFlyerPrompt(e: FlyerPromptInput): string {
  const parts = [
    `A clean, inviting event flyer for "${e.name || "an upcoming event"}"${e.centerName ? ` at ${e.centerName}` : ""}.`,
  ];
  if (e.startsAtText) parts.push(`Date and time: ${e.startsAtText}.`);
  if (e.venue) parts.push(`Venue: ${e.venue}.`);
  if (e.audienceText) parts.push(`Audience: ${e.audienceText}.`);
  const desc = e.description.trim();
  if (desc) parts.push(`About the event: ${desc.slice(0, 400)}`);
  parts.push("Portrait orientation, warm and welcoming, no illegible or garbled text baked into the image — the event details are added separately.");
  return parts.join(" ").slice(0, MAX_PROMPT_CHARS);
}

export type FlyerState =
  | { status: "unavailable"; reason: string }
  | { status: "queued" | "running"; jobId?: string }
  | { status: "done"; imageB64: string; model: string; prompt: string }
  | { status: "failed"; reason: string }
  | { status: "none" };

/** The RPC's jsonb answer (app.events_request_flyer / app.events_flyer_result), read defensively. */
export function readFlyerState(d: unknown): FlyerState {
  const o = (d ?? {}) as Record<string, unknown>;
  const status = typeof o.status === "string" ? o.status : "";
  if (status === "queued" || status === "running") return { status, jobId: typeof o.job_id === "string" ? o.job_id : undefined };
  if (status === "unavailable") return { status: "unavailable", reason: typeof o.reason === "string" ? o.reason : "The background service is not available." };
  if (status === "failed" || status === "cancelled") return { status: "failed", reason: typeof o.error === "string" && o.error ? o.error : "The flyer generation job failed." };
  if (status === "done") {
    const r = (o.result ?? {}) as Record<string, unknown>;
    const imageB64 = typeof r.image_b64 === "string" ? r.image_b64 : "";
    if (!imageB64) return { status: "failed", reason: "The background service finished but did not return an image." };
    return { status: "done", imageB64, model: typeof r.model === "string" ? r.model : "", prompt: typeof r.prompt === "string" ? r.prompt : "" };
  }
  return { status: "none" };
}

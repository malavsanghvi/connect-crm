// Changing an organization's kind (Platform › the organization › Kind of organization). The database does the
// work and the safety (app.category_change_preview, app.set_center_category: a platform admin, a reason, a fresh
// 2FA check, audited, the owner emailed). This file reads the preview it answers with so the portal can say, in
// plain English, what will be hidden and what becomes available BEFORE anyone confirms.
//
// Pure — unit-tested.

import type { Json } from "@/lib/database.types";

export type KindChangeLine = { module: string; label: string; text: string };

export type KindPreview = {
  centerName: string;
  from: { key: string; label: string };
  to: { key: string; label: string; active: boolean };
  changed: boolean;
  /** Modules that are on now and will not be (their records stay, hidden). */
  hidden: KindChangeLine[];
  /** Modules that become available or on. */
  available: KindChangeLine[];
  /** How many people's saved paths stay stored but are ignored. */
  pathsKept: number;
  /** The database's own sentences, in order: the whole preview as plain English. */
  summary: string[];
  /** Set after a change: what happened to the email to the owner. */
  emailStatus: string | null;
};

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function lines(v: unknown): KindChangeLine[] {
  if (!Array.isArray(v)) return [];
  const out: KindChangeLine[] = [];
  for (const raw of v) {
    const r = rec(raw);
    if (!r || typeof r.module !== "string") continue;
    out.push({ module: r.module, label: typeof r.label === "string" ? r.label : r.module, text: typeof r.text === "string" ? r.text : "" });
  }
  return out;
}

/** Reads what app.category_change_preview / app.set_center_category answer; null when it is not that shape. */
export function parseKindPreview(raw: Json | null | undefined): KindPreview | null {
  const r = rec(raw);
  const from = rec(r?.from);
  const to = rec(r?.to);
  if (!r || !from || !to || typeof from.key !== "string" || typeof to.key !== "string") return null;
  return {
    centerName: typeof r.center_name === "string" ? r.center_name : "",
    from: { key: from.key, label: typeof from.label === "string" ? from.label : from.key },
    to: { key: to.key, label: typeof to.label === "string" ? to.label : to.key, active: to.active === true },
    changed: r.changed === true,
    hidden: lines(r.hidden),
    available: lines(r.available),
    pathsKept: typeof r.paths_kept === "number" ? r.paths_kept : 0,
    summary: Array.isArray(r.summary) ? r.summary.filter((x): x is string => typeof x === "string") : [],
    emailStatus: typeof r.email_status === "string" ? r.email_status : null,
  };
}

/** What the owner is told by email, in the portal's words (status from app.message_status_text). */
export function ownerEmailText(status: string | null | undefined): { tone: "ok" | "warn"; text: string } {
  if (status === "queued") return { tone: "ok", text: "The owner was emailed." };
  if (status === "no_owner") return { tone: "warn", text: "This organization has no owner yet, so nobody was emailed." };
  return { tone: "warn", text: "The owner could not be emailed (email sending is not set up or failed). Tell them yourself." };
}

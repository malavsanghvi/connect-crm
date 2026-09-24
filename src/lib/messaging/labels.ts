// Plain-English labels and small helpers for the messaging Settings screens
// (Email, Texting, WhatsApp, Notifications). Pure; unit-tested.

export const SENDER_PURPOSES = [
  { key: "auth", label: "Sign-in codes", hint: "Sign-in and verification codes — needed for go-live readiness." },
  { key: "office", label: "Office", hint: "General email; also used when no other sender fits." },
  { key: "receipts", label: "Receipts", hint: "Donation receipts and statements." },
  { key: "newsletters", label: "Newsletters", hint: "Newsletters and announcements; they carry the unsubscribe link." },
] as const;

export type Tone = "ok" | "warn" | "bad";

export function domainStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "verified":
      return { label: "Verified", tone: "ok" };
    case "failed":
      return { label: "DNS check failing", tone: "bad" };
    default:
      return { label: "Waiting for DNS", tone: "warn" };
  }
}

export function recordStatus(status: string): { label: string; tone: Tone } {
  if (status === "verified") return { label: "Found", tone: "ok" };
  if (status === "recommended") return { label: "Recommended", tone: "warn" };
  if (status === "failed" || status === "temporary_failure") return { label: "Wrong value", tone: "bad" };
  return { label: "Not found yet", tone: "warn" };
}

export function messageStatus(status: string): { label: string; tone: Tone } {
  switch (status) {
    case "sent":
      return { label: "Sent", tone: "ok" };
    case "delivered":
      return { label: "Delivered", tone: "ok" };
    case "queued":
      return { label: "Queued", tone: "warn" };
    case "suppressed":
      return { label: "Not sent (suppressed)", tone: "warn" };
    case "bounced":
      return { label: "Bounced", tone: "bad" };
    case "complained":
      return { label: "Marked as spam", tone: "bad" };
    case "cancelled":
      return { label: "Cancelled", tone: "warn" };
    default:
      return { label: "Failed", tone: "bad" };
  }
}

export function registrationStatus(status: string | null | undefined): { label: string; tone: Tone } {
  switch (status) {
    case "approved":
      return { label: "Approved", tone: "ok" };
    case "submitted":
      return { label: "Submitted · waiting for the carriers", tone: "warn" };
    case "in_review":
      return { label: "In review with the carriers", tone: "warn" };
    case "rejected":
      return { label: "Rejected", tone: "bad" };
    case "draft":
      return { label: "Draft (not submitted)", tone: "warn" };
    default:
      return { label: "Not started", tone: "warn" };
  }
}

export function metaStatus(status: string | null | undefined): { label: string; tone: Tone } {
  switch (status) {
    case "approved":
      return { label: "Approved by Meta", tone: "ok" };
    case "rejected":
      return { label: "Rejected by Meta", tone: "bad" };
    case "pending_meta":
      return { label: "Pending Meta approval", tone: "warn" };
    default:
      return { label: "Not started", tone: "warn" };
  }
}

export const SUPPRESSION_REASON: Record<string, string> = {
  bounce: "Bounced",
  complaint: "Marked as spam",
  stop: "Replied STOP",
  manual: "Added by staff",
};

export const CHANNEL_LABEL: Record<string, string> = { email: "Email", sms: "Text", whatsapp: "WhatsApp", push: "Push", in_app: "In-app" };

/** The registration form → the detail object app.save_texting_registration expects. */
export function parseTextingDetail(fd: { get(name: string): unknown }): Record<string, unknown> {
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const samples = [s("sample_1"), s("sample_2"), s("sample_3")].filter(Boolean);
  const out: Record<string, unknown> = {
    legal_name: s("legal_name"), ein: s("ein").replace(/\D/g, ""), website: s("website"), use_case: s("use_case"),
    samples, opt_in: s("opt_in"), volume: s("volume"), contact_email: s("contact_email"),
  };
  for (const k of Object.keys(out)) if (out[k] === "" || (Array.isArray(out[k]) && (out[k] as unknown[]).length === 0)) delete out[k];
  return out;
}

/** "Quiet hours 9 PM – 7 AM" from the center rules' hours. */
export function hour12(h: number): string {
  const x = ((h % 24) + 24) % 24;
  return `${x % 12 === 0 ? 12 : x % 12} ${x < 12 ? "AM" : "PM"}`;
}

// Onboarding (stream o-platform): the public request form, sandbox codes, /start,
// the Community Connect console (Requests, Codes, Pipeline, Go-live, Support access)
// and the owner's Setup › Go-live. Pure helpers only, so they are unit-tested.

export const ORG_TYPES = [
  { value: "temple", label: "Temple" },
  { value: "community_center", label: "Community center" },
  { value: "other_nonprofit", label: "Other non-profit" },
] as const;
export type OrgType = (typeof ORG_TYPES)[number]["value"];

export function orgTypeLabel(v: string | null | undefined): string {
  return ORG_TYPES.find((t) => t.value === v)?.label ?? "Other";
}

/** Systems the form offers as chips; anything else can be typed. */
export const CURRENT_SYSTEMS = ["Neon", "Bloomerang", "Little Green Light", "NamoCRM", "QuickBooks", "Spreadsheets", "Paper records"] as const;

export const REQUEST_STATUS_LABEL: Record<string, string> = {
  new: "New",
  more_info: "Waiting for more information",
  approved: "Approved",
  declined: "Declined",
};

export const HONEYPOT_FIELD = "company_fax";

/** The form's hidden trap: a person never sees or fills it. */
export function isHoneypotHit(value: FormDataEntryValue | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** The browser's address from the portal's incoming request (first x-forwarded-for entry, else x-real-ip). */
export function clientIpFrom(forwardedFor: string | null, realIp: string | null): string | null {
  const first = (forwardedFor ?? "").split(",")[0]?.trim();
  const ip = first || (realIp ?? "").trim();
  if (!ip) return null;
  // IPv4, IPv6 (optionally bracketed, with a port) — never pass anything else on.
  const bare = ip.replace(/^\[(.*)\](?::\d+)?$/, "$1").replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, "$1");
  return /^[0-9a-fA-F:.]{2,45}$/.test(bare) ? bare : null;
}

// ── Sandbox codes ────────────────────────────────────────────────────────────
export const SANDBOX_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_RE = new RegExp(`^[${SANDBOX_CODE_ALPHABET}]{8}$`);

/** Mirrors app.normalize_sandbox_code: any spacing, case and dashes; the CC-SBX prefix is optional. */
export function normalizeSandboxCode(raw: string | null | undefined): string | null {
  let v = String(raw ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (v.startsWith("CCSBX")) v = v.slice(5);
  if (!CODE_RE.test(v)) return null;
  return `CC-SBX-${v.slice(0, 4)}-${v.slice(4)}`;
}

export type CodeState = "valid" | "used" | "revoked" | "expired";

export function codeState(c: { redeemed_at: string | null; revoked_at: string | null; expires_at: string }, now = new Date()): CodeState {
  if (c.redeemed_at) return "used";
  if (c.revoked_at) return "revoked";
  if (new Date(c.expires_at).getTime() <= now.getTime()) return "expired";
  return "valid";
}

export const CODE_STATE_LABEL: Record<CodeState, string> = { valid: "Not used yet", used: "Redeemed", revoked: "Revoked", expired: "Expired" };

/** What the requester sees for a code check (app.check_sandbox_code). */
export function checkCodeMessage(state: string): string | null {
  switch (state) {
    case "valid":
      return null;
    case "used":
      return "This code has already been used. If you created the sandbox, sign in as usual.";
    case "expired":
      return "This code has expired. Ask Community Connect to send you a new one.";
    default:
      return "That code is not valid. Check it against the email (it looks like CC-SBX-7K4M-Q2PD), or ask Community Connect for a new one.";
  }
}

/** The email status the database recorded (queued | not_set_up | failed: …) in plain English, for the CC console. */
export function emailStatusText(status: string | null | undefined): { tone: "ok" | "warn" | "bad"; text: string } {
  if (!status) return { tone: "warn", text: "No email recorded" };
  if (status === "queued") return { tone: "ok", text: "Email queued" };
  if (status === "not_set_up")
    return { tone: "warn", text: "Email sending isn't set up yet — the code is shown here for the Community Connect team to send by hand" };
  return { tone: "bad", text: `Email not sent — ${status.replace(/^failed:\s*/, "")}` };
}

// ── Web names ────────────────────────────────────────────────────────────────
/** Mirrors the database: 2–40 lowercase letters, numbers and single dashes, not ending in -sandbox. */
export function slugProblem(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(s) || s.includes("--")) {
    return "Use 2 to 40 lowercase letters, numbers and single dashes, for example jain-center-dallas.";
  }
  if (s.endsWith("-sandbox")) return "Leave out “-sandbox”; it is added for you.";
  return null;
}

export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

// ── /start ───────────────────────────────────────────────────────────────────
export type StartStatus = {
  code_status: "valid" | "expired" | "used" | "invalid";
  email_matches?: boolean;
  code_email?: string;
  center_slug?: string | null;
  org_name?: string;
  expires_at?: string;
  phone_verified?: boolean;
  phone?: string | null;
  has_totp?: boolean;
  aal?: string;
  terms_published?: boolean;
  terms?: { id: string; title: string; version: string; body_md: string } | null;
  terms_accepted?: boolean;
  suggested_slug?: string | null;
};

export type StartStep = "code" | "signin" | "wrong_email" | "phone" | "authenticator" | "totp_check" | "terms" | "create" | "done" | "closed";

export const START_STEPS: readonly { key: StartStep; label: string }[] = [
  { key: "code", label: "Code" },
  { key: "signin", label: "Email" },
  { key: "phone", label: "Mobile" },
  { key: "authenticator", label: "Authenticator" },
  { key: "terms", label: "Sandbox terms" },
];

/** Which /start step to show, from whether a code is held, whether someone is signed in, and their progress. */
export function startStep(hasCode: boolean, signedIn: boolean, s: StartStatus | null): StartStep {
  if (!hasCode) return "code";
  if (!signedIn || !s) return "signin";
  if (s.code_status === "used") return s.email_matches && s.center_slug ? "done" : "closed";
  if (s.code_status !== "valid") return "closed";
  if (!s.email_matches) return "wrong_email";
  if (!s.phone_verified) return "phone";
  if (!s.has_totp) return "authenticator";
  if (s.aal !== "aal2") return "totp_check";
  if (!s.terms_accepted) return "terms";
  return "create";
}

/** The step number (1-based) shown in the progress strip. */
export function startStepIndex(step: StartStep): number {
  const order: StartStep[] = ["code", "signin", "phone", "authenticator", "terms"];
  if (step === "wrong_email") return 2;
  if (step === "totp_check") return 4;
  if (step === "create" || step === "done") return 5;
  const i = order.indexOf(step);
  return i < 0 ? 1 : i + 1;
}

// ── Pipeline and go-live ─────────────────────────────────────────────────────
export const STAGE_LABEL: Record<string, string> = {
  setup: "Setting up",
  sandbox: "Sandbox",
  golive_requested: "Go-live requested",
  approved: "Approved · promote next",
  promoted: "Promoted to production",
};

export function daysSince(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

export const GOLIVE_STATUS_LABEL: Record<string, string> = {
  requested: "Waiting for approvals",
  approved: "Approved",
  rejected: "Sent back",
  live: "Live",
};

/** Where a go-live request stands, in words, for the console and the owner. */
export function goliveProgress(g: { status: string; first_approver: string | null; second_approver: string | null }): string {
  if (g.status === "requested") return g.first_approver ? "1 of 2 approvals" : "0 of 2 approvals";
  if (g.status === "approved") return "2 of 2 approvals · the owner promotes the sandbox";
  if (g.status === "live") return "Live";
  return "Sent back to the organization";
}

export const ATTESTATIONS = [
  { key: "staff_trained", label: "Staff trained", help: "Every staff member finished their role's training (videos and sandbox exercises)." },
  { key: "health_check_green", label: "Sandbox health check green", help: "The automated journeys pass for every module that is on." },
  { key: "pilot_done", label: "Pilot done", help: "The pilot with 30–50 champion families is done and its feedback addressed." },
] as const;
export type AttestationKey = (typeof ATTESTATIONS)[number]["key"];

export function isAttestationKey(v: unknown): v is AttestationKey {
  return ATTESTATIONS.some((a) => a.key === v);
}

/** Support-access durations the owner can choose. */
export const SUPPORT_DURATIONS = [
  { hours: 4, label: "4 hours" },
  { hours: 24, label: "1 day" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "1 week" },
] as const;

export function supportState(g: { revoked_at: string | null; expires_at: string }, now = new Date()): "live" | "ended" | "expired" {
  if (g.revoked_at) return "ended";
  return new Date(g.expires_at).getTime() > now.getTime() ? "live" : "expired";
}

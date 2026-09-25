// Settings › Integrations: the credential vault and the background service.
// Pure helpers (tested in tests/vault.test.ts). The vault itself is in the
// database (0170): the portal only ever sees fingerprints, never a value.

import { isPlainObject } from "@/lib/center-rules";
import type { Json } from "@/lib/database.types";

/** SQLSTATE raised by app.assert_step_up: "This needs a fresh 2FA check." */
export const STEP_UP_CODE = "CCSTP";

export function isStepUpError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  return error.code === STEP_UP_CODE || /needs a fresh 2FA check/i.test(error.message ?? "");
}

/** Mirrors the database check on app.integration_secrets.name. */
export const SECRET_NAME_RE = /^[a-z][a-z0-9_.-]{0,62}$/;

export function secretNameProblem(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return "Give the secret a name, for example api_key.";
  if (!SECRET_NAME_RE.test(n)) return "Use lower-case letters, digits, dots, dashes or underscores, starting with a letter (for example webhook_secret).";
  return null;
}

/** Mirrors app.set_integration_secret: at least 8 characters, so the last 4 never give the whole value away. */
export function secretValueProblem(value: string): string | null {
  if (!value || !value.trim()) return "Paste the secret value.";
  if (value.length < 8) return "That value is too short to be a real secret (at least 8 characters).";
  if (value.length > 65536) return "That value is too long to be a secret.";
  if (value !== value.trim()) return "The value starts or ends with a space; check you copied only the key.";
  return null;
}

export function fingerprintLabel(fingerprint: string | null | undefined): string {
  return fingerprint ? `••••${fingerprint}` : "—";
}

/** Names suggested when adding a secret to a connection (the database accepts any valid name). */
export const SECRET_NAME_SUGGESTIONS: Record<string, string[]> = {
  stripe: ["api_key", "webhook_secret"],
  quickbooks_online: ["oauth.refresh_token", "oauth.access_token"],
  twilio: ["auth_token", "api_key"],
  sendgrid: ["api_key"],
  resend: ["api_key"],
  whatsapp: ["access_token", "app_secret"],
  neon_crm: ["api_key"],
  google_calendar: ["oauth.refresh_token"],
  other: ["api_key"],
};

export const PROVIDER_LABELS: Record<string, string> = {
  quickbooks_online: "QuickBooks Online",
  stripe: "Stripe",
  paypal: "PayPal",
  neon_crm: "Neon CRM",
  whatsapp: "WhatsApp Business",
  twilio: "Twilio",
  sendgrid: "SendGrid",
  resend: "Resend",
  google_calendar: "Google Calendar",
  other: "Other",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

export type VaultAction = "add" | "replace" | "rotate" | "disconnect";

/** Wording for the confirm modal of each vault action. */
export function vaultActionCopy(action: VaultAction, secretName: string, connectionLabel: string) {
  switch (action) {
    case "add":
      return { title: `Add a secret to ${connectionLabel}`, confirm: "Save secret", body: "It is stored encrypted in the vault. After saving, only the last 4 characters are ever shown." };
    case "replace":
      return { title: `Replace ${secretName}`, confirm: "Replace", body: "Paste the correct value. The old value is overwritten in the vault and cannot be seen again." };
    case "rotate":
      return {
        title: `Rotate ${secretName}`,
        confirm: "Rotate",
        body: "Create a new key at the provider, paste it here, then revoke the old key at the provider. The rotation date is recorded.",
      };
    case "disconnect":
      return {
        title: `Remove ${secretName}`,
        confirm: "Remove secret",
        body: "The secret is deleted from the vault. Anything that uses it stops working until a new one is added.",
      };
  }
}

// ── Background service ───────────────────────────────────────────────────────

export type HandlerState = { kind: string; configured: boolean; reason: string | null };
export type BackgroundServiceView = {
  state: "running" | "stopped" | "not_configured" | "unknown";
  label: string;
  tone: "ok" | "warn" | "bad";
  detail: string;
  lastBeatAt: string | null;
  handlers: HandlerState[];
  jobs: { queued: number; running: number; failed24h: number; done24h: number; scanPending: number };
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function ago(seconds: number): string {
  if (seconds < 90) return `${Math.max(0, Math.round(seconds))} seconds ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} minutes ago`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours ago`;
  return `${Math.round(seconds / 86400)} days ago`;
}

/** app.background_service_status(center) → what the status tile shows. */
export function backgroundServiceView(status: Json | null | undefined): BackgroundServiceView {
  const s = isPlainObject(status) ? status : {};
  const jobsRaw = isPlainObject(s.jobs) ? s.jobs : {};
  const jobs = {
    queued: num(jobsRaw.queued),
    running: num(jobsRaw.running),
    failed24h: num(jobsRaw.failed_24h),
    done24h: num(jobsRaw.done_24h),
    scanPending: num(jobsRaw.scan_pending),
  };
  const workers = Array.isArray(s.workers) ? s.workers.filter(isPlainObject) : [];
  const newest = workers[0];
  const handlersRaw = newest && isPlainObject(newest.handlers) ? newest.handlers : {};
  const handlers: HandlerState[] = Object.entries(handlersRaw)
    .map(([kind, h]) => {
      const o = isPlainObject(h) ? h : {};
      return { kind, configured: o.configured === true, reason: typeof o.reason === "string" ? o.reason : null };
    })
    .sort((a, b) => a.kind.localeCompare(b.kind));
  const lastBeatAt = typeof s.last_beat_at === "string" ? s.last_beat_at : null;
  const age = typeof s.age_seconds === "number" ? s.age_seconds : null;
  switch (s.state) {
    case "running":
      return { state: "running", label: "Running", tone: "ok", detail: `Last heartbeat ${age === null ? "just now" : ago(age)}.`, lastBeatAt, handlers, jobs };
    case "stopped":
      return {
        state: "stopped",
        label: "Not running",
        tone: "bad",
        detail:
          newest && typeof newest.stopped_at === "string"
            ? `The background service was stopped ${age === null ? "" : `(last heartbeat ${ago(age)}) `}and has not started again. Jobs wait in the queue until it is back.`
            : `The background service last reported in ${age === null ? "a while ago" : ago(age)} and has stopped answering. Jobs wait in the queue until it is back.`,
        lastBeatAt,
        handlers,
        jobs,
      };
    case "not_configured":
      return {
        state: "not_configured",
        label: "Background service not configured",
        tone: "warn",
        detail:
          "It has never reported in. It is deployed once the WORKER_DATABASE_URL secret is added (docs/DEPLOY.md › Background service); until then background jobs wait in the queue.",
        lastBeatAt: null,
        handlers,
        jobs,
      };
    default:
      return { state: "unknown", label: "Unknown", tone: "warn", detail: "The database did not say whether the background service is running.", lastBeatAt, handlers, jobs };
  }
}

export const JOB_KIND_LABELS: Record<string, string> = {
  "demo.ping": "Test job",
  "oauth.exchange": "Connect a service",
  "storage.retention": "Remove expired files",
  "storage.scan": "Malware scan",
  "payments.webhook.stripe": "Stripe event",
  "payments.webhook.paypal": "PayPal event",
  "payments.refund": "Refund through the provider",
  "payments.test_charge": "$1 test refund",
  "payments.sync_payouts": "Payout sync",
  "demo.load": "Load demo data",
  "demo.clear": "Clear the sandbox",
};

export function jobKindLabel(kind: string): string {
  return JOB_KIND_LABELS[kind] ?? kind;
}

export function jobStatusView(status: string, attempts: number, maxAttempts: number): { label: string; tone: "ok" | "warn" | "bad" } {
  switch (status) {
    case "done":
      return { label: "Done", tone: "ok" };
    case "running":
      return { label: "Running", tone: "warn" };
    case "queued":
      return attempts > 0 ? { label: `Retrying (attempt ${attempts + 1} of ${maxAttempts})`, tone: "warn" } : { label: "Waiting", tone: "warn" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    case "cancelled":
      return { label: "Cancelled", tone: "warn" };
    default:
      return { label: status, tone: "warn" };
  }
}

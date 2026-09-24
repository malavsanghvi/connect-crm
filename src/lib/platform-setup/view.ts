import "server-only";

import { randomBytes } from "node:crypto";

import { workerDbConfigured } from "@/lib/messaging/server-db";
import type { CrmSession } from "@/lib/session";

import { FIELDS, STEPS, missingFor, setupComplete, type StepKey, type StepRow, type StepStatus } from "./catalog";
import type { StepTest } from "./checks";
import { loadPlatformConfig, platformConfigError, platformSources } from "./server-config";

// Everything the platform setup wizard shows, computed on the server from the
// database (as the signed-in platform admin, RLS) and this server's own view.
// No secret value is ever read here: fingerprints and names only.

export type Source = "saved" | "env" | "missing";
export type FieldView = {
  name: string;
  kind: "secret" | "setting";
  label: string;
  hint: string;
  placeholder: string | null;
  options: { value: string; label: string }[] | null;
  generate: boolean;
  /** Settings only (never a secret). */
  value: string | null;
  fingerprint: string | null;
  setBy: string | null;
  setAt: string | null;
  rotatedAt: string | null;
  portal: Source;
  worker: Source | "unknown";
};
export type TestView = { jobId: string; status: string; createdAt: string; finishedAt: string | null; error: string | null; result: StepTest | null; stale: boolean };
export type StepView = {
  key: StepKey;
  required: boolean;
  title: string;
  what: string;
  why: string;
  status: StepStatus;
  parkedBy: string | null;
  parkedAt: string | null;
  completedBy: string | null;
  completedAt: string | null;
  note: string | null;
  fields: FieldView[];
  missing: string[];
  /** The live check: passes, and why/why not in plain words. */
  live: { ok: boolean; summary: string };
  canComplete: boolean;
  workerTest: boolean;
  test: TestView | null;
};
export type WorkerState = { state: "running" | "stopped" | "not_configured"; lastBeatAt: string | null; ageSeconds: number | null; workers: number; configError: string | null };
export type SetupView = {
  steps: StepView[];
  complete: boolean;
  worker: WorkerState;
  portalDomain: string | null;
  wildcardDomain: string | null;
  hookActivity: HookActivity;
  portalDbConfigured: boolean;
  portalConfigError: string | null;
};
export type HookActivity = Record<"email" | "sms", { last_at: string | null; sent: number; failed: number; last_status: string | null; last_error: string | null; since: number } | undefined>;

type Heartbeat = { worker: string; beat_at: string; stopped_at: string | null; info: { platform_config?: { saved?: string[]; env?: string[]; error?: string | null } } | null };

const STALE_MS = 3 * 60 * 1000;

/** Setup rows only: for the first-sign-in redirect and the Platform home reminder. */
export async function loadStepRows(session: CrmSession): Promise<{ rows: (StepRow & { parked_at: string | null; note: string | null })[]; error: string | null }> {
  const res = await session.db.from("platform_setup_steps").select("key, required, status, parked_at, note").order("sort");
  if (res.error) {
    console.error("[platform-setup] could not read the setup steps:", res.error);
    return { rows: [], error: res.error.message };
  }
  return { rows: (res.data ?? []) as (StepRow & { parked_at: string | null; note: string | null })[], error: null };
}

export async function isSetupComplete(session: CrmSession): Promise<boolean | null> {
  const { rows, error } = await loadStepRows(session);
  if (error) return null;
  return setupComplete(rows);
}

export async function loadSetupView(session: CrmSession, opts: { hookSince?: string | null } = {}): Promise<{ ok: true; view: SetupView } | { ok: false; error: string }> {
  const { db } = session;
  await loadPlatformConfig(true);
  const [stepsRes, secretsRes, settingsRes, beatsRes, jobsRes, namesRes, hookRes] = await Promise.all([
    db.from("platform_setup_steps").select("key, required, status, parked_by, parked_at, completed_by, completed_at, note").order("sort"),
    db.from("platform_secrets").select("name, fingerprint, set_by, set_at, rotated_at"),
    db.from("platform_settings").select("key, value, set_by, set_at"),
    db.from("worker_heartbeats").select("worker, beat_at, stopped_at, info").order("beat_at", { ascending: false }).limit(20),
    db.from("jobs").select("id, status, payload, result, last_error, created_at, finished_at").eq("kind", "platform.test_provider").order("id", { ascending: false }).limit(60),
    db.rpc("platform_admin_directory"),
    db.rpc("platform_auth_hook_activity", { p_since: opts.hookSince ?? undefined }),
  ]);
  const firstError = [stepsRes, secretsRes, settingsRes, beatsRes, jobsRes].find((r) => r.error)?.error;
  if (firstError) {
    console.error("[platform-setup] could not load the setup:", firstError);
    return { ok: false, error: firstError.message };
  }
  if (namesRes.error) console.error("[platform-setup] could not load the platform admins' names (showing ids instead):", namesRes.error);
  if (hookRes.error) console.error("[platform-setup] could not load the sign-in hook activity:", hookRes.error);
  const names = new Map(((namesRes.data ?? []) as { user_id: string; email: string }[]).map((n) => [n.user_id, n.email]));
  const who = (id: string | null) => (id ? (id === session.userId ? "you" : (names.get(id) ?? "another platform admin")) : null);

  const secrets = new Map((secretsRes.data ?? []).map((s) => [s.name, s]));
  const settings = new Map((settingsRes.data ?? []).map((s) => [s.key, s]));
  const settingValue = (k: string): string | null => {
    const v = settings.get(k)?.value;
    return typeof v === "string" ? v : null;
  };

  // The background service: live heartbeats, and what its platform config says (names only).
  const beats = (beatsRes.data ?? []) as Heartbeat[];
  const live = beats.filter((b) => !b.stopped_at && Date.now() - new Date(b.beat_at).getTime() <= STALE_MS);
  const last = beats[0]?.beat_at ?? null;
  const worker: WorkerState = {
    state: live.length > 0 ? "running" : beats.length > 0 ? "stopped" : "not_configured",
    lastBeatAt: last,
    ageSeconds: last ? Math.round((Date.now() - new Date(last).getTime()) / 1000) : null,
    workers: live.length,
    configError: live[0]?.info?.platform_config?.error ?? null,
  };
  const wcfg = live[0]?.info?.platform_config;
  const workerSource = (n: string): Source | "unknown" => (!wcfg ? "unknown" : wcfg.saved?.includes(n) ? "saved" : wcfg.env?.includes(n) ? "env" : "missing");
  const portalSrc = platformSources(Object.keys(FIELDS));
  const has = (n: string) => secrets.has(n) || settings.has(n) || portalSrc[n] === "env" || (wcfg?.env?.includes(n) ?? false);

  // Portal address and wildcard: DNS and certificates are o-https's (its HTTPS status panel), not checked here.
  const portalDomain = settingValue("portal_domain");
  const wildcardDomain = settingValue("wildcard_domain");
  const hookActivity = (hookRes.data ?? {}) as HookActivity;

  const jobs = (jobsRes.data ?? []) as { id: number; status: string; payload: { step?: string } | null; result: StepTest | null; last_error: string | null; created_at: string; finished_at: string | null }[];
  const rows = new Map((stepsRes.data ?? []).map((r) => [r.key, r]));

  const steps: StepView[] = STEPS.map((s) => {
    const row = rows.get(s.key);
    const fields: FieldView[] = s.fields.map((f) => {
      const sec = f.kind === "secret" ? secrets.get(f.name) : undefined;
      const set = f.kind === "setting" ? settings.get(f.name) : undefined;
      return {
        name: f.name, kind: f.kind, label: f.label, hint: f.hint, placeholder: f.placeholder ?? null, options: f.options ?? null, generate: f.generate === true,
        value: f.kind === "setting" ? settingValue(f.name) : null,
        fingerprint: sec?.fingerprint ?? null,
        setBy: who((sec?.set_by ?? set?.set_by) ?? null),
        setAt: sec?.set_at ?? set?.set_at ?? null,
        rotatedAt: sec?.rotated_at ?? null,
        portal: f.name in portalSrc ? (secrets.has(f.name) || settings.has(f.name) ? "saved" : portalSrc[f.name]!) : "missing",
        worker: workerSource(f.name),
      };
    });
    const missing = missingFor(s.key, has, settingValue);
    const lastChange = fields.reduce<number>((m, f) => Math.max(m, f.setAt ? new Date(f.setAt).getTime() : 0), 0);
    const j = jobs.find((x) => x.payload?.step === s.key);
    const test: TestView | null = j
      ? { jobId: String(j.id), status: j.status, createdAt: j.created_at, finishedAt: j.finished_at, error: j.last_error, result: j.result && Array.isArray(j.result.lines) ? j.result : null, stale: new Date(j.created_at).getTime() < lastChange }
      : null;
    const liveCheck = liveFor(s.key, { worker, missing, test, hookActivity, secrets });
    return {
      key: s.key, required: s.required, title: s.title, what: s.what, why: s.why,
      status: (row?.status ?? "not_started") as StepStatus,
      parkedBy: who(row?.parked_by ?? null), parkedAt: row?.parked_at ?? null,
      completedBy: who(row?.completed_by ?? null), completedAt: row?.completed_at ?? null, note: row?.note ?? null,
      fields, missing, live: liveCheck, canComplete: liveCheck.ok, workerTest: s.workerTest, test,
    };
  });

  return {
    ok: true,
    view: {
      steps,
      complete: setupComplete(steps.map((s) => ({ key: s.key, required: s.required, status: s.status }))),
      worker, portalDomain, wildcardDomain, hookActivity,
      portalDbConfigured: workerDbConfigured(),
      portalConfigError: platformConfigError(),
    },
  };
}

function liveFor(
  key: StepKey,
  c: {
    worker: WorkerState; missing: string[]; test: TestView | null; hookActivity: HookActivity; secrets: Map<string, { set_at: string }>;
  },
): { ok: boolean; summary: string } {
  const needs = (m: string[]) => `Still needed: ${m.join("; ")}.`;
  switch (key) {
    case "background":
      if (c.worker.state === "running") return { ok: true, summary: `Running · last reported in ${c.worker.ageSeconds ?? 0} seconds ago.` };
      if (c.worker.state === "stopped") return { ok: false, summary: `Not running · last reported in ${c.worker.lastBeatAt ? new Date(c.worker.lastBeatAt).toUTCString() : "never"}.` };
      return { ok: false, summary: "Not configured · it has never reported in. The WORKER_DATABASE_URL secret is missing (see the steps below)." };
    case "portal":
    case "wildcard": {
      if (c.missing.length) return { ok: false, summary: needs(c.missing) };
      // DNS and the certificate are shown by the HTTPS status panel (o-https) on this step; marking it done is the admin's confirmation.
      return { ok: true, summary: "Saved. Confirm in the HTTPS status below that the DNS record and the certificate are in place before marking it done." };
    }
    case "hooks": {
      if (c.missing.length) return { ok: false, summary: needs(c.missing) };
      const email = c.hookActivity.email;
      const savedAt = c.secrets.get("SEND_EMAIL_HOOK_SECRET")?.set_at;
      if (email?.last_at && email.last_status === "sent" && (!savedAt || new Date(email.last_at) >= new Date(savedAt))) {
        return { ok: true, summary: `The Send Email hook sent a sign-in code ${new Date(email.last_at).toUTCString()}.` };
      }
      if (email?.last_status === "failed") return { ok: false, summary: `The Send Email hook was called but could not send: ${email.last_error ?? "no detail"}.` };
      return { ok: false, summary: "No sign-in code has gone through the hook since the secret was saved. Turn the hook on in Supabase, then send a test code." };
    }
    case "push":
      return { ok: true, summary: "Push works without a token." };
    default: {
      if (c.missing.length) return { ok: false, summary: needs(c.missing) };
      if (c.worker.state !== "running") return { ok: false, summary: "The background service must be running to test these keys." };
      const t = c.test;
      if (!t) return { ok: false, summary: "Saved, not tested yet. Press Test." };
      if (t.status === "queued" || t.status === "running") return { ok: false, summary: "Testing…" };
      if (t.status === "failed") return { ok: false, summary: `The test could not run: ${t.error ?? "no detail"}.` };
      if (t.stale) return { ok: false, summary: "A value changed after the last test. Test again." };
      if (!t.result?.ok) return { ok: false, summary: `The last test found a problem: ${t.result?.lines.filter((l) => !l.ok).map((l) => `${l.label} — ${l.detail}`).join("; ") || "see below"}.` };
      return { ok: true, summary: `Tested ${t.finishedAt ? new Date(t.finishedAt).toUTCString() : ""}: everything answered.` };
    }
  }
}

/** A fresh random value for a "Generate" field. */
export function generatedSecret(): string {
  return randomBytes(36).toString("base64url");
}

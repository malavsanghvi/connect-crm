// "Are our connected services working?" in plain words (Settings, B90 phase 4). Takes what Settings › Integrations, Email and
// Texting already read and says, for each service, whether it works, why not, and where to fix it. It reads status only: no
// keys, no secrets, no one-time values (the vault is never read). Pure: no server imports.

import { integrationRows, type ConnectionRow } from "@/lib/integrations";
import { domainStatus, registrationStatus } from "@/lib/messaging/labels";
import type { ReadinessResult } from "@/lib/setup";
import { hourLabel } from "@/lib/settings-rules";

import { whereLabel, type FixAt } from "./setup-view";

export type ServiceHealth = {
  service: string;
  status: string;
  working: boolean;
  in_words: string;
  owner: string;
  fix_at: FixAt | null;
};

export type EmailDomainIn = { domain: string; status: string; last_error: string | null };
export type TextingIn = {
  /** texting_registrations rows, any order. */
  registrations: readonly { kind: string; status: string; detail: unknown }[];
  /** integration_connections row for the texting provider, when there is one. */
  connection: { status: string; last_error: string | null } | null;
  phoneSignIn: boolean;
  quietStartHour: number;
  quietEndHour: number;
};

export type HealthView = {
  summary: string;
  needs_attention: number;
  services: ServiceHealth[];
  email_domains: { domain: string; status: string; note: string | null }[];
  texting: {
    carrier_status: string;
    kind: string | null;
    sending_number: string | null;
    why_texts_may_not_go_out: string[];
    phone_sign_in: string;
    quiet_hours: string;
  };
};

/** The go-live check whose answer explains each service. */
const CHECK_FOR: Record<string, string> = {
  qbo: "quickbooks_ready",
  payments: "payments_live",
  email: "email_domain_verified",
  sms: "texting_registered",
  background: "background_service",
};

function text(detail: unknown, key: string): string | null {
  const v = detail && typeof detail === "object" ? (detail as Record<string, unknown>)[key] : undefined;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** The registration that counts: the approved one, else the latest that was not just a draft, else any. */
function currentRegistration(regs: TextingIn["registrations"]) {
  return regs.find((r) => r.status === "approved") ?? regs.find((r) => r.status !== "draft") ?? regs[0] ?? null;
}

export function buildHealthView(input: { connections: readonly ConnectionRow[]; readiness: readonly ReadinessResult[]; emailDomains: readonly EmailDomainIn[]; texting: TextingIn }): HealthView {
  const checks = new Map(input.readiness.map((r) => [r.key, r]));
  const services: ServiceHealth[] = integrationRows([...input.connections]).map((row) => {
    const check = checks.get(CHECK_FOR[row.key] ?? "");
    const connectedOk = row.status.tone === "ok";
    const working = connectedOk && (check ? check.ok : true);
    const parts = [row.detail];
    if (check && !check.ok && check.detail) parts.push(check.detail);
    return {
      service: row.label,
      status: check && !check.ok && connectedOk ? "Connected, but not ready" : row.status.label,
      working,
      in_words: parts.filter(Boolean).join(" · "),
      owner: row.owner,
      fix_at: working ? null : whereLabel(row.href ?? null),
    };
  });

  const emailDomains = input.emailDomains.map((d) => ({
    domain: d.domain,
    status: domainStatus(d.status).label,
    note: d.last_error ? clip(d.last_error, 200) : d.status === "verified" ? null : "The records to add at the domain's registrar are listed in Settings › Email.",
  }));

  const reg = currentRegistration(input.texting.registrations);
  const regStatus = registrationStatus(reg?.status);
  const why: string[] = [];
  if (!reg) why.push("Texting is not registered yet. US carriers block business texts until a registration is approved.");
  else if (reg.status === "rejected") {
    const note = text(reg.detail, "reviewer_note");
    why.push(`The texting registration was rejected${note ? `: ${clip(note, 300)}` : ""}. It has to be corrected and sent again before texts go out.`);
  } else if (reg.status !== "approved") why.push(`The texting registration is not approved yet (${regStatus.label.toLowerCase()}). Texts wait for the carriers.`);
  if (input.texting.connection?.status === "error") {
    why.push(`The texting provider reported a problem${input.texting.connection.last_error ? `: ${clip(input.texting.connection.last_error, 300)}` : ""}.`);
  }
  why.push(`Texts that are not urgent wait during quiet hours (${hourLabel(input.texting.quietStartHour)} to ${hourLabel(input.texting.quietEndHour)}).`);
  why.push("A family that replied STOP is not texted again, and a family with no phone number on file has nothing to send to. Settings › Texting lists the people who opted out.");

  const attention = services.filter((s) => !s.working && s.status !== "Not connected").length;
  const notConnected = services.filter((s) => s.status === "Not connected").length;
  const summary =
    attention === 0 && notConnected === 0
      ? "Every connected service is working."
      : [
          attention > 0 ? `${attention} connected ${attention === 1 ? "service needs" : "services need"} attention.` : null,
          notConnected > 0 ? `${notConnected} ${notConnected === 1 ? "is" : "are"} not connected yet.` : null,
        ]
          .filter(Boolean)
          .join(" ");

  return {
    summary,
    needs_attention: attention,
    services,
    email_domains: emailDomains,
    texting: {
      carrier_status: regStatus.label,
      kind: reg ? (reg.kind === "10dlc" ? "10DLC (a local number)" : "Toll-free") : null,
      sending_number: reg?.status === "approved" ? text(reg.detail, "from_number") : null,
      why_texts_may_not_go_out: why,
      phone_sign_in: input.texting.phoneSignIn ? "On: members can sign in with a texted code." : "Off: members sign in with email.",
      quiet_hours: `${hourLabel(input.texting.quietStartHour)} to ${hourLabel(input.texting.quietEndHour)}`,
    },
  };
}


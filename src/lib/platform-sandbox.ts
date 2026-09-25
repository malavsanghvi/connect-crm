// Platform › Centers › New sandbox (stream f-sandbox, owner decisions 2026-09-25, second batch):
// Community Connect's super admin creates a sandbox directly and invites its owner.
// Pure helpers only (unit-tested); the database decides (app.platform_create_sandbox, 0502).

import { ORG_TYPES, slugProblem, type OrgType } from "@/lib/platform-onboarding";

export type NewSandboxInput = {
  name: string;
  slug: string;
  orgType: string;
  city: string;
  state: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerEmail: string;
  reason: string;
};

export type NewSandbox = Omit<NewSandboxInput, "orgType"> & { orgType: OrgType };

/** The web name without a trailing "-sandbox" (it is added for you): "Jain-Center-Dallas-sandbox " → "jain-center-dallas". */
export function baseSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/-sandbox$/, "");
}

/** The sandbox's web name as it will be created. */
export function sandboxSlug(raw: string): string {
  const b = baseSlug(raw);
  return b ? `${b}-sandbox` : "";
}

/** Checks what the form sent; the database checks it all again. Returns the first problem in plain English. */
export function validateNewSandbox(raw: NewSandboxInput): { ok: true; value: NewSandbox } | { ok: false; error: string } {
  const v = {
    name: raw.name.trim(),
    slug: baseSlug(raw.slug),
    orgType: raw.orgType.trim(),
    city: raw.city.trim(),
    state: raw.state.trim().toUpperCase(),
    ownerFirstName: raw.ownerFirstName.trim(),
    ownerLastName: raw.ownerLastName.trim(),
    ownerEmail: raw.ownerEmail.trim().toLowerCase(),
    reason: raw.reason.trim(),
  };
  if (v.name.length < 2) return { ok: false, error: "enter the organization's name." };
  const slug = slugProblem(v.slug);
  if (slug) return { ok: false, error: `the web name: ${slug}` };
  if (!ORG_TYPES.some((t) => t.value === v.orgType)) return { ok: false, error: "choose the kind of organization." };
  if (!v.city) return { ok: false, error: "enter the city." };
  if (!/^[A-Z]{2}$/.test(v.state)) return { ok: false, error: "enter the state as two letters, for example TX." };
  if (!v.ownerFirstName) return { ok: false, error: "enter the owner's first name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.ownerEmail)) return { ok: false, error: "enter the owner's email address." };
  if (!v.reason) return { ok: false, error: "give a reason (it goes in the audit log)." };
  if (v.reason.length > 500) return { ok: false, error: "keep the reason under 500 characters." };
  return { ok: true, value: { ...v, orgType: v.orgType as OrgType } };
}

/** What happened to the invitation email, for the console. The link is always shown so it can be sent by hand. */
export function invitationEmailText(status: string | null | undefined, email: string): { tone: "ok" | "warn" | "bad"; text: string } {
  if (status === "queued") return { tone: "ok", text: `Invitation email queued to ${email}. You can also send the link below yourself.` };
  if (!status || status === "not_set_up") {
    return { tone: "warn", text: `Email sending isn't set up yet — send this link to ${email} yourself.` };
  }
  return { tone: "bad", text: `The invitation email was not sent (${status.replace(/^failed:\s*/, "")}) — send this link to ${email} yourself.` };
}

// The community's agreement to activity recording (owner decisions 2026-10-11) as the portal reads it. Pure, no server imports.
//
// The database keeps it in centers.rules.activity (0621): { enabled, share_with_weaver, consent: {by, at, version},
// withdrawn: {by, at} }. Recording is on only while a consent record exists. Only the community's own administrator
// (settings.manage, after a fresh 2FA check) can agree or change the sharing; Weaver staff can switch recording OFF at any
// time and back ON only while the agreement stands. Weaver sees a community's ideas, usage and counts only if it also agreed
// to share them. This file turns what the database says into the words the screens print.

import { formatDate } from "@/lib/dates";

/**
 * The version of the notice below. The administrator's agreement records which version they read, so change this whenever
 * ACTIVITY_NOTICE changes in meaning (tests/activity-consent.test.ts reminds you). The database takes letters, digits and
 * . _ - up to 40 characters.
 */
export const ACTIVITY_NOTICE_VERSION = "1";

/** The notice the administrator reads before agreeing. Plain English; each line is one promise. */
export const ACTIVITY_NOTICE: readonly string[] = [
  "Weaver notes which screens your staff use and which actions they take (for example, recording a payment), and which screens members open in the app.",
  "It never keeps what anyone types: no names, amounts, notes or searches.",
  "Nothing is noted about anyone under 18, about Weaver administrators, or about anyone who opts out.",
  "People are noted under a code that is different in every community, never under their name.",
  "What is noted is kept for 400 days and then deleted.",
  "Members can switch this off for themselves in the app.",
  "Weaver uses the counts to suggest repeated work that could be automated. You see those ideas here first and decide which are useful.",
  "You can withdraw your agreement at any time. Recording stops at once.",
];

/** The wording of the sharing choice, exactly as the owner asked for it. */
export const SHARE_LABEL = "Also let Weaver staff see counts of how communities use Weaver (no names, no content)";

export type ActivityConsent = {
  /** Recording is switched on for the community. */
  recording: boolean;
  /** The community's administrator has agreed (a consent record exists). */
  agreed: boolean;
  /** When they agreed, and which version of the notice they read. */
  at: string | null;
  version: string | null;
  /** They also agreed that Weaver staff see counts. Only meaningful while agreed. */
  share: boolean;
  /** When they last withdrew, if they did and have not agreed again. */
  withdrawnAt: string | null;
};

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The agreement as centers.rules holds it (what the platform screen reads, and the fallback for Weaver staff). */
export function consentFromRules(rules: unknown): ActivityConsent {
  const a = obj(obj(rules)?.activity);
  if (!a) return { recording: false, agreed: false, at: null, version: null, share: false, withdrawnAt: null };
  const consent = obj(a.consent);
  const at = text(consent?.at);
  const agreed = at !== null;
  return {
    recording: a.enabled === true,
    agreed,
    at,
    version: agreed ? text(consent?.version) : null,
    share: agreed && a.share_with_weaver === true,
    withdrawnAt: agreed ? null : text(obj(a.withdrawn)?.at),
  };
}

/**
 * The agreement as app.activity_status tells it to people with settings.manage: { enabled, consented, consent: {at, version},
 * share_with_weaver }. When the answer has no `consented` (the caller lacks settings.manage, such as Weaver staff) the
 * community's rules are used instead. The withdrawal date is only in the rules.
 */
export function consentFromStatus(status: unknown, rules: unknown): ActivityConsent {
  const fromRules = consentFromRules(rules);
  const s = obj(status);
  if (!s || typeof s.consented !== "boolean") return fromRules;
  const consent = obj(s.consent);
  return {
    recording: s.enabled === true,
    agreed: s.consented,
    at: s.consented ? text(consent?.at) : null,
    version: s.consented ? text(consent?.version) : null,
    share: s.consented && s.share_with_weaver === true,
    withdrawnAt: s.consented ? null : fromRules.withdrawnAt,
  };
}

/** The same yes/no the database uses to let Weaver staff see a community: recording on, agreed, and sharing agreed. */
export function sharedWithWeaver(rules: unknown): boolean {
  const c = consentFromRules(rules);
  return c.recording && c.agreed && c.share;
}

/** How many of these communities (rows with their rules) are counted by Weaver's cross-community numbers. */
export function countSharingCommunities(rows: readonly { rules: unknown }[]): number {
  return rows.filter((r) => sharedWithWeaver(r.rules)).length;
}

/** "Not agreed" or "Agreed on Oct 11, 2026 (notice v1)". */
export function agreementText(c: ActivityConsent, tz: string): string {
  if (!c.agreed) return "Not agreed";
  const when = c.at ? ` on ${formatDate(c.at, tz)}` : "";
  const version = c.version ? ` (notice v${c.version})` : "";
  return `Agreed${when}${version}`;
}

/** "You withdrew your agreement on Oct 11, 2026." when that is the last thing that happened, else null. */
export function withdrawnText(c: ActivityConsent, tz: string): string | null {
  return !c.agreed && c.withdrawnAt ? `Your agreement was withdrawn on ${formatDate(c.withdrawnAt, tz)}.` : null;
}

/** Whether Weaver staff may switch recording ON for this community (OFF is always allowed), and if not, why. */
export function weaverCanSwitchOn(c: ActivityConsent): { ok: true } | { ok: false; reason: string } {
  if (c.agreed) return { ok: true };
  return { ok: false, reason: "The community's administrator has not agreed yet. Recording can be switched on only after they agree in Settings > Automation ideas." };
}

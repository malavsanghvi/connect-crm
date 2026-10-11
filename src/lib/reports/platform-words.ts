// Words and places for the Weaver team's inbox, used by the Platform home, the community summary page and the Platform commands.
// Pure.

import type { CommunitySummary } from "./parse";

/** The page of the console where the team does what a platform command only points to. */
export const PLATFORM_WHERE = {
  goLive: { label: "Open Platform › Go-live approvals", href: "/platform/go-live" },
  verification: { label: "Open Platform › Verification", href: "/platform/verification" },
  requests: { label: "Open Platform › Requests", href: "/platform/requests" },
  pipeline: { label: "Open Platform › Onboarding", href: "/platform/pipeline" },
  centers: { label: "Open Platform › Centers", href: "/platform" },
} as const;

export type Where = { label: string; href: string };

/** What each kind of waiting thing is called, and where the team deals with it. */
export const WAITING_KIND: Record<string, { label: string; where: Where }> = {
  golive: { label: "Go-live request", where: PLATFORM_WHERE.goLive },
  promote: { label: "Approved, waiting to move to production", where: PLATFORM_WHERE.goLive },
  verification: { label: "Nonprofit papers to review", where: PLATFORM_WHERE.verification },
  access_request: { label: "New request for access", where: PLATFORM_WHERE.requests },
  readiness: { label: "Go-live checks not passing", where: PLATFORM_WHERE.pipeline },
};

export function waitingKind(kind: string): { label: string; where: Where } {
  return WAITING_KIND[kind] ?? { label: kind, where: PLATFORM_WHERE.centers };
}

/** The activity-recording consent a community's own administrator gave, in words. */
export const RECORDING_WORDS: Record<string, string> = { not_agreed: "Not agreed yet", on: "On", off: "Stopped" };

export const recordingWords = (state: string): string => RECORDING_WORDS[state] ?? state;

/** A community's status in the words the team uses. */
export const COMMUNITY_STATUS_WORDS: Record<string, string> = { onboarding: "setting up", active: "live", suspended: "suspended" };

export const communityStatusWords = (status: string): string => COMMUNITY_STATUS_WORDS[status] ?? status;

export const NONPROFIT_WORDS: Record<string, string> = {
  unverified: "has not sent its nonprofit papers yet",
  submitted: "has sent its nonprofit papers and they are waiting for review",
  verified: "is verified as a nonprofit",
  rejected: "had its nonprofit papers sent back",
};

/** Where the community's go-live request stands, in words (the first approval is the team's, the second must be a different person). */
export function goLiveWords(g: NonNullable<CommunitySummary["goLive"]>): string {
  switch (g.status) {
    case "requested":
      return g.firstApproved ? "asked to go live and is waiting for a second approval" : "asked to go live and is waiting for a first approval";
    case "approved":
      return "was approved to go live and is waiting to be moved to production";
    case "rejected":
      return "asked to go live and was sent back";
    case "live":
      return "is live";
    default:
      return `has a go-live request (${g.status})`;
  }
}

/** What the team should know about one community, as short sentences, ready to say. Pure. */
export function summaryWords(s: CommunitySummary, kind: string): string[] {
  const c = s.community;
  const out: string[] = [];
  const status = communityStatusWords(c.status);
  out.push(`${c.name} is a ${c.environment === "sandbox" ? "sandbox" : "community"} of kind ${kind}, ${status}${c.movedToProductionAs ? ` (moved to production as ${c.movedToProductionAs})` : ""}.`);
  out.push(`${s.size.households.toLocaleString("en-US")} households and ${s.size.people.toLocaleString("en-US")} people; ${s.size.signedInAccounts.toLocaleString("en-US")} have signed in; ${s.size.activeMemberships.toLocaleString("en-US")} active memberships.`);
  if (s.setup) out.push(`Setup: ${s.setup.done} of ${s.setup.total} required steps are done.`);
  if (s.readiness) {
    const failing = s.readiness.failing;
    out.push(
      failing.length === 0
        ? `All ${s.readiness.total} go-live checks pass.`
        : `${failing.length} of ${s.readiness.total} go-live checks do not pass: ${failing.slice(0, 5).map((x) => x.check).join("; ")}${failing.length > 5 ? "; and more" : ""}.`,
    );
  } else out.push("The go-live checks could not be run.");
  if (s.goLive) out.push(`It ${goLiveWords(s.goLive)}.`);
  if (s.verification) out.push(`It ${NONPROFIT_WORDS[s.verification.status] ?? `has nonprofit status "${s.verification.status}"`}.`);
  out.push(
    s.consent.activityRecording === "not_agreed"
      ? "Its administrator has not agreed to record how the portal is used."
      : `Recording how the portal is used is ${s.consent.activityRecording === "on" ? "on" : "stopped"}${s.consent.sharesWithWeaver ? " and shared with Weaver" : " and not shared with Weaver"}.`,
  );
  if (s.modulesOff.length > 0) out.push(`Modules switched off: ${s.modulesOff.join(", ")}.`);
  return out;
}

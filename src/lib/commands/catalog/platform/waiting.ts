import { formatDate, formatDateTime } from "@/lib/dates";
import { daysSince } from "@/lib/platform-onboarding";
import { reportReads } from "@/lib/reports/load";
import { recordingWords, waitingKind } from "@/lib/reports/platform-words";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";

import { got } from "../reports/shared";

export type PlatformWaitingData = {
  as_of: string | null;
  /** How many of each kind are waiting (before the limit). */
  counts: { go_live_requests: number; approved_waiting_to_move: number; nonprofit_papers: number; access_requests: number; communities_with_failing_checks: number; access_requests_waiting_on_them: number };
  waiting: {
    kind: string;
    community: string;
    address: string | null;
    waiting_since: string | null;
    days_waiting: number | null;
    what: string;
    details: string[];
    where: { label: string; href: string };
  }[];
  consent: { community: string; address: string; kind: string; activity_recording: string; shares_with_weaver: boolean; support_access: string }[];
};

const input = object({
  limit: f.withDefault(f.integer("The most waiting things to list, oldest kind of work first.", { min: 1, max: 100 }), 25),
});

/** The Weaver team's inbox across communities: who is waiting for the team, what is missing, and each community's consent states. */
export const platformWaiting = defineCommand<Infer<typeof input>, PlatformWaitingData>({
  key: "platform.waiting",
  title: "Show who is waiting and what is missing",
  description:
    "The Weaver team's inbox across all communities: go-live requests waiting for a first or second approval, approved sandboxes waiting to be moved to production, nonprofit papers waiting for review, " +
    "new requests for access, sandboxes whose go-live checks do not pass yet (with the first few checks that fail), and each community's consent states (whether its own administrator agreed to record how the portal is used, " +
    "whether it shares that with Weaver, and whether the owner has opened support access for the team). Use it for 'who is waiting for us?' and 'what is blocking go-live?'. " +
    "It names communities, never members, learners or children, and gives no email or phone number. Only the Weaver team can use it. It changes nothing: approving, sending back and moving to production are done on the Platform screens.",
  level: "read",
  permission: "dashboard",
  platformOnly: true,
  input,
  async execute(ctx, { limit }) {
    const tz = ctx.session.center.time_zone;
    const now = ctx.now?.() ?? new Date();
    const w = got(await reportReads.platformWaiting(ctx.session.db, limit), "read who is waiting");
    const data: PlatformWaitingData = {
      as_of: w.asOf ? formatDateTime(w.asOf, tz) : null,
      counts: {
        go_live_requests: w.counts.golive,
        approved_waiting_to_move: w.counts.promote,
        nonprofit_papers: w.counts.verification,
        access_requests: w.counts.accessRequests,
        communities_with_failing_checks: w.counts.readiness,
        access_requests_waiting_on_them: w.counts.accessRequestsWaitingOnThem,
      },
      waiting: w.items.map((i) => {
        const kind = waitingKind(i.kind);
        return {
          kind: kind.label,
          community: i.community,
          address: i.slug,
          waiting_since: i.since ? formatDate(i.since, tz) : null,
          days_waiting: daysSince(i.since, now),
          what: i.detail,
          details: i.more,
          where: kind.where,
        };
      }),
      consent: w.consent.map((k) => ({
        community: k.community,
        address: k.slug,
        kind: k.environment === "sandbox" ? "Sandbox" : "Community",
        activity_recording: recordingWords(k.activityRecording),
        shares_with_weaver: k.sharesWithWeaver,
        support_access: k.supportAccessUntil ? `Open until ${formatDate(k.supportAccessUntil, tz)}` : "None open",
      })),
    };
    const total = w.counts.golive + w.counts.promote + w.counts.verification + w.counts.accessRequests + w.counts.readiness;
    return {
      ok: true,
      data,
      message: total === 0 ? "Nobody is waiting for the team right now." : `${total} thing${total === 1 ? " is" : "s are"} waiting${w.items.length < total ? `; showing ${w.items.length}` : ""}.`,
    };
  },
});

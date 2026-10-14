import { formatDate, formatDateTime } from "@/lib/dates";
import { reportReads } from "@/lib/reports/load";
import { communityStatusWords, goLiveWords, NONPROFIT_WORDS, recordingWords, summaryWords } from "@/lib/reports/platform-words";

import { defineCommand } from "../../define";
import { f, object, type Infer } from "../../schema";
import { CommandError } from "../../types";

import { got } from "../reports/shared";

import { findCommunity, kindLabel } from "./shared";

export type CommunitySummaryData = {
  community: string;
  address: string;
  kind: string;
  status: string;
  sandbox: boolean;
  created: string | null;
  owner: string | null;
  moved_to_production_as: string | null;
  size: { households: number; people: number; signed_in_accounts: number; active_memberships: number };
  setup: { done: number; total: number } | null;
  go_live_checks: { passing: number; total: number; failing: { check: string; detail: string }[] } | null;
  go_live_request: string | null;
  nonprofit_papers: string | null;
  consent: { activity_recording: string; shares_with_weaver: boolean; support_access: string; niva_actions_switched_on: number };
  modules_off: string[];
  ways_to_pay: string[];
  portal_addresses: number;
  last_staff_activity: string | null;
  /** The same, as short sentences. */
  in_words: string[];
};

const input = object({
  community: f.string("The community by its address (like riverside), its name or its id.", { min: 1, max: 120 }),
});

/** One page about one community. */
export const communitySummary = defineCommand<Infer<typeof input>, CommunitySummaryData>({
  key: "platform.community_summary",
  title: "Summarise one community",
  description:
    "One page about one community for the Weaver team: what kind of organization it is and its status, how many households and people it has and how many have signed in, how far its setup is, " +
    "which go-live checks do not pass, where its go-live request stands, its nonprofit verification, its consent states (record how the portal is used, share with Weaver, support access), the modules switched off, the ways to pay it accepts, " +
    "and when its staff last did something. Name the community by its address, its name or its id. Counts and sentences only: no member, learner or child is named and no contact detail is given. " +
    "Only the Weaver team can use it. Read only; changes are made on the Platform screens.",
  level: "read",
  permission: "dashboard",
  platformOnly: true,
  input,
  async execute(ctx, { community }) {
    const { db } = ctx.session;
    const tz = ctx.session.center.time_zone;
    const ref = await findCommunity(db, community);
    const s = got(await reportReads.communitySummary(db, ref.id), "read the community summary");
    if (!s) throw new CommandError(`There is no community called "${community}".`);
    const kind = await kindLabel(db, s.community.kind);
    const data: CommunitySummaryData = {
      community: s.community.name,
      address: s.community.slug,
      kind,
      status: communityStatusWords(s.community.status),
      sandbox: s.community.environment === "sandbox",
      created: s.community.createdAt ? formatDate(s.community.createdAt, tz) : null,
      owner: s.community.owner,
      moved_to_production_as: s.community.movedToProductionAs,
      size: { households: s.size.households, people: s.size.people, signed_in_accounts: s.size.signedInAccounts, active_memberships: s.size.activeMemberships },
      setup: s.setup,
      go_live_checks: s.readiness,
      go_live_request: s.goLive ? goLiveWords(s.goLive) : null,
      nonprofit_papers: s.verification ? (NONPROFIT_WORDS[s.verification.status] ?? s.verification.status) : null,
      consent: {
        activity_recording: recordingWords(s.consent.activityRecording),
        shares_with_weaver: s.consent.sharesWithWeaver,
        support_access: s.consent.supportAccessUntil ? `Open until ${formatDate(s.consent.supportAccessUntil, tz)}` : "None open",
        niva_actions_switched_on: s.consent.nivaActionsSwitchedOn,
      },
      modules_off: s.modulesOff,
      ways_to_pay: s.waysToPay,
      portal_addresses: s.portalAddresses,
      last_staff_activity: s.lastStaffActivityAt ? formatDateTime(s.lastStaffActivityAt, tz) : null,
      in_words: summaryWords(s, kind),
    };
    return { ok: true, data, message: data.in_words[0] };
  },
});

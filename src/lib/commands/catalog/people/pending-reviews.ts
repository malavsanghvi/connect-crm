import { isAdultMember } from "../../child-filter";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { tierLabel } from "@/lib/people";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";
import { CommandDbError, type HouseholdCard } from "../../types";

import { cardsFor, fullName, today } from "./shared";

const input = object({});

const LIMIT = 15;
const KIND_LABEL: Record<string, string> = {
  add_member: "Add a family member",
  change_relationship: "Change a relationship",
  remove_member: "Remove a family member",
  new_household: "Move to a new household",
};

export type PendingReviewsData = {
  applications: { id: string; applicant: string; tier: string; step: string; fee: string | null; household: HouseholdCard | null }[];
  applications_total: number | null;
  family_requests: { id: string; kind: string; summary: string; household: HouseholdCard | null }[];
  family_requests_total: number;
  /** Requests that mention a child: they are not described here and are decided on the People screen. */
  family_requests_for_the_screen: number;
  note?: string;
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export const pendingReviews = defineCommand<Infer<typeof input>, PendingReviewsData>({
  key: "people.pending_reviews",
  title: "Show applications and family requests waiting",
  description:
    "List what People is waiting to decide: membership applications at the center review or Executive Committee step, and family change requests from members (add a family member, change a relationship). " +
    "Each has its household card so two households with the same name can be told apart. Use the ids with people.decide_application and people.decide_household_request. " +
    "A request that mentions a child is only counted, never described; it is decided on the People screen.",
  level: "read",
  permission: "householdRequests",
  module: "people",
  input,
  async execute(ctx) {
    const { db, center } = ctx.session;
    const showApplications = canAccess(ctx.session, "applications");

    const [apps, reqs] = await Promise.all([
      showApplications
        ? db
            .from("membership_applications")
            .select("id, applicant_person_id, household_id, tier, status, fee_cents, created_at", { count: "exact" })
            .eq("center_id", center.id)
            .in("status", ["awaiting_center", "awaiting_ec"])
            .order("created_at", { ascending: true })
            .limit(LIMIT)
        : Promise.resolve(null),
      db
        .from("household_change_requests")
        .select("id, household_id, kind, details, created_at", { count: "exact" })
        .eq("center_id", center.id)
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(LIMIT),
    ]);
    if (apps?.error) throw new CommandDbError(apps.error, "read the membership applications");
    if (reqs.error) throw new CommandDbError(reqs.error, "read the family change requests");

    const applicantIds = [...new Set((apps?.data ?? []).map((a) => a.applicant_person_id))];
    const people = applicantIds.length ? await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth").in("id", applicantIds) : null;
    if (people?.error) throw new CommandDbError(people.error, "read the applicants");
    const personById = new Map((people?.data ?? []).map((p) => [p.id, p]));
    const now = today(ctx);

    const cards = await cardsFor(ctx, [...(apps?.data ?? []).map((a) => a.household_id), ...(reqs.data ?? []).map((r) => r.household_id)]);
    const cardOf = (id: string) => cards.find((c) => c.household_id === id) ?? null;

    const applications: PendingReviewsData["applications"] = [];
    let forScreen = 0;
    for (const a of apps?.data ?? []) {
      const p = personById.get(a.applicant_person_id);
      applications.push({
        id: a.id,
        applicant: p && (p.date_of_birth ? isAdultMember({ date_of_birth: p.date_of_birth }, now) : true) ? fullName(p) : "someone you can't see",
        tier: tierLabel(a.tier),
        step: a.status === "awaiting_ec" ? "waiting for the Executive Committee" : "waiting for the center review",
        fee: a.fee_cents > 0 ? formatCents(a.fee_cents, center.currency) : null,
        household: cardOf(a.household_id),
      });
    }

    const family_requests: PendingReviewsData["family_requests"] = [];
    for (const r of reqs.data ?? []) {
      const d = (r.details && typeof r.details === "object" ? r.details : {}) as Record<string, unknown>;
      // Only a request to add an adult is described; anything else (or anything about a child) is left to the screen.
      const adultAdd = r.kind === "add_member" && isAdultMember({ date_of_birth: text(d.dob), role: text(d.relationship) }, now);
      if (!adultAdd) {
        forScreen += 1;
        continue;
      }
      const who = [text(d.first_name), text(d.last_name)].filter(Boolean).join(" ") || "a new person";
      family_requests.push({ id: r.id, kind: KIND_LABEL[r.kind] ?? r.kind, summary: `Add ${who}${text(d.relationship) ? `, asked for as their ${text(d.relationship)}` : ""}`, household: cardOf(r.household_id) });
    }

    return {
      ok: true,
      data: {
        applications,
        applications_total: showApplications ? (apps?.count ?? applications.length) : null,
        family_requests,
        family_requests_total: reqs.count ?? family_requests.length + forScreen,
        family_requests_for_the_screen: forScreen,
        ...(showApplications ? {} : { note: "Your role cannot see membership applications, so only family requests are listed." }),
      },
      message: applications.length + family_requests.length + forScreen === 0 ? "Nothing is waiting for a decision." : undefined,
    };
  },
});

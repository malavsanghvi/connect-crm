import { planDecision, type ApplicationDecision } from "@/lib/applications";
import type { Enums } from "@/lib/database.types";
import { formatCents } from "@/lib/money";
import { passesRoleChecks } from "@/lib/permissions";
import { tierLabel } from "@/lib/people";
import { dbWithReason, type CrmSession } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview, type PreviewLine } from "../../types";

import { cardLine, cardsFor, fullName, loadPersonBrief, refuseChildForAssistant } from "./shared";

const input = object({
  id: f.uuid("The membership application (its id, from people.pending_reviews)."),
  decision: f.enum("approve, or reject (decline).", ["approve", "reject"]),
  reason: f.optional(f.string("Why. Required to decline (it is kept for the applicant's record); optional to approve.", { min: 0, max: 5000 })),
});
export type DecideApplicationInput = Infer<typeof input>;

const TIER_RANK: Record<string, number> = { community: 1, yearly: 2, life: 3 };

type AppRow = {
  id: string;
  status: Enums<"application_status">;
  tier: string;
  membership_type_id: string;
  center_decided_by: string | null;
  household_id: string;
  applicant_person_id: string;
  reference_person_id: string | null;
  reference_decision: string | null;
  fee_cents: number;
};

async function load(ctx: CommandContext, inp: DecideApplicationInput) {
  const { session } = ctx;
  const { db, center } = session;
  const decision = inp.decision as ApplicationDecision;
  const doing = decision === "reject" ? "decline the application" : "approve the application";
  const reason = (inp.reason ?? "").trim();
  if (decision === "reject" && !reason) throw new CommandError("Could not decline the application — give a reason (it is kept for the applicant's record).");
  if (reason.length > 1000) throw new CommandError(`Could not ${doing} — the reason is longer than 1,000 characters.`);

  const appRes = await db
    .from("membership_applications")
    .select("id, status, tier, membership_type_id, center_decided_by, household_id, applicant_person_id, reference_person_id, reference_decision, fee_cents")
    .eq("id", inp.id)
    .eq("center_id", center.id)
    .maybeSingle();
  if (appRes.error) throw new CommandDbError(appRes.error, doing);
  if (!appRes.data) throw new CommandError(`Could not ${doing} — it was not found, or you can't see it.`);
  const app = appRes.data as unknown as AppRow;

  const typeRes = await db.from("membership_types").select("name, ec_approval_required, reference_tier_min").eq("id", app.membership_type_id).maybeSingle();
  if (typeRes.error) throw new CommandDbError(typeRes.error, doing);

  // The owner passes the Executive Committee check too (0501; owner decision 2026-09-25, second batch).
  const isEc = passesRoleChecks(session) || session.roles.some((r) => r.key === "executive_committee" && r.scopeKind === "center");
  const plan = planDecision(
    { status: app.status, tier: app.tier, ecApprovalRequired: typeRes.data?.ec_approval_required ?? false, centerDecidedBy: app.center_decided_by },
    decision,
    { userId: session.userId, isExecutiveCommittee: isEc },
  );
  if (!plan.ok) throw new CommandError(`Could not ${doing} — ${plan.reason}.`);
  return { app, plan, decision, doing, reason, type: typeRes.data };
}

/** The checks the Applications screen shows beside the decision, as sentences (the reference, their tier, their household, duplicates). */
async function checks(ctx: CommandContext, app: AppRow, type: { reference_tier_min: string | null } | null): Promise<PreviewLine[]> {
  const { db, center } = ctx.session;
  const lines: PreviewLine[] = [];
  if (app.reference_person_id) {
    const [person, links, own] = await Promise.all([
      db.from("people").select("first_name, last_name, preferred_name").eq("id", app.reference_person_id).maybeSingle(),
      db.from("household_members").select("household_id").eq("person_id", app.reference_person_id).is("left_at", null),
      db.from("memberships").select("tier").eq("person_id", app.reference_person_id).eq("status", "active"),
    ]);
    const households = (links.data ?? []).map((l) => l.household_id);
    let best = (own.data ?? []).map((m) => m.tier).sort((x, y) => (TIER_RANK[y] ?? 0) - (TIER_RANK[x] ?? 0))[0] ?? null;
    if (!best && households.length) {
      const hm = await db.from("memberships").select("tier").in("household_id", households).eq("status", "active");
      best = (hm.data ?? []).map((m) => m.tier).sort((x, y) => (TIER_RANK[y] ?? 0) - (TIER_RANK[x] ?? 0))[0] ?? null;
    }
    const min = type?.reference_tier_min ?? (app.tier === "life" ? "life" : app.tier === "yearly" ? "yearly" : null);
    lines.push({ label: "Reference", value: `${person.data ? fullName(person.data) : "someone you can't see"} · ${app.reference_decision ? `answered: ${app.reference_decision}` : "has not answered yet"}` });
    if (min) lines.push({ label: "Reference's membership", value: best ? `${tierLabel(best)} (needs ${tierLabel(min)} or higher): ${(TIER_RANK[best] ?? 0) >= (TIER_RANK[min] ?? 0) ? "passes" : "does not pass"}` : `none found (needs ${tierLabel(min)} or higher): does not pass` });
    lines.push({ label: "Reference's household", value: households.includes(app.household_id) ? "the same household as the applicant" : "outside the applicant's household" });
  } else {
    lines.push({ label: "Reference", value: "none named" });
  }
  const dupes = await db
    .from("merge_candidates")
    .select("id", { count: "exact", head: true })
    .eq("center_id", center.id)
    .eq("status", "open")
    .or(`left_id.eq.${app.applicant_person_id},right_id.eq.${app.applicant_person_id}`);
  if ((dupes.count ?? 0) > 0) lines.push({ label: "Possible duplicate", value: "the applicant has an open duplicate suggestion; check it before approving" });
  return lines;
}

/** What approval created (0130: the membership, and an open fee pledge when the type has a fee). */
async function approvedMessage(db: CrmSession["db"], id: string): Promise<string> {
  const appRes = await db.from("membership_applications").select("fee_cents, membership_id").eq("id", id).maybeSingle();
  const membershipId = appRes.data?.membership_id;
  const m = membershipId ? await db.from("memberships").select("tier, fee_pledge_id").eq("id", membershipId).maybeSingle() : null;
  if (appRes.error || !m || m.error || !m.data) {
    console.error("approved application: could not read the new membership", appRes.error ?? m?.error ?? "no membership_id");
    return "Approved. The membership record could not be read back — reload the household to check it.";
  }
  const fee = appRes.data?.fee_cents ?? 0;
  const tier = m.data.tier.charAt(0).toUpperCase() + m.data.tier.slice(1);
  if (fee <= 0) return `Approved · ${tier} membership is now active.`;
  return m.data.fee_pledge_id
    ? `Approved · ${tier} membership is now active, and the ${formatCents(fee)} fee is recorded as an open pledge (card payment is not connected yet).`
    : `Approved · ${tier} membership is now active. The ${formatCents(fee)} fee was not recorded because Pledges & donations is switched off.`;
}

export const decideApplication = defineCommand<DecideApplicationInput, undefined>({
  key: "people.decide_application",
  title: "Decide a membership application",
  description:
    "Approve or decline a membership application. Approving a yearly or life application first records the center review and then needs an Executive Committee member; " +
    "approving the final step makes the membership active and records the fee, if any, as an open pledge. Declining needs a reason. " +
    "It asks the person to confirm first and shows the checks (the reference, their membership, their household, duplicates), the household card and the fee in the community's currency.",
  level: "confirm",
  permission: "applicationsDecide",
  module: "membership",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/memberships/applications/actions.ts#decideApplicationAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const { app, plan, decision, reason, type } = await load(ctx, inp);
    const applicant = await loadPersonBrief(ctx, app.applicant_person_id);
    if (applicant) refuseChildForAssistant(ctx, applicant);
    const name = applicant?.name ?? "the applicant";
    const cards = await cardsFor(ctx, [app.household_id]);
    const fee = app.fee_cents > 0 ? formatCents(app.fee_cents, ctx.session.center.currency) : null;
    const summary =
      plan.next === "awaiting_ec"
        ? `Record the center review for ${name}'s ${tierLabel(app.tier)} application. It then waits for Executive Committee approval.`
        : plan.next === "approved"
          ? `Approve ${name}'s ${tierLabel(app.tier)} membership. It becomes active now${fee ? ` and the ${fee} fee is recorded as an open pledge` : ""}.`
          : `Decline ${name}'s ${tierLabel(app.tier)} application. The reason is kept with it.`;
    return {
      summary,
      lines: [
        { label: "Applicant", value: `${name} · ${cardLine(cards[0])}` },
        { label: "Membership", value: `${tierLabel(app.tier)}${type?.name ? ` · ${type.name}` : ""}` },
        ...(fee ? [{ label: "Fee", value: fee }] : []),
        { label: "Now", value: app.status.replace(/_/g, " ") },
        ...(reason ? [{ label: "Reason", value: reason }] : []),
        ...(decision === "approve" ? await checks(ctx, app, type) : []),
      ],
      households: cards,
      warnings: plan.next === "approved" ? ["Approving creates the membership right away."] : [],
    };
  },
  confirmText: (input_, preview) => (input_.decision === "reject" ? "Yes, decline this application" : `Yes, ${preview.summary.charAt(0).toLowerCase()}${preview.summary.slice(1).replace(/\.$/, "")}`),
  async execute(ctx, inp) {
    const { session } = ctx;
    const { app, plan, doing, reason } = await load(ctx, inp);
    if (ctx.via === "assistant") {
      const applicant = await loadPersonBrief(ctx, app.applicant_person_id);
      if (applicant) refuseChildForAssistant(ctx, applicant);
    }
    const now = (ctx.now?.() ?? new Date()).toISOString();
    const update =
      plan.step === "ec"
        ? { status: plan.next, ec_decided_by: session.userId, ec_decided_at: now }
        : plan.step === "center"
          ? { status: plan.next, center_decided_by: session.userId, center_decided_at: now, center_reason: reason || null }
          : app.status === "awaiting_ec"
            ? { status: plan.next, ec_decided_by: session.userId, ec_decided_at: now, center_reason: reason }
            : { status: plan.next, center_decided_by: session.userId, center_decided_at: now, center_reason: reason };

    const writer = reason ? await dbWithReason(session, reason) : session.db;
    const { data, error } = await writer
      .from("membership_applications")
      .update(update)
      .eq("id", inp.id)
      .eq("status", app.status) // someone else may have decided meanwhile
      .select("id");
    if (error) throw new CommandDbError(error, doing);
    if (!data || data.length === 0) throw new CommandError(`Could not ${doing} — it changed while you were looking (or you lack permission). Reload and try again.`);
    revalidateAfterCommand(["/memberships/applications", "/", `/households/${app.household_id}`]);
    const message =
      plan.next === "awaiting_ec"
        ? "Center review recorded. It now waits for Executive Committee approval."
        : plan.next === "approved"
          ? await approvedMessage(session.db, inp.id)
          : "Declined. The reason is saved with the application.";
    return { ok: true, data: undefined, message };
  },
});

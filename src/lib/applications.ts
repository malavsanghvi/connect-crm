// Membership application decisions (pure): what the next status is.
//
//   yearly (and any type without EC approval):  awaiting_center → approved
//   life   (or ec_approval_required types):     awaiting_center → awaiting_ec → approved
//   reject: any open status → rejected (reason required)

export const OPEN_APPLICATION_STATUSES = [
  "draft",
  "awaiting_reference",
  "reference_declined",
  "awaiting_center",
  "awaiting_ec",
] as const;

export type ApplicationDecision = "approve" | "reject";

export type DecisionInput = {
  status: string;
  tier: string;
  ecApprovalRequired: boolean;
  centerDecidedBy: string | null;
};

export type DecisionPlan =
  | { ok: true; next: "approved" | "awaiting_ec" | "rejected"; step: "center" | "ec" | "reject" }
  | { ok: false; reason: string };

export function needsEcApproval(tier: string, ecApprovalRequired: boolean): boolean {
  return ecApprovalRequired || tier === "life";
}

export function planDecision(
  app: DecisionInput,
  decision: ApplicationDecision,
  actor: { userId: string; isExecutiveCommittee: boolean },
): DecisionPlan {
  if (decision === "reject") {
    if (!(OPEN_APPLICATION_STATUSES as readonly string[]).includes(app.status)) {
      return { ok: false, reason: `the application is already ${app.status.replace(/_/g, " ")}` };
    }
    return { ok: true, next: "rejected", step: "reject" };
  }
  if (app.status === "awaiting_center") {
    return needsEcApproval(app.tier, app.ecApprovalRequired)
      ? { ok: true, next: "awaiting_ec", step: "center" }
      : { ok: true, next: "approved", step: "center" };
  }
  if (app.status === "awaiting_ec") {
    if (!actor.isExecutiveCommittee) {
      return { ok: false, reason: "the final approval for this tier is an Executive Committee step" };
    }
    if (app.centerDecidedBy && app.centerDecidedBy === actor.userId) {
      return {
        ok: false,
        reason: "you already made the center review, so a different Executive Committee member must give the EC approval",
      };
    }
    return { ok: true, next: "approved", step: "ec" };
  }
  if (app.status === "awaiting_reference" || app.status === "draft") {
    return { ok: false, reason: "the named reference has not approved it yet" };
  }
  if (app.status === "reference_declined") {
    return { ok: false, reason: "the reference declined — the applicant needs to name another reference" };
  }
  return { ok: false, reason: `the application is already ${app.status.replace(/_/g, " ")}` };
}

import { isAdultMember } from "../../child-filter";
import { RELATIONSHIP_OPTIONS, isHouseholdRole } from "@/lib/people";
import { dbWithReason } from "@/lib/session";

import { defineCommand } from "../../define";
import { revalidateAfterCommand } from "../../revalidate";
import { f, object, type Infer } from "../../schema";
import { CommandDbError, CommandError, type CommandContext, type CommandPreview } from "../../types";

import { CHILD_RECORDS_ON_SCREEN, cardLine, cardsFor, relationshipWords, today } from "./shared";

const ROLES = RELATIONSHIP_OPTIONS.map((o) => o.value) as ["spouse", ...string[]];

const input = object({
  id: f.uuid("The family change request (its id, from people.pending_reviews)."),
  decision: f.enum("approve, or reject (decline).", ["approve", "reject"]),
  role: f.optional(f.enum("When approving a request to add a family member: their relationship to the household (never primary).", ROLES)),
  reason: f.optional(f.string("Why. Required to decline (it is kept for the household's record).", { min: 0, max: 5000 })),
});
export type DecideRequestInput = Infer<typeof input>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function check(inp: DecideRequestInput) {
  const doing = inp.decision === "reject" ? "decline the request" : "approve the request";
  const role = inp.role ?? "";
  if (inp.decision === "approve" && (!isHouseholdRole(role) || role === "primary")) {
    throw new CommandError("Could not approve the request — choose their relationship to the household first.");
  }
  const reason = (inp.reason ?? "").trim();
  if (inp.decision === "reject" && !reason) throw new CommandError("Could not decline the request — give a reason (it is kept for the household's record).");
  if (reason.length > 1000) throw new CommandError(`Could not ${doing} — the reason is longer than 1,000 characters.`);
  return { doing, role, reason };
}

type RequestRow = { id: string; household_id: string; kind: string; details: unknown; status: string };

async function loadRequest(ctx: CommandContext, id: string): Promise<RequestRow> {
  const { db, center } = ctx.session;
  const res = await db.from("household_change_requests").select("id, household_id, kind, details, status").eq("id", id).eq("center_id", center.id).maybeSingle();
  if (res.error) throw new CommandDbError(res.error, "read the request");
  if (!res.data) throw new CommandError("That request was not found, or you can't see it.");
  if (res.data.status !== "open") throw new CommandError("That request was already decided.");
  return res.data as RequestRow;
}

/** D2: Niva reads no request about a child, and only the add-an-adult kind. The rest is decided on the screen. */
function guardForAssistant(ctx: CommandContext, req: RequestRow): void {
  if (ctx.via !== "assistant") return;
  const d = (req.details && typeof req.details === "object" ? req.details : {}) as Record<string, unknown>;
  const rel = text(d.relationship) ?? "";
  if (req.kind !== "add_member" || !isAdultMember({ date_of_birth: text(d.dob), role: rel || null }, today(ctx))) throw new CommandError(CHILD_RECORDS_ON_SCREEN);
}

export const decideHouseholdRequest = defineCommand<DecideRequestInput, undefined>({
  key: "people.decide_household_request",
  title: "Decide a family change request",
  description:
    "Approve or decline a request a member sent to change their household (add a family member, change a relationship). Approving an add-a-family-member request needs the person's relationship to the household; " +
    "declining needs a reason. It asks the person to confirm first and shows the household card and what the request says. " +
    "Niva only handles requests to add an adult; a request that mentions a child is decided on the People screen.",
  level: "confirm",
  permission: "householdRequestsDecide",
  module: "people",
  enabledByDefault: false,
  input,
  covers: ["src/app/(app)/people/requests/actions.ts#decideHouseholdRequestAction"],
  async preview(ctx, inp): Promise<CommandPreview> {
    const { role, reason } = check(inp);
    const req = await loadRequest(ctx, inp.id);
    const d = (req.details && typeof req.details === "object" ? req.details : {}) as Record<string, unknown>;
    guardForAssistant(ctx, req);
    const cards = await cardsFor(ctx, [req.household_id]);
    const who = [text(d.first_name), text(d.last_name)].filter(Boolean).join(" ") || "a new person";
    const approve = inp.decision === "approve";
    return {
      summary: approve ? `Approve the request to add ${who} to the household as ${relationshipWords(role)}.` : `Decline the request to add ${who} to the household.`,
      lines: [
        { label: "Household", value: cardLine(cards[0]) },
        { label: "Request", value: req.kind === "add_member" ? `Add ${who}${text(d.relationship) ? ` (they asked for: ${text(d.relationship)})` : ""}` : req.kind.replace(/_/g, " ") },
        ...(approve ? [{ label: "Relationship", value: relationshipWords(role) }] : [{ label: "Reason", value: reason }]),
      ],
      households: cards,
      warnings: approve ? ["They are added to the household right away."] : [],
    };
  },
  confirmText: (input_) => (input_.decision === "reject" ? "Yes, decline this request" : "Yes, approve this request"),
  async execute(ctx, inp) {
    const { doing, role, reason } = check(inp);
    if (ctx.via === "assistant") guardForAssistant(ctx, await loadRequest(ctx, inp.id));
    const writer = await dbWithReason(ctx.session, reason || `Family change request ${inp.decision === "approve" ? "approved" : "declined"}`);
    const res = await writer.rpc("decide_household_change_request", {
      p_request: inp.id,
      p_decision: inp.decision,
      ...(inp.decision === "approve" && isHouseholdRole(role) ? { p_role: role } : {}),
      ...(reason ? { p_reason: reason } : {}),
    });
    if (res.error) throw new CommandDbError(res.error, doing);
    revalidateAfterCommand(["/people/requests", "/households", "/people"]);
    return { ok: true, data: undefined, message: inp.decision === "approve" ? "Request approved — they're now in the household · audit logged" : "Request declined · audit logged" };
  },
});

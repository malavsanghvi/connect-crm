import { dateInTz } from "@/lib/dates";
import { ATTESTATIONS, GOLIVE_STATUS_LABEL } from "@/lib/platform-onboarding";
import { buildSetupView, whereLabel, type ChecklistRowIn, type FixAt, type SetupView } from "@/lib/settings-help/setup-view";

import { defineCommand } from "../../define";
import { object, type Infer } from "../../schema";
import { stripSecrets } from "../../secrets";

import { must } from "../db";

const input = object({});

export type SetupStatusData = SetupView & {
  go_live: {
    /** "Not requested", "Waiting for approvals", "Approved", "Sent back" or "Live". */
    request: string;
    /** The owner's own confirmations that are still missing (staff trained, health check, pilot). */
    owner_confirmations_missing: string[];
    /** Going live is the owner's decision; Niva only points to the place. */
    where: FixAt | null;
  } | null;
};

/** Where the community stands on its setup checklist and its go-live checks, and what is left, with where to fix each. */
export const setupStatus = defineCommand<Infer<typeof input>, SetupStatusData>({
  key: "settings.setup_status",
  title: "Check what is left before going live",
  description:
    "Answer 'what is left before we can go live?' and 'how is our setup going?'. Returns how many setup steps are done, the steps still open (most important first, with who owns each, when it is due " +
    "and the exact screen to fix it), and the go-live checks that do not pass yet with what is missing and where to fix it. For a sandbox it also says where the go-live request stands and which of the owner's " +
    "own confirmations are missing. It changes nothing: asking to go live and confirming as the owner are things only the owner does (settings.go_live and settings.confirm_as_owner point to the place).",
  level: "read",
  permission: "setup",
  input,
  async execute(ctx) {
    const { db, center } = ctx.session;
    const [list, ready, requests, attested] = await Promise.all([
      db.rpc("setup_checklist", { p_center: center.id }),
      db.rpc("readiness", { p_center: center.id }),
      db.from("golive_requests").select("status, requested_at").eq("center_id", center.id).order("requested_at", { ascending: false }).limit(1),
      db.from("center_attestations").select("key").eq("center_id", center.id),
    ]);
    const rows = (must(list, "read the setup checklist") ?? []) as ChecklistRowIn[];
    const checks = must(ready, "read the go-live checks") ?? [];
    const latest = (must(requests, "read the go-live request") ?? [])[0] as { status: string } | undefined;
    const done = new Set(((must(attested, "read the owner's confirmations") ?? []) as { key: string }[]).map((a) => a.key));

    const today = dateInTz(ctx.now?.() ?? new Date(), center.time_zone);
    const view = buildSetupView(rows, checks, today);
    const sandbox = center.environment === "sandbox";
    const go_live = sandbox
      ? {
          request: latest ? (GOLIVE_STATUS_LABEL[latest.status] ?? latest.status) : "Not requested",
          owner_confirmations_missing: ATTESTATIONS.filter((a) => !done.has(a.key)).map((a) => a.label),
          where: whereLabel("/setup/go-live"),
        }
      : null;
    const tail = go_live ? ` Going live is the owner's decision (Setup › Go-live): the request is "${go_live.request.toLowerCase()}".` : "";
    return { ok: true, data: stripSecrets({ ...view, go_live }).value, message: `${view.summary}${tail}` };
  },
});

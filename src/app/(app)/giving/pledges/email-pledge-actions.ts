"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { rpcJson } from "@/lib/commands/catalog/db";
import { communityMajority } from "@/lib/commands/child-filter";
import { CommandDbError } from "@/lib/commands/types";
import { failure, type ActionResult } from "@/lib/errors";
import { checkEmailAddress } from "@/lib/pledge-email/address";
import { parsePledgeEmailStatuses, type PledgeEmailStatus } from "@/lib/pledge-email/bulk";
import { parsePledgeEmailSheet, parseRequestStatus, queuedMessage, type PledgeEmailSheetData, type RequestStatus } from "@/lib/pledge-email/sheet";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Email a pledge (0792): giving.manage, as recording one. The Email sheet opens with the household's primary member and their address
// (pledgeEmailSheetAction), the person may change the address, and Send (emailPledgeAction) asks the database to write the pledge email
// with the pledge's PDF attached to exactly that address: the request is recorded once per confirmation key, the pledge's History says
// who sent it to which address, and the background service writes and sends it (the job carries ids only). The sheet then asks how it
// went (pledgeEmailStatusAction) until it is sent or has failed. A bulk upload asks the same question for many pledges at once
// (pledgeEmailsStatusAction). The database checks everything again.

const lowerFirst = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** What the Email sheet opens with. */
export async function pledgeEmailSheetAction(pledgeId: string): Promise<ActionResult<PledgeEmailSheetData>> {
  const auth = await authorizeAction("givingManage", "open the pledge to email it");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  if (!isUuid(pledgeId)) return { ok: false, error: "Could not open the pledge to email it — it was not found. Reload the page." };
  try {
    const j = await rpcJson(
      session.db,
      "pledge_email_recipient",
      { p_center: session.center.id, p_pledge: pledgeId, p_majority: communityMajority(session.center) },
      "open the pledge to email it",
    );
    const data = parsePledgeEmailSheet(j);
    if (!data) return { ok: false, error: "Could not open the pledge to email it — the database did not answer as expected. Try again." };
    return { ok: true, data };
  } catch (error) {
    return failure("Could not open the pledge to email it", error instanceof CommandDbError ? error.dbError : error);
  }
}

export type EmailPledgeInput = { pledgeId: string; to: string; key: string };
export type EmailedPledge = { requestId: string; to: string; replayed: boolean };

export async function emailPledgeAction(input: EmailPledgeInput): Promise<ActionResult<EmailedPledge>> {
  return withActivity("giving.email_pledge", () => send(input), {
    entityFrom: () => ({ kind: "pledge", id: input?.pledgeId }),
  });
}

async function send(input: EmailPledgeInput): Promise<ActionResult<EmailedPledge>> {
  const auth = await authorizeAction("givingManage", "email the pledge");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  if (!isUuid(input?.pledgeId)) return { ok: false, error: "Could not email the pledge — it was not found. Reload the page." };
  const address = checkEmailAddress(input.to);
  if (!address.ok) return { ok: false, error: `Could not email the pledge — ${lowerFirst(address.error)}` };
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (key.length < 8 || key.length > 120) return { ok: false, error: "Could not email the pledge — close the sheet and open it again." };
  let j: Record<string, unknown> | null;
  try {
    j = (await rpcJson(
      session.db,
      "send_pledge_email",
      { p_center: session.center.id, p_pledge: input.pledgeId, p_to: address.value, p_key: key },
      "email the pledge",
    )) as Record<string, unknown> | null;
  } catch (error) {
    return failure("Could not email the pledge. Nothing was sent", error instanceof CommandDbError ? error.dbError : error);
  }
  const requestId = typeof j?.request_id === "string" ? j.request_id : null;
  if (!j || !requestId) {
    return { ok: false, error: "The email may not have been sent: the database did not say. Look at the pledge's History before trying again." };
  }
  const to = typeof j.to === "string" ? j.to : address.value;
  revalidatePath("/giving/pledges");
  return { ok: true, data: { requestId, to, replayed: j.replayed === true }, message: queuedMessage(to) };
}

/** How one email is doing: waiting, sent, failed or not sent (and why). */
export async function pledgeEmailStatusAction(requestId: string): Promise<ActionResult<RequestStatus>> {
  const auth = await authorizeAction("givingManage", "check the email");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isUuid(requestId)) return { ok: false, error: "Could not check the email — it was not found. Reload the page." };
  try {
    const j = await rpcJson(session.db, "pledge_email_request_status", { p_center: session.center.id, p_request: requestId }, "check the email");
    const data = parseRequestStatus(j);
    if (!data) return { ok: false, error: "Could not check the email — the database did not answer as expected. Try again." };
    return { ok: true, data };
  } catch (error) {
    return failure("Could not check the email", error instanceof CommandDbError ? error.dbError : error);
  }
}

/** How each pledge's automatic email is doing: the bulk upload's result asks until nothing is waiting. */
export async function pledgeEmailsStatusAction(pledgeIds: string[]): Promise<ActionResult<PledgeEmailStatus[]>> {
  const auth = await authorizeAction("recordPledge", "check the emails");
  if (!auth.ok) return auth;
  const { session } = auth;
  if (!isModuleEnabled(session, "giving")) return { ok: false, error: moduleOffMessage("giving", session.center.name) };
  const ids = [...new Set((Array.isArray(pledgeIds) ? pledgeIds : []).filter((id) => isUuid(id)))];
  if (ids.length === 0) return { ok: true, data: [] };
  if (ids.length > 500) return { ok: false, error: "Could not check the emails — ask about at most 500 pledges at a time." };
  try {
    const j = await rpcJson(
      session.db,
      "pledge_email_status",
      { p_center: session.center.id, p_pledges: ids, p_majority: communityMajority(session.center) },
      "check the emails",
    );
    return { ok: true, data: parsePledgeEmailStatuses(j) };
  } catch (error) {
    return failure("Could not check the emails", error instanceof CommandDbError ? error.dbError : error);
  }
}

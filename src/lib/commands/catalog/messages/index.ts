// The Messages commands (B90 phase 4). Read and draft ones are on for everyone whose role allows them; the confirm-level ones are
// registered but OFF for Niva until the owner switches each on (assistant.tools.<key>). A message to a member is always confirm-level:
// Niva prepares it, the person presses the button. The Server Actions in src/app/(app)/comms/actions.ts call the same `execute`, so a
// screen, the ⌘K palette and Niva share one code path. messages.draft_reminder (an event reminder in English, Gujarati and Hindi)
// lives beside the first commands (../messages-draft-reminder.ts).

import type { AnyCommand } from "../../types";

import { approveCampaign } from "./approve-campaign";
import { messageAudiencePreview } from "./audience";
import { campaigns } from "./campaigns";
import { whyNotDelivered } from "./delivery";
import { draftReply } from "./draft-reply";
import { inboxTriage } from "./inbox-triage";
import { replyToThread } from "./reply-to-thread";
import { scheduleCampaign } from "./schedule-campaign";
import { setCampaignStatus } from "./set-campaign-status";
import { setThread } from "./set-thread";
import { handleWhatsappRequest } from "./whatsapp-request";

export { approveCampaign, handleWhatsappRequest, replyToThread, scheduleCampaign, setCampaignStatus, setThread };

/** In the order a person would meet them: look, prepare, then change. */
export const MESSAGES_COMMANDS: readonly AnyCommand[] = [
  // read
  inboxTriage,
  campaigns,
  messageAudiencePreview,
  whyNotDelivered,
  // draft
  draftReply,
  // confirm (off by default)
  scheduleCampaign,
  approveCampaign,
  setCampaignStatus,
  replyToThread,
  setThread,
  handleWhatsappRequest,
];

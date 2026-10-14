"use server";

import { revalidatePath } from "next/cache";

import {
  channelNotSetUpSentence,
  copiedMessage,
  copyName,
  fromTemplateMessage,
  savedTemplateMessage,
  templateDefaultName,
  templateNameProblem,
} from "@/lib/comms-templates";
import { loadChannels } from "@/lib/data/comms-templates";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

// Copy a communication as a new draft, and saved templates (docs/COMMS_HUB_TEMPLATES.md). Each action checks comms.send, then calls
// a database function (migration 0800) that checks it again, in the right community, with Communications on. Nothing here sends
// anything, and a copy never carries a schedule, an approval or a number. Every failure is a sentence next to what the person did.

function text(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function revalidateComms() {
  revalidatePath("/comms", "layout");
}

const INCOMPLETE = "the request was incomplete";
const NOT_HERE = ["alert", "survey"];

type Made = { id: string; name: string };

/** "Copy as new draft": a new working draft with the same words and audience, opened in the composer by the caller. */
export async function copyCampaignAction(_prev: ActionResult<Made> | null, fd: FormData): Promise<ActionResult<Made>> {
  const doing = "copy the communication";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — ${INCOMPLETE}.` };

  const src = await db.from("comms_campaigns").select("id, name, title, kind, channels").eq("id", id).eq("center_id", center.id).maybeSingle();
  if (src.error) return failure(`Could not ${doing}`, src.error);
  if (!src.data) return { ok: false, error: `Could not ${doing} — it was not found, or you can't see it.` };
  if (NOT_HERE.includes(src.data.kind)) return { ok: false, error: `Could not ${doing} — alerts and surveys are not copied here.` };

  const channels = await loadChannels(db, auth.session);
  const notSetUp = channelNotSetUpSentence(src.data.channels, channels.available);
  if (notSetUp) return { ok: false, error: `Could not ${doing} — ${notSetUp}.` };

  const name = copyName(src.data.name, src.data.title);
  const { data, error } = await db.rpc("copy_campaign_as_draft", { p_center: center.id, p_campaign: id, p_name: name });
  if (error) return failure(`Could not ${doing}`, error);
  if (!data) return { ok: false, error: `Could not ${doing} — the database did not return the new draft. Check the list before trying again.` };
  revalidateComms();
  return { ok: true, message: copiedMessage(name), data: { id: data, name } };
}

/** "Save as template": the words of a communication, under a name (default: its name, else its subject). */
export async function saveTemplateAction(_prev: ActionResult<Made> | null, fd: FormData): Promise<ActionResult<Made>> {
  const doing = "save the template";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — ${INCOMPLETE}.` };

  const src = await db.from("comms_campaigns").select("id, name, title, kind, channels").eq("id", id).eq("center_id", center.id).maybeSingle();
  if (src.error) return failure(`Could not ${doing}`, src.error);
  if (!src.data) return { ok: false, error: `Could not ${doing} — the communication was not found, or you can't see it.` };
  if (NOT_HERE.includes(src.data.kind)) return { ok: false, error: `Could not ${doing} — alerts and surveys are not saved as templates.` };

  const name = text(fd, "name") || templateDefaultName(src.data.name, src.data.title);
  const problem = templateNameProblem(name);
  if (problem) return { ok: false, error: `Could not ${doing} — ${problem}.` };

  const channels = await loadChannels(db, auth.session);
  const notSetUp = channelNotSetUpSentence(src.data.channels, channels.available);
  if (notSetUp) return { ok: false, error: `Could not ${doing} — ${notSetUp}.` };

  const { data, error } = await db.rpc("save_campaign_as_template", { p_center: center.id, p_campaign: id, p_name: name });
  if (error) return failure(`Could not ${doing}`, error);
  if (!data) return { ok: false, error: `Could not ${doing} — the database did not return the template. Check Templates before trying again.` };
  revalidateComms();
  return { ok: true, message: savedTemplateMessage(name), data: { id: data, name } };
}

/** "Use this template": a new working draft with the template's words and no audience, opened in the composer by the caller. */
export async function startFromTemplateAction(_prev: ActionResult<Made> | null, fd: FormData): Promise<ActionResult<Made>> {
  const doing = "start from the template";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — ${INCOMPLETE}.` };

  const tpl = await db.from("comms_templates").select("id, name, channels").eq("id", id).eq("center_id", center.id).maybeSingle();
  if (tpl.error) return failure(`Could not ${doing}`, tpl.error);
  if (!tpl.data) return { ok: false, error: `Could not ${doing} — the template was not found. It may have been deleted.` };

  const channels = await loadChannels(db, auth.session);
  const notSetUp = channelNotSetUpSentence(tpl.data.channels, channels.available);
  if (notSetUp) return { ok: false, error: `Could not ${doing} — ${notSetUp}.` };

  const { data, error } = await db.rpc("create_campaign_from_template", { p_center: center.id, p_template: id });
  if (error) return failure(`Could not ${doing}`, error);
  if (!data) return { ok: false, error: `Could not ${doing} — the database did not return the new draft. Check the list before trying again.` };
  revalidateComms();
  return { ok: true, message: fromTemplateMessage(tpl.data.name), data: { id: data, name: tpl.data.name } };
}

export async function renameTemplateAction(_prev: ActionResult<Made> | null, fd: FormData): Promise<ActionResult<Made>> {
  const doing = "rename the template";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = text(fd, "id");
  const name = text(fd, "name");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — ${INCOMPLETE}.` };
  const problem = templateNameProblem(name);
  if (problem) return { ok: false, error: `Could not ${doing} — ${problem}.` };

  const { error } = await db.rpc("rename_comms_template", { p_center: center.id, p_template: id, p_name: name });
  if (error) return failure(`Could not ${doing}`, error);
  revalidateComms();
  return { ok: true, message: `Renamed to "${name}".`, data: { id, name } };
}

export async function deleteTemplateAction(_prev: ActionResult<Made> | null, fd: FormData): Promise<ActionResult<Made>> {
  const doing = "delete the template";
  const auth = await authorizeAction("commsSend", doing);
  if (!auth.ok) return auth;
  const { db, center } = auth.session;
  const id = text(fd, "id");
  if (!isUuid(id)) return { ok: false, error: `Could not ${doing} — ${INCOMPLETE}.` };

  const tpl = await db.from("comms_templates").select("id, name").eq("id", id).eq("center_id", center.id).maybeSingle();
  if (tpl.error) return failure(`Could not ${doing}`, tpl.error);
  if (!tpl.data) return { ok: false, error: `Could not ${doing} — it was not found. It may already be deleted.` };

  const { error } = await db.rpc("delete_comms_template", { p_center: center.id, p_template: id });
  if (error) return failure(`Could not ${doing}`, error);
  revalidateComms();
  return { ok: true, message: `Deleted the template "${tpl.data.name}". Communications made from it are not changed.`, data: { id, name: tpl.data.name } };
}

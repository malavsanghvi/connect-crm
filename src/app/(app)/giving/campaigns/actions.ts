"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { parseAmountToCents } from "@/lib/money";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

const KINDS = ["general", "boli", "sponsorship", "construction", "pathshala", "event", "membership", "store", "other"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function createCampaignAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("campaignsManage", "create the campaign");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "general");
  const fundId = String(formData.get("fund_id") ?? "");
  const goalText = String(formData.get("goal") ?? "").trim();
  const startsOn = String(formData.get("starts_on") ?? "").trim();
  const endsOn = String(formData.get("ends_on") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();

  if (!name) return { ok: false, error: "Could not create the campaign — give it a name." };
  if (name.length > 160) return { ok: false, error: "Could not create the campaign — the name is longer than 160 characters." };
  if (!KINDS.includes(kind)) return { ok: false, error: "Could not create the campaign — choose a kind." };
  const goal = goalText ? parseAmountToCents(goalText) : null;
  if (goalText && (goal === null || goal <= 0)) return { ok: false, error: "Could not create the campaign — the goal must be an amount like 25000.00." };
  if ((startsOn && !DATE.test(startsOn)) || (endsOn && !DATE.test(endsOn))) return { ok: false, error: "Could not create the campaign — a date is not valid." };
  if (startsOn && endsOn && endsOn < startsOn) return { ok: false, error: "Could not create the campaign — it ends before it starts." };

  const { error } = await db.from("campaigns").insert({
    center_id: center.id,
    name,
    kind,
    fund_id: isUuid(fundId) ? fundId : null,
    goal_cents: goal,
    starts_on: startsOn || null,
    ends_on: endsOn || null,
    description: description || null,
    status: "draft",
    created_by: userId,
  });
  if (error) return failure("Could not create the campaign", error);
  revalidatePath("/giving/campaigns");
  return { ok: true, message: `Created "${name}" as a draft. Publish it when it is ready for members.` };
}

const TRANSITIONS: Record<string, { from: string[]; label: string }> = {
  published: { from: ["draft", "closed"], label: "publish" },
  closed: { from: ["published"], label: "close" },
  archived: { from: ["closed", "draft"], label: "archive" },
  draft: { from: ["published"], label: "unpublish" },
};

export async function setCampaignStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const next = String(formData.get("status") ?? "");
  const t = TRANSITIONS[next];
  const auth = await authorizeAction("campaignsManage", t ? `${t.label} the campaign` : "change the campaign");
  if (!auth.ok) return auth;
  const id = String(formData.get("id") ?? "");
  if (!t || !isUuid(id)) return { ok: false, error: "Could not change the campaign — unknown change." };
  const { data, error } = await auth.session.db
    .from("campaigns")
    .update({ status: next })
    .eq("id", id)
    .eq("center_id", auth.session.center.id)
    .in("status", t.from)
    .select("name");
  if (error) return failure(`Could not ${t.label} the campaign`, error);
  if (!data || data.length === 0) return { ok: false, error: `Could not ${t.label} the campaign — its status changed meanwhile. Reload and try again.` };
  revalidatePath("/giving/campaigns");
  return { ok: true, message: `"${data[0].name}" is now ${next}.` };
}

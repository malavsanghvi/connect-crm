"use server";

import { revalidatePath } from "next/cache";

import type { Json } from "@/lib/database.types";
import { explainError, failure, type ActionResult } from "@/lib/errors";
import { ALERT_AUDIENCES, OPPORTUNITY_TYPES, buildOptions, mergeAudience, removedTakenKeys, type OptionRow } from "@/lib/giving";
import { parseAmountToCents } from "@/lib/money";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

export type OpportunityInput = {
  id?: string | null;
  name: string;
  subtitle: string;
  kind: string;
  campaignId: string;
  allowAnonymous: boolean;
  rows: OptionRow[];
  audience: string[];
  publish: boolean;
};

function refresh() {
  revalidatePath("/giving/opportunities");
}

/** Create or update an opportunity (0022 kinds + options); on publish, draft the member alert in Communications. */
export async function saveOpportunityAction(input: OpportunityInput): Promise<ActionResult<{ id: string }>> {
  const auth = await authorizeAction("campaignsManage", input.publish ? "publish the opportunity" : "save the opportunity");
  if (!auth.ok) return auth;
  const { db, center, userId } = auth.session;
  const doing = input.publish ? "Could not publish the opportunity" : "Could not save the opportunity";
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: `${doing} — give it a name.` };
  if (name.length > 160) return { ok: false, error: `${doing} — the name is longer than 160 characters.` };
  if (!OPPORTUNITY_TYPES.some((t) => t.kind === input.kind) && input.kind !== "fixed") return { ok: false, error: `${doing} — choose a type.` };
  if (!isUuid(input.campaignId)) return { ok: false, error: `${doing} — choose the campaign it belongs to.` };
  const kind = input.kind as "tier" | "multi" | "amount" | "open";
  const built = buildOptions(kind, Array.isArray(input.rows) ? input.rows.slice(0, 60) : [], parseAmountToCents);
  if (!built.ok) return { ok: false, error: `${doing} — ${built.error[0].toLowerCase()}${built.error.slice(1)}` };

  const camp = await db.from("campaigns").select("id, status").eq("id", input.campaignId).eq("center_id", center.id).maybeSingle();
  if (camp.error) return failure(doing, camp.error);
  if (!camp.data) return { ok: false, error: `${doing} — that campaign was not found.` };
  if (input.publish && camp.data.status !== "published") {
    return { ok: false, error: `${doing} — its campaign is ${camp.data.status}; publish the campaign first (Opportunities › Campaigns).` };
  }

  const row = {
    center_id: center.id,
    campaign_id: input.campaignId,
    name,
    subtitle: (input.subtitle ?? "").trim().slice(0, 200) || null,
    kind,
    options: built.options as unknown as Json,
    allow_anonymous: Boolean(input.allowAnonymous),
    amount_cents: null,
    min_amount_cents: null,
    status: input.publish ? "open" : "draft",
  };

  let id: string;
  if (input.id) {
    if (!isUuid(input.id)) return { ok: false, error: `${doing} — it was not found.` };
    const av = await db.rpc("opportunity_availability", { p_opportunity: input.id });
    if (av.error) return failure(doing, av.error);
    const removed = removedTakenKeys(
      (av.data ?? []).flatMap((a) => (a.option_key ? [{ key: a.option_key, taken_count: a.taken_count ?? 0 }] : [])),
      built.options,
    );
    if (removed.length > 0) {
      return { ok: false, error: `${doing} — families have already pledged for ${removed.join(", ")}; those rows cannot be removed.` };
    }
    const up = await db.from("opportunities").update(row).eq("id", input.id).eq("center_id", center.id).select("id");
    if (up.error) return failure(doing, up.error);
    if (!up.data || up.data.length === 0) return { ok: false, error: `${doing} — no change was saved (it may have been removed, or you lack permission).` };
    id = input.id;
  } else {
    const ins = await db.from("opportunities").insert(row).select("id").single();
    if (ins.error) return failure(doing, ins.error);
    id = ins.data.id;
  }

  // Member alert: drafted in Communications for review — never sent from here.
  let alertNote = "";
  const audience = mergeAudience(input.audience ?? []);
  const untargetable = ALERT_AUDIENCES.filter((a) => (input.audience ?? []).includes(a.key) && !a.audience).map((a) => a.label);
  if (input.publish && audience) {
    if (can(auth.session, "comms.send")) {
      const c = await db.from("comms_campaigns").insert({
        center_id: center.id,
        kind: "appeal",
        name: `Giving alert · ${name}`,
        title: name,
        body_md: row.subtitle ?? `A new giving opportunity: ${name}.`,
        audience: audience as Json,
        status: "draft",
        created_by: userId,
      });
      if (c.error) {
        console.error("[opportunities] alert draft failed:", c.error);
        alertNote = ` The member alert was NOT drafted — ${explainError(c.error)}.`;
      } else {
        alertNote = " Member alert drafted in Communications for review and sending.";
      }
    } else {
      alertNote = " No member alert was drafted: that needs comms.send — ask the communications officer.";
    }
  }
  if (input.publish && untargetable.length > 0) alertNote += ` ${untargetable.join(" and ")} can't be targeted yet, so they were left out.`;
  refresh();
  return {
    ok: true,
    message: `${input.publish ? "Published" : "Saved draft"} opportunity "${name}" · saved and audited.${alertNote}`,
    data: { id },
  };
}

/** Live recipient count for the chosen alert audience (0025 segment_recipient_count; needs comms.send). */
export async function previewAudienceAction(keys: string[]): Promise<ActionResult<{ count: number | null; note: string | null }>> {
  const auth = await authorizeAction("campaignsManage", "preview the recipients");
  if (!auth.ok) return auth;
  const audience = mergeAudience(Array.isArray(keys) ? keys : []);
  if (!audience) return { ok: true, data: { count: null, note: null } };
  if (!can(auth.session, "comms.send")) return { ok: true, data: { count: null, note: "Recipient counts need comms.send." } };
  const r = await auth.session.db.rpc("segment_recipient_count", { p_center: auth.session.center.id, p_audience: audience as Json });
  if (r.error) return failure("Could not count the recipients", r.error);
  return { ok: true, data: { count: r.data ?? 0, note: null } };
}

export async function setOpportunityStatusAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const next = String(formData.get("status") ?? "");
  const id = String(formData.get("id") ?? "");
  const verb = next === "open" ? "reopen" : next === "closed" ? "close" : "change";
  const auth = await authorizeAction("campaignsManage", `${verb} the opportunity`);
  if (!auth.ok) return auth;
  if (!isUuid(id) || !["open", "closed", "draft"].includes(next)) return { ok: false, error: "Could not change the opportunity — unknown change." };
  const { data, error } = await auth.session.db
    .from("opportunities")
    .update({ status: next })
    .eq("id", id)
    .eq("center_id", auth.session.center.id)
    .select("name");
  if (error) return failure(`Could not ${verb} the opportunity`, error);
  if (!data || data.length === 0) return { ok: false, error: `Could not ${verb} the opportunity — it was not found, or you lack permission.` };
  refresh();
  return { ok: true, message: `"${data[0].name}" is now ${next === "open" ? "open to members" : next} · audit logged.` };
}

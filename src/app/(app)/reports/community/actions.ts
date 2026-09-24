"use server";

import { revalidatePath } from "next/cache";

import { failure, type ActionResult } from "@/lib/errors";
import { authorizeAction } from "@/lib/session";

/** Publish / unpublish one KPI on the public community dashboard (0023 public_kpi_settings; audited). */
export async function setKpiVisibilityAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const visibility = String(formData.get("visibility") ?? "");
  const key = String(formData.get("key") ?? "");
  const label = String(formData.get("label") ?? key).slice(0, 80);
  const verb = visibility === "public" ? "publish" : "unpublish";
  const auth = await authorizeAction("publicKpisManage", `${verb} "${label}"`);
  if (!auth.ok) return auth;
  if (!/^[a-z_]{2,40}$/.test(key) || !["public", "members"].includes(visibility)) return { ok: false, error: `Could not ${verb} the KPI — unknown KPI.` };
  const { error } = await auth.session.db
    .from("public_kpi_settings")
    .upsert({ center_id: auth.session.center.id, kpi_key: key, visibility }, { onConflict: "center_id,kpi_key" });
  if (error) return failure(`Could not ${verb} "${label}"`, error);
  revalidatePath("/reports/community");
  revalidatePath("/");
  return { ok: true, message: `${visibility === "public" ? "Published" : "Unpublished"} public KPI "${label}" · audit logged` };
}

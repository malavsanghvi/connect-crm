"use server";

import { revalidatePath } from "next/cache";

import { CUSTOM_TYPES, type CustomType } from "@/lib/import/mapping";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

const SENSITIVITIES = ["staff", "member_self", "directory"] as const;

function choicesFrom(v: FormDataEntryValue | null): string[] {
  return [...new Set(String(v ?? "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean))].slice(0, 100);
}

function refresh() {
  revalidatePath("/settings/custom-fields");
  revalidatePath("/people");
  revalidatePath("/households");
}

export async function defineCustomFieldAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "add the custom field");
  if (!auth.ok) return auth;
  const entity = String(fd.get("entity") ?? "");
  const label = String(fd.get("label") ?? "").trim();
  const type = String(fd.get("type") ?? "text") as CustomType;
  const sensitivity = String(fd.get("sensitivity") ?? "staff");
  if (!label) return { ok: false, error: "Could not add the custom field — give it a name." };
  if (label.length > 120) return { ok: false, error: "Could not add the custom field — keep the name under 120 characters." };
  if (!CUSTOM_TYPES.some((t) => t.value === type)) return { ok: false, error: "Could not add the custom field — choose a type." };
  if (!(SENSITIVITIES as readonly string[]).includes(sensitivity)) return { ok: false, error: "Could not add the custom field — choose who can see it." };
  const choices = choicesFrom(fd.get("choices"));
  if (type === "choice" && choices.length === 0) return { ok: false, error: "Could not add the custom field — a choice list needs at least one choice." };
  const { error } = await auth.session.db.rpc("define_custom_field", {
    p_center: auth.session.center.id,
    p_entity: entity,
    p_label: label,
    p_type: type,
    p_choices: choices,
    p_sensitivity: sensitivity,
    p_searchable: fd.get("searchable") === "on",
  });
  if (error) return failure("Could not add the custom field", error);
  refresh();
  return { ok: true, message: `${label} added.` };
}

export async function updateCustomFieldAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("centerSettings", "save the custom field");
  if (!auth.ok) return auth;
  const id = String(fd.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not save the custom field — it was not found." };
  const label = String(fd.get("label") ?? "").trim();
  const sensitivity = String(fd.get("sensitivity") ?? "");
  const status = String(fd.get("status") ?? "");
  if (!label) return { ok: false, error: "Could not save the custom field — give it a name." };
  if (sensitivity && !(SENSITIVITIES as readonly string[]).includes(sensitivity)) return { ok: false, error: "Could not save the custom field — choose who can see it." };
  if (status && status !== "active" && status !== "archived") return { ok: false, error: "Could not save the custom field — choose active or archived." };
  const choices = fd.has("choices") ? choicesFrom(fd.get("choices")) : undefined;
  const { error } = await auth.session.db.rpc("update_custom_field", {
    p_id: id,
    p_label: label,
    p_choices: choices,
    p_sensitivity: sensitivity || undefined,
    p_searchable: fd.get("searchable") === "on",
    p_status: status || undefined,
  });
  if (error) return failure("Could not save the custom field", error);
  refresh();
  return { ok: true, message: status === "archived" ? `${label} archived: it keeps its values but takes no new ones.` : `${label} saved.` };
}

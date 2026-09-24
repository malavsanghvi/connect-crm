"use server";

import { revalidatePath } from "next/cache";

import { identifierRules } from "@/lib/center-rules";
import { addDays, todayInTz } from "@/lib/dates";
import { externalIdInsert } from "@/lib/db-inserts";
import { failure, type ActionResult } from "@/lib/errors";
import { identifierKindLabel, identifierTarget, padOrgId } from "@/lib/identifiers";
import { IDENTIFIER_KINDS, canManageIdentifierKind, type IdentifierKind } from "@/lib/permissions";
import { isUuid } from "@/lib/search-params";
import { authorizeAction } from "@/lib/session";

function safeReturnPath(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(households|people)\/[0-9a-f-]{36}(\?.*)?$/i.test(s) ? s.split("?")[0] : "/households";
}

export async function addIdentifierAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("dashboard", "add the identifier");
  if (!auth.ok) return auth;
  const { session } = auth;
  const { db, center } = session;
  const rules = identifierRules(center.rules);

  const kind = String(formData.get("kind") ?? "") as IdentifierKind;
  const target = String(formData.get("target") ?? "");
  let value = String(formData.get("value") ?? "").trim();
  const system = String(formData.get("system") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const returnPath = safeReturnPath(formData.get("returnPath"));

  if (!IDENTIFIER_KINDS.includes(kind)) return { ok: false, error: "Could not add the identifier — choose what kind of identifier it is." };
  const kindLabel = identifierKindLabel(kind, rules);
  if (!canManageIdentifierKind(session, kind)) {
    const need = ["accounting", "bank_payer", "payment_provider"].includes(kind) ? "giving.manage" : "people.manage";
    return { ok: false, error: `Could not add the ${kindLabel} — you don't have permission (needs ${need}).` };
  }
  if (!value) return { ok: false, error: `Could not add the ${kindLabel} — enter the value exactly as the other system shows it.` };
  if (value.length > 200) return { ok: false, error: "Could not add the identifier — the value is longer than 200 characters." };
  if (!system) return { ok: false, error: "Could not add the identifier — say which system it comes from (for example neon or quickbooks)." };
  if (!/^[a-z0-9_.-]{1,40}$/i.test(system)) {
    return { ok: false, error: "Could not add the identifier — the system name may only use letters, numbers, dot, dash and underscore." };
  }
  const [targetKind, targetId] = target.split(":");
  if (!isUuid(targetId) || (targetKind !== "household" && targetKind !== "person")) {
    return { ok: false, error: "Could not add the identifier — choose who it belongs to." };
  }
  const mustBe = identifierTarget(kind);
  if (mustBe !== "either" && mustBe !== targetKind) {
    return {
      ok: false,
      error: `Could not add the ${kindLabel} — it belongs to ${
        mustBe === "person" ? "a person, not the household" : "the household, not a person"
      }. Choose ${mustBe === "person" ? "a member" : "the household"} under "Belongs to".`,
    };
  }
  if (kind === "org_member") value = padOrgId(value, rules.orgMemberDigits);
  if (kind === "org_household") value = padOrgId(value, rules.orgHouseholdDigits);

  const today = todayInTz(center.time_zone);
  const { error } = await db.from("external_ids").insert(
    externalIdInsert({
    center_id: center.id,
    household_id: targetKind === "household" ? targetId : null,
    person_id: targetKind === "person" ? targetId : null,
    kind,
    system: system.toLowerCase(),
    value,
    label: label || null,
    notes: notes || null,
    source: "manual",
    valid_from: today,
      created_by: session.userId,
    }),
  );
  if (error) {
    if (error.code === "23505") {
      const holder = await db.rpc("resolve_identifier", { p_center: center.id, p_value: value });
      const other = (holder.data ?? []).find((r) => r.kind === kind);
      return {
        ok: false,
        error: `Could not add the ${kindLabel} — "${value}" (${system}) is already assigned${
          other?.display_name ? ` to ${other.display_name}` : " to another record"
        }. Retire it there first if it moved.`,
      };
    }
    return failure(`Could not add the ${kindLabel}`, error);
  }
  revalidatePath(returnPath);
  return { ok: true, message: `Added ${kindLabel} "${value}".` };
}

export async function retireIdentifierAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const auth = await authorizeAction("dashboard", "retire the identifier");
  if (!auth.ok) return auth;
  const { session } = auth;
  const { db, center } = session;
  const id = String(formData.get("id") ?? "");
  const returnPath = safeReturnPath(formData.get("returnPath"));
  if (!isUuid(id)) return { ok: false, error: "Could not retire the identifier — it was not found." };

  const current = await db.from("external_ids").select("id, kind, value, valid_to").eq("id", id).maybeSingle();
  if (current.error) return failure("Could not retire the identifier", current.error);
  if (!current.data) return { ok: false, error: "Could not retire the identifier — it was not found, or you can't see it." };
  const kind = current.data.kind as IdentifierKind;
  const kindLabel = identifierKindLabel(kind, identifierRules(center.rules));
  if (!canManageIdentifierKind(session, kind)) {
    return { ok: false, error: `Could not retire the ${kindLabel} — you don't have permission.` };
  }
  if (current.data.valid_to) return { ok: false, error: `The ${kindLabel} "${current.data.value}" is already retired.` };

  // Last valid day = yesterday, so lookups stop resolving it today. The row stays for history.
  const lastDay = addDays(todayInTz(center.time_zone), -1);
  const { data, error } = await db
    .from("external_ids")
    .update({ valid_to: lastDay })
    .eq("id", id)
    .is("valid_to", null)
    .select("id");
  if (error) return failure(`Could not retire the ${kindLabel}`, error);
  if (!data || data.length === 0) {
    return { ok: false, error: `Could not retire the ${kindLabel} — no change was saved (you may not have permission).` };
  }
  revalidatePath(returnPath);
  return { ok: true, message: `Retired "${current.data.value}". It stays in the history.` };
}

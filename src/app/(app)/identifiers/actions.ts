"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { runScreenCommand } from "@/lib/commands/screen";
import { type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";

// Add and retire an identifier (the Identifiers panel on the household and person pages). Both are commands now
// (src/lib/commands/catalog/people, migration 0720): these actions read the form and call the same `execute` that the ⌘K palette and
// Niva use. Who may add or retire which kind is still decided by canManageIdentifierKind, and RLS on external_ids enforces it.
// The one change: retiring an identifier now asks for a reason, which goes on the audit row.

function safeReturnPath(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(households|people)\/[0-9a-f-]{36}(\?.*)?$/i.test(s) ? s.split("?")[0] : "/households";
}

export async function addIdentifierAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const [targetKind = "", targetId = ""] = String(formData.get("target") ?? "").split(":");
  const text = (key: string) => String(formData.get(key) ?? "");
  const result = await withActivity(
    "people.add_identifier",
    () =>
      runScreenCommand(
        "people.add_identifier",
        { kind: text("kind"), target_kind: targetKind, target_id: targetId, value: text("value"), system: text("system"), label: text("label"), notes: text("notes") },
        "add the identifier",
      ),
    { entityFrom: { kind: targetKind === "person" ? "person" : "household", id: targetId } },
  );
  // The panel may sit on another page than the one the id belongs to (a person's id added from the household page).
  if (result.ok) revalidatePath(safeReturnPath(formData.get("returnPath")));
  return result;
}

export async function retireIdentifierAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return { ok: false, error: "Could not retire the identifier — it was not found." };
  const result = await withActivity(
    "people.retire_identifier",
    () => runScreenCommand("people.retire_identifier", { identifier_id: id, reason: String(formData.get("reason") ?? "") }, "retire the identifier"),
    { entityFrom: { kind: "identifier", id } },
  );
  if (result.ok) revalidatePath(safeReturnPath(formData.get("returnPath")));
  return result;
}

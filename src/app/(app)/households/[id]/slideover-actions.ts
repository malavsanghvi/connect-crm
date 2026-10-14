"use server";

import { runScreenCommand } from "@/lib/commands/screen";
import { isHouseholdRole } from "@/lib/people";
import { isUuid } from "@/lib/search-params";

// "Add person" on the Family page (the New look's inline card). One thin Server Action: it checks the shape of what came from the
// browser, then runs the SAME people.add_person command the classic drawer's addPersonAction, the palette and Niva share, through
// runScreenCommand, so the permission, the audit trail, the household-card warning and every rule are the ones that already exist.
// The browser checked the draft with the same pure rules first (checkAddPerson); the command checks again.

export type AddPersonCall = {
  household_id: string;
  first_name: string;
  last_name: string;
  role: string;
  date_of_birth?: string;
  phone_e164?: string;
  email?: string;
};

export type AddPersonSave =
  | { ok: true; message: string; /** The new person (to open their details); null if the server did not say. */ personId: string | null }
  | { ok: false; error: string; stepUp?: boolean };

const SENDABLE = ["household_id", "first_name", "last_name", "role", "date_of_birth", "phone_e164", "email"] as const;

export async function addPersonInlineAction(input: AddPersonCall): Promise<AddPersonSave> {
  if (!input || typeof input !== "object" || !isUuid(input.household_id)) return { ok: false, error: "Could not add the person — the family was not found." };
  if (!isHouseholdRole(input.role) || input.role === "primary") return { ok: false, error: "Could not add the person — choose their relationship to the family." };
  const raw: Record<string, string> = {};
  for (const k of SENDABLE) {
    const v = (input as Record<string, unknown>)[k];
    // The names are always sent, even empty, so the command answers "first and last name are required" as the classic form does.
    if (k === "first_name" || k === "last_name") raw[k] = typeof v === "string" ? v : "";
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || v.length > 200) return { ok: false, error: "Could not add the person — a detail was not understood." };
    raw[k] = v;
  }
  const result = await runScreenCommand<{ personId: string }>("people.add_person", raw, "add the person");
  if (!result.ok) return { ok: false, error: result.error, ...(result.stepUp ? { stepUp: true } : {}) };
  return { ok: true, message: result.message ?? "Added", personId: result.data?.personId ?? null };
}

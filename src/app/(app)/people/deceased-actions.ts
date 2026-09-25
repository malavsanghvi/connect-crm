"use server";

import { revalidatePath } from "next/cache";

import { todayInTz } from "@/lib/dates";
import { markedMessage, parseDeceasedForm } from "@/lib/deceased";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

// The deceased flag (owner decision 2026-09-25). The database functions (0420) check
// people.manage, the reason and the date again, and write the audit rows with the reason.

function refresh(personId: string, householdIds: string[] = []) {
  revalidatePath("/people");
  revalidatePath("/households");
  revalidatePath("/people/directory");
  revalidatePath("/");
  revalidatePath(`/people/${personId}`);
  for (const h of householdIds) revalidatePath(`/households/${h}`);
}

export async function markDeceasedAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "This person");
  if (!isUuid(id)) return { ok: false, error: "Could not mark as deceased — the person was not found." };
  const auth = await authorizeAction("householdsEdit", "mark as deceased");
  if (!auth.ok) return auth;
  const { center } = auth.session;
  const parsed = parseDeceasedForm(
    {
      deceased_on: String(fd.get("deceased_on") ?? ""),
      note: String(fd.get("note") ?? ""),
      reason: String(fd.get("reason") ?? ""),
      confirm: fd.get("confirm") === "on" ? "on" : null,
    },
    todayInTz(center.time_zone),
    String(fd.get("date_of_birth") ?? "") || null,
  );
  if (!parsed.ok) return { ok: false, error: `Could not mark ${name} as deceased — ${parsed.error}.` };
  const db = await dbWithReason(auth.session, parsed.value.reason);
  const res = await db.rpc("mark_person_deceased", {
    p_person: id,
    p_deceased_on: parsed.value.deceasedOn,
    p_note: parsed.value.note ?? "",
    p_reason: parsed.value.reason,
  });
  if (res.error) return failure(`Could not mark ${name} as deceased`, res.error);
  const households = String(fd.get("household_ids") ?? "")
    .split(",")
    .filter(isUuid);
  refresh(id, households);
  return { ok: true, message: markedMessage(name, res.data) };
}

export async function undoDeceasedAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "This person");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!isUuid(id)) return { ok: false, error: "Could not undo — the person was not found." };
  if (!reason) return { ok: false, error: `Could not undo "deceased" for ${name} — give a reason. It goes in the audit log.` };
  const auth = await authorizeAction("householdsEdit", "undo deceased");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const res = await db.rpc("undo_person_deceased", { p_person: id, p_reason: reason });
  if (res.error) return failure(`Could not undo "deceased" for ${name}`, res.error);
  const restored = Number((res.data as { restored_memberships?: number } | null)?.restored_memberships ?? 0);
  const households = String(fd.get("household_ids") ?? "")
    .split(",")
    .filter(isUuid);
  refresh(id, households);
  return {
    ok: true,
    message: `${name} is no longer recorded as deceased${restored ? ` · ${restored} membership${restored === 1 ? "" : "s"} restored` : ""} · audit logged. If you chose a new primary member meanwhile, it stays as chosen.`,
  };
}

export async function setHouseholdPrimaryAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const household = String(fd.get("household_id") ?? "");
  const person = String(fd.get("person_id") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (!isUuid(household)) return { ok: false, error: "Could not change the primary member — the household was not found." };
  if (!isUuid(person)) return { ok: false, error: "Could not change the primary member — choose who becomes the primary member." };
  if (!reason) return { ok: false, error: "Could not change the primary member — give a reason. It goes in the audit log." };
  const auth = await authorizeAction("householdsEdit", "change the primary member");
  if (!auth.ok) return auth;
  const db = await dbWithReason(auth.session, reason);
  const res = await db.rpc("set_household_primary", { p_household: household, p_person: person, p_reason: reason });
  if (res.error) return failure("Could not change the primary member", res.error);
  revalidatePath(`/households/${household}`);
  revalidatePath(`/people/${person}`);
  revalidatePath("/households");
  return { ok: true, message: "The primary member is changed · audit logged. Pledges, payments and statements stay with the household." };
}

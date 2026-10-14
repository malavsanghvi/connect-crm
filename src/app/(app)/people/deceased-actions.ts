"use server";

import { revalidatePath } from "next/cache";

import { withActivity } from "@/lib/activity/with-activity";
import { runScreenCommand } from "@/lib/commands/screen";
import { failure, type ActionResult } from "@/lib/errors";
import { isUuid } from "@/lib/search-params";
import { authorizeAction, dbWithReason } from "@/lib/session";

// The deceased flag (owner decision 2026-09-25). The database functions (0420) check
// people.manage, the reason and the date again, and write the audit rows with the reason. Marking and choosing the primary member
// are commands now (src/lib/commands/catalog/people, migration 0720): these actions read the form and call the same `execute`.
// Undoing "deceased" stays a direct action for now.

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
  if (!isUuid(id)) return { ok: false, error: "Could not mark as deceased — the person was not found." };
  // A command now (people.mark_deceased, screenOnly): it checks the date, the reason and the tick with the same sentences, reads the
  // birth date from the record, and calls the same database function with the reason on the audit row.
  return withActivity(
    "people.mark_deceased",
    () =>
      runScreenCommand(
        "people.mark_deceased",
        {
          person_id: id,
          deceased_on: String(fd.get("deceased_on") ?? ""),
          note: String(fd.get("note") ?? ""),
          reason: String(fd.get("reason") ?? ""),
          confirmed: fd.get("confirm") === "on",
        },
        "mark as deceased",
      ),
    { entityFrom: { kind: "person", id } },
  );
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
  return withActivity(
    "people.set_primary",
    () => runScreenCommand("people.set_primary", { household_id: household, person_id: person, reason }, "change the primary member"),
    { entityFrom: { kind: "household", id: household } },
  );
}

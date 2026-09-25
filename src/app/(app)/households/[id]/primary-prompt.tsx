import { ActionForm } from "@/components/action-form";
import { Alert } from "@/components/ui";
import { personName } from "@/lib/data/lookups";
import { formatDate, todayInTz } from "@/lib/dates";
import { primaryCandidates } from "@/lib/deceased";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

import { setHouseholdPrimaryAction } from "../../people/deceased-actions";

/**
 * When the household's primary member has passed away (or no living primary is left), ask for a
 * new one (owner decision 2026-09-25). Pledges, payments and statements stay with the household;
 * past records keep the late member as the payer.
 */
export async function PrimaryPrompt({ session, householdId }: { session: CrmSession; householdId: string }) {
  const { db, center } = session;
  const links = await db.from("household_members").select("person_id, is_primary").eq("household_id", householdId).is("left_at", null);
  if (links.error) {
    console.error("[households] primary check failed; the new-primary prompt is not shown:", links.error);
    return null;
  }
  const ids = (links.data ?? []).map((l) => l.person_id);
  if (ids.length === 0) return null;
  const people = await db.from("people").select("id, first_name, last_name, preferred_name, date_of_birth, is_deceased, deceased_on, merged_into_id").in("id", ids);
  if (people.error) {
    console.error("[households] primary check failed; the new-primary prompt is not shown:", people.error);
    return null;
  }
  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));
  const primary = (links.data ?? []).filter((l) => l.is_primary).map((l) => byId.get(l.person_id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const livingPrimary = primary.some((p) => !p.is_deceased && !p.merged_into_id);
  const late = primary.find((p) => p.is_deceased);
  if (livingPrimary || !late) return null;
  const candidates = primaryCandidates(people.data ?? [], todayInTz(center.time_zone));
  const canEdit = canAccess(session, "householdsEdit");
  const lateName = personName(late);

  return (
    <div className="mb-5" data-testid="new-primary-prompt">
      <Alert tone="warning" title="Choose a new primary member">
        <p>
          {lateName}, the primary member, passed away{late.deceased_on ? ` on ${formatDate(late.deceased_on, center.time_zone)}` : ""}. Choose who is the household&apos;s
          primary member now. Pledges, payments and statements stay with the household, and past records keep {lateName} as the payer.
        </p>
        {candidates.length === 0 ? (
          <p className="mt-2">No living adult is left in this household. Add or move an adult into it first, or leave it as it is.</p>
        ) : !canEdit ? (
          <p className="mt-2">Someone with the people.manage permission can choose the new primary member.</p>
        ) : (
          <ActionForm action={setHouseholdPrimaryAction} submitLabel="Make primary member" pendingLabel="Saving…" className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="household_id" value={householdId} />
            <div>
              <label htmlFor="np-person" className="crm-label">
                New primary member
              </label>
              <select id="np-person" name="person_id" required className="crm-input" defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {candidates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personName(p)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="np-reason" className="crm-label">
                Reason (goes in the audit log)
              </label>
              <input id="np-reason" name="reason" required maxLength={1000} className="crm-input" defaultValue={`${lateName} passed away`} />
            </div>
          </ActionForm>
        )}
      </Alert>
    </div>
  );
}

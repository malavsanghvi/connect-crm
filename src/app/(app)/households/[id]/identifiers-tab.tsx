import { IdentifiersPanel } from "@/components/identifiers-panel";
import { QueryError } from "@/components/ui";
import { personName } from "@/lib/data/lookups";
import { todayInTz } from "@/lib/dates";
import type { CrmSession } from "@/lib/session";

export async function IdentifiersTab({
  session,
  householdId,
  household,
}: {
  session: CrmSession;
  householdId: string;
  household: { display_name: string; household_number: string | null };
}) {
  const { db, center } = session;
  const retry = `/households/${householdId}?tab=identifiers`;

  const links = await db.from("household_members").select("person_id, left_at").eq("household_id", householdId);
  if (links.error) return <QueryError what="members" error={links.error} retryHref={retry} />;
  const personIds = (links.data ?? []).map((l) => l.person_id);
  const currentIds = new Set((links.data ?? []).filter((l) => l.left_at === null).map((l) => l.person_id));

  const [peopleRes, idsRes] = await Promise.all([
    personIds.length > 0
      ? db.from("people").select("id, first_name, last_name, preferred_name, member_number").in("id", personIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("external_ids")
      .select("id, kind, system, value, label, person_id, household_id, source, confidence, times_matched, last_matched_at, valid_from, valid_to, notes")
      .eq("center_id", center.id)
      .or(personIds.length > 0 ? `household_id.eq.${householdId},person_id.in.(${personIds.join(",")})` : `household_id.eq.${householdId}`)
      .order("kind")
      .order("valid_to", { ascending: false, nullsFirst: true })
      .order("created_at", { ascending: false }),
  ]);
  if (peopleRes.error) return <QueryError what="members" error={peopleRes.error} retryHref={retry} />;
  if (idsRes.error) return <QueryError what="identifiers" error={idsRes.error} retryHref={retry} />;

  const people = peopleRes.data ?? [];
  const ownerNames = new Map<string, string>([[householdId, household.display_name]]);
  for (const p of people) ownerNames.set(p.id, personName(p));

  return (
    <IdentifiersPanel
      session={session}
      rows={idsRes.data ?? []}
      ownerNames={ownerNames}
      today={todayInTz(center.time_zone)}
      returnPath={`/households/${householdId}`}
      targets={[
        { value: `household:${householdId}`, label: `${household.display_name} (the household)`, type: "household" },
        ...people
          .filter((p) => currentIds.has(p.id))
          .map((p) => ({
            value: `person:${p.id}`,
            label: `${personName(p)}${p.member_number ? ` · ${p.member_number}` : ""}`,
            type: "person" as const,
          })),
      ]}
      connectNumbers={[
        { label: "Connect household number", value: household.household_number, owner: household.display_name },
        ...people.map((p) => ({ label: "Connect member number", value: p.member_number, owner: personName(p) })),
      ]}
    />
  );
}

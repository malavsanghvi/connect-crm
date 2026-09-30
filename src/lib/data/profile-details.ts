import "server-only";

import type { DbErrorLike } from "@/lib/errors";
import { can } from "@/lib/permissions";
import { dietaryChoices, interestLabels, type DietaryChoice } from "@/lib/profile-details";
import type { CrmSession } from "@/lib/session";

// What a member told the community about themselves in the app (migration 0546), for the
// person page. Plain queries; RLS decides what comes back (people.view / people.manage read
// the details; volunteer interests also need a volunteers permission), and each part carries
// its own error so one failed read never blanks the page.

export type ProfileDetailsView = {
  /** A details row exists for this person (the member has saved something). */
  recorded: boolean;
  anniversary: string | null;
  dietary: DietaryChoice[];
  emergency: { name: string; relationship: string | null; phone: string } | null;
  interests: string[];
  /** Volunteering areas the member ticked; null when the viewer has no volunteers permission. */
  volunteering: { ok: true; data: string[] } | { ok: false; error: DbErrorLike | string } | null;
  updatedAt: string | null;
  /** Set when the community's names for the dietary choices could not be read; the choices then show as stored. */
  labelsNote: string | null;
};

export async function loadProfileDetails(
  session: CrmSession,
  person: { id: string; interests: readonly string[] | null; isMinor: boolean },
): Promise<{ ok: true; data: ProfileDetailsView } | { ok: false; error: DbErrorLike | string }> {
  const { db, center } = session;
  const seesVolunteers = !person.isMinor && can(session, ["volunteers.view", "volunteers.manage"]);
  const [detailsRes, optionsRes, volunteerRes] = await Promise.all([
    db.from("person_profile_details").select("anniversary, dietary, dietary_other, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, updated_at").eq("person_id", person.id).maybeSingle(),
    db.from("dietary_options").select("key, label, active").eq("center_id", center.id),
    seesVolunteers ? db.from("volunteer_interests").select("group_id").eq("person_id", person.id).neq("status", "inactive") : null,
  ]);
  if (detailsRes.error) return { ok: false, error: detailsRes.error };
  // Without the option labels the keys still read (humanized), so this is not fatal: the card says so.
  const options = optionsRes.error ? [] : (optionsRes.data ?? []);
  const d = detailsRes.data;

  let volunteering: ProfileDetailsView["volunteering"] = null;
  if (volunteerRes) {
    if (volunteerRes.error) volunteering = { ok: false, error: volunteerRes.error };
    else {
      const groupIds = (volunteerRes.data ?? []).map((r) => r.group_id);
      if (groupIds.length === 0) volunteering = { ok: true, data: [] };
      else {
        const groups = await db.from("volunteer_groups").select("id, name").in("id", groupIds).order("name");
        volunteering = groups.error ? { ok: false, error: groups.error } : { ok: true, data: (groups.data ?? []).map((g) => g.name) };
      }
    }
  }

  return {
    ok: true,
    data: {
      recorded: !!d,
      anniversary: person.isMinor ? null : (d?.anniversary ?? null),
      dietary: dietaryChoices(d?.dietary, options, d?.dietary_other),
      emergency: d?.emergency_contact_name && d.emergency_contact_phone ? { name: d.emergency_contact_name, relationship: d.emergency_contact_relationship, phone: d.emergency_contact_phone } : null,
      interests: interestLabels(person.interests),
      volunteering,
      updatedAt: d?.updated_at ?? null,
      labelsNote: optionsRes.error ? "The community's names for the dietary choices could not be loaded, so they are shown as stored." : null,
    },
  };
}

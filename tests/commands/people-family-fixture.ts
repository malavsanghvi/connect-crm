// Test pieces for "Add a family" (slice 6): a community that is not a faith community, and a family whose names are not written in
// the Latin alphabet, on top of the People fixture.

import type { FakeDbOptions } from "./helpers";
import { fakeSession } from "./helpers";
import { peopleDb } from "./people-fixture";

export const MING = {
  household: "a0000000-0000-4000-8000-0000000000c1",
  person: "b0000000-0000-4000-8000-0000000000c1",
  second: "b0000000-0000-4000-8000-0000000000c2",
};

/** A neighbourhood association: nothing here is a faith community. */
export function neighbourhoodCenter() {
  return {
    ...fakeSession().center,
    slug: "riverside",
    name: "Riverside Neighbourhood Association",
    short_name: "Riverside",
    rules: { identifiers: { org_member_label: "Member number", org_household_label: "Household number" } },
  };
}

/** The People fixture plus a household of two adults whose names are written in Chinese and Arabic. */
export function familyDb(over: FakeDbOptions = {}) {
  const { db, tables } = peopleDb(over);
  const center_id = "center-1";
  tables.households.push({ id: MING.household, center_id, display_name: "李, 明", household_number: "H-2001", merged_into_id: null, city: "Austin" });
  tables.people.push(
    { id: MING.person, center_id, first_name: "明", last_name: "李", preferred_name: null, date_of_birth: "1975-04-04", member_number: "M-21", email: null, phone_e164: null, merged_into_id: null },
    { id: MING.second, center_id, first_name: "ليلى", last_name: "الحسن", preferred_name: null, date_of_birth: "1978-09-09", member_number: "M-22", email: null, phone_e164: null, merged_into_id: null },
  );
  tables.household_members.push(
    { household_id: MING.household, person_id: MING.person, center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: MING.household, person_id: MING.second, center_id, role: "spouse", is_primary: false, left_at: null },
  );
  return { db, tables };
}

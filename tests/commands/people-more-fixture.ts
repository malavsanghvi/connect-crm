// Test pieces for the People "More" commands (slice 5): the People fixture plus a fake that can insert an identifier (the shared
// fake database only reads and updates), a person whose name is not in the Latin alphabet, and a community that is not a faith
// community at all.

import type { FakeDbOptions } from "./helpers";
import { fakeSession } from "./helpers";
import { ID, peopleDb } from "./people-fixture";

type Row = Record<string, unknown>;

export const MING = {
  household: "a0000000-0000-4000-8000-0000000000c1",
  person: "b0000000-0000-4000-8000-0000000000c1",
  second: "b0000000-0000-4000-8000-0000000000c2",
  identifier: "ee000000-0000-4000-8000-0000000000c1",
};

/** A neighbourhood association: nothing here is a faith community, and the member number has five digits. */
export function neighbourhoodCenter() {
  return {
    ...fakeSession().center,
    slug: "riverside",
    name: "Riverside Neighbourhood Association",
    short_name: "Riverside",
    rules: { identifiers: { org_member_label: "Member number", org_member_digits: 5, org_member_system: "riverside_register" } },
  };
}

/** The People fixture, with a household of two adults whose names are written in Chinese and Arabic, and the call log for inserts. */
export function moreDb(over: FakeDbOptions & { insertError?: { code?: string; message: string } } = {}) {
  const { insertError, ...rest } = over;
  const { db, tables } = peopleDb(rest);
  const center_id = "center-1";
  tables.households.push({ id: MING.household, center_id, display_name: "李 明 家", household_number: "H-2001", merged_into_id: null, city: "Austin" });
  tables.people.push(
    { id: MING.person, center_id, first_name: "明", last_name: "李", preferred_name: null, date_of_birth: "1975-04-04", member_number: "M-21", email: null, phone_e164: null, merged_into_id: null },
    { id: MING.second, center_id, first_name: "ليلى", last_name: "الحسن", preferred_name: null, date_of_birth: "1978-09-09", member_number: "M-22", email: null, phone_e164: null, merged_into_id: null },
  );
  tables.household_members.push(
    { household_id: MING.household, person_id: MING.person, center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: MING.household, person_id: MING.second, center_id, role: "spouse", is_primary: false, left_at: null },
  );
  tables.external_ids.push({ id: MING.identifier, center_id, household_id: MING.household, person_id: MING.person, kind: "org_member", system: "riverside_register", value: "00021", valid_to: null });

  const inserted: Row[] = [];
  const realFrom = db.from.bind(db);
  const from = (table: string) => {
    const builder = realFrom(table) as unknown as Record<string, unknown>;
    if (table !== "external_ids") return builder;
    return new Proxy(builder, {
      get(target, prop) {
        if (prop === "insert") {
          return (row: Row) => {
            if (!insertError) inserted.push(row);
            return Promise.resolve({ data: null, error: insertError ?? null });
          };
        }
        return target[prop as string];
      },
    });
  };
  const wrapped = Object.assign(Object.create(null), db, { from }) as typeof db;
  // The holder of a value that is already taken (resolve_identifier), as the database names them.
  return { db: wrapped, tables, inserted, ID };
}

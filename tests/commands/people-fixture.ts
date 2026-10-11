// A small community for the People commands: ids are real UUIDs (the commands' schemas check them), two households with children
// in them (one child with a birth date, one with none and the role "child"), a duplicate of Priya in a duplicate household, a
// membership application, and two family requests (one for an adult, one for a child).

import { CommandRegistry } from "@/lib/commands/registry";
import { PEOPLE_COMMANDS } from "@/lib/commands/catalog/people";
import type { CommandVia } from "@/lib/commands/types";
import type { CrmSession } from "@/lib/session";

import { fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

type Row = Record<string, unknown>;

export const ID = {
  hhShah: "a0000000-0000-4000-8000-000000000001",
  hhPatel: "a0000000-0000-4000-8000-000000000002",
  hhShah2: "a0000000-0000-4000-8000-000000000003",
  priya: "b0000000-0000-4000-8000-000000000001",
  rahul: "b0000000-0000-4000-8000-000000000002",
  zoya: "b0000000-0000-4000-8000-000000000003",
  nikhil: "b0000000-0000-4000-8000-000000000004",
  aarav: "b0000000-0000-4000-8000-000000000005",
  priya2: "b0000000-0000-4000-8000-000000000006",
  candPerson: "d0000000-0000-4000-8000-000000000001",
  candChildren: "d0000000-0000-4000-8000-000000000002",
  candHousehold: "d0000000-0000-4000-8000-000000000003",
  app: "e0000000-0000-4000-8000-000000000001",
  type: "f0000000-0000-4000-8000-000000000001",
  reqAdult: "c0000000-0000-4000-8000-000000000001",
  reqChild: "c0000000-0000-4000-8000-000000000002",
  zone: "9a000000-0000-4000-8000-000000000001",
};

export const MERGE_PEOPLE_PREVIEW = {
  can_merge: true,
  blockers: [] as string[],
  keep: { id: ID.priya, member_number: "M-1" },
  drop: { id: ID.priya2, member_number: "M-6" },
  moves: { household_links: 1, shared_households: 0, primary_links: 1, external_ids: 2, memberships: 0, open_suggestions: 1 },
  fields: [] as string[],
};
export const MERGE_HOUSEHOLDS_PREVIEW = {
  can_merge: true,
  blockers: [] as string[],
  keep: { id: ID.hhShah, household_number: "H-1001" },
  drop: { id: ID.hhShah2, household_number: "H-1003" },
  moves: { members_moving: 1, already_in_keep: 0, primary_becomes_other: 1, household_ids_staying: 1, active_memberships_staying: 0, open_suggestions: 1 },
};

export const MINORS = ["Zoya Shah", "Aarav Patel"];
const center_id = "center-1";

export function peopleTables(): Record<string, Row[]> {
  return {
    households: [
      { id: ID.hhShah, center_id, display_name: "Shah, Priya, Rahul & Zoya", household_number: "H-1001", merged_into_id: null, address_line1: "1 Oak St", address_line2: null, city: "Austin", state_region: "TX", postal_code: "78701", zone_id: null, directory_opt_in: true, physical_mail_opt_in: true },
      { id: ID.hhPatel, center_id, display_name: "Patel family", household_number: "H-1002", merged_into_id: null, address_line1: null, address_line2: null, city: "Austin", state_region: "TX", postal_code: null, zone_id: null, directory_opt_in: false, physical_mail_opt_in: true },
      { id: ID.hhShah2, center_id, display_name: "Shah, Priya", household_number: "H-1003", merged_into_id: null, address_line1: null, address_line2: null, city: "Round Rock", state_region: "TX", postal_code: null, zone_id: null, directory_opt_in: false, physical_mail_opt_in: true },
    ],
    people: [
      { id: ID.priya, center_id, first_name: "Priya", last_name: "Shah", preferred_name: null, date_of_birth: "1984-03-02", member_number: "M-1", email: "priya@example.org", phone_e164: "+15125550101", gender: "female", profession: "Engineer", employer: null, language: "en", merged_into_id: null, photo_opt_in: false, new_member_contact_opt_in: false, expertise_opt_in: false, expertise_headline: null },
      { id: ID.rahul, center_id, first_name: "Rahul", last_name: "Shah", preferred_name: null, date_of_birth: "1982-07-19", member_number: "M-2", email: null, phone_e164: null, gender: "male", profession: null, employer: null, language: "en", merged_into_id: null, photo_opt_in: false, new_member_contact_opt_in: false, expertise_opt_in: false, expertise_headline: null },
      { id: ID.zoya, center_id, first_name: "Zoya", last_name: "Shah", preferred_name: null, date_of_birth: "2018-05-05", member_number: "M-3", email: null, phone_e164: null, gender: "female", profession: null, employer: null, language: "en", merged_into_id: null, photo_opt_in: false, new_member_contact_opt_in: false, expertise_opt_in: false, expertise_headline: null },
      { id: ID.nikhil, center_id, first_name: "Nikhil", last_name: "Patel", preferred_name: null, date_of_birth: "1979-01-30", member_number: "M-4", email: null, phone_e164: null, gender: "male", profession: null, employer: null, language: "en", merged_into_id: null, photo_opt_in: false, new_member_contact_opt_in: false, expertise_opt_in: false, expertise_headline: null },
      { id: ID.aarav, center_id, first_name: "Aarav", last_name: "Patel", preferred_name: null, date_of_birth: null, member_number: "M-5", email: null, phone_e164: null, gender: null, profession: null, employer: null, language: "en", merged_into_id: null, photo_opt_in: false, new_member_contact_opt_in: false, expertise_opt_in: false, expertise_headline: null },
      { id: ID.priya2, center_id, first_name: "Priya", last_name: "Shah", preferred_name: null, date_of_birth: null, member_number: "M-6", email: null, phone_e164: null, gender: null, profession: null, employer: null, language: "en", merged_into_id: null, photo_opt_in: false, new_member_contact_opt_in: false, expertise_opt_in: false, expertise_headline: null },
    ],
    household_members: [
      { household_id: ID.hhShah, person_id: ID.priya, center_id, role: "primary", is_primary: true, left_at: null },
      { household_id: ID.hhShah, person_id: ID.rahul, center_id, role: "spouse", is_primary: false, left_at: null },
      { household_id: ID.hhShah, person_id: ID.zoya, center_id, role: "child", is_primary: false, left_at: null },
      { household_id: ID.hhPatel, person_id: ID.nikhil, center_id, role: "primary", is_primary: true, left_at: null },
      { household_id: ID.hhPatel, person_id: ID.aarav, center_id, role: "child", is_primary: false, left_at: null },
      { household_id: ID.hhShah2, person_id: ID.priya2, center_id, role: "primary", is_primary: true, left_at: null },
    ],
    merge_candidates: [
      { id: ID.candPerson, center_id, kind: "person", left_id: ID.priya, right_id: ID.priya2, score: 0.9, status: "open", created_at: "2026-10-01" },
      { id: ID.candChildren, center_id, kind: "person", left_id: ID.zoya, right_id: ID.aarav, score: 0.4, status: "open", created_at: "2026-10-02" },
      { id: ID.candHousehold, center_id, kind: "household", left_id: ID.hhShah, right_id: ID.hhShah2, score: 0.8, status: "open", created_at: "2026-10-03" },
    ],
    center_users: [{ center_id, person_id: ID.priya, user_id: "user-priya" }],
    membership_types: [{ id: ID.type, center_id, name: "Yearly", ec_approval_required: false, reference_tier_min: "community" }],
    membership_applications: [
      { id: ID.app, center_id, applicant_person_id: ID.nikhil, household_id: ID.hhPatel, membership_type_id: ID.type, tier: "yearly", status: "awaiting_center", center_decided_by: null, reference_person_id: ID.rahul, reference_decision: "approved", fee_cents: 5000, membership_id: null, created_at: "2026-10-04" },
    ],
    memberships: [{ id: "m1", center_id, household_id: ID.hhShah, person_id: ID.priya, tier: "yearly", status: "active", starts_on: "2025-01-01", fee_pledge_id: null }],
    household_change_requests: [
      { id: ID.reqAdult, center_id, household_id: ID.hhShah, kind: "add_member", status: "open", details: { first_name: "Meera", last_name: "Shah", relationship: "parent", dob: "1955-02-02" }, created_at: "2026-10-05" },
      { id: ID.reqChild, center_id, household_id: ID.hhPatel, kind: "add_member", status: "open", details: { first_name: "Dev", last_name: "Patel", relationship: "child", dob: "2020-01-01" }, created_at: "2026-10-06" },
    ],
    external_ids: [
      { id: "x1", center_id, household_id: ID.hhPatel, person_id: null, kind: "accounting", system: "quickbooks", value: "QB-7", valid_to: null },
      { id: "x2", center_id, household_id: ID.hhPatel, person_id: ID.nikhil, kind: "crm", system: "neon", value: "N-77", valid_to: null },
      { id: "x3", center_id, household_id: ID.hhPatel, person_id: ID.aarav, kind: "crm", system: "neon", value: "N-99", valid_to: null },
    ],
    zones: [{ id: ID.zone, center_id }],
  };
}

const CARDS: Record<string, Row> = {
  [ID.hhShah]: { household_id: ID.hhShah, household_name: "Shah, Priya, Rahul & Zoya", household_number: "H-1001", org_household_id: "2041", members: "Priya, Rahul, Zoya", primary_member: "Priya Shah", primary_org_member_id: "0417", zone: "North", city: "Austin", last_gift_on: "2026-09-01", open_pledge_cents: 250000 },
  [ID.hhPatel]: { household_id: ID.hhPatel, household_name: "Patel family", household_number: "H-1002", org_household_id: "2042", members: "Nikhil, Aarav", primary_member: "Nikhil Patel", primary_org_member_id: "0418", zone: "South", city: "Austin", last_gift_on: null, open_pledge_cents: null },
  [ID.hhShah2]: { household_id: ID.hhShah2, household_name: "Shah, Priya", household_number: "H-1003", org_household_id: null, members: "Priya", primary_member: "Priya Shah", primary_org_member_id: null, zone: "North", city: "Round Rock", last_gift_on: null, open_pledge_cents: null },
};

export type PeopleWorld = { tables: Record<string, Row[]>; rpcCalls: { fn: string; args: Record<string, unknown> }[]; db: ReturnType<typeof fakeDb> };

/** A fake database for these commands. `rpc` adds or overrides answers (and `failRpc` makes one fail). */
export function peopleDb(over: FakeDbOptions = {}) {
  const tables = peopleTables();
  const db = fakeDb({
    tables,
    ...over,
    rpc: {
      household_card: (a: Record<string, unknown>) => (CARDS[String(a.p_household)] ? [CARDS[String(a.p_household)]] : []),
      resolve_identifier: [],
      staff_add_person: "b0000000-0000-4000-8000-0000000000aa",
      move_person_household: null,
      merge_people: null,
      merge_households: null,
      decide_household_change_request: null,
      change_household_tier: null,
      merge_people_preview: MERGE_PEOPLE_PREVIEW,
      merge_households_preview: MERGE_HOUSEHOLDS_PREVIEW,
      ...over.rpc,
    },
  });
  return { db, tables };
}

export const STAFF = ["people.view", "people.manage", "people.approve"];

export function staffSession(db: CrmSession["db"], permissions: string[] = STAFF, over: Partial<Record<keyof CrmSession, unknown>> = {}): CrmSession {
  return fakeSession({ db, permissions, ...over });
}

export function peopleRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const command of PEOPLE_COMMANDS) registry.register(command);
  return registry;
}

/** A context for these commands: a signed-in staff member, the People commands registered, and the community's minors known. */
export function peopleContext(opts: { via?: CommandVia; permissions?: string[]; db?: CrmSession["db"]; session?: Partial<Record<keyof CrmSession, unknown>> } = {}) {
  const db = opts.db ?? peopleDb().db;
  const session = staffSession(db, opts.permissions, opts.session);
  return testContext({ session, via: opts.via ?? "screen", registry: peopleRegistry(), minorNames: MINORS });
}

/** The community's switch for each confirm command, on. (They are off until an owner switches them on.) */
export function switchedOn(keys: string[]): Record<string, unknown> {
  return { assistant: { tools: Object.fromEntries(keys.map((k) => [k, true])) } };
}

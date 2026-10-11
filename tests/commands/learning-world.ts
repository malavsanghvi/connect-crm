// A small Pathshala for the Learning commands: three terms (one closed, one open for registration with its fees locked, one still a draft),
// levels with and without fees, classes with and without teachers, adults who could teach, and, in the learner tables, children with
// names, birth dates, notes and fees that must NEVER reach a model. The learner tables are filled on purpose: the D2 sweep proves the
// commands never even ask for them.

import { CATALOG } from "@/lib/commands/catalog";
import { CommandRegistry } from "@/lib/commands/registry";
import type { CommandVia } from "@/lib/commands/types";
import type { CrmSession } from "@/lib/session";

import { fakeDb, fakeSession, testContext, type FakeDbOptions } from "./helpers";

type Row = Record<string, unknown>;

const center_id = "center-1";

export const ID = {
  t1: "b1000000-0000-4000-8000-000000000001", // 2026-27, registration open, fees locked
  t2: "b1000000-0000-4000-8000-000000000002", // 2027-28, draft
  t0: "b1000000-0000-4000-8000-000000000003", // 2025-26, closed
  jain: "d1000000-0000-4000-8000-000000000001",
  guj: "d1000000-0000-4000-8000-000000000002",
  lJ1: "c1000000-0000-4000-8000-000000000001",
  lJ2: "c1000000-0000-4000-8000-000000000002",
  lG1: "c1000000-0000-4000-8000-000000000003",
  lAdult: "c1000000-0000-4000-8000-000000000004",
  lOld: "c1000000-0000-4000-8000-000000000005", // retired
  c1: "e1000000-0000-4000-8000-000000000001", // Jainism 1, has a teacher (Asha)
  c2: "e1000000-0000-4000-8000-000000000002", // Jainism 2, no teacher
  c3: "e1000000-0000-4000-8000-000000000003", // Gujarati 1, no teacher
  c4: "e1000000-0000-4000-8000-000000000004", // Jainism 1 next year (draft), no teacher
  c5: "e1000000-0000-4000-8000-000000000005", // Adult class, taught by Bina on Sunday 10:00 to 11:30
  c0: "e1000000-0000-4000-8000-000000000010", // Jainism 2 last year: Bina taught, a 16-year-old assisted
  asha: "f1000000-0000-4000-8000-000000000001",
  bina: "f1000000-0000-4000-8000-000000000002",
  dev: "f1000000-0000-4000-8000-000000000003",
  zoya: "f1000000-0000-4000-8000-000000000004", // a child
  tia: "f1000000-0000-4000-8000-000000000005", // 16: taught as an assistant last year
  aarav: "f1000000-0000-4000-8000-000000000006", // a child, no birth date
  kanta: "f1000000-0000-4000-8000-000000000007", // an adult with no birth date and no household
  priya: "f1000000-0000-4000-8000-000000000008", // the signed-in principal
  nobody: "f1000000-0000-4000-8000-0000000000ff",
  pos: "a2000000-0000-4000-8000-000000000001",
  user: "a1000000-0000-4000-8000-000000000001",
};

/** Names, birth dates and notes of children that must never appear in anything a model sees. */
export const CHILD_FACTS = {
  names: ["Zoya Shah", "Aarav Patel", "Tia Mehta"],
  firstNames: ["Zoya", "Aarav", "Tia"],
  birthDates: ["2018-05-05", "2009-10-11"],
  notes: ["peanut allergy", "needs a quiet seat", "We lost a job this year", "fell asleep in class", "Zoya's drawing of Mahavir"],
};

/** Tables that hold learners: the Learning commands must never read them. */
export const LEARNER_TABLES = [
  "pathshala_enrollments",
  "pathshala_attendance",
  "pathshala_progress_reports",
  "pathshala_registrations",
  "pathshala_pending_registrations",
  "pathshala_enrollment_fees",
  "pathshala_assistance_notes",
  "pathshala_sessions",
  "gyan_signoffs",
  "gyan_assignments",
  "gyan_submissions",
  "gyan_progress",
];

export function term(over: Row): Row {
  return {
    center_id,
    registration_opens_at: null,
    registration_closes_at: null,
    membership_required: false,
    fee_per_child_cents: 0,
    fee_per_family_cap_cents: null,
    sibling_discount_pct: 0,
    no_class_dates: [],
    payment_mode: "pledge",
    hold_hours: 48,
    office_payment_allowed: false,
    office_hold_days: 7,
    seat_rule: "automatic",
    campaign_id: null,
    fund_id: null,
    late_registration_closes_at: null,
    late_fee_cents: 0,
    withdrawal_credit_until: null,
    age_cutoff_on: null,
    fees_locked_at: null,
    fees_locked_by: null,
    ...over,
  };
}

export function klass(over: Row): Row {
  return { center_id, room: null, capacity: 12, meets_on: "sunday", starts_time: "10:00", ends_time: "11:00", class_email: null, waitlist_enabled: false, ...over };
}

export function learningTables(): Record<string, Row[]> {
  const people: Row[] = [
    { id: ID.asha, center_id, first_name: "Asha", last_name: "Mehta", preferred_name: null, date_of_birth: "1980-04-04", member_number: "1101", merged_into_id: null, is_deceased: false },
    { id: ID.bina, center_id, first_name: "Bina", last_name: "Shah", preferred_name: null, date_of_birth: "1975-08-08", member_number: "1102", merged_into_id: null, is_deceased: false },
    { id: ID.dev, center_id, first_name: "Dev", last_name: "Kapoor", preferred_name: null, date_of_birth: "1985-01-01", member_number: "1103", merged_into_id: null, is_deceased: false },
    { id: ID.zoya, center_id, first_name: "Zoya", last_name: "Shah", preferred_name: null, date_of_birth: "2018-05-05", member_number: null, merged_into_id: null, is_deceased: false },
    { id: ID.tia, center_id, first_name: "Tia", last_name: "Mehta", preferred_name: null, date_of_birth: "2009-10-11", member_number: null, merged_into_id: null, is_deceased: false },
    { id: ID.aarav, center_id, first_name: "Aarav", last_name: "Patel", preferred_name: null, date_of_birth: null, member_number: null, merged_into_id: null, is_deceased: false },
    { id: ID.kanta, center_id, first_name: "Kanta", last_name: "Desai", preferred_name: null, date_of_birth: null, member_number: "1104", merged_into_id: null, is_deceased: false },
    { id: ID.priya, center_id, first_name: "Priya", last_name: "Admin", preferred_name: null, date_of_birth: "1978-02-02", member_number: "1001", merged_into_id: null, is_deceased: false },
  ];
  const household_members: Row[] = [
    { household_id: "hh-mehta", person_id: ID.asha, center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: "hh-mehta", person_id: ID.tia, center_id, role: "child", is_primary: false, left_at: null },
    { household_id: "hh-shah", person_id: ID.bina, center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: "hh-shah", person_id: ID.zoya, center_id, role: "child", is_primary: false, left_at: null },
    { household_id: "hh-kapoor", person_id: ID.dev, center_id, role: "primary", is_primary: true, left_at: null },
    { household_id: "hh-patel", person_id: ID.aarav, center_id, role: "child", is_primary: false, left_at: null },
    { household_id: "hh-admin", person_id: ID.priya, center_id, role: "primary", is_primary: true, left_at: null },
  ];
  const households: Row[] = [
    { id: "hh-mehta", center_id, display_name: "Mehta, Asha & Tia", household_number: "H-2001", merged_into_id: null },
    { id: "hh-shah", center_id, display_name: "Shah, Bina & Zoya", household_number: "H-2002", merged_into_id: null },
    { id: "hh-kapoor", center_id, display_name: "Kapoor, Dev", household_number: "H-2003", merged_into_id: null },
    { id: "hh-patel", center_id, display_name: "Patel family", household_number: "H-2004", merged_into_id: null },
    { id: "hh-admin", center_id, display_name: "Admin, Priya", household_number: "H-2005", merged_into_id: null },
  ];
  return {
    people,
    household_members,
    households,
    pathshala_tracks: [
      { id: ID.jain, center_id, key: "jainism", name: "Jainism" },
      { id: ID.guj, center_id, key: "gujarati", name: "Gujarati" },
    ],
    pathshala_levels: [
      { id: ID.lJ1, center_id, track_id: ID.jain, key: "1", name: "Jainism 1", sort_order: 1, min_age: 5, max_age: 7, active: true },
      { id: ID.lJ2, center_id, track_id: ID.jain, key: "2", name: "Jainism 2", sort_order: 2, min_age: 8, max_age: 10, active: true },
      { id: ID.lAdult, center_id, track_id: ID.jain, key: "adult", name: "Adult class", sort_order: 9, min_age: 18, max_age: null, active: true },
      { id: ID.lG1, center_id, track_id: ID.guj, key: "1", name: "Gujarati 1", sort_order: 1, min_age: null, max_age: null, active: true },
      { id: ID.lOld, center_id, track_id: ID.jain, key: "old", name: "Jainism 0", sort_order: 0, min_age: 3, max_age: 4, active: false },
    ],
    pathshala_terms: [
      term({ id: ID.t1, name: "2026-27", starts_on: "2026-09-06", ends_on: "2027-05-30", status: "registration", sibling_discount_pct: 10, fee_per_family_cap_cents: 30000, late_fee_cents: 2500, registration_opens_at: "2026-08-01T15:00:00Z", registration_closes_at: "2026-09-13T04:59:00Z", fees_locked_at: "2026-08-01T15:00:00Z", fund_id: "fund-pathshala" }),
      term({ id: ID.t2, name: "2027-28", starts_on: "2027-09-05", ends_on: "2028-05-28", status: "draft" }),
      term({ id: ID.t0, name: "2025-26", starts_on: "2025-09-07", ends_on: "2026-05-31", status: "closed", fees_locked_at: "2025-08-01T15:00:00Z" }),
    ],
    pathshala_level_fees: [
      { center_id, term_id: ID.t1, level_id: ID.lJ1, fee_cents: 13000, set_by: null, set_at: null },
      { center_id, term_id: ID.t1, level_id: ID.lJ2, fee_cents: 14500, set_by: null, set_at: null },
      { center_id, term_id: ID.t0, level_id: ID.lJ1, fee_cents: 12000, set_by: null, set_at: null },
      { center_id, term_id: ID.t0, level_id: ID.lJ2, fee_cents: 12500, set_by: null, set_at: null },
    ],
    pathshala_classes: [
      klass({ id: ID.c1, term_id: ID.t1, level_id: ID.lJ1, name: "Jainism 1 · Room A", room: "A", starts_time: "10:00", ends_time: "11:00" }),
      klass({ id: ID.c2, term_id: ID.t1, level_id: ID.lJ2, name: "Jainism 2 · Room B", room: "B", starts_time: "10:00", ends_time: "11:30", capacity: 15 }),
      klass({ id: ID.c3, term_id: ID.t1, level_id: ID.lG1, name: "Gujarati 1 · Room C", room: "C", starts_time: "11:00", ends_time: "12:00" }),
      klass({ id: ID.c5, term_id: ID.t1, level_id: ID.lAdult, name: "Adult class", room: "Hall", starts_time: "10:00", ends_time: "11:30" }),
      klass({ id: ID.c4, term_id: ID.t2, level_id: ID.lJ1, name: "Jainism 1 · Room A", room: "A" }),
      klass({ id: ID.c0, term_id: ID.t0, level_id: ID.lJ2, name: "Jainism 2 · Room B", room: "B", starts_time: "10:00", ends_time: "11:30" }),
    ],
    pathshala_teachers: [
      { id: "pt-1", center_id, class_id: ID.c1, person_id: ID.asha, role: "teacher" },
      { id: "pt-2", center_id, class_id: ID.c5, person_id: ID.bina, role: "teacher" },
      { id: "pt-3", center_id, class_id: ID.c0, person_id: ID.bina, role: "teacher" },
      { id: "pt-4", center_id, class_id: ID.c0, person_id: ID.tia, role: "assistant" },
    ],
    teacher_positions: [{ id: ID.pos, center_id, term_id: ID.t1, level_id: ID.lJ2, title: "Jainism 2 teacher", status: "open" }],
    teacher_applications: [
      { id: "ta-1", center_id, position_id: ID.pos, person_id: ID.dev, name: "Dev Kapoor", outcome: "selected" },
      { id: "ta-2", center_id, position_id: ID.pos, person_id: ID.zoya, name: "Zoya Shah", outcome: "selected" },
      { id: "ta-3", center_id, position_id: ID.pos, person_id: ID.kanta, name: "Kanta Desai", outcome: "selected" },
    ],
    background_checks: [
      { id: "bc-1", center_id, person_id: ID.bina, status: "clear", cleared_on: "2025-03-01", expires_on: "2027-03-01" },
      { id: "bc-2", center_id, person_id: ID.asha, status: "clear", cleared_on: "2024-12-01", expires_on: "2026-06-01" },
    ],
    funds: [{ id: "fund-pathshala", center_id, key: "pathshala", name: "Pathshala", active: true }],
    // ---- the learners: none of this may ever reach a model, or even be read by a Learning command ----
    pathshala_enrollments: [
      { id: "en-1", center_id, term_id: ID.t1, class_id: ID.c1, student_person_id: ID.zoya, status: "placed", notes: "peanut allergy; needs a quiet seat", date_of_birth: "2018-05-05" },
      { id: "en-2", center_id, term_id: ID.t1, class_id: ID.c2, student_person_id: ID.aarav, status: "waitlisted", notes: "Aarav Patel fell asleep in class" },
    ],
    pathshala_attendance: [{ id: "at-1", enrollment_id: "en-1", status: "present", note: "Zoya Shah was late" }],
    pathshala_progress_reports: [{ id: "pr-1", enrollment_id: "en-1", remarks: "Zoya's drawing of Mahavir was lovely" }],
    pathshala_registrations: [{ id: "rg-1", center_id, household_id: "hh-shah", term_id: ID.t1 }],
    pathshala_pending_registrations: [{ id: "pg-1", center_id, term_id: ID.t1, first_name: "Aarav", last_name: "Patel", date_of_birth: "2017-02-02", status: "pending" }],
    pathshala_enrollment_fees: [{ id: "ef-1", center_id, enrollment_id: "en-1", term_id: ID.t1, household_id: "hh-shah", total_cents: 13000, status: "paid" }],
    pathshala_assistance_notes: [{ enrollment_id: "en-1", center_id, assistance_note: "We lost a job this year." }],
    pathshala_sessions: [{ id: "ss-1", class_id: ID.c1, held_on: "2026-09-13", topic: "Ahimsa" }],
    gyan_signoffs: [{ id: "gs-1", person_id: ID.zoya, status: "requested" }],
    gyan_assignments: [{ id: "ga-1", title: "Draw Mahavir" }],
    gyan_submissions: [{ id: "gx-1", person_id: ID.zoya, text: "Zoya's drawing of Mahavir" }],
    gyan_progress: [{ id: "gp-1", person_id: ID.zoya, level: 2 }],
  };
}

function card(id: string, name: string, number: string, members: string): Row {
  return { household_id: id, household_name: name, household_number: number, org_household_id: null, members, primary_member: name, primary_org_member_id: null, zone: "North", city: "Naperville", last_gift_on: null, open_pledge_cents: 0 };
}

export function learningWorld(): FakeDbOptions & { tables: Record<string, Row[]>; rpc: Record<string, unknown> } {
  const cards: Record<string, Row> = {
    "hh-mehta": card("hh-mehta", "Mehta, Asha & Tia", "H-2001", "Asha, Tia"),
    "hh-shah": card("hh-shah", "Shah, Bina & Zoya", "H-2002", "Bina, Zoya"),
    "hh-kapoor": card("hh-kapoor", "Kapoor, Dev", "H-2003", "Dev"),
  };
  return {
    tables: learningTables(),
    rpc: {
      household_card: (a: Record<string, unknown>) => (cards[String(a.p_household)] ? [cards[String(a.p_household)]] : []),
      // The database's counts, with one stray key a future version might add: only the known keys are ever read.
      pathshala_task_counts: {
        to_place: 3,
        held_for_payment: 2,
        held_ending_soon: 0,
        held_for_membership: 1,
        waiting_for_waiver: 0,
        waitlisted: 4,
        children_to_add: 1,
        assistance_to_decide: 2,
        payments_after_release: null,
        levels_without_fee: 1,
        learner_names: ["Zoya Shah", "Aarav Patel"],
      },
      pathshala_fee_totals: (a: Record<string, unknown>) => ({
        term_id: a.p_term,
        term: "2026-27",
        fee_lines: 7,
        base_cents: 95000,
        sibling_discount_cents: 4000,
        cap_reduction_cents: 0,
        late_fee_cents: 2500,
        assistance_cents: 5000,
        total_cents: 88500,
        paid_cents: 40000,
        billed_unpaid_cents: 30500,
        not_billed_cents: 18000,
        unpriced_lines: 1,
        by_level: [
          { level_id: ID.lJ1, level: "Jainism 1", track: "Jainism", fee_lines: 4, total_cents: 48000, paid_cents: 26000 },
          { level_id: ID.lJ2, level: "Jainism 2", track: "Jainism", fee_lines: 2, total_cents: 29000, paid_cents: 14000 },
          { level_id: ID.lG1, level: "Gujarati 1", track: "Gujarati", fee_lines: 1, total_cents: 11500, paid_cents: 0 },
        ],
      }),
      pathshala_pay_now_ready: () => null,
      set_pathshala_level_fees: () => null,
    },
  };
}

const PRINCIPAL = ["pathshala.view", "pathshala.manage", "giving.view", "giving.manage", "people.view", "people.manage", "safety.view"];

export function catalogRegistry() {
  const r = new CommandRegistry();
  for (const c of CATALOG) r.register(c);
  return r;
}

/** The signed-in principal, with every Pathshala permission, through a given door. Niva is switched on for the community. */
export function asPrincipal(opts: { via?: CommandVia; world?: FakeDbOptions; permissions?: string[]; rules?: unknown; session?: Partial<Record<keyof CrmSession, unknown>>; minors?: string[] } = {}) {
  const db = fakeDb(opts.world ?? learningWorld());
  const session = fakeSession({
    db,
    userId: ID.user,
    person: { id: ID.priya, name: "Priya Admin", memberNumber: "1001" },
    permissions: opts.permissions ?? PRINCIPAL,
    center: { ...fakeSession().center, rules: opts.rules ?? { assistant: { enabled: true } } },
    ...opts.session,
  });
  const ctx = testContext({ session, registry: catalogRegistry(), via: opts.via ?? "assistant", minorNames: opts.minors ?? CHILD_FACTS.names });
  return { ctx, db, session };
}

/** The rules that switch on, for Niva, the confirm commands of Learning. */
export const NIVA_MAY_CHANGE_LEARNING = {
  assistant: { enabled: true, tools: { "learning.assign_teacher": true, "learning.save_class": true, "learning.set_level_fees": true } },
};

// ---------------------------------------------------------------------------
// Watching what a command asks the database for
// ---------------------------------------------------------------------------
export type WriteCall = { op: "insert" | "update" | "delete" | "upsert"; table: string; payload: unknown; filters: [string, unknown][] };

/**
 * Wraps a fake database so a test can see which tables were read and which writes were tried. A write is NOT applied to the tables: it
 * is recorded and answered as done (an update answers with the one row it touched), or refused with the error given for that table.
 */
export function traceDb(fake: unknown, opts: { failWrites?: Record<string, { code?: string; message: string }>; updatesTouchNothing?: boolean } = {}) {
  const db = fake as { from: (table: string) => object };
  const tables: string[] = [];
  const writes: WriteCall[] = [];
  const original = db.from.bind(db);
  db.from = (table: string) => {
    tables.push(table);
    const builder = original(table);
    return new Proxy(builder, {
      get(target, prop, receiver) {
        if (prop === "insert" || prop === "update" || prop === "delete" || prop === "upsert") {
          return (payload?: unknown) => {
            const call: WriteCall = { op: prop, table, payload, filters: [] };
            writes.push(call);
            const failure = opts.failWrites?.[table];
            const chain: unknown = new Proxy(() => undefined, {
              get(_t, p: string) {
                if (p === "then") {
                  return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                    Promise.resolve(failure ? { data: null, error: failure } : { data: prop === "update" ? (opts.updatesTouchNothing ? [] : [{ id: "touched" }]) : null, error: null }).then(resolve, reject);
                }
                if (p === "eq") return (col: string, val: unknown) => (call.filters.push([col, val]), chain);
                return () => chain;
              },
            });
            return chain;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  };
  return { tables, writes };
}

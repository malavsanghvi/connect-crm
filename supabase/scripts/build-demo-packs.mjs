#!/usr/bin/env node
// Builds the two demo community packs (B88) as data and writes them as a migration.
//
//   node supabase/scripts/build-demo-packs.mjs [out.sql]       (default: supabase/migrations/0628_demo_pack_content.sql)
//
// A pack is JSON: {center, order, steps: {step: [ops]}, personas}. The loader that reads it is app.demo_load_pack (0629):
//   {t, r}            one row of table t                 {t, rows: [..]}   several rows
//   {op: "pay"|"rsvp"|"order", ...}                      the three things a plain insert cannot do (0627)
//   "@center" "@actor"  the community / the person who loaded it       "@ref"  a stable id for ref in this community
//   "+9d" "-30d"        a date relative to today                       "+9d@10:00"  a moment relative to today
// Every name, address, phone number (555-01xx) and e-mail (@demo.weaverams.org) is invented. Ages are plausible; the
// children's names are obviously fictional. To change a pack, change this file and generate a NEW migration (never edit
// an applied one); bump `version`.
//
// The script also checks the pack on its own: every "@ref" that a row uses is defined by some row, every role of the
// kind's role catalog has exactly one persona, and the counts the PR promises.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOMAIN = "demo.weaverams.org";

// ── Roles: what each can do, in plain words (the persona's story) ───────────
const ROLE_ORDER = [
  "center_admin", "executive_committee", "executive_viewer", "treasurer", "finance_volunteer", "membership_coordinator",
  "religious_coordinator", "communications_officer", "content_editor", "privacy_officer", "volunteer_coordinator",
  "event_lead", "checkin_volunteer", "kitchen_lead", "store_lead", "store_pickup", "boli_recorder", "pathshala_principal",
  "pathshala_committee", "teacher", "zone_lead", "community_member", "membership_reference", "primary_adult", "adult_member", "child",
];
const CAN = {
  center_admin: "looks after the whole organization: its settings, people, roles and connections to other services.",
  executive_committee: "sits on the executive committee: edits people-level information, approves memberships and reads the reports.",
  executive_viewer: "is a board member who can look at the dashboards and reports but cannot change anything.",
  treasurer: "keeps the books: records and refunds gifts, matches the bank, sends statements and closes each month.",
  finance_volunteer: "helps the treasurer by recording gifts received offline and matching bank lines, but cannot refund.",
  membership_coordinator: "looks after families and memberships: checks new families, approves applications and keeps their numbers straight.",
  religious_coordinator: "plans the religious calendar: bolis, pujans, the practice catalog and the approval of religious content.",
  communications_officer: "sends announcements and newsletters, answers the shared inboxes and looks after the message templates.",
  content_editor: "writes the guide and pages and adds photos; what they write waits for someone to approve it.",
  privacy_officer: "handles requests to export or delete someone's information and can read the audit log.",
  volunteer_coordinator: "organizes volunteer groups, shifts, waivers and background checks.",
  event_lead: "runs one event: the attendee list, lunch, volunteers and the checklist for the day.",
  checkin_volunteer: "scans tickets at the door on the day of an event and sees no giving information.",
  kitchen_lead: "sees the headcounts and the store's prep lists so the kitchen knows how much to make.",
  store_lead: "runs the store: the menu, pickup times, orders and stock.",
  store_pickup: "hands out store orders at pickup and marks them picked up.",
  boli_recorder: "calls the bolis at an event and records the results in person.",
  pathshala_principal: "runs the Pathshala: terms, classes, levels, teachers and the committee.",
  pathshala_committee: "plans the Pathshala year with its checklists and takes part in its resolutions.",
  teacher: "teaches a class: takes attendance, signs off progress and posts class announcements.",
  zone_lead: "looks after one zone: its inbox, the contact details of its families and its reports.",
  community_member: "has an account but is not a member yet, and can still RSVP, give, shop and learn.",
  membership_reference: "is a member who vouches for newcomers and approves or declines the applications that name them.",
  primary_adult: "is the main adult of a family: manages the household, the children's profiles, payments and RSVPs.",
  adult_member: "is another adult in a family, with their own profile, the family's pledges, RSVPs and payments.",
  child: "is a child in the family who can see events and learning but cannot RSVP, pledge or pay.",
};

// ── Small builders ──────────────────────────────────────────────────────────
const d = (n) => `${n < 0 ? "-" : "+"}${Math.abs(n)}d`;
const at = (n, time) => `${d(n)}@${time}`;
const t = (table, r) => ({ t: table, r });
const rows = (table, rs) => ({ t: table, rows: rs });
const pad2 = (n) => String(n).padStart(2, "0");

/** Households and people, from a compact table. member: [key, first, last, gender, age, relation, job, role?] */
function people(spec) {
  const hh = [], pp = [], hm = [], pe = [], personas = [];
  let phone = 0;
  for (const h of spec.households) {
    hh.push({
      id: `@h:${h.k}`, display_name: h.name, address_line1: h.street, city: "Lakeview", state_region: "IL", postal_code: h.zip,
      zone_id: `@zone:${h.zone}`, directory_opt_in: h.dir, physical_mail_opt_in: false, custom: {},
    });
    for (const [mk, first, last, g, age, rel, job, role] of h.m) {
      const adult = age >= 18;
      const email = role ? `${role.replace(/_/g, "-")}.${spec.tag}@${DOMAIN}` : adult ? `${first}.${last}.${spec.tag}@${DOMAIN}`.toLowerCase() : null;
      const ref = `${h.k}.${mk}`;
      if (adult) phone += 1;
      pp.push({
        id: `@p:${ref}`, first_name: first, last_name: last, date_of_birth: d(-(Math.round(age * 365.25) + ((phone * 37 + age * 11) % 200))),
        gender: g === "f" ? "female" : "male", email, phone_e164: adult ? `+1312555${pad2(1)}${pad2(phone % 100)}` : null, language: "en",
        profession: job || null, is_verified: adult, verified_at: adult ? "-200d" : null, photo_opt_in: adult,
      });
      hm.push({ household_id: `@h:${h.k}`, person_id: `@p:${ref}`, role: rel, is_primary: rel === "primary", joined_at: "-900d" });
      if (email) pe.push({ person_id: `@p:${ref}`, email, label: "primary", verified: true });
      if (role) {
        const p = { role, person: ref, story: `${first} ${last} ${CAN[role]}` };
        const sc = spec.scopes?.[role];
        if (sc) Object.assign(p, sc);
        personas.push(p);
      }
    }
  }
  personas.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return { ops: [rows("households", hh), rows("people", pp), rows("household_members", hm), rows("person_emails", pe)], personas };
}

function membershipOps(spec) {
  return [rows("memberships", spec.memberships.map(([hk, pk, tier, since, ends]) => ({
    household_id: `@h:${hk}`, person_id: `@p:${hk}.${pk}`, membership_type_id: `@mt:${tier}`, tier, status: "active",
    starts_on: d(since), ends_on: ends === undefined ? null : d(ends), granted_by: "@actor", notes: "Demo data",
  })))];
}

function givingOps(spec) {
  const ops = [];
  ops.push(rows("pledges", spec.pledges.map((p) => ({
    id: `@pledge:${p.ref}`, household_id: `@h:${p.hh}`, pledged_by_person_id: `@p:${p.hh}.${p.who}`,
    ...(p.camp ? { campaign_id: `@camp:${p.camp}` } : { fund_id: `@fund:${p.fund}` }),
    ...(p.fund && p.camp ? { fund_id: `@fund:${p.fund}` } : {}),
    source: p.source, ...(p.srcRef ? { source_ref_id: `@${p.srcRef}` } : {}), amount_cents: p.cents, pledged_at: d(-p.ago),
    ...(p.due !== undefined ? { due_on: d(p.due) } : {}), created_by: "@actor",
  }))));
  for (const p of spec.payments) {
    ops.push({
      op: "pay", ref: p.ref, household: p.hh, payer: `${p.hh}.${p.who}`, cents: p.cents, method: p.method, days_ago: p.ago, pledges: p.pledges,
      ...(p.check ? { check: p.check } : {}), ...(p.memo ? { memo: p.memo } : {}),
      // A card payment is a TEST-mode Stripe payment (a demo community never takes a live one).
      ...(p.method === "card" ? { provider: "stripe", provider_ref: `pi_test_demo_${spec.tag}_${p.ref}` } : {}),
    });
  }
  return ops;
}

function eventOps(spec) {
  const ops = [rows("events", spec.events.map((e) => ({
    id: `@ev:${e.k}`, template_id: null, name: e.name, description: e.descr, venue: e.venue, starts_at: at(e.day, e.from), ends_at: at(e.day, e.to),
    program_year: null, capacity: e.cap, audience: e.audience, rsvp_opens_at: e.opens === null ? null : at(e.opens, "09:00"),
    rsvp_closes_at: e.closes === null ? null : at(e.closes, "20:00"), lunch_enabled: false, lunch_starts_at: null, lunch_slot_minutes: 15,
    lunch_seats_per_slot: null, owner_person_id: `@p:${e.owner}`, status: e.status, created_by: "@actor", waitlist_enabled: !!e.waitlist,
  })))];
  for (const [ev, hh, status] of spec.rsvps) ops.push({ op: "rsvp", event: `ev:${ev}`, household: hh, status });
  ops.push(rows("volunteer_shifts", spec.shifts.map((s) => ({
    id: `@shift:${s.k}`, event_id: `@ev:${s.ev}`, station: s.station, starts_at: at(s.day, s.from), ends_at: at(s.day, s.to), capacity: s.cap, notes: s.notes ?? null,
  }))));
  ops.push(rows("volunteer_assignments", spec.assignments.map(([shift, who, status]) => ({ shift_id: `@shift:${shift}`, person_id: `@p:${who}`, status }))));
  return ops;
}

function storeOps(spec) {
  const ops = [];
  ops.push(rows("store_categories", spec.store.categories.map(([k, name], i) => ({ id: `@cat:${k}`, name, sort_order: i + 1 }))));
  ops.push(rows("store_items", spec.store.items.map((i) => ({
    id: `@item:${i.sku}`, category_id: `@cat:${i.cat}`, sku: `DEMO-${i.sku}`, name: i.name, description: i.descr, price_cents: i.cents, pack_size: i.pack,
    taxable: i.taxable, track_inventory: false, low_stock_threshold: null, status: "active", gift_pack: !!i.gift,
  }))));
  ops.push(rows("pickup_windows", [
    { id: "@pickup:past", starts_at: at(-13, "11:00"), ends_at: at(-13, "13:00"), order_cutoff_at: at(-15, "20:00"), capacity: 40, orders_count: 0, location: spec.store.where, status: "fulfilled" },
    { id: "@pickup:next", starts_at: at(2, "11:00"), ends_at: at(2, "13:00"), order_cutoff_at: at(1, "20:00"), capacity: 40, orders_count: 0, location: spec.store.where, status: "open" },
  ]));
  for (const o of spec.store.orders) {
    ops.push({ op: "order", ref: o.ref, household: o.hh, person: `${o.hh}.${o.who}`, window: `pickup:${o.win}`, status: o.status, past: o.win === "past", lines: o.lines.map(([sku, n]) => [`item:${sku}`, n]) });
  }
  return ops;
}

function noticeOps(spec) {
  return [
    rows("alerts", spec.alerts.map((a) => ({ severity: a.sev, title: a.title, body: a.body, starts_at: at(a.from, "08:00"), ends_at: at(a.to, "00:00"), created_by: "@actor" }))),
    rows("comms_campaigns", spec.campaigns.map((c) => ({
      id: `@comms:${c.k}`, kind: c.kind, name: c.name, title: c.title, body_md: c.body, channels: c.channels, audience: { all_members: true },
      sent_at: c.sentDay === null ? null : at(c.sentDay, "09:00"), status: c.status, approved_by: c.status === "sent" ? "@actor" : null,
      recipients_count: null, opened_count: null, created_by: "@actor", created_at: at(c.createdDay, "09:00"),
    }))),
    rows("volunteer_interests", spec.interests.map(([who, group, status]) => ({ person_id: `@p:${who}`, group_id: `@vg:${group}`, status }))),
  ];
}

function setupOps(spec) {
  const ops = [];
  ops.push(rows("zones", spec.zones.map(([k, name, zips]) => ({ id: `@zone:${k}`, name, zip_codes: zips }))));
  ops.push(rows("funds", spec.funds.map(([k, name, restricted]) => ({ id: `@fund:${k}`, key: k, name, restricted }))));
  ops.push(rows("campaigns", spec.camps.map((c) => ({
    id: `@camp:${c.k}`, fund_id: `@fund:${c.fund}`, name: c.name, kind: c.kind, description: c.descr, goal_cents: c.goal ?? null,
    starts_on: d(c.from), ends_on: c.to === null ? null : d(c.to), status: "published", created_by: "@actor",
  }))));
  ops.push(rows("membership_types", spec.membershipTypes.map((m) => ({
    id: `@mt:${m.k}`, key: m.k, tier: m.k, name: m.name, fee_cents: m.fee, period_months: m.months ?? null, includes_spouse: m.spouse,
    reference_required: m.ref, reference_tier_min: m.ref ? m.k : null, ec_approval_required: false, voting_wait_days: 0,
  }))));
  ops.push(rows("volunteer_groups", spec.groups.map(([k, name, bg]) => ({ id: `@vg:${k}`, name, requires_background_check: bg }))));
  ops.push(rows("guide_sections", spec.guide.map(([slug, title, body, checklist], i) => ({ slug, title, body_md: body, sort_order: i + 1, is_checklist: checklist }))));
  return ops;
}

function pathshalaOps(spec) {
  const P = spec.pathshala;
  const ops = [];
  ops.push(t("pathshala_tracks", { id: "@track:jainism", key: "jainism", name: "Jainism" }));
  ops.push(rows("pathshala_levels", P.levels.map(([n, name, lo, hi]) => ({ id: `@level:jainism${n}`, track_id: "@track:jainism", key: String(n), name, sort_order: n, min_age: lo, max_age: hi }))));
  ops.push(t("pathshala_terms", {
    id: "@term:current", name: P.term, starts_on: d(-42), ends_on: d(196), registration_opens_at: at(-80, "09:00"), registration_closes_at: at(-45, "23:59"),
    membership_required: false, fee_per_child_cents: 15000, fee_per_family_cap_cents: 40000, sibling_discount_pct: 10, no_class_dates: [d(21), d(35)], status: "active",
  }));
  ops.push(rows("pathshala_classes", P.classes.map(([k, level, name, room, cap]) => ({
    id: `@class:${k}`, term_id: "@term:current", level_id: `@level:jainism${level}`, name, room, capacity: cap, meets_on: "sunday", starts_time: "10:00", ends_time: "11:30",
  }))));
  return ops;
}

function pathshalaPeopleOps(spec) {
  const P = spec.pathshala;
  const ops = [];
  ops.push(t("background_checks", { id: `@bgc:${P.teacher}`, person_id: `@p:${P.teacher}`, provider: "Demo checks", status: "clear", cleared_on: d(-200), expires_on: d(530), recorded_by: "@actor" }));
  ops.push(rows("pathshala_enrollments", P.enrolled.map((e) => ({
    id: `@enroll:${e.child}`, term_id: "@term:current", student_person_id: `@p:${e.hh}.${e.child}`, household_id: `@h:${e.hh}`, requested_level_id: `@level:jainism${e.level}`,
    class_id: `@class:${e.cls}`, status: "active", fee_pledge_id: `@pledge:pfee.${e.child}`, registered_by: "@actor", registered_at: "-70d", placed_at: "-50d",
  }))));
  ops.push(t("pathshala_teachers", { class_id: `@class:${P.teachClass}`, person_id: `@p:${P.teacher}`, role: "teacher", background_check_id: `@bgc:${P.teacher}` }));
  return ops;
}

function build(spec) {
  const ppl = people(spec);
  const steps = {
    setup: setupOps(spec),
    people: ppl.ops,
    membership: membershipOps(spec),
    giving: givingOps(spec),
    events: eventOps(spec),
    store: storeOps(spec),
    community: noticeOps(spec),
  };
  const order = ["setup", "people", "membership", "giving", "events", "store"];
  if (spec.pathshala) { steps.pathshala = [...pathshalaPeopleOps(spec)]; order.push("pathshala"); steps.setup.push(...pathshalaOps(spec)); }
  order.push("community");
  return { center: spec.center, order, steps, personas: ppl.personas };
}

// ═══ Sunrise Worship Center (Demo) · faith-based ═════════════════════════════════
const faith = {
  tag: "sunrise",
  center: { kind: "faith", name: "Sunrise Worship Center (Demo)", short_name: "Sunrise Worship Demo", slug: "sunrise-worship-demo", category_key: "jain_center", city: "Lakeview", state: "IL" },
  scopes: {
    event_lead: { scope: "ev:tapasvi" }, checkin_volunteer: { scope: "ev:tapasvi" }, boli_recorder: { scope: "ev:tapasvi" },
    teacher: { scope: "class:j2" }, zone_lead: { scope: "zone:north" },
  },
  zones: [["north", "North", ["60101", "60102"]], ["south", "South", ["60111", "60112"]]],
  households: [
    { k: "varma", name: "Varma family", street: "101 Lotus Lane", zip: "60101", zone: "north", dir: true, m: [
      ["asha", "Asha", "Varma", "f", 41, "primary", "Software engineer", "center_admin"], ["rohit", "Rohit", "Varma", "m", 43, "spouse", "Physician", "executive_committee"],
      ["anaya", "Anaya", "Varma", "f", 9, "child", ""]] },
    { k: "doshiwal", name: "Doshiwal family", street: "22 Banyan Court", zip: "60111", zone: "south", dir: true, m: [
      ["meera", "Meera", "Doshiwal", "f", 52, "primary", "Accountant", "treasurer"], ["kiran", "Kiran", "Doshiwal", "m", 54, "spouse", "Engineer", "finance_volunteer"],
      ["ved", "Ved", "Doshiwal", "m", 12, "child", ""]] },
    { k: "parmar", name: "Parmar household", street: "7 Neem Street", zip: "60102", zone: "north", dir: true, m: [
      ["hemant", "Hemant", "Parmar", "m", 66, "primary", "Retired teacher", "membership_coordinator"], ["kusum", "Kusum", "Parmar", "f", 64, "spouse", "Retired", "membership_reference"]] },
    { k: "lunawat", name: "Lunawat family", street: "48 Peepal Drive", zip: "60112", zone: "south", dir: false, m: [
      ["sanjay", "Sanjay", "Lunawat", "m", 47, "primary", "Business owner", "event_lead"], ["riya", "Riya", "Lunawat", "f", 44, "spouse", "Pharmacist", "checkin_volunteer"],
      ["tia", "Tia", "Lunawat", "f", 7, "child", ""], ["neel", "Neel", "Lunawat", "m", 14, "child", ""]] },
    { k: "salecha", name: "Salecha family", street: "15 Jasmine Way", zip: "60101", zone: "north", dir: true, m: [
      ["pooja", "Pooja", "Salecha", "f", 38, "primary", "Marketing lead", "communications_officer"], ["nikhil", "Nikhil", "Salecha", "m", 40, "spouse", "Designer", "content_editor"],
      ["jay", "Jay", "Salecha", "m", 10, "child", ""]] },
    { k: "kataria", name: "Kataria household", street: "3 Marigold Place", zip: "60111", zone: "south", dir: true, m: [
      ["bharat", "Bharat", "Kataria", "m", 61, "primary", "Jeweler", "religious_coordinator"], ["sarla", "Sarla", "Kataria", "f", 59, "spouse", "", "boli_recorder"]] },
    { k: "chopda", name: "Chopda family", street: "90 Tulsi Lane", zip: "60102", zone: "north", dir: true, m: [
      ["deepa", "Deepa", "Chopda", "f", 45, "primary", "School principal", "pathshala_principal"], ["manish", "Manish", "Chopda", "m", 47, "spouse", "Civil engineer", "pathshala_committee"],
      ["ishaan", "Ishaan", "Chopda", "m", 8, "child", ""]] },
    { k: "bhandari", name: "Bhandari family", street: "12 Ashoka Road", zip: "60112", zone: "south", dir: true, m: [
      ["anita", "Anita", "Bhandari", "f", 42, "primary", "Teacher", "teacher"], ["vijay", "Vijay", "Bhandari", "m", 44, "spouse", "Restaurant owner", "kitchen_lead"],
      ["mira", "Mira", "Bhandari", "f", 11, "child", ""]] },
    { k: "nahar", name: "Nahar household", street: "5 Kesar Street", zip: "60101", zone: "north", dir: false, m: [
      ["sunil", "Sunil", "Nahar", "m", 58, "primary", "Textile importer", "store_lead"], ["rekha", "Rekha", "Nahar", "f", 56, "spouse", "", "store_pickup"]] },
    { k: "singhvi", name: "Singhvi family", street: "61 Champa Avenue", zip: "60111", zone: "south", dir: true, m: [
      ["falguni", "Falguni", "Singhvi", "f", 49, "primary", "Lawyer", "privacy_officer"], ["dipak", "Dipak", "Singhvi", "m", 51, "spouse", "Pharmacist", "volunteer_coordinator"],
      ["zara", "Zara", "Singhvi", "f", 15, "child", "", "child"]] },
    { k: "rathore", name: "Rathore household", street: "19 Kamal Court", zip: "60102", zone: "north", dir: true, m: [
      ["lalit", "Lalit", "Rathore", "m", 39, "primary", "IT consultant", "zone_lead"], ["kavita", "Kavita", "Rathore", "f", 37, "spouse", "Nurse", "executive_viewer"]] },
    { k: "patni", name: "Patni family", street: "8 Chandan Lane", zip: "60112", zone: "south", dir: true, m: [
      ["tarun", "Tarun", "Patni", "m", 35, "primary", "Data scientist", "primary_adult"], ["nisha", "Nisha", "Patni", "f", 33, "spouse", "Dentist", "adult_member"],
      ["aarav", "Aarav", "Patni", "m", 5, "child", ""]] },
    { k: "wadhwa", name: "Wadhwa household", street: "9 Vishal Apartments", zip: "60101", zone: "north", dir: false, m: [
      ["priya", "Priya", "Wadhwa", "f", 29, "primary", "Teacher", "community_member"]] },
  ],
  funds: [["general", "General fund", false], ["building", "Temple building", true], ["pathshala", "Pathshala", false]],
  camps: [
    { k: "annual", fund: "general", name: "Annual appeal", kind: "general", descr: "Keeps the temple open, the lights on and the programs running.", goal: 3000000, from: -300, to: 60 },
    { k: "building", fund: "building", name: "New derasar fund", kind: "construction", descr: "The new derasar and community hall.", goal: 150000000, from: -400, to: null },
    { k: "pathshala", fund: "pathshala", name: "Pathshala fees", kind: "pathshala", descr: "Fees per child for this Pathshala term.", from: -60, to: 180 },
  ],
  membershipTypes: [
    { k: "community", name: "Community member", fee: 0, spouse: false, ref: false },
    { k: "yearly", name: "Yearly membership", fee: 15100, months: 12, spouse: true, ref: true },
    { k: "life", name: "Life membership", fee: 110100, spouse: true, ref: true },
  ],
  memberships: [
    ["varma", "asha", "life", -4000], ["doshiwal", "meera", "yearly", -200, 165], ["parmar", "hemant", "yearly", -150, 215], ["lunawat", "sanjay", "yearly", -120, 245],
    ["salecha", "pooja", "yearly", -100, 265], ["kataria", "bharat", "life", -3000], ["chopda", "deepa", "yearly", -90, 275], ["bhandari", "anita", "community", -300],
    ["nahar", "sunil", "community", -500], ["singhvi", "falguni", "yearly", -80, 285], ["rathore", "lalit", "community", -90], ["patni", "tarun", "community", -60],
  ],
  pledges: [
    { ref: "a1", hh: "varma", who: "asha", camp: "annual", source: "general", cents: 50000, ago: 200 },
    { ref: "a2", hh: "doshiwal", who: "meera", camp: "annual", source: "general", cents: 25100, ago: 150 },
    { ref: "a3", hh: "lunawat", who: "sanjay", camp: "annual", source: "general", cents: 15100, ago: 120 },
    { ref: "a4", hh: "salecha", who: "pooja", camp: "annual", source: "general", cents: 10100, ago: 100 },
    { ref: "a5", hh: "chopda", who: "deepa", camp: "annual", source: "general", cents: 20000, ago: 90 },
    { ref: "a6", hh: "singhvi", who: "falguni", camp: "annual", source: "general", cents: 10000, ago: 80 },
    { ref: "a7", hh: "bhandari", who: "anita", camp: "annual", source: "general", cents: 15100, ago: 60 },
    { ref: "b1", hh: "kataria", who: "bharat", camp: "building", source: "construction", cents: 500000, ago: 340 },
    { ref: "b2", hh: "nahar", who: "sunil", camp: "building", source: "construction", cents: 250000, ago: 300 },
    { ref: "g1", hh: "rathore", who: "lalit", fund: "general", source: "general", cents: 5100, ago: 70 },
    { ref: "g2", hh: "patni", who: "tarun", fund: "general", source: "general", cents: 5100, ago: 40 },
    ...[["anaya", "varma", "asha"], ["ved", "doshiwal", "meera"], ["tia", "lunawat", "sanjay"], ["neel", "lunawat", "sanjay"], ["jay", "salecha", "pooja"], ["ishaan", "chopda", "deepa"], ["mira", "bhandari", "anita"]]
      .map(([child, hh, who]) => ({
        ref: `pfee.${child}`, hh, who, camp: "pathshala", fund: "pathshala", source: "pathshala_fee", srcRef: `enroll:${child}`,
        cents: child === "neel" ? 13500 : 15000, ago: 70, due: 14,
      })),
  ],
  payments: [
    { ref: "a1", hh: "varma", who: "asha", cents: 50000, method: "zelle", ago: 195, pledges: ["a1"] },
    { ref: "a2", hh: "doshiwal", who: "meera", cents: 25100, method: "check", ago: 140, pledges: ["a2"], check: "1042" },
    { ref: "a3", hh: "lunawat", who: "sanjay", cents: 10000, method: "ach", ago: 110, pledges: ["a3"] },
    { ref: "a4", hh: "salecha", who: "pooja", cents: 10100, method: "cash", ago: 90, pledges: ["a4"] },
    { ref: "a5", hh: "chopda", who: "deepa", cents: 20000, method: "card", ago: 80, pledges: ["a5"] },
    { ref: "a6", hh: "singhvi", who: "falguni", cents: 10000, method: "card", ago: 70, pledges: ["a6"] },
    { ref: "b1a", hh: "kataria", who: "bharat", cents: 250000, method: "check", ago: 330, pledges: ["b1"], check: "2210", memo: "Building fund" },
    { ref: "b1b", hh: "kataria", who: "bharat", cents: 125000, method: "ach", ago: 160, pledges: ["b1"], memo: "Building fund" },
    { ref: "b2", hh: "nahar", who: "sunil", cents: 125000, method: "zelle", ago: 280, pledges: ["b2"], memo: "Building fund" },
    { ref: "g1", hh: "rathore", who: "lalit", cents: 2500, method: "cash", ago: 60, pledges: ["g1"] },
    { ref: "pfee.varma", hh: "varma", who: "asha", cents: 15000, method: "zelle", ago: 55, pledges: ["pfee.anaya"], memo: "Pathshala fees" },
    { ref: "pfee.doshiwal", hh: "doshiwal", who: "meera", cents: 15000, method: "card", ago: 54, pledges: ["pfee.ved"], memo: "Pathshala fees" },
    { ref: "pfee.lunawat", hh: "lunawat", who: "sanjay", cents: 28500, method: "check", ago: 53, pledges: ["pfee.tia", "pfee.neel"], check: "3321", memo: "Pathshala fees" },
    { ref: "pfee.salecha", hh: "salecha", who: "pooja", cents: 15000, method: "zelle", ago: 52, pledges: ["pfee.jay"], memo: "Pathshala fees" },
  ],
  events: [
    { k: "satsang", name: "Sunday satsang and lunch", descr: "Morning aarti, a short talk and a shared lunch.", venue: "Main hall", day: -12, from: "10:00", to: "13:00", cap: 120, audience: "members_and_guests", opens: -30, closes: -13, owner: "lunawat.sanjay", status: "completed" },
    { k: "tapasvi", name: "Tapasvi Bahuman and Swamivatsalya", descr: "Honoring this year's tapasvis, followed by a shared meal.", venue: "Main hall", day: 9, from: "10:00", to: "14:00", cap: 200, audience: "members_and_guests", opens: -14, closes: 8, owner: "lunawat.sanjay", status: "published", waitlist: true },
    { k: "diwali", name: "Diwali puja and new year", descr: "Diwali puja at the derasar, then the new year's darshan and aarti.", venue: "Derasar", day: 40, from: "18:00", to: "21:00", cap: null, audience: "public", opens: -5, closes: 39, owner: "kataria.bharat", status: "published" },
    { k: "picnic", name: "Youth picnic", descr: "A picnic for the youth group (being planned).", venue: "Lakeview park", day: 60, from: "11:00", to: "16:00", cap: 60, audience: "members_only", opens: null, closes: null, owner: "salecha.pooja", status: "draft" },
  ],
  rsvps: [
    ...["varma", "doshiwal", "lunawat", "salecha", "kataria", "chopda", "bhandari"].map((h) => ["satsang", h, "attended"]),
    ["satsang", "nahar", "no_show"],
    ["tapasvi", "varma", "confirmed"], ["tapasvi", "doshiwal", "confirmed"], ["tapasvi", "lunawat", "confirmed"], ["tapasvi", "kataria", "confirmed"],
    ["tapasvi", "salecha", "rsvpd"], ["tapasvi", "chopda", "rsvpd"], ["tapasvi", "bhandari", "rsvpd"], ["tapasvi", "singhvi", "rsvpd"], ["tapasvi", "nahar", "cancelled"],
    ["diwali", "varma", "rsvpd"], ["diwali", "rathore", "rsvpd"], ["diwali", "patni", "rsvpd"],
  ],
  shifts: [
    { k: "tb_entry", ev: "tapasvi", station: "entry", day: 9, from: "09:00", to: "12:00", cap: 4, notes: "Scan tickets at the door" },
    { k: "tb_food", ev: "tapasvi", station: "food", day: 9, from: "11:30", to: "14:00", cap: 6 },
    { k: "tb_parking", ev: "tapasvi", station: "parking", day: 9, from: "09:00", to: "11:00", cap: 3 },
  ],
  assignments: [["tb_entry", "lunawat.riya", "confirmed"], ["tb_entry", "varma.rohit", "assigned"], ["tb_food", "bhandari.vijay", "confirmed"], ["tb_food", "salecha.nikhil", "assigned"], ["tb_food", "kataria.sarla", "assigned"], ["tb_parking", "nahar.rekha", "assigned"]],
  groups: [["kitchen", "Bhojanshala and kitchen", false], ["teaching", "Pathshala teaching", true], ["events", "Events and decoration", false], ["parking", "Parking and welcome", false]],
  interests: [["lunawat.riya", "events", "active"], ["bhandari.vijay", "kitchen", "active"], ["salecha.nikhil", "events", "interested"], ["nahar.rekha", "parking", "active"],
             ["rathore.kavita", "kitchen", "interested"], ["varma.rohit", "events", "active"], ["doshiwal.kiran", "teaching", "interested"], ["patni.nisha", "kitchen", "active"]],
  guide: [
    ["visiting-the-temple", "Visiting the temple", "Everyone is welcome. Remove shoes at the door, silence your phone and sit where you are comfortable.\n\n(Demo content.)", false],
    ["first-visit-checklist", "Your first visit", "- Arrive a few minutes early\n- Dress modestly\n- Say hello at the office\n- Ask about Pathshala for the children", true],
    ["parking-and-access", "Parking and access", "The east door is step-free. Overflow parking opens on busy days; volunteers will guide you.\n\n(Demo content.)", false],
  ],
  store: {
    where: "Temple kitchen",
    categories: [["mithai", "Mithai"], ["namkeen", "Namkeen"], ["meals", "Meals"]],
    items: [
      { sku: "101", cat: "mithai", name: "Mohanthal", descr: "Gram-flour fudge with ghee and cardamom", cents: 899, pack: "250 g", taxable: true, gift: true },
      { sku: "102", cat: "mithai", name: "Kaju katli", descr: "Cashew fudge", cents: 999, pack: "250 g", taxable: true, gift: true },
      { sku: "201", cat: "namkeen", name: "Farsi puri", descr: "Crisp, flaky puris", cents: 599, pack: "200 g", taxable: true, gift: true },
      { sku: "202", cat: "namkeen", name: "Chakri", descr: "Rice-flour spirals", cents: 599, pack: "200 g", taxable: true, gift: true },
      { sku: "301", cat: "meals", name: "Dal dhokli", descr: "Jain dal dhokli, no root vegetables", cents: 899, pack: "one meal", taxable: false },
    ],
    orders: [
      { ref: "o1", hh: "varma", who: "asha", win: "past", status: "picked_up", lines: [["101", 2], ["201", 1]] },
      { ref: "o2", hh: "doshiwal", who: "meera", win: "past", status: "picked_up", lines: [["102", 1], ["301", 4]] },
      { ref: "o3", hh: "lunawat", who: "sanjay", win: "next", status: "ready", lines: [["201", 2]] },
      { ref: "o4", hh: "salecha", who: "pooja", win: "next", status: "placed", lines: [["102", 1], ["202", 2]] },
    ],
  },
  alerts: [
    { sev: "important", title: "Parking for the Tapasvi Bahuman", body: "Please use the overflow lot; volunteers will guide you. (Demo notice.)", from: -1, to: 10 },
    { sev: "info", title: "Derasar closes early on Friday", body: "For maintenance. (Demo notice.)", from: -40, to: -35 },
  ],
  campaigns: [
    { k: "news", kind: "newsletter", name: "Monthly newsletter", title: "Sunrise Worship Center newsletter", body: "## This month\n\n- Thank you to every tapasvi\n- The Pathshala term is under way\n- Building fund update\n\n(Demo newsletter.)", channels: ["email"], status: "sent", sentDay: -20, createdDay: -22 },
    { k: "invite", kind: "event", name: "Tapasvi Bahuman invitation", title: "You're invited: Tapasvi Bahuman and Swamivatsalya", body: "Join us to honor this year's tapasvis. RSVP in the app. (Demo.)", channels: ["push", "email"], status: "sent", sentDay: -5, createdDay: -6 },
    { k: "draft", kind: "pathshala_update", name: "Pathshala annual day", title: "Save the date: Pathshala annual day", body: "Students will perform; families bring a dish to share. (Demo draft.)", channels: ["push"], status: "draft", sentDay: null, createdDay: 0 },
  ],
  pathshala: {
    term: "Fall term (demo)",
    levels: [[1, "Jainism 1", 5, 7], [2, "Jainism 2", 8, 10], [3, "Jainism 3", 11, 14], [4, "Jainism 4", 15, 18]],
    classes: [["j1", 1, "Jainism 1 · Room A", "A", 12], ["j2", 2, "Jainism 2 · Room B", "B", 15], ["j3", 3, "Jainism 3 · Room C", "C", 15]],
    teacher: "bhandari.anita", teachClass: "j2",
    enrolled: [
      { child: "tia", hh: "lunawat", level: 1, cls: "j1" }, { child: "anaya", hh: "varma", level: 2, cls: "j2" }, { child: "jay", hh: "salecha", level: 2, cls: "j2" },
      { child: "ishaan", hh: "chopda", level: 2, cls: "j2" }, { child: "ved", hh: "doshiwal", level: 3, cls: "j3" }, { child: "mira", hh: "bhandari", level: 3, cls: "j3" },
      { child: "neel", hh: "lunawat", level: 3, cls: "j3" },
    ],
  },
};

// ═══ Lakeside Neighbors Club (Demo) · not faith-based ═════════════════════════
const club = {
  tag: "lakeside",
  center: { kind: "neutral", name: "Lakeside Neighbors Club (Demo)", short_name: "Lakeside Demo", slug: "lakeside-neighbors-demo", category_key: "nonprofit_secular", city: "Lakeview", state: "IL" },
  scopes: { event_lead: { scope: "ev:cleanup" }, checkin_volunteer: { scope: "ev:cleanup" }, zone_lead: { scope: "zone:north" } },
  zones: [["north", "North shore", ["60201", "60202"]], ["south", "South shore", ["60211", "60212"]]],
  households: [
    { k: "alvarez", name: "Alvarez family", street: "14 Harbor View", zip: "60201", zone: "north", dir: true, m: [
      ["marisol", "Marisol", "Alvarez", "f", 44, "primary", "Nonprofit director", "center_admin"], ["tomas", "Tomas", "Alvarez", "m", 46, "spouse", "Architect", "executive_viewer"],
      ["lucia", "Lucia", "Alvarez", "f", 10, "child", ""]] },
    { k: "brightwater", name: "Brightwater household", street: "92 Willow Bend", zip: "60211", zone: "south", dir: true, m: [
      ["dana", "Dana", "Brightwater", "f", 52, "primary", "Accountant", "treasurer"], ["colin", "Colin", "Brightwater", "m", 54, "spouse", "Bookkeeper", "finance_volunteer"]] },
    { k: "okonkwo", name: "Okonkwo family", street: "7 Cedar Row", zip: "60202", zone: "north", dir: true, m: [
      ["ngozi", "Ngozi", "Okonkwo", "f", 39, "primary", "Nurse", "membership_coordinator"], ["emeka", "Emeka", "Okonkwo", "m", 41, "spouse", "Engineer", "membership_reference"],
      ["ada", "Ada", "Okonkwo", "f", 7, "child", ""]] },
    { k: "petrov", name: "Petrov family", street: "33 Maple Terrace", zip: "60212", zone: "south", dir: false, m: [
      ["irina", "Irina", "Petrov", "f", 47, "primary", "Event planner", "event_lead"], ["nikolai", "Nikolai", "Petrov", "m", 49, "spouse", "Electrician", "checkin_volunteer"],
      ["katya", "Katya", "Petrov", "f", 13, "child", ""]] },
    { k: "lindqvist", name: "Lindqvist household", street: "5 Pier Street", zip: "60201", zone: "north", dir: true, m: [
      ["sofia", "Sofia", "Lindqvist", "f", 36, "primary", "Journalist", "communications_officer"], ["erik", "Erik", "Lindqvist", "m", 38, "spouse", "Photographer", "content_editor"]] },
    { k: "nakamura", name: "Nakamura family", street: "61 Orchard Lane", zip: "60211", zone: "south", dir: true, m: [
      ["hana", "Hana", "Nakamura", "f", 58, "primary", "Retired professor", "executive_committee"], ["ken", "Ken", "Nakamura", "m", 60, "spouse", "Chef", "kitchen_lead"]] },
    { k: "haddad", name: "Haddad family", street: "20 Birch Court", zip: "60202", zone: "north", dir: true, m: [
      ["layla", "Layla", "Haddad", "f", 43, "primary", "Lawyer", "privacy_officer"], ["omar", "Omar", "Haddad", "m", 45, "spouse", "Teacher", "volunteer_coordinator"],
      ["zain", "Zain", "Haddad", "m", 12, "child", ""]] },
    { k: "whitfield", name: "Whitfield household", street: "3 Lantern Way", zip: "60212", zone: "south", dir: false, m: [
      ["grace", "Grace", "Whitfield", "f", 61, "primary", "Shop owner", "store_lead"], ["henry", "Henry", "Whitfield", "m", 64, "spouse", "Retired", "store_pickup"]] },
    { k: "moreau", name: "Moreau family", street: "48 Elm Street", zip: "60201", zone: "north", dir: true, m: [
      ["camille", "Camille", "Moreau", "f", 35, "primary", "Graphic designer", "zone_lead"], ["jules", "Jules", "Moreau", "m", 37, "spouse", "Paramedic", "adult_member"],
      ["remy", "Remy", "Moreau", "m", 4, "child", ""]] },
    { k: "osei", name: "Osei family", street: "17 Dockside Road", zip: "60211", zone: "south", dir: true, m: [
      ["kwame", "Kwame", "Osei", "m", 50, "primary", "Contractor", "primary_adult"], ["abena", "Abena", "Osei", "f", 48, "spouse", "Pharmacist"],
      ["kofi", "Kofi", "Osei", "m", 15, "child", "", "child"]] },
    { k: "reyes", name: "Reyes household", street: "9 Garden Walk", zip: "60202", zone: "north", dir: false, m: [
      ["mateo", "Mateo", "Reyes", "m", 29, "primary", "Barista", "community_member"]] },
    { k: "sullivan", name: "Sullivan household", street: "26 Quarry Hill", zip: "60212", zone: "south", dir: true, m: [
      ["patrick", "Patrick", "Sullivan", "m", 68, "primary", "Retired"], ["maeve", "Maeve", "Sullivan", "f", 66, "spouse", "Retired librarian"]] },
  ],
  funds: [["general", "General fund", false], ["garden", "Community garden", true]],
  camps: [
    { k: "annual", fund: "general", name: "Annual appeal", kind: "general", descr: "Keeps the club running: the hall, the insurance and the events.", goal: 2000000, from: -300, to: 60 },
    { k: "garden", fund: "garden", name: "Community garden", kind: "general", descr: "New raised beds and a tool shed for the shared garden.", goal: 800000, from: -120, to: 90 },
  ],
  membershipTypes: [
    { k: "community", name: "Neighbor (free)", fee: 0, spouse: false, ref: false },
    { k: "yearly", name: "Member (yearly)", fee: 5000, months: 12, spouse: true, ref: true },
  ],
  memberships: [
    ["alvarez", "marisol", "yearly", -200, 165], ["brightwater", "dana", "yearly", -180, 185], ["okonkwo", "ngozi", "yearly", -150, 215], ["petrov", "irina", "yearly", -120, 245],
    ["lindqvist", "sofia", "yearly", -100, 265], ["nakamura", "hana", "yearly", -400, 100], ["haddad", "layla", "community", -90], ["whitfield", "grace", "community", -500],
    ["moreau", "camille", "community", -60], ["osei", "kwame", "yearly", -80, 285],
  ],
  pledges: [
    { ref: "a1", hh: "alvarez", who: "marisol", camp: "annual", source: "general", cents: 30000, ago: 200 },
    { ref: "a2", hh: "brightwater", who: "dana", camp: "annual", source: "general", cents: 20000, ago: 150 },
    { ref: "a3", hh: "nakamura", who: "hana", camp: "annual", source: "general", cents: 50000, ago: 120 },
    { ref: "a4", hh: "okonkwo", who: "ngozi", camp: "annual", source: "general", cents: 10000, ago: 100 },
    { ref: "a5", hh: "petrov", who: "irina", camp: "annual", source: "general", cents: 15000, ago: 90 },
    { ref: "g1", hh: "whitfield", who: "grace", camp: "garden", source: "sponsorship", cents: 100000, ago: 100 },
    { ref: "g2", hh: "haddad", who: "layla", camp: "garden", source: "sponsorship", cents: 25000, ago: 80 },
    { ref: "g3", hh: "osei", who: "kwame", camp: "garden", source: "sponsorship", cents: 12500, ago: 60 },
    { ref: "g4", hh: "sullivan", who: "patrick", fund: "general", source: "general", cents: 5000, ago: 40 },
    { ref: "g5", hh: "reyes", who: "mateo", fund: "general", source: "general", cents: 2500, ago: 20 },
  ],
  payments: [
    { ref: "a1", hh: "alvarez", who: "marisol", cents: 30000, method: "card", ago: 195, pledges: ["a1"] },
    { ref: "a2", hh: "brightwater", who: "dana", cents: 20000, method: "check", ago: 140, pledges: ["a2"], check: "5071" },
    { ref: "a3", hh: "nakamura", who: "hana", cents: 50000, method: "zelle", ago: 115, pledges: ["a3"] },
    { ref: "a4", hh: "okonkwo", who: "ngozi", cents: 5000, method: "cash", ago: 95, pledges: ["a4"] },
    { ref: "a5", hh: "petrov", who: "irina", cents: 15000, method: "card", ago: 85, pledges: ["a5"] },
    { ref: "g1a", hh: "whitfield", who: "grace", cents: 50000, method: "check", ago: 90, pledges: ["g1"], check: "7788", memo: "Garden" },
    { ref: "g1b", hh: "whitfield", who: "grace", cents: 25000, method: "ach", ago: 30, pledges: ["g1"], memo: "Garden" },
    { ref: "g2", hh: "haddad", who: "layla", cents: 25000, method: "zelle", ago: 70, pledges: ["g2"], memo: "Garden" },
  ],
  events: [
    { k: "potluck", name: "Neighbors potluck", descr: "Bring a dish to share and meet the neighbors.", venue: "Lakeside hall", day: -10, from: "17:00", to: "20:00", cap: 80, audience: "members_and_guests", opens: -30, closes: -11, owner: "petrov.irina", status: "completed" },
    { k: "cleanup", name: "Spring clean-up day", descr: "Gloves, bags and lunch provided; we tidy the shoreline and the garden.", venue: "Lakeside park", day: 12, from: "09:00", to: "13:00", cap: 60, audience: "members_and_guests", opens: -14, closes: 11, owner: "petrov.irina", status: "published", waitlist: true },
    { k: "concert", name: "Summer concert in the park", descr: "An evening of local bands on the lawn.", venue: "Lakeside park", day: 45, from: "18:00", to: "21:00", cap: null, audience: "public", opens: -5, closes: 44, owner: "lindqvist.sofia", status: "published" },
    { k: "bookswap", name: "Book swap", descr: "Bring a book, take a book (being planned).", venue: "Lakeside hall", day: 60, from: "10:00", to: "12:00", cap: 40, audience: "members_only", opens: null, closes: null, owner: "okonkwo.ngozi", status: "draft" },
  ],
  rsvps: [
    ...["alvarez", "brightwater", "okonkwo", "petrov", "lindqvist", "nakamura", "haddad"].map((h) => ["potluck", h, "attended"]),
    ["potluck", "whitfield", "no_show"],
    ["cleanup", "alvarez", "confirmed"], ["cleanup", "petrov", "confirmed"], ["cleanup", "haddad", "confirmed"], ["cleanup", "moreau", "confirmed"],
    ["cleanup", "okonkwo", "rsvpd"], ["cleanup", "osei", "rsvpd"], ["cleanup", "reyes", "rsvpd"], ["cleanup", "whitfield", "cancelled"],
    ["concert", "alvarez", "rsvpd"], ["concert", "lindqvist", "rsvpd"], ["concert", "sullivan", "rsvpd"],
  ],
  shifts: [
    { k: "cu_welcome", ev: "cleanup", station: "welcome", day: 12, from: "08:30", to: "11:00", cap: 4, notes: "Greet people and hand out gloves" },
    { k: "cu_refresh", ev: "cleanup", station: "refreshments", day: 12, from: "10:30", to: "13:00", cap: 4 },
    { k: "cu_tools", ev: "cleanup", station: "tools", day: 12, from: "08:30", to: "10:30", cap: 3 },
  ],
  assignments: [["cu_welcome", "petrov.nikolai", "confirmed"], ["cu_welcome", "moreau.jules", "assigned"], ["cu_refresh", "nakamura.ken", "confirmed"], ["cu_refresh", "haddad.omar", "assigned"], ["cu_tools", "osei.kwame", "assigned"], ["cu_tools", "whitfield.henry", "assigned"]],
  groups: [["garden", "Garden crew", false], ["events", "Events crew", false], ["welcome", "Welcome team", false], ["youth", "Youth helpers", true]],
  interests: [["petrov.nikolai", "events", "active"], ["nakamura.ken", "events", "active"], ["moreau.jules", "garden", "active"], ["osei.kwame", "garden", "active"],
             ["haddad.omar", "welcome", "interested"], ["whitfield.henry", "garden", "interested"], ["lindqvist.erik", "events", "interested"], ["okonkwo.emeka", "welcome", "active"]],
  guide: [
    ["welcome", "Welcome to the club", "We are neighbors who like to do things together: meals, clean-ups, concerts and the garden.\n\n(Demo content.)", false],
    ["how-to-join", "How to join", "Say hello at any event, then apply for a yearly membership in the app. Two members vouch for you.\n\n(Demo content.)", false],
    ["first-event-checklist", "Your first event", "- Bring a dish if it is a potluck\n- Introduce yourself at the welcome table\n- Ask about the garden crew", true],
  ],
  store: {
    where: "Lakeside hall office",
    categories: [["shop", "Club shop"], ["treats", "Treats"]],
    items: [
      { sku: "101", cat: "shop", name: "Club T-shirt", descr: "Soft cotton, in the club's lake blue", cents: 1800, pack: "one shirt", taxable: true, gift: true },
      { sku: "102", cat: "shop", name: "Canvas tote bag", descr: "Sturdy bag with the club's lighthouse", cents: 1200, pack: "one bag", taxable: true, gift: true },
      { sku: "103", cat: "shop", name: "Enamel mug", descr: "Holds a full cup of coffee", cents: 1000, pack: "one mug", taxable: true, gift: true },
      { sku: "104", cat: "shop", name: "Neighborhood cookbook", descr: "Recipes from the potlucks", cents: 2200, pack: "one book", taxable: false },
      { sku: "201", cat: "treats", name: "Lemon bars", descr: "A box of six, baked by the garden crew", cents: 900, pack: "box of 6", taxable: false },
    ],
    orders: [
      { ref: "o1", hh: "alvarez", who: "marisol", win: "past", status: "picked_up", lines: [["101", 2], ["201", 1]] },
      { ref: "o2", hh: "brightwater", who: "dana", win: "past", status: "picked_up", lines: [["104", 1], ["103", 2]] },
      { ref: "o3", hh: "petrov", who: "irina", win: "next", status: "ready", lines: [["102", 2]] },
      { ref: "o4", hh: "lindqvist", who: "sofia", win: "next", status: "placed", lines: [["104", 1], ["201", 2]] },
    ],
  },
  alerts: [
    { sev: "important", title: "Parking for the clean-up day", body: "Please use the lakeside lot and carpool if you can. (Demo notice.)", from: -1, to: 14 },
    { sev: "info", title: "Garden gate code has changed", body: "Ask any garden crew member for the new code. (Demo notice.)", from: -40, to: -35 },
  ],
  campaigns: [
    { k: "news", kind: "newsletter", name: "Monthly newsletter", title: "Lakeside Neighbors Club newsletter", body: "## This month\n\n- Thank you to everyone who came to the potluck\n- Clean-up day is coming\n- Garden fund update\n\n(Demo newsletter.)", channels: ["email"], status: "sent", sentDay: -20, createdDay: -22 },
    { k: "invite", kind: "event", name: "Clean-up day invitation", title: "You're invited: spring clean-up day", body: "Join us at the shoreline. RSVP in the app. (Demo.)", channels: ["push", "email"], status: "sent", sentDay: -5, createdDay: -6 },
    { k: "draft", kind: "event", name: "Summer concert", title: "Save the date: summer concert in the park", body: "Local bands on the lawn; bring a blanket. (Demo draft.)", channels: ["push"], status: "draft", sentDay: null, createdDay: 0 },
  ],
};

// ═══ Checks the script does on its own ═══════════════════════════════════════
function check(name, content, expect) {
  const defined = new Set(["@center", "@actor"]);
  const used = new Map();
  const visit = (v, where) => {
    if (Array.isArray(v)) return v.forEach((x) => visit(x, where));
    if (v && typeof v === "object") return Object.values(v).forEach((x) => visit(x, where));
    if (typeof v === "string" && v.startsWith("@") && v.length > 1) used.set(v, where);
  };
  for (const [step, ops] of Object.entries(content.steps)) {
    for (const op of ops) {
      const list = op.rows ?? (op.r ? [op.r] : []);
      for (const r of list) {
        if (typeof r.id === "string" && r.id.startsWith("@")) defined.add(r.id);
        for (const [k, v] of Object.entries(r)) if (k !== "id") visit(v, `${step}/${op.t}.${k}`);
      }
      // ops that name ids as bare refs (no "@")
      if (op.op === "pay") { for (const p of op.pledges ?? []) used.set(`@pledge:${p}`, `${step}/pay.${op.ref}`); used.set(`@h:${op.household}`, "pay"); used.set(`@p:${op.payer}`, "pay"); }
      if (op.op === "rsvp") { used.set(`@${op.event}`, "rsvp"); used.set(`@h:${op.household}`, "rsvp"); }
      if (op.op === "order") { used.set(`@h:${op.household}`, "order"); used.set(`@p:${op.person}`, "order"); used.set(`@${op.window}`, "order"); for (const [i] of op.lines) used.set(`@${i}`, "order"); }
    }
  }
  for (const p of content.personas) { used.set(`@p:${p.person}`, "persona"); if (p.scope) used.set(`@${p.scope}`, "persona.scope"); }
  const missing = [...used].filter(([ref]) => !defined.has(ref));
  if (missing.length) throw new Error(`${name}: refs used but never defined:\n  ${missing.map(([r, w]) => `${r} (${w})`).join("\n  ")}`);
  const roles = content.personas.map((p) => p.role);
  if (new Set(roles).size !== roles.length) throw new Error(`${name}: a role has two personas`);
  const emails = new Set();
  for (const op of content.steps.people) if (op.t === "people") for (const r of op.rows) if (r.email) { if (emails.has(r.email)) throw new Error(`${name}: duplicate e-mail ${r.email}`); emails.add(r.email); if (!r.email.endsWith(`@${DOMAIN}`)) throw new Error(`${name}: e-mail off the demo domain ${r.email}`); }
  const count = (table) => Object.values(content.steps).flat().filter((o) => o.t === table).reduce((n, o) => n + (o.rows ? o.rows.length : 1), 0);
  const got = { households: count("households"), people: count("people"), personas: content.personas.length };
  for (const [k, v] of Object.entries(expect)) if (got[k] !== v) throw new Error(`${name}: expected ${v} ${k}, got ${got[k]}`);
  return got;
}

const packs = [
  { key: "demo_faith_jain_v1", spec: faith, title: "Sunrise Worship Center (Demo)", expect: { households: 13, people: 34, personas: 26 },
    descr: "A small worship center of invented people (in a Jain Center's words: Pathshala, bolis, tapasvis): 13 households, 34 people, pledges and test-mode payments, events with RSVPs, a small store, notices, volunteer groups and a Pathshala term. One demo person for every role." },
  { key: "demo_neutral_club_v1", spec: club, title: "Lakeside Neighbors Club (Demo)", expect: { households: 12, people: 29, personas: 21 },
    descr: "A neighborhood club that is not faith-based, of invented people: 12 households, 29 people, pledges and test-mode payments, events with RSVPs, a small shop, notices and volunteer groups. One demo person for every role." },
];

const built = packs.map((p) => {
  const content = build(p.spec);
  const got = check(p.key, content, p.expect);
  return { ...p, content, got };
});

// One op per line keeps the migration reviewable.
function format(content) {
  const line = (v) => JSON.stringify(v);
  const steps = Object.entries(content.steps).map(([k, ops]) => `    ${line(k)}: [\n${ops.map((o) => `      ${line(o)}`).join(",\n")}\n    ]`).join(",\n");
  return `{\n  "center": ${line(content.center)},\n  "order": ${line(content.order)},\n  "steps": {\n${steps}\n  },\n  "personas": [\n${content.personas.map((p) => `    ${line(p)}`).join(",\n")}\n  ]\n}`;
}
const sq = (s) => `'${s.replace(/'/g, "''")}'`;
const sql = `-- Demo communities (B88) · 2 of 3: the two packs, as data. GENERATED by supabase/scripts/build-demo-packs.mjs: change the
-- script and add a new migration; never edit this one. The packs are not offered on Setup > Demo (active = false): a demo
-- community is created and reset only by app.create_demo_community / app.reset_demo_community (0629).
--   demo_faith_jain_v1      ${built[0].got.households} households, ${built[0].got.people} people, ${built[0].got.personas} demo people (one per role of a Jain Center's role catalog)
--   demo_neutral_club_v1    ${built[1].got.households} households, ${built[1].got.people} people, ${built[1].got.personas} demo people (one per role of a non-faith organization's role catalog)
set client_min_messages = warning;

insert into app.demo_packs (key, version, title, description, contents, active, content) values
${built.map((b) => `(${sq(b.key)}, 1, ${sq(b.title)}, ${sq(b.descr)}, '[]'::jsonb, false, $demo$${format(b.content)}$demo$::jsonb)`).join(",\n")}
on conflict (key) do update set version = excluded.version, title = excluded.title, description = excluded.description,
  contents = excluded.contents, active = excluded.active, content = excluded.content;
`;

// A changed pack is a NEW migration (never edit an applied one) that upserts that one pack at a higher version:
//   node supabase/scripts/build-demo-packs.mjs <out.sql> --only demo_faith_jain_v1 --version 2
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const only = flag("--only");
const version = Number(flag("--version") ?? 1);
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const updateSql = (b, v) => `-- Demo community pack ${b.key}, version ${v}, as data. This part is GENERATED by supabase/scripts/build-demo-packs.mjs
-- (node supabase/scripts/build-demo-packs.mjs <out.sql> --only ${b.key} --version ${v}): change the script and add a new migration.
--   ${b.key}      ${b.got.households} households, ${b.got.people} people, ${b.got.personas} demo people
set client_min_messages = warning;

insert into app.demo_packs (key, version, title, description, contents, active, content) values
(${sq(b.key)}, ${v}, ${sq(b.title)}, ${sq(b.descr)}, '[]'::jsonb, false, $demo$${format(b.content)}$demo$::jsonb)
on conflict (key) do update set version = excluded.version, title = excluded.title, description = excluded.description,
  contents = excluded.contents, active = excluded.active, content = excluded.content;
`;
const here = path.dirname(fileURLToPath(import.meta.url));
let out = positional[0] ?? path.join(here, "..", "migrations", "0628_demo_pack_content.sql");
let text = sql;
if (only) {
  const b = built.find((x) => x.key === only);
  if (!b) throw new Error(`--only: there is no pack called "${only}"`);
  if (!positional[0]) throw new Error("--only needs an output path (never overwrite an applied migration)");
  if (!Number.isInteger(version) || version < 2) throw new Error("--version must be 2 or more for a changed pack");
  text = updateSql(b, version);
}
// An applied migration is never rewritten: refuse an existing file unless it is asked for.
if (fs.existsSync(out) && !args.includes("--force")) throw new Error(`${out} already exists (an applied migration is never rewritten); give a new path, or --force for a scratch file`);
fs.writeFileSync(out, text);
console.log(`wrote ${out}\n` + (only ? built.filter((b) => b.key === only) : built).map((b) => `  ${b.key}: ${JSON.stringify(b.got)}`).join("\n"));

// DEV ONLY. Invented details for the person slide-over's preview, on the same neutral community as the Family page's preview (a
// community hall in Riverside, members from several cultures; one family with two children). Nothing here is real.

import type { AuditRow } from "@/components/audit-table";
import type { FamilyModel, FamilyPerson } from "@/lib/people-v2/family-model";
import { preferenceValues, privacyValues } from "@/lib/people-v2/family-model";
import {
  addIdKinds,
  detailHousehold,
  part,
  shapeIdRows,
  type IdRow,
  type MembershipHeld,
  type Part,
  type PersonDetailModel,
  type ProfileDetails,
  type RolesFacts,
} from "@/lib/people-v2/slideover";

import { PREVIEW_TODAY, familyFixture, type FamilyKey } from "../people-family/fixtures";

export const PREVIEW_TZ = "America/Chicago";
export type Access = "full" | "view" | "limited";

const RULES = {
  orgMemberDigits: 4 as number | null,
  orgMemberLabel: "Community member ID",
  systems: { orgMemberSystem: "org_register", orgHouseholdSystem: "org_register", legacySystems: [{ system: "neon", label: "Neon ID" }] },
};

const LABELS: Record<string, string> = {
  connect_member: "Member no.",
  org_member: RULES.orgMemberLabel,
  crm: "Legacy CRM id",
  accounting: "Accounting (QuickBooks) customer",
  bank_payer: "Bank payer name",
  payment_provider: "Payment-provider customer",
  other: "Other identifier",
};
const labelOf = (k: string) => LABELS[k] ?? k;
const FINANCE = ["accounting", "bank_payer", "payment_provider"];

/** What else is on an adult's record (interests, expertise areas, call time, the ways they like to be reached, the daily goal). */
type Prefs = { interests: string[]; areas: string[]; callTime: string; channels: string[]; goal: number | null };
const NO_PREFS: Prefs = { interests: [], areas: [], callTime: "", channels: [], goal: null };

type Extra = {
  prefs: Prefs;
  linkedAt: string | null;
  roles: string[];
  waiver: string;
  background: string;
  details: ProfileDetails;
  expertise: string;
  photo: boolean;
  newMember: boolean;
  expertiseOn: boolean;
  ids: IdRow[];
  memberships: MembershipHeld[];
};

const NONE: ProfileDetails = { anniversary: null, dietary: [], emergency: null, labelsNote: null };

const EXTRA: Record<string, Extra> = {
  "p-samira": {
    prefs: { interests: ["Community kitchen", "Youth mentoring", "Gardening"], areas: ["Pharmacy", "Health"], callTime: "evening", channels: ["phone_call", "email"], goal: 10 },
    linkedAt: "2026-03-03T15:00:00Z",
    roles: ["Volunteer coordinator"],
    waiver: "Signed",
    background: "Clear · expires 2027-05-01",
    details: {
      anniversary: "2009-06-20",
      dietary: [
        { label: "Vegetarian", retired: false },
        { label: "Nut allergy", retired: false },
      ],
      emergency: { name: "Layla Haddad", relationship: "Sister", phone: "+17135550100" },
      labelsNote: null,
    },
    expertise: "Clinical pharmacist, happy to guide students",
    photo: true,
    newMember: false,
    expertiseOn: true,
    ids: [
      { id: "i-org", kind: "org_member", system: "org_register", value: "0482", valid_to: null },
      { id: "i-crm", kind: "crm", system: "neon", value: "20417", valid_to: null },
      { id: "i-old", kind: "crm", system: "neon", value: "19110", valid_to: "2025-12-31" },
      { id: "i-qb", kind: "accounting", system: "quickbooks", value: "1187", valid_to: null },
      { id: "i-bank", kind: "bank_payer", system: "bank", value: "S HASSAN", valid_to: null },
      { id: "i-bank2", kind: "bank_payer", system: "bank", value: "SAMIRA K HASSAN", valid_to: null },
    ],
    memberships: [{ id: "m1", tier: "yearly", status: "active", startsOn: "2025-04-01", endsOn: "2027-03-31", household: { name: "Hassan household", number: "0301" } }],
  },
  "p-karim": {
    prefs: NO_PREFS,
    linkedAt: null,
    roles: [],
    waiver: "No volunteer shifts",
    background: "None on file",
    details: NONE,
    expertise: "",
    photo: false,
    newMember: true,
    expertiseOn: false,
    ids: [{ id: "i-org-k", kind: "org_member", system: "org_register", value: "0483", valid_to: null }],
    memberships: [],
  },
  "p-layla": {
    prefs: NO_PREFS,
    linkedAt: null,
    roles: [],
    waiver: "",
    background: "",
    details: { anniversary: null, dietary: [{ label: "Dairy-free", retired: false }], emergency: null, labelsNote: null },
    expertise: "",
    photo: true,
    newMember: false,
    expertiseOn: false,
    ids: [],
    memberships: [],
  },
  "p-omar2": { prefs: NO_PREFS, linkedAt: null, roles: [], waiver: "", background: "", details: NONE, expertise: "", photo: false, newMember: false, expertiseOn: false, ids: [], memberships: [] },
  "p-misaki": {
    prefs: { interests: ["茶道", "俳句", "Gardening"], areas: ["薬学"], callTime: "morning", channels: ["whatsapp", "email"], goal: 5 },
    linkedAt: "2026-05-11T18:30:00Z",
    roles: [],
    waiver: "No volunteer shifts",
    background: "None on file",
    details: { anniversary: "2012-10-08", dietary: [{ label: "Halal", retired: false }], emergency: { name: "田中 健", relationship: "Brother", phone: "+81398765432" }, labelsNote: null },
    expertise: "薬剤師。薬の相談に乗れます",
    photo: true,
    newMember: true,
    expertiseOn: true,
    ids: [],
    memberships: [{ id: "m2", tier: "yearly", status: "active", startsOn: "2026-07-01", endsOn: "2027-06-30", household: { name: "田中・Haddad の家", number: "0507" } }],
  },
};

const FALLBACK: Extra = { ...EXTRA["p-omar2"], waiver: "No volunteer shifts", background: "None on file" };

export function findPerson(model: FamilyModel, personId: string): FamilyPerson | null {
  return [...model.adults, ...model.children].find((p) => p.id === personId) ?? null;
}

export function detailFixture(family: FamilyKey, personId: string, o: { access: Access; standalone: boolean }): PersonDetailModel | null {
  const view = o.access !== "full";
  const model = familyFixture(family, { canEdit: !view });
  const person = findPerson(model, personId);
  if (!person) return null;
  const x = EXTRA[person.id] ?? FALLBACK;
  const child = person.isChild;
  const limited = o.access === "limited";
  const canView = (k: string) => !limited || !FINANCE.includes(k);
  const canManage = (k: string) => !view && (!FINANCE.includes(k) || o.access === "full");

  const rows = shapeIdRows({
    rows: x.ids,
    memberNumber: person.memberNumber,
    today: PREVIEW_TODAY,
    labelOf,
    canView,
    canManage,
  });
  const addKinds = addIdKinds({
    canManage,
    labelOf,
    rules: RULES.systems,
    hints: { crm: "An id from a system that was retired. Kept so old QR codes and imports still resolve.", accounting: "The accounting system's customer or donor id." },
  });
  const roles: RolesFacts = limited
    ? { roles: part.noAccess(), waiver: part.noAccess(), background: part.noAccess() }
    : { roles: part.ok(x.roles), waiver: part.ok(x.waiver), background: part.ok(x.background) };
  const details: Part<ProfileDetails> = limited ? part.noAccess() : part.ok(x.details);
  const household = o.standalone ? null : detailHousehold(model);

  return {
    person: o.standalone ? { ...person, role: "other", isPrimary: false } : person,
    household,
    canEdit: !view,
    mergedIntoId: null,
    deceasedOn: null,
    timeZone: PREVIEW_TZ,
    check: model.check,
    account: part.ok({ linkedAt: x.linkedAt, hasEmail: Boolean(person.values.email) || !child, hasMobile: Boolean(person.values.phone_e164), childLoginAge: 13 }),
    roles,
    profileDetails: details,
    preferences: child
      ? null
      : {
          values: preferenceValues({ interests: x.prefs.interests, expertise_tags: x.prefs.areas, best_call_time: x.prefs.callTime || null, gyan_daily_minutes: x.prefs.goal }),
          channels: x.prefs.channels,
          learningOn: true,
        },
    privacy: {
      values: privacyValues({ photo_opt_in: x.photo, new_member_contact_opt_in: x.newMember, expertise_opt_in: x.expertiseOn, expertise_headline: x.expertise }),
      directory: household ? (model.values.directory_opt_in === "on" ? "Listed with the household" : "Not listed") : null,
      mail: household ? (model.values.physical_mail_opt_in === "on" ? "Opted in (household)" : "Opted out (household)") : null,
    },
    ids: part.ok({
      rows,
      addKinds,
      orgMemberDigits: RULES.orgMemberDigits,
      hiddenKinds: limited ? FINANCE.map(labelOf) : [],
    }),
    memberships: part.ok(x.memberships),
    ownerLinks: { roles: view ? null : "/dev/people-slideover" },
  };
}

/** A few audit rows (the real audit table draws them). */
export function historyRows(personId: string, name: string): AuditRow[] {
  const row = (id: number, at: string, action: string, before: Record<string, unknown>, after: Record<string, unknown>, reason: string | null): AuditRow => ({
    id,
    occurred_at: at,
    actor_user_id: "dev-user",
    action,
    record_table: "people",
    record_id: personId,
    before: before as AuditRow["before"],
    after: after as AuditRow["after"],
    reason,
    hash: `hash-${id}`,
  });
  void name;
  return [
    row(3, "2026-10-09T16:12:00Z", "people.update", { phone_e164: "+17135550125" }, { phone_e164: "+17135550136" }, null),
    row(2, "2026-09-02T14:40:00Z", "people.update", { last_name: "Hasan" }, { last_name: "Hassan" }, "Correction"),
    row(1, "2026-03-03T15:00:00Z", "people.insert", {}, { first_name: "Samira" }, null),
  ];
}

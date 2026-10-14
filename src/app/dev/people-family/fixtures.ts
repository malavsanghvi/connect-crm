// DEV ONLY. Invented families for a neutral community (a community hall in Riverside, members from several cultures), for the
// preview of the Family page. Nothing here is real. Each family has people, a household card and IDs; one has two children.

import type { HouseholdRole } from "@/lib/people";
import type { FamilyModel, FamilyPerson } from "@/lib/people-v2/family-model";

export const PREVIEW_COMMUNITY = "Riverside Community";
export const PREVIEW_TODAY = "2026-10-12";
const ZONES = [
  { id: "9a000000-0000-4000-8000-000000000001", name: "North Riverside" },
  { id: "9a000000-0000-4000-8000-000000000002", name: "South Riverside" },
];

function person(o: {
  id: string;
  first: string;
  last: string;
  /** The name the person goes by (people.preferred_name); the card then reads "Fola Adeyemi" and says "Goes by Fola". */
  preferred?: string;
  role: HouseholdRole;
  primary?: boolean;
  dob: string;
  age: number;
  gender?: string;
  phone?: string;
  email?: string;
  language?: string;
  profession?: string;
  child?: boolean;
  onApp?: boolean;
  member?: string;
  orgIds?: string[];
  name?: string;
}): FamilyPerson {
  return {
    id: o.id,
    name: o.name ?? `${o.preferred || o.first} ${o.last}`,
    firstName: o.preferred || o.first,
    role: o.role,
    isPrimary: o.primary ?? false,
    isChild: o.child ?? false,
    age: o.age,
    memberNumber: o.member ?? null,
    orgIds: o.orgIds ?? [],
    onApp: o.onApp ?? false,
    deceased: false,
    alsoPrimaryOf: null,
    values: {
      first_name: o.first,
      last_name: o.last,
      preferred_name: o.preferred ?? "",
      date_of_birth: o.dob,
      gender: o.gender ?? "",
      profession: o.profession ?? "",
      employer: "",
      phone_e164: o.phone ?? "",
      email: o.email ?? "",
      language: o.language ?? "en",
      role: o.role,
    },
  };
}

const CHECK = {
  today: PREVIEW_TODAY,
  majority: 18,
  zoneIds: ZONES.map((z) => z.id),
  languages: [
    { value: "en", label: "English" },
    { value: "es", label: "Spanish" },
    { value: "yo", label: "Yoruba" },
    { value: "ja", label: "Japanese" },
    { value: "ar", label: "Arabic" },
  ],
};

export type FamilyKey = "hassan" | "adeyemi" | "tanaka" | "empty";

const base = {
  orgLabel: "Community household ID",
  orgMemberLabel: "Community member ID",
  mergedIntoId: null,
  hiddenPeople: 0,
  zones: ZONES,
  can: { recordPayment: true, seesGiving: true, seesIds: true },
  check: CHECK,
};

function values(o: { name: string; line1: string; city: string; state: string; zip: string; zone: string; directory: boolean; mail: boolean; notes: string }) {
  return {
    display_name: o.name,
    address_line1: o.line1,
    address_line2: "",
    city: o.city,
    state_region: o.state,
    postal_code: o.zip,
    zone_id: o.zone,
    directory_opt_in: o.directory ? "on" : "off",
    physical_mail_opt_in: o.mail ? "on" : "off",
    notes: o.notes,
  };
}

export function familyFixture(key: FamilyKey, opts: { canEdit?: boolean } = {}): FamilyModel {
  const canEdit = opts.canEdit ?? true;
  if (key === "adeyemi") {
    const adults = [
      person({
        id: "p-tunde",
        first: "Tunde",
        last: "Adeyemi",
        role: "primary",
        primary: true,
        dob: "1974-02-11",
        age: 52,
        gender: "male",
        phone: "+17135550142",
        email: "tunde.adeyemi@example.org",
        language: "yo",
        onApp: true,
        member: "M-10211",
        orgIds: ["0211"],
        profession: "Civil engineer",
      }),
      person({
        id: "p-folake",
        first: "Folake",
        preferred: "Fola",
        last: "Adeyemi",
        role: "spouse",
        dob: "1977-08-30",
        age: 49,
        gender: "female",
        phone: "+17135550152",
        email: "folake.adeyemi@example.org",
        language: "en",
        onApp: true,
        member: "M-10212",
        orgIds: ["0212"],
      }),
    ];
    return {
      ...base,
      canEdit,
      id: "hh-adeyemi",
      name: "Adeyemi household",
      number: "0212",
      orgIds: ["RCC-H-1048"],
      card: { number: "0212", orgIds: ["RCC-H-1048"], adults: adults.map((a) => a.name), place: "Riverside, South Riverside" },
      membership: { tier: "life", endsOn: null },
      openPledge: { cents: 18000, text: "$180.00" },
      adults,
      children: [],
      values: values({
        name: "Adeyemi household",
        line1: "88 Brook Lane",
        city: "Riverside",
        state: "TX",
        zip: "77031",
        zone: ZONES[1].id,
        directory: true,
        mail: true,
        notes: "",
      }),
      zoneName: ZONES[1].name,
      ids: [
        { id: "number", kind: "connect_household", label: "Household number", value: "0212", system: null },
        { id: "i1", kind: "org_household", label: "Community household ID", value: "RCC-H-1048", system: "org_register" },
      ],
    };
  }
  if (key === "tanaka") {
    const adults = [
      person({
        id: "p-misaki",
        first: "美咲",
        last: "田中",
        name: "田中 美咲",
        role: "primary",
        primary: true,
        dob: "1981-06-04",
        age: 45,
        gender: "female",
        phone: "+81312345678",
        email: "misaki.tanaka@example.jp",
        language: "ja",
        onApp: true,
        member: "M-10507",
        profession: "薬剤師",
      }),
      person({
        id: "p-omar",
        first: "Omar",
        last: "Haddad",
        role: "spouse",
        dob: "1979-12-20",
        age: 46,
        gender: "male",
        phone: "+17135550177",
        email: "omar.haddad@example.org",
        language: "ar",
        onApp: false,
        member: "M-10508",
      }),
    ];
    return {
      ...base,
      canEdit,
      id: "hh-tanaka",
      name: "田中・Haddad の家",
      number: "0507",
      orgIds: [],
      card: { number: "0507", orgIds: [], adults: adults.map((a) => a.name), place: "Riverside, North Riverside" },
      membership: { tier: "yearly", endsOn: "2027-06-30" },
      openPledge: null,
      adults,
      children: [person({ id: "p-sora", first: "空", last: "田中", name: "田中 空", role: "child", dob: "2016-09-02", age: 10, gender: "male", child: true })],
      values: values({
        name: "田中・Haddad の家",
        line1: "3 Cedar Row",
        city: "Riverside",
        state: "TX",
        zip: "77030",
        zone: ZONES[0].id,
        directory: false,
        mail: true,
        notes: "連絡は夜がよい。",
      }),
      zoneName: ZONES[0].name,
      ids: [{ id: "number", kind: "connect_household", label: "Household number", value: "0507", system: null }],
    };
  }
  if (key === "empty") {
    const adults = [
      person({
        id: "p-ines",
        first: "Inés",
        last: "Valdés",
        role: "primary",
        primary: true,
        dob: "1990-03-03",
        age: 36,
        gender: "female",
        language: "es",
        member: "M-10901",
      }),
    ];
    return {
      ...base,
      canEdit,
      id: "hh-valdes",
      name: "Valdés household",
      number: "0901",
      orgIds: [],
      card: { number: "0901", orgIds: [], adults: adults.map((a) => a.name), place: null },
      membership: null,
      openPledge: null,
      adults,
      children: [],
      values: values({ name: "Valdés household", line1: "", city: "", state: "", zip: "", zone: "", directory: false, mail: true, notes: "" }),
      zoneName: null,
      ids: [{ id: "number", kind: "connect_household", label: "Household number", value: "0901", system: null }],
      can: { recordPayment: false, seesGiving: false, seesIds: true },
    };
  }
  const adults = [
    person({
      id: "p-samira",
      first: "Samira",
      last: "Hassan",
      role: "primary",
      primary: true,
      dob: "1985-04-14",
      age: 41,
      gender: "female",
      phone: "+17135550136",
      email: "samira.hassan@example.org",
      language: "en",
      onApp: true,
      member: "M-10482",
      orgIds: ["0482"],
      profession: "Pharmacist",
    }),
    person({
      id: "p-karim",
      first: "Karim",
      last: "Hassan",
      role: "spouse",
      dob: "1983-01-09",
      age: 43,
      gender: "male",
      phone: "+17135550171",
      email: "karim.hassan@example.org",
      language: "en",
      onApp: true,
      member: "M-10483",
      orgIds: ["0483"],
    }),
  ];
  const kids = [
    person({ id: "p-layla", first: "Layla", last: "Hassan", role: "child", dob: "2015-07-21", age: 11, gender: "female", child: true }),
    person({ id: "p-omar2", first: "Omar", last: "Hassan", role: "child", dob: "2018-02-02", age: 8, gender: "male", child: true }),
  ];
  return {
    ...base,
    canEdit,
    id: "hh-hassan",
    name: "Hassan household",
    number: "0301",
    orgIds: ["RCC-H-1102"],
    card: { number: "0301", orgIds: ["RCC-H-1102"], adults: adults.map((a) => a.name), place: "Riverside, North Riverside" },
    membership: { tier: "yearly", endsOn: "2027-03-31" },
    openPledge: { cents: 30000, text: "$300.00" },
    adults,
    children: kids,
    values: values({
      name: "Hassan household",
      line1: "14 Maple Court",
      city: "Riverside",
      state: "TX",
      zip: "77030",
      zone: ZONES[0].id,
      directory: true,
      mail: true,
      notes: "Prefers evening calls.",
    }),
    zoneName: ZONES[0].name,
    ids: [
      { id: "number", kind: "connect_household", label: "Household number", value: "0301", system: null },
      { id: "i1", kind: "org_household", label: "Community household ID", value: "RCC-H-1102", system: "org_register" },
      { id: "i2", kind: "accounting", label: "Accounting (QuickBooks) customer", value: "1187", system: "quickbooks" },
      { id: "i3", kind: "bank_payer", label: "Bank payer name", value: "S HASSAN", system: "bank" },
    ],
  };
}

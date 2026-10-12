// Invented people for the find box tests: a neutral neighbourhood association with names in several scripts. Nothing is real.

import type { IdLabelRules } from "@/lib/find/labels";
import type { FamilyCandidate, PersonCandidate } from "@/lib/find/types";

export const RULES: IdLabelRules = {
  orgMemberLabel: "Member ID",
  orgHouseholdLabel: "Household ID",
  legacySystems: [{ system: "neon", label: "Old CRM ID" }],
};

export function person(over: Partial<PersonCandidate> & Pick<PersonCandidate, "id" | "firstName" | "lastName">): PersonCandidate {
  return {
    preferredName: null,
    email: null,
    phoneE164: null,
    memberNumber: null,
    isChild: false,
    isDeceased: false,
    householdId: null,
    relationship: "primary",
    hits: [],
    ...over,
  };
}

export function family(over: Partial<FamilyCandidate> & Pick<FamilyCandidate, "id">): FamilyCandidate {
  return { displayName: null, householdNumber: null, hits: [], ...over };
}

export const PEOPLE = {
  samira: person({ id: "p-samira", firstName: "Samira", lastName: "Hassan", householdId: "h-hassan", memberNumber: "10482", phoneE164: "+17135550136", email: "samira.hassan@example.org" }),
  layla: person({ id: "p-layla", firstName: "Layla", lastName: "Hassan", householdId: "h-hassan", relationship: "child", isChild: true }),
  sam: person({ id: "p-sam", firstName: "Samuel", preferredName: "Sam", lastName: "Nakamura", householdId: "h-nakamura", relationship: "spouse", memberNumber: "10471" }),
  taro: person({ id: "p-taro", firstName: "太郎", lastName: "田中", householdId: "h-tanaka", memberNumber: "10533" }),
  sofia: person({ id: "p-sofia", firstName: "Sofía", lastName: "Fernández", householdId: "h-fernandez", phoneE164: "+14155550142" }),
  priya: person({ id: "p-priya", firstName: "प्रिया", lastName: "शर्मा", householdId: "h-sharma" }),
  mohammed: person({ id: "p-mohammed", firstName: "محمد", lastName: "الحسن", householdId: "h-hasan" }),
  nikolai: person({ id: "p-nikolai", firstName: "Николай", lastName: "Иванов", householdId: "h-ivanov" }),
  ana: person({ id: "p-ana", firstName: "Ana", lastName: "Lopez", householdId: "h-lopez", email: "ana@lopezbakery.example", phoneE164: "+14155550134" }),
};

export const FAMILIES = {
  hassan: family({ id: "h-hassan", displayName: "Hassan household", householdNumber: "0301" }),
  nakamura: family({ id: "h-nakamura", displayName: "Nakamura household", householdNumber: "0455" }),
  tanaka: family({ id: "h-tanaka", displayName: "田中 household", householdNumber: "0470" }),
  fernandez: family({ id: "h-fernandez", displayName: "Fernández Ruiz household", householdNumber: "0662" }),
  lopez: family({ id: "h-lopez", displayName: "Lopez Bakery household", householdNumber: "0212" }),
};

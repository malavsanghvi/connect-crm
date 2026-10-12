import type { FamilyMatchView } from "@/lib/people-family";

// Invented sample data for the Add a family preview: a neutral neighbourhood association, names from several cultures. None of it
// is real and none of it touches a database.

export const PREVIEW_COMMUNITY = "Riverside Neighbourhood Association";

export const MATCHES: FamilyMatchView[] = [
  { householdId: "11111111-1111-4111-8111-111111111111", reasons: ["mobile", "name"], householdNumber: "H-1001", orgHouseholdId: "RNA-2041", adults: ["Priya Shah", "Rahul Shah"], city: "Austin", zone: "North Riverside" },
  { householdId: "22222222-2222-4222-8222-222222222222", reasons: ["name"], householdNumber: "H-1042", orgHouseholdId: "RNA-2077", adults: ["Priya Sharma"], city: "Round Rock", zone: null },
  { householdId: "33333333-3333-4333-8333-333333333333", reasons: ["last_name"], householdNumber: "H-1090", orgHouseholdId: null, adults: ["Hana Shah", "Omar Hassan"], city: "Cedar Park", zone: "West" },
];

export const CJK_MATCHES: FamilyMatchView[] = [
  { householdId: "44444444-4444-4444-8444-444444444444", reasons: ["email", "name"], householdNumber: "H-2201", orgHouseholdId: "RNA-3310", adults: ["李 明", "ليلى الحسن"], city: "Austin", zone: null },
];

export const SCENARIOS = ["default", "matches", "confirm", "nomatch", "error", "adderror", "noaccess", "cjk"] as const;
export type Scenario = (typeof SCENARIOS)[number];

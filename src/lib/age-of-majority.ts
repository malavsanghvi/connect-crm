// The age at which a person stops being a child, for one community.
//
// Decision D2 says nothing about anyone under 18 reaches an AI provider. 18 is the FLOOR, not the rule: some places set the age
// of majority higher (Singapore 21, Alabama 19 …), and a community there must not have its 18-year-olds treated as adults by the
// assistant. So the answer is always max(18, what the community's place says), and never lower than 18, whatever is configured.
//
// The place is data the organization already has: centers.country (an ISO code, "US" by default; Setup > Profile sets it, and a name or
// a three-letter code is understood too) and centers.state_region.
// A community can also record its own age in its rules (`rules.age_of_majority`, a whole number from 18 to 25); nothing sets
// that yet, but the assistant honours it the moment something does. A country this table does not know is simply 18.
//
// Pure: no server imports, so it is tested directly and usable anywhere.

import { countryCodeOf } from "./countries";

export const MIN_AGE_OF_MAJORITY = 18;
const MAX_AGE_OF_MAJORITY = 25;

export type MajorityPlace = {
  country?: string | null;
  state_region?: string | null;
  rules?: unknown;
};

/** Countries whose general age of majority is above 18 (ISO 3166-1 alpha-2). A conservative list: anything missing reads as 18. */
const COUNTRY_MAJORITY: Readonly<Record<string, number>> = {
  SG: 21, // Singapore
  EG: 21, // Egypt
  KW: 21, // Kuwait
  AE: 21, // United Arab Emirates
  OM: 21, // Oman
  BH: 21, // Bahrain
  CM: 21, // Cameroon
  CI: 21, // Cote d'Ivoire
  TH: 20, // Thailand
  KR: 19, // South Korea
  DZ: 19, // Algeria
};

/** Regions inside a country with their own age: US states and Canadian provinces (code or name, lower case). */
const REGION_MAJORITY: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  US: { al: 19, alabama: 19, ne: 19, nebraska: 19, ms: 21, mississippi: 21 },
  CA: {
    bc: 19, "british columbia": 19, nb: 19, "new brunswick": 19, nl: 19, "newfoundland and labrador": 19,
    ns: 19, "nova scotia": 19, nt: 19, "northwest territories": 19, nu: 19, nunavut: 19, yt: 19, yukon: 19,
  },
};

function configuredAge(rules: unknown): number | null {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return null;
  const v = (rules as Record<string, unknown>).age_of_majority;
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_AGE_OF_MAJORITY && v <= MAX_AGE_OF_MAJORITY ? v : null;
}

/** The age a person must reach in this community to count as an adult: max(18, the place's age, the community's own setting). */
export function ageOfMajority(place?: MajorityPlace | null): number {
  if (!place) return MIN_AGE_OF_MAJORITY;
  const code = countryCodeOf(place.country);
  const region = (place.state_region ?? "").trim().toLowerCase();
  const fromRegion = code && region ? REGION_MAJORITY[code]?.[region] : undefined;
  const fromCountry = fromRegion ?? (code ? COUNTRY_MAJORITY[code] : undefined);
  return Math.max(MIN_AGE_OF_MAJORITY, fromCountry ?? MIN_AGE_OF_MAJORITY, configuredAge(place.rules) ?? MIN_AGE_OF_MAJORITY);
}

function daysIn(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/**
 * The latest birth date (YYYY-MM-DD) of a person who is an adult on `today`: anyone born AFTER it is under `majority`. A birthday
 * that does not exist in that year (29 February) counts from the last day of the month, so nobody is treated as an adult a day early.
 */
export function birthCutoff(today: string, majority: number): string {
  const [y = 0, m = 1, d = 1] = today.split("-").map(Number);
  const year = y - Math.max(majority, MIN_AGE_OF_MAJORITY);
  const day = Math.min(d, daysIn(year, m));
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

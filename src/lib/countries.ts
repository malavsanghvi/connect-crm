// Countries by ISO 3166-1 code and name, for the community's Profile (where it is decides the age of majority the assistant uses; see
// age-of-majority.ts). Pure data and one lookup that accepts what people type: "SG", "SGP", "Singapore", "Republic of Singapore",
// "U.A.E.", "United States of America".

/** [alpha-2, alpha-3, name]. A country that is not listed is not an error: the lookup then gives null and the age stays 18. */
export const COUNTRIES: readonly (readonly [string, string, string])[] = [
  ["US", "USA", "United States"], ["CA", "CAN", "Canada"], ["GB", "GBR", "United Kingdom"], ["IE", "IRL", "Ireland"],
  ["AU", "AUS", "Australia"], ["NZ", "NZL", "New Zealand"], ["IN", "IND", "India"], ["PK", "PAK", "Pakistan"],
  ["BD", "BGD", "Bangladesh"], ["LK", "LKA", "Sri Lanka"], ["NP", "NPL", "Nepal"], ["SG", "SGP", "Singapore"],
  ["MY", "MYS", "Malaysia"], ["AE", "ARE", "United Arab Emirates"], ["SA", "SAU", "Saudi Arabia"], ["QA", "QAT", "Qatar"],
  ["KW", "KWT", "Kuwait"], ["OM", "OMN", "Oman"], ["BH", "BHR", "Bahrain"], ["EG", "EGY", "Egypt"], ["JO", "JOR", "Jordan"],
  ["LB", "LBN", "Lebanon"], ["IL", "ISR", "Israel"], ["TR", "TUR", "Turkey"], ["IR", "IRN", "Iran"], ["IQ", "IRQ", "Iraq"],
  ["ZA", "ZAF", "South Africa"], ["KE", "KEN", "Kenya"], ["NG", "NGA", "Nigeria"], ["GH", "GHA", "Ghana"], ["TZ", "TZA", "Tanzania"],
  ["UG", "UGA", "Uganda"], ["ET", "ETH", "Ethiopia"], ["DZ", "DZA", "Algeria"], ["MA", "MAR", "Morocco"], ["TN", "TUN", "Tunisia"],
  ["CM", "CMR", "Cameroon"], ["CI", "CIV", "Cote d'Ivoire"], ["MU", "MUS", "Mauritius"], ["DE", "DEU", "Germany"], ["FR", "FRA", "France"],
  ["IT", "ITA", "Italy"], ["ES", "ESP", "Spain"], ["PT", "PRT", "Portugal"], ["NL", "NLD", "Netherlands"], ["BE", "BEL", "Belgium"],
  ["CH", "CHE", "Switzerland"], ["AT", "AUT", "Austria"], ["SE", "SWE", "Sweden"], ["NO", "NOR", "Norway"], ["DK", "DNK", "Denmark"],
  ["FI", "FIN", "Finland"], ["PL", "POL", "Poland"], ["CZ", "CZE", "Czechia"], ["HU", "HUN", "Hungary"], ["RO", "ROU", "Romania"],
  ["GR", "GRC", "Greece"], ["UA", "UKR", "Ukraine"], ["RU", "RUS", "Russia"], ["GE", "GEO", "Georgia"], ["AM", "ARM", "Armenia"],
  ["CN", "CHN", "China"], ["HK", "HKG", "Hong Kong"], ["TW", "TWN", "Taiwan"], ["JP", "JPN", "Japan"], ["KR", "KOR", "South Korea"],
  ["TH", "THA", "Thailand"], ["VN", "VNM", "Vietnam"], ["ID", "IDN", "Indonesia"], ["PH", "PHL", "Philippines"], ["MX", "MEX", "Mexico"],
  ["BR", "BRA", "Brazil"], ["AR", "ARG", "Argentina"], ["CL", "CHL", "Chile"], ["CO", "COL", "Colombia"], ["PE", "PER", "Peru"],
  ["TT", "TTO", "Trinidad and Tobago"], ["JM", "JAM", "Jamaica"], ["GY", "GUY", "Guyana"], ["FJ", "FJI", "Fiji"],
];

const BY_ALPHA2 = new Map(COUNTRIES.map(([a2]) => [a2, a2]));
const BY_KEY = new Map<string, string>();
const key = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
for (const [a2, a3, name] of COUNTRIES) {
  BY_KEY.set(key(a3), a2);
  BY_KEY.set(key(name), a2);
}
for (const [alias, a2] of [
  ["usa", "US"], ["united states of america", "US"], ["america", "US"], ["uk", "GB"], ["great britain", "GB"], ["britain", "GB"], ["england", "GB"], ["scotland", "GB"],
  ["wales", "GB"], ["northern ireland", "GB"], ["uae", "AE"], ["emirates", "AE"], ["korea", "KR"], ["republic of korea", "KR"], ["korea republic of", "KR"],
  ["holland", "NL"], ["czech republic", "CZ"], ["ivory coast", "CI"], ["cote divoire", "CI"], ["turkiye", "TR"], ["russian federation", "RU"],
  ["viet nam", "VN"], ["burma", "MM"], ["people's republic of china", "CN"], ["prc", "CN"],
] as const) BY_KEY.set(key(alias), a2);

/** The ISO alpha-2 code for what someone typed or picked, or null when it is not a country this list knows. */
export function countryCodeOf(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const k = key(raw);
  const direct = BY_KEY.get(k);
  if (direct) return direct;
  // "Republic of Singapore", "the Kingdom of Thailand", "State of Kuwait", "Islamic Republic of Iran".
  const stripped = k.replace(/^(the)?(federalrepublicof|islamicrepublicof|peoplesrepublicof|democraticrepublicof|republicof|kingdomof|stateof|sultanateof|emirateof|commonwealthof)/, "");
  return BY_KEY.get(stripped) ?? BY_ALPHA2.get(stripped.toUpperCase()) ?? null;
}

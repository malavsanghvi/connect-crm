// The community's country from its time zone, for the places that only have the time zone at hand (the profile's time zone
// is always set, the country is not always passed along). Pure, no dependencies.

const BY_ZONE: Readonly<Record<string, string>> = (() => {
  const m: Record<string, string> = Object.create(null) as Record<string, string>;
  const add = (iso: string, zones: string) => {
    for (const z of zones.split(/\s+/).filter(Boolean)) m[z] = iso;
  };
  add("US", "America/New_York America/Chicago America/Denver America/Los_Angeles America/Phoenix America/Anchorage America/Detroit America/Boise America/Juneau America/Adak America/Menominee America/Nome America/Sitka America/Yakutat America/Metlakatla America/Indianapolis America/Louisville Pacific/Honolulu EST5EDT CST6CDT MST7MDT PST8PDT");
  add("CA", "America/Toronto America/Vancouver America/Edmonton America/Winnipeg America/Halifax America/St_Johns America/Regina America/Montreal America/Moncton America/Glace_Bay America/Iqaluit America/Whitehorse America/Yellowknife America/Thunder_Bay America/Rainy_River America/Cambridge_Bay America/Atikokan America/Goose_Bay America/Resolute America/Rankin_Inlet America/Swift_Current America/Dawson America/Dawson_Creek America/Fort_Nelson America/Inuvik America/Nipigon America/Pangnirtung America/Blanc-Sablon America/Creston");
  add("MX", "America/Mexico_City America/Cancun America/Monterrey America/Tijuana America/Merida America/Chihuahua America/Hermosillo America/Mazatlan America/Matamoros America/Ojinaga America/Bahia_Banderas America/Ciudad_Juarez");
  add("BR", "America/Sao_Paulo America/Manaus America/Bahia America/Fortaleza America/Recife America/Belem America/Cuiaba America/Campo_Grande America/Porto_Velho America/Rio_Branco America/Noronha America/Araguaina America/Maceio America/Santarem America/Boa_Vista America/Eirunepe");
  add("AR", "America/Buenos_Aires");
  add("CL", "America/Santiago"); add("CO", "America/Bogota"); add("PE", "America/Lima"); add("VE", "America/Caracas"); add("EC", "America/Guayaquil");
  add("UY", "America/Montevideo"); add("BO", "America/La_Paz"); add("CR", "America/Costa_Rica"); add("GT", "America/Guatemala"); add("PA", "America/Panama");
  add("DO", "America/Santo_Domingo"); add("JM", "America/Jamaica"); add("TT", "America/Port_of_Spain"); add("PR", "America/Puerto_Rico");
  add("GB", "Europe/London"); add("IE", "Europe/Dublin"); add("FR", "Europe/Paris"); add("DE", "Europe/Berlin"); add("ES", "Europe/Madrid");
  add("IT", "Europe/Rome"); add("PT", "Europe/Lisbon"); add("NL", "Europe/Amsterdam"); add("BE", "Europe/Brussels"); add("CH", "Europe/Zurich");
  add("AT", "Europe/Vienna"); add("SE", "Europe/Stockholm"); add("NO", "Europe/Oslo"); add("DK", "Europe/Copenhagen"); add("FI", "Europe/Helsinki");
  add("PL", "Europe/Warsaw"); add("CZ", "Europe/Prague"); add("HU", "Europe/Budapest"); add("RO", "Europe/Bucharest"); add("BG", "Europe/Sofia");
  add("GR", "Europe/Athens"); add("TR", "Europe/Istanbul Asia/Istanbul"); add("RU", "Europe/Moscow Asia/Yekaterinburg Asia/Novosibirsk Asia/Vladivostok");
  add("UA", "Europe/Kiev Europe/Kyiv"); add("BY", "Europe/Minsk"); add("RS", "Europe/Belgrade"); add("HR", "Europe/Zagreb"); add("SK", "Europe/Bratislava");
  add("IN", "Asia/Kolkata Asia/Calcutta"); add("PK", "Asia/Karachi"); add("BD", "Asia/Dhaka"); add("LK", "Asia/Colombo"); add("NP", "Asia/Kathmandu Asia/Katmandu");
  add("AE", "Asia/Dubai"); add("SA", "Asia/Riyadh"); add("QA", "Asia/Qatar"); add("KW", "Asia/Kuwait"); add("BH", "Asia/Bahrain"); add("OM", "Asia/Muscat");
  add("IQ", "Asia/Baghdad"); add("IR", "Asia/Tehran"); add("IL", "Asia/Jerusalem Asia/Tel_Aviv"); add("JO", "Asia/Amman"); add("LB", "Asia/Beirut");
  add("AF", "Asia/Kabul"); add("KZ", "Asia/Almaty"); add("SG", "Asia/Singapore"); add("MY", "Asia/Kuala_Lumpur"); add("TH", "Asia/Bangkok");
  add("VN", "Asia/Ho_Chi_Minh Asia/Saigon"); add("ID", "Asia/Jakarta"); add("PH", "Asia/Manila"); add("CN", "Asia/Shanghai Asia/Chongqing Asia/Harbin");
  add("HK", "Asia/Hong_Kong"); add("TW", "Asia/Taipei"); add("JP", "Asia/Tokyo"); add("KR", "Asia/Seoul"); add("MM", "Asia/Yangon Asia/Rangoon"); add("KH", "Asia/Phnom_Penh");
  add("NG", "Africa/Lagos"); add("GH", "Africa/Accra"); add("KE", "Africa/Nairobi"); add("ET", "Africa/Addis_Ababa"); add("TZ", "Africa/Dar_es_Salaam");
  add("UG", "Africa/Kampala"); add("ZA", "Africa/Johannesburg"); add("EG", "Africa/Cairo"); add("MA", "Africa/Casablanca"); add("DZ", "Africa/Algiers"); add("TN", "Africa/Tunis");
  add("NZ", "Pacific/Auckland");
  return m;
})();

const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["America/Indiana/", "US"], ["America/Kentucky/", "US"], ["America/North_Dakota/", "US"], ["US/", "US"], ["America/Argentina/", "AR"],
  ["Canada/", "CA"], ["Brazil/", "BR"], ["Australia/", "AU"],
];

/** The ISO country code for an IANA time zone ("Asia/Kolkata" is IN, "America/Chicago" is US), or null when it says nothing ("UTC"). */
export function countryFromTimeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  const z = String(zone).trim();
  if (BY_ZONE[z]) return BY_ZONE[z] ?? null;
  for (const [prefix, iso] of PREFIXES) if (z.startsWith(prefix)) return iso;
  return null;
}

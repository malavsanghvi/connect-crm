// Phone numbers and street addresses found in the text of a web page, for many countries. Pure, no dependencies on the app
// (the crawler worker bundles this file). Every pattern is bounded: no unbounded repetition inside a repetition, so a hostile page
// of 200,000 characters costs a few passes, never a search that grows with its square.

import { parsePhone } from "./phone";

// Digits may be separated by one or two spaces, dots, hyphens or brackets, but a full stop followed by a space ends a sentence:
// "call +44 7700 900123. 12 Lotus Road" is a number and an address, not one long number.
const SEP = /(?:(?!\.\s)[ \u00a0.()-]){0,2}/.source;
const NANP_PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-][2-9]\d{2}[\s.-]\d{4}\b/g;
/** A number that carries its country code: +44 20 7946 0958, 0091 98250 12345. */
const INTERNATIONAL_PHONE = new RegExp(String.raw`(?<![\w+])(?:\+|00)[ \u00a0]?\d(?:${SEP}\d){6,17}(?!\d)`, "g");
/** A number that is introduced by a word that says it is one: "Tel: 020 7946 0958", "Mobile 98250 12345", "WhatsApp +34 612 345 678". */
const LABELLED_PHONE = new RegExp(
  String.raw`\b(?:tel|telephone|telefon|tel[eé]fono|telefone|t[eé]l[eé]phone|t[eé]l|tlf|phone|ph|mob|mobile|cell|whatsapp|call|rufnummer)\b\.?\s{0,2}[:.#-]?\s{0,3}(\(?\+?\d(?:${SEP}\d){6,17})(?!\d)`,
  "gi",
);

/**
 * Phone numbers, as written, in the order they appear: North American formats, numbers with a country code (checked against the
 * calling-code table), and numbers that follow a label such as "Tel".
 */
export function findPhones(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const key = candidate.replace(/\D/g, "").replace(/^00/, "").replace(/^1(?=\d{10}$)/, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };
  for (const m of text.matchAll(NANP_PHONE)) add(m[0].trim());
  for (const m of text.matchAll(INTERNATIONAL_PHONE)) {
    const candidate = m[0].replace(/[\s.-]+$/, "").trim();
    if (parsePhone(candidate, null).ok) add(candidate);
  }
  for (const m of text.matchAll(LABELLED_PHONE)) {
    const candidate = (m[1] ?? "").replace(/[\s.-]+$/, "").trim();
    const digits = candidate.replace(/\D/g, "");
    // 8 to 13 digits, and not a date written with dashes or slashes.
    if (digits.length >= 8 && digits.length <= 13 && !/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(candidate) && !/^(\d)\1+$/.test(digits)) add(candidate);
  }
  return out;
}

const NAME = "[A-Z][A-Za-z.'’-]*";
const EN_TYPES = "Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Way|Court|Ct|Place|Pl|Terrace|Crescent|Cres|Gardens|Square|Hill|Park|Grove|Row|Walk|Parade|Pde|Boulevard|Blvd|Highway|Hwy|Trail";
const CA_PROVINCES = "AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT";
const AU_STATES = "NSW|VIC|QLD|SA|WA|TAS|NT|ACT";
const IN_STATES =
  "India|Maharashtra|Gujarat|Karnataka|Tamil Nadu|Kerala|Delhi|West Bengal|Telangana|Rajasthan|Uttar Pradesh|Madhya Pradesh|Punjab|Haryana|Bihar|Odisha|Assam|Goa|Andhra Pradesh|Jharkhand|Chhattisgarh|Uttarakhand|Himachal Pradesh";

const ADDRESS_PATTERNS: RegExp[] = [
  // United Kingdom and Ireland: "12 Lotus Road, Leeds LS1 4AB", "Flat 4, 12 High Street, London SW1A 1AA".
  new RegExp(`\\b\\d{1,5}[A-Za-z]?\\s+(?:${NAME}\\s+){1,4}(?:${EN_TYPES})\\b\\.?,?\\s+(?:${NAME}\\s*,?\\s*){1,3}[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}\\b`, "g"),
  // Canada: "100 King St W, Toronto, ON M5X 1A1".
  new RegExp(`\\b\\d{1,6}[A-Za-z]?\\s+(?:${NAME}\\s+){1,4}(?:${EN_TYPES})\\b\\.?\\s*[NSEW]{0,2}\\.?,?\\s+${NAME}(?:\\s${NAME}){0,2},?\\s+(?:${CA_PROVINCES})\\.?\\s+[A-Z]\\d[A-Z][\\s-]?\\d[A-Z]\\d\\b`, "g"),
  // Australia: "12 George St, Sydney NSW 2000".
  new RegExp(`\\b\\d{1,5}[A-Za-z]?(?:[-/]\\d{1,4})?\\s+(?:${NAME}\\s+){1,3}(?:${EN_TYPES})\\b\\.?,?\\s+${NAME}(?:\\s${NAME}){0,2},?\\s+(?:${AU_STATES})\\s+\\d{4}\\b`, "g"),
  // Germany, Austria, Switzerland: "Hauptstraße 12, 10115 Berlin", "Karl-Marx-Allee 5a, 1010 Wien".
  /\b[A-ZÄÖÜ][A-Za-zäöüßÄÖÜ'’-]{1,30}?(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer)\s+\d{1,4}[a-z]?,?\s+(?:D-|A-|CH-)?\d{4,5}\s+[A-ZÄÖÜ][A-Za-zäöüß.-]+(?:\s[A-ZÄÖÜ][A-Za-zäöüß-]+)?/g,
  // Netherlands and Belgium: "Kerkstraat 5, 1012 AB Amsterdam".
  /\b[A-Z][A-Za-z'’-]{2,25}?(?:straat|laan|plein|gracht|dijk|weg)\s+\d{1,4}[a-z]?,?\s+\d{4}\s?[A-Z]{0,2}\s+[A-Z][A-Za-z-]+/g,
  // France: "12 rue de la Paix, 75002 Paris".
  /\b\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:rue|avenue|av\.|boulevard|bd|chemin|place|impasse|allée|allee|quai|route|cours)\s+[\p{L}'’ .-]{2,40}?,?\s+\d{5}\s+\p{Lu}[\p{L}'’-]+(?:[ -]\p{Lu}[\p{L}'’-]+){0,2}/giu,
  // Spain and Latin America: "Calle Mayor 12, 28013 Madrid", "Av. Libertador 1234, C1425 Buenos Aires".
  /\b(?:Calle|Avenida|Av\.|Avda\.|Paseo|Plaza|Camino|Carretera|Carrer)\s+[\p{L}'’. -]{2,40}?,?\s+(?:n[º°o]\.?\s*)?\d{1,5}[A-Za-z]?(?:,?\s+[\p{L}\d.º°ª-]{1,6}){0,3},?\s+[A-Z]?\d{4,5}[A-Z]{0,3}\s+\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?/gu,
  // Italy: "Via Roma 12, 00184 Roma".
  /\b(?:Via|Viale|Corso|Piazza|Largo|Vicolo)\s+[\p{L}'’. -]{2,40}?,?\s+(?:n\.?\s*)?\d{1,4}(?:\/?[A-Za-z])?,?\s+\d{5}\s+\p{Lu}[\p{L}'’-]+/gu,
  // Portugal and Brazil: "Rua das Flores 123, 1200-195 Lisboa", "Rua das Flores, 123 - Centro, São Paulo - SP, 01310-100".
  /\b(?:Rua|Avenida|Av\.|Travessa|Alameda|Praça)\s+[\p{L}'’. -]{2,40}?,?\s+(?:n[º°o]\.?\s*)?\d{1,5}\b[^.\n]{0,60}?\b(?:\d{4}-\d{3}|\d{5}-\d{3})\b(?:\s+\p{Lu}[\p{L}'’-]+)?/gu,
  // India: "Plot 12, MG Road, Andheri East, Mumbai, Maharashtra 400069", "B-304 Lotus Park, Pune - 411001, India".
  new RegExp(`(?<![\\w/-])(?:[A-Za-z]{1,6}[-/ ]?)?\\d{1,5}[A-Za-z]?(?:[/-]\\d{1,4})?,?\\s+[^\\n.;|]{4,90}?\\b(?:${IN_STATES})\\b[,\\s-]*(?:India)?[,\\s-]*(?:PIN\\s*(?:code)?[:\\s-]*)?[1-9]\\d{2}\\s?\\d{3}\\b`, "g"),
];

/** Street addresses written with a postal code, in the formats of the United Kingdom, Canada, Australia, Germany, the Netherlands, France, Spain, Italy, Portugal, Brazil and India. */
export function findInternationalAddresses(text: string): string[] {
  const out: string[] = [];
  for (const re of ADDRESS_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const t = m[0].replace(/\s+/g, " ").trim();
      if (t.length <= 160) out.push(t);
    }
  }
  return out;
}

// Words in street addresses and dates in many languages. Pure data, no dependencies. All keys are lower-case and folded
// (no accents: "calle", "strasse", "février" is "fevrier").
//
import { table } from "./fold";

// Street types map to one short code per KIND of street, so "Street", "Rue", "Calle", "Via" and "Strasse" are all "st"
// and "Road", "Chemin", "Camino" and "Weg" are all "rd". Two addresses are only told apart by a different kind when
// both name one, as before.

/** Types that come AFTER the street name in English and the Germanic and Slavic languages: "Lotus Lane", "Kerkstraat". */
export const SUFFIX_TYPES: Readonly<Record<string, string>> = table({
  street: "st", st: "st", str: "st", strasse: "st", gasse: "st", straat: "st", gracht: "st", gata: "st", gatan: "st", gade: "st", sokak: "st",
  avenue: "ave", ave: "ave", av: "ave", allee: "ave", laan: "ave", caddesi: "ave",
  road: "rd", rd: "rd", weg: "rd", vagen: "rd", veien: "rd", vej: "rd",
  drive: "dr", dr: "dr", lane: "ln", ln: "ln", boulevard: "blvd", blvd: "blvd", bulvari: "blvd", court: "ct", ct: "ct", circle: "cir", cir: "cir",
  place: "pl", pl: "pl", platz: "pl", plein: "pl", terrace: "ter", ter: "ter", parkway: "pkwy", pkwy: "pkwy", highway: "hwy", hwy: "hwy",
  trail: "trl", trl: "trl", way: "way", square: "sq", sq: "sq", loop: "loop", path: "path", alley: "aly", crossing: "xing", xing: "xing",
  pike: "pike", run: "run", row: "row", cove: "cv", cv: "cv", bend: "bnd", bnd: "bnd",
});

/** Types that come BEFORE the street name: "Calle Mayor", "Rue de la Paix", "Via Roma", "ulitsa Lenina", "Jalan Merdeka". */
export const PREFIX_TYPES: Readonly<Record<string, string>> = table({
  rue: "st", calle: "st", cl: "st", via: "st", strada: "st", rua: "st", carrer: "st", ulica: "st", ul: "st", ulitsa: "st", jalan: "st", jl: "st",
  odos: "st", kalea: "st", ulice: "st", utca: "st", "ул": "st", "улица": "st",
  avenue: "ave", avenida: "ave", avda: "ave", viale: "ave", corso: "ave", prospekt: "ave", prospect: "ave", paseo: "ave", cours: "ave",
  leoforos: "ave", "пр": "ave", "проспект": "ave",
  boulevard: "blvd", bd: "blvd", bulevar: "blvd", bulvar: "blvd", "бул": "blvd",
  chemin: "rd", camino: "rd", route: "rd", carretera: "rd", estrada: "rd", ronda: "rd", road: "rd",
  place: "pl", plaza: "pl", piazza: "pl", praca: "pl", plac: "pl", ploshchad: "pl", "пл": "pl",
  impasse: "ln", callejon: "ln", vicolo: "ln", travessa: "ln", pereulok: "ln", "пер": "ln",
  alameda: "ave", largo: "pl", quai: "st",
});

/** Words that sit between a street type and the name and are not part of it ("Rue DE LA Paix", "Calle DEL Sol"). */
export const NAME_LINKS: ReadonlySet<string> = new Set([
  "de", "del", "la", "las", "los", "le", "les", "du", "des", "di", "da", "do", "das", "dos", "della", "delle", "dei", "degli", "the", "of",
]);

/** Ends of a one-word street name written together: "Hauptstrasse", "Kerkstraat". */
export const GLUED_SUFFIXES: ReadonlyArray<readonly [string, string]> = [
  ["strasse", "st"], ["straat", "st"], ["gasse", "st"], ["gracht", "st"], ["str", "st"], ["allee", "ave"], ["laan", "ave"], ["weg", "rd"],
  ["platz", "pl"], ["plein", "pl"],
];

/** Words that name an apartment, floor or door; the next word is the unit. */
export const UNIT_WORDS: ReadonlySet<string> = new Set([
  "apt", "apartment", "unit", "ste", "suite", "bldg", "building", "fl", "floor", "rm", "room", "lot", "spc", "space",
  "flat", "apto", "apartamento", "depto", "departamento", "piso", "puerta", "pta", "esc", "escalera", "bloc",
  "etage", "etg", "appartement", "wohnung", "whg", "stiege", "kamer", "appt",
]);

/** Words that stand in front of a house number: "No. 12", "Nº 12", "Num 12". */
export const NUMBER_WORDS: ReadonlySet<string> = new Set(["no", "nr", "num", "numero", "numer", "number"]);

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

const MONTH_LISTS: ReadonlyArray<readonly [number, string]> = [
  [1, "jan january janv janvier ene enero gen gennaio januar januari janeiro stycznia styczen ocak january januar yanvar yanvarya"],
  [2, "feb february fev fevr fevrier febrero febbraio februar februari fevereiro lutego luty subat fevral fevralya"],
  [3, "mar march mars marzo marz mrz marco marca marzec mart marta maart"],
  [4, "apr april avr avril abr abril aprile aprilie kwietnia kwiecien nisan aprel aprelya"],
  [5, "may mai mayo maggio mag maio maja maj mei mayis maya"],
  [6, "jun june juin junio giugno giu juni junho czerwca czerwiec haziran iyun iyunya"],
  [7, "jul july juil juillet julio luglio lug juli julho lipca lipiec temmuz iyul iyulya"],
  [8, "aug august aout agosto ago augustus agosto sierpnia sierpien agustos avgust avgusta"],
  [9, "sep sept september septembre septiembre sete set settembre setembro wrzesnia wrzesien eylul sentyabr sentyabrya"],
  [10, "oct october oct octobre octubre ottobre ott oktober okt outubro out pazdziernika pazdziernik ekim oktyabr oktyabrya"],
  [11, "nov november novembre noviembre novembro listopada listopad kasim noyabr noyabrya"],
  [12, "dec december decembre diciembre dic dicembre dezember dez dezembro grudnia grudzien aralik dekabr dekabrya"],
];

const MONTH_NATIVE: Readonly<Record<string, number>> = {
  // Russian, Ukrainian (nominative and genitive), Hindi, Arabic (Levantine), Greek are written in their own scripts.
  "январь": 1, "января": 1, "февраль": 2, "февраля": 2, "март": 3, "марта": 3, "апрель": 4, "апреля": 4, "май": 5, "мая": 5, "июнь": 6,
  "июня": 6, "июль": 7, "июля": 7, "август": 8, "августа": 8, "сентябрь": 9, "сентября": 9, "октябрь": 10, "октября": 10, "ноябрь": 11,
  "ноября": 11, "декабрь": 12, "декабря": 12,
  "जनवरी": 1, "फरवरी": 2, "मार्च": 3, "अप्रैल": 4, "मई": 5, "जून": 6, "जुलाई": 7, "अगस्त": 8, "सितंबर": 9, "अक्टूबर": 10, "नवंबर": 11, "दिसंबर": 12,
  "يناير": 1, "فبراير": 2, "مارس": 3, "ابريل": 4, "مايو": 5, "يونيو": 6, "يوليو": 7, "اغسطس": 8, "سبتمبر": 9, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
};

/** Month words (folded, lower-case) in English, Spanish, Portuguese, French, German, Italian, Dutch, Polish, Turkish, Russian, Hindi and Arabic. */
export const MONTH_NUMBERS: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const [n, list] of MONTH_LISTS) for (const w of list.split(/\s+/)) if (!m.has(w)) m.set(w, n);
  for (const [w, n] of Object.entries(MONTH_NATIVE)) m.set(w, n);
  return m;
})();

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { callingCodeFor, countryForCallingCode, countryFromText, parsePhone } from "@/lib/onboarding/intl/phone";
import { parsePostal } from "@/lib/onboarding/intl/postal";
import { countryFromTimeZone } from "@/lib/onboarding/intl/zone";
import { MONTH_NUMBERS } from "@/lib/onboarding/intl/address-words";
import { asciiDigits, foldText } from "@/lib/onboarding/intl/fold";
import { addressKey, phoneKey } from "@/lib/onboarding/normalize";
import { matchPayers } from "@/lib/onboarding/match";
import { validateDonations } from "@/lib/onboarding/donations";
import { validatePeople, PERSON_FIELDS } from "@/lib/onboarding/people";
import { makeConfig } from "@/lib/onboarding/resolve/config";
import { normalizeAddress, normalizePhone, normalizePhones, normalizeRecord, parseDate } from "@/lib/onboarding/resolve/normalize";
import { countryOfNumbers, makeRunConfig } from "@/lib/onboarding/resolve/store";
import { resolveRecords } from "@/lib/onboarding/resolve/run";
import type { RawRecord } from "@/lib/onboarding/resolve/types";
import { rec, TODAY } from "./fixtures/onboarding-resolve/helpers";

describe("phone numbers of many countries", () => {
  it("reads a national number in the community's own country", () => {
    for (const [country, text, want] of [
      ["GB", "020 7946 0958", "+442079460958"],
      ["GB", "07700 900123", "+447700900123"],
      ["GB", "(020) 7946 0958", "+442079460958"],
      ["IN", "98250 12345", "+919825012345"],
      ["IN", "098250 12345", "+919825012345"],
      ["IN", "022 2345 6789", "+912223456789"],
      ["AU", "0412 345 678", "+61412345678"],
      ["DE", "030 12345678", "+493012345678"],
      ["FR", "01 23 45 67 89", "+33123456789"],
      ["ES", "612 345 678", "+34612345678"],
      ["IT", "06 1234 5678", "+390612345678"],
      ["BR", "(11) 91234-5678", "+5511912345678"],
      ["MX", "55 1234 5678", "+525512345678"],
      ["PK", "0300 1234567", "+923001234567"],
      ["RU", "8 (495) 123-45-67", "+74951234567"],
      ["JP", "090-1234-5678", "+819012345678"],
      ["CN", "138 0013 8000", "+8613800138000"],
      ["NG", "0803 123 4567", "+2348031234567"],
      ["ZA", "082 123 4567", "+27821234567"],
      ["US", "(713) 555-0142", "+17135550142"],
      ["CA", "416-555-0198", "+14165550198"],
    ] as const) {
      expect(normalizePhone(text, country).value, `${country} ${text}`).toBe(want);
    }
  });
  it("reads a number that carries its country code, whatever the community's country", () => {
    for (const [text, want] of [
      ["+44 20 7946 0958", "+442079460958"],
      ["+44 (0)20 7946 0958", "+442079460958"],
      ["0044 20 7946 0958", "+442079460958"],
      ["+91 98250 12345", "+919825012345"],
      ["0091 98250 12345", "+919825012345"],
      ["+49 (0) 30 12345678", "+493012345678"],
      ["+34 612 345 678", "+34612345678"],
      ["+52 1 55 1234 5678", "+525512345678"],
      ["+7 495 123 45 67", "+74951234567"],
      ["+971 50 123 4567", "+971501234567"],
      ["+1 (713) 555-0142", "+17135550142"],
    ] as const) {
      for (const home of ["US", "GB", "IN", undefined]) expect(normalizePhone(text, home).value, `${text} in ${home}`).toBe(want);
    }
    expect(normalizePhone("011 91 98250 12345", "US").value).toBe("+919825012345");
  });
  it("reads a number pasted without its plus, and numbers in other digits", () => {
    expect(normalizePhone("919825012345", "IN").value).toBe("+919825012345");
    expect(normalizePhone("442079460958", "GB").value).toBe("+442079460958");
    expect(normalizePhone("٠٩٨٢٥٠١٢٣٤٥", "IN").value).toBe("+919825012345"); // Arabic-Indic digits
    expect(normalizePhone("०९८२५०१२३४५", "IN").value).toBe("+919825012345"); // Devanagari digits
    expect(asciiDigits("١٢٣ ४५६ １２３")).toBe("123 456 123");
  });
  it("does not guess a country: a bare national number with no known country is unreadable, not American", () => {
    expect(normalizePhone("98250 12345")).toEqual({ value: null, problem: "phone" });
    expect(normalizePhone("07700 900123")).toEqual({ value: null, problem: "phone" });
    expect(normalizePhone("7135550142")).toEqual({ value: null, problem: "phone" });
    // only a number written unmistakably the North American way is read without a country
    expect(normalizePhone("(713) 555-0142").value).toBe("+17135550142");
    expect(normalizePhone("713-555-0142").value).toBe("+17135550142");
    expect(parsePhone("98250 12345", null)).toEqual({ ok: false, reason: "country_unknown" });
  });
  it("rejects numbers that are the wrong length for the country, and repeated digits", () => {
    for (const [country, text] of [["GB", "1234567"], ["IN", "98250 1234"], ["AU", "0412 345"], ["US", "713-155-0142"], ["DE", "+49 12"], ["IN", "0000000000"]] as const) {
      expect(normalizePhone(text, country).problem, `${country} ${text}`).toBe("phone");
    }
  });
  it("splits a cell with several numbers, on commas too", () => {
    expect(normalizePhones("98250 12345, 98250 12346", "IN").values).toEqual(["+919825012345", "+919825012346"]);
    expect(normalizePhones("020 7946 0958 / 07700 900123", "GB").values).toEqual(["+442079460958", "+447700900123"]);
    expect(normalizePhones("020 7946 0958, ext. 5", "GB").values).toEqual(["+442079460958"]);
  });
  it("knows country codes in both directions", () => {
    expect(callingCodeFor("us")).toBe("1");
    expect(callingCodeFor("+91")).toBe("91");
    expect(callingCodeFor("0044")).toBe("44");
    expect(callingCodeFor("ZZ")).toBeNull();
    expect(callingCodeFor("999")).toBeNull();
    expect(countryForCallingCode("44")).toBe("GB");
    expect(countryFromText("United Kingdom")).toBe("GB");
    expect(countryFromText("India")).toBe("IN");
    expect(countryFromText("U.S.A.")).toBe("US");
    expect(countryFromText("Narnia")).toBeNull();
  });
  it("the community's country comes from its profile or its time zone; unknown stays unknown", () => {
    const c = makeConfig(TODAY);
    expect([c.country, c.defaultCountry]).toEqual(["", ""]);
    expect(makeConfig(TODAY, { country: "GB" })).toMatchObject({ country: "GB", defaultCountry: "44" });
    expect(makeConfig(TODAY, { defaultCountry: "91" })).toMatchObject({ country: "IN", defaultCountry: "91" });
    expect(makeConfig(TODAY, { defaultCountry: "1" })).toMatchObject({ country: "US", defaultCountry: "1" });
    expect(makeConfig(TODAY, { country: "ZZ" })).toMatchObject({ country: "", defaultCountry: "" });
    expect(countryFromTimeZone("Asia/Kolkata")).toBe("IN");
    expect(countryFromTimeZone("America/Chicago")).toBe("US");
    expect(countryFromTimeZone("America/Toronto")).toBe("CA");
    expect(countryFromTimeZone("Europe/London")).toBe("GB");
    expect(countryFromTimeZone("Australia/Perth")).toBe("AU");
    expect(countryFromTimeZone("America/Argentina/Cordoba")).toBe("AR");
    expect(countryFromTimeZone("UTC")).toBeNull();
  });
  it("a run takes the country from the numbers that carry one, when it was not given", () => {
    const rows = [1, 2, 3, 4].map((i) => rec({ mobile: `+91 98250 1234${i}` }));
    expect(countryOfNumbers(rows)).toBe("IN");
    expect(makeRunConfig(rows, TODAY)).toMatchObject({ country: "IN", defaultCountry: "91" });
    // a given country wins
    expect(makeRunConfig(rows, TODAY, { country: "GB" }).country).toBe("GB");
    // a mixed file proves nothing
    expect(countryOfNumbers([...rows.slice(0, 2), rec({ mobile: "+44 20 7946 0958" }), rec({ mobile: "+44 20 7946 0959" })])).toBeNull();
    // too few numbers prove nothing
    expect(countryOfNumbers(rows.slice(0, 2))).toBeNull();
  });
});

describe("postal codes of many countries", () => {
  const code = (raw: string, country?: string) => parsePostal(raw, country)?.code ?? null;
  it("reads each country's format into one comparison key", () => {
    expect(parsePostal("77478-1234", "US")).toEqual({ code: "77478", plus4: "1234" });
    expect(parsePostal("774781234", "US")).toEqual({ code: "77478", plus4: "1234" });
    expect(code("2134", "US")).toBe("02134");
    expect(code("TX 77478", "US")).toBe("77478");
    expect(code("K1A 0B1", "CA")).toBe("k1a0b1");
    expect(code("k1a0b1", "CA")).toBe("k1a0b1");
    expect(code("SW1A 1AA", "GB")).toBe("sw1a1aa");
    expect(code("sw1a1aa", "GB")).toBe("sw1a1aa");
    expect(code("LS1 4AB", "GB")).toBe("ls14ab");
    expect(code("400 001", "IN")).toBe("400001");
    expect(code("400001", "IN")).toBe("400001");
    expect(code("10115", "DE")).toBe("10115");
    expect(code("D-10115", "DE")).toBe("10115");
    expect(code("75002", "FR")).toBe("75002");
    expect(code("2000", "AU")).toBe("2000");
    expect(code("1012 AB", "NL")).toBe("1012ab");
    expect(code("01310-100", "BR")).toBe("01310100");
    expect(code("1200-195", "PT")).toBe("1200195");
    expect(code("100-0001", "JP")).toBe("1000001");
    expect(code("00-950", "PL")).toBe("00950");
    expect(code("111 22", "SE")).toBe("11122");
    expect(code("D02 X285", "IE")).toBe("d02x285");
  });
  it("without a country the shape decides, and a 4-digit code is not turned into an American ZIP", () => {
    expect(code("77478")).toBe("77478");
    expect(code("SW1A 1AA")).toBe("sw1a1aa");
    expect(code("K1A 0B1")).toBe("k1a0b1");
    expect(code("400001")).toBe("400001");
    expect(code("2134")).toBe("2134");
    expect(code("n/a")).toBeNull();
    expect(code("")).toBeNull();
  });
  it("the same code written two ways is one comparison key in an address", () => {
    const a = normalizeAddress({ line1: "12 Lotus Road", zip: "SW1A 1AA" }, { country: "GB" })!;
    const b = normalizeAddress({ line1: "12 lotus rd", zip: "sw1a1aa" }, { country: "GB" })!;
    expect([a.zip5, a.streetKey]).toEqual([b.zip5, b.streetKey]);
    expect(normalizeAddress({ line1: "9 Elm St", zip: "400 001", country: "India" })?.zip5).toBe("400001");
  });
});

describe("street addresses of many countries", () => {
  const key = (line1: string, country?: string, zip?: string) => normalizeAddress({ line1, zip }, { country })?.streetKey;
  it("reads the house number before or after the street, and the street type in the language of the street", () => {
    expect(key("Hauptstrasse 12", "DE")).toBe("12|haupt");
    expect(key("Hauptstraße 12", "DE")).toBe(key("Hauptstrasse 12", "DE"));
    expect(key("Hauptstr. 12", "DE")).toBe(key("Hauptstrasse 12", "DE"));
    expect(key("Haupt Strasse 12")).toBe(key("Hauptstrasse 12", "DE"));
    expect(key("12 rue de la Paix", "FR")).toBe("12|paix");
    expect(key("Rue de la Paix 12", "FR")).toBe("12|paix");
    expect(key("Calle Mayor 12, 3 B", "ES")).toBe("12|mayor");
    expect(normalizeAddress({ line1: "Calle Mayor 12, 3 B" }, { country: "ES" })?.unit).toBe("3b");
    expect(key("Via Roma 12/A", "IT")).toBe("12/a|roma");
    expect(key("Kerkstraat 5", "NL")).toBe("5|kerk");
    expect(key("Rua das Flores 123 apto 45", "BR")).toBe("123|flores");
    expect(normalizeAddress({ line1: "Rua das Flores 123 apto 45" }, { country: "BR" })?.unit).toBe("45");
    expect(normalizeAddress({ line1: "Flat 4, 12 Lotus Road" }, { country: "GB" })).toMatchObject({ streetKey: "12|lotus", unit: "4", suffix: "rd" });
    expect(key("No. 12 Lotus Lane")).toBe("12|lotus");
  });
  it("the English forms still read as before", () => {
    for (const s of ["12 Lotus Lane", "12 lotus ln", "12 N. Lotus Lane", "12 Lotus Ln #4"]) expect(key(s), s).toBe("12|lotus");
    expect(key("PO Box 77")).toBe("77|po box");
    expect(normalizeAddress({ line1: "Postfach 77" })?.poBox).toBe(true);
    // no house number and no postal code: nothing to compare
    expect(normalizeAddress({ line1: "Highway 6 North" })).toBeNull();
    expect(normalizeAddress({ line1: "Highway 6 North", zip: "77478" })?.streetKey).toBe("");
  });
  it("the older matcher's key reads them too", () => {
    expect(addressKey("Hauptstrasse 12", null, "10115", "DE")?.key).toBe("10115|12|haupt st");
    expect(addressKey("Hauptstr. 12", null, "10115", "DE")?.key).toBe("10115|12|haupt st");
    expect(addressKey("12 Lotus Lane, Apt 4", "", "SW1A 1AA", "GB")).toEqual({ key: "sw1a1aa|12|lotus ln", unit: "4", zip: "sw1a1aa" });
  });
});

describe("dates with month names in many languages", () => {
  const iso = (text: string) => parseDate(text, { order: "unknown", today: TODAY, context: "birth" }).alternatives;
  it("reads English, Spanish, Portuguese, French, German, Italian, Dutch, Polish, Turkish, Russian, Hindi and Arabic month names", () => {
    for (const [text, want] of [
      ["3 April 1987", "1987-04-03"],
      ["April 3, 1987", "1987-04-03"],
      ["3 de abril de 1987", "1987-04-03"],
      ["3 de março de 1987", "1987-03-03"],
      ["3 avril 1987", "1987-04-03"],
      ["3. März 1987", "1987-03-03"],
      ["3 marzo 1987", "1987-03-03"],
      ["3 maart 1987", "1987-03-03"],
      ["3 kwietnia 1987", "1987-04-03"],
      ["3 Nisan 1987", "1987-04-03"],
      ["3 апреля 1987", "1987-04-03"],
      ["3 अप्रैल 1987", "1987-04-03"],
      ["3 أبريل 1987", "1987-04-03"],
      ["3 déc 1987", "1987-12-03"],
      ["3 Dez 1987", "1987-12-03"],
    ] as const) {
      expect(iso(text), text).toEqual([want]);
    }
  });
  it("reads Chinese, Japanese and Korean dates and digits of other scripts", () => {
    expect(iso("1987年4月3日")).toEqual(["1987-04-03"]);
    expect(iso("1987년 4월 3일")).toEqual(["1987-04-03"]);
    expect(iso("1987. 4. 3.")).toEqual(["1987-04-03"]);
    expect(iso("٣ أبريل ١٩٨٧")).toEqual(["1987-04-03"]);
  });
  it("still flags a day and month that could be swapped", () => {
    expect(iso("03/04/1987")).toEqual(["1987-03-04", "1987-04-03"]);
    expect(iso("13/04/1987")).toEqual(["1987-04-13"]);
  });
  it("month words are folded and lower-cased", () => {
    expect(MONTH_NUMBERS.get(foldText("Février").toLowerCase())).toBe(2);
    expect(MONTH_NUMBERS.get("mei")).toBe(5);
  });
});

describe("a community outside the United States", () => {
  const uk = makeConfig(TODAY, { country: "GB" });
  const base = { sourceKind: "spreadsheet" as const, kind: "person" as const };
  const rows = (): RawRecord[] => [
    { ...base, id: "a#1", source: "a.xlsx", row: 1, name: "Priya Sharma", mobile: "07700 900123", email: "priya.sharma@example.com", address1: "12 Lotus Road", zip: "LS1 4AB", dob: "14/03/1985" },
    { ...base, id: "b#1", source: "b.csv", row: 1, name: "Sharma, Priya", mobile: "+44 7700 900123", email: "Priya.Sharma@Example.com", address1: "12 lotus rd", zip: "ls14ab", dob: "1985-03-14" },
  ];
  it("normalises UK numbers, postcodes and dates", () => {
    const r = normalizeRecord(rows()[0]!, 0, uk);
    expect(r.phones).toEqual([{ value: "+447700900123", mobile: true }]);
    expect(r.address).toMatchObject({ zip5: "ls14ab", streetKey: "12|lotus" });
    expect(r.dob?.alternatives).toContain("1985-03-14");
  });
  it("links the same person written two ways automatically, on two identifiers that are not names", () => {
    const res = resolveRecords({ records: rows(), config: uk });
    const pair = res.pairs.find((p) => p.a === "a#1" && p.b === "b#1");
    expect(pair?.tier).toBe("A");
    expect(pair?.evidence.filter((e) => e.independent).map((e) => e.kind).sort()).toEqual(expect.arrayContaining(["address", "email", "phone"]));
  });
  it("without a country, a bare local number is flagged, and only the e-mail and address are left to go on", () => {
    const r = normalizeRecord(rows()[0]!, 0, makeConfig(TODAY));
    expect(r.phones).toEqual([]);
    expect(r.problems).toContain("phone");
  });
  it("the older matcher reads the same numbers with the community's country", () => {
    expect(phoneKey("07700 900123", "GB")).toBe("447700900123");
    expect(phoneKey("+44 7700 900123", "GB")).toBe("447700900123");
    expect(phoneKey("+44 7700 900123")).toBe("447700900123");
    expect(phoneKey("(281) 555-0142")).toBe("2815550142");
    expect(phoneKey("2815550142")).toBe("2815550142"); // the last 10 digits, as before, when no country is given
    expect(phoneKey("07700 900123")).toBeNull();
    const r = matchPayers(
      [
        { rowNo: 1, name: "Priya Sharma", phone: "07700 900123" },
        { rowNo: 2, name: "Sharma, Priya", phone: "+44 7700 900123" },
      ],
      { country: "GB" },
    );
    expect(r.groups).toHaveLength(1);
    expect(r.questions).toHaveLength(0);
  });
  it("the checks on an uploaded list read phone numbers in the community's country", () => {
    const choices = PERSON_FIELDS.map((f) => (f.key === "firstName" ? f.key : f.key === "lastName" ? f.key : f.key === "phone" ? f.key : "skip")) as never;
    const headers = PERSON_FIELDS.map((f) => f.label);
    const row = PERSON_FIELDS.map((f) => (f.key === "firstName" ? "Priya" : f.key === "lastName" ? "Sharma" : f.key === "phone" ? "07700 900123" : ""));
    const withCountry = validatePeople(headers, [row], choices, { country: "GB" });
    expect(withCountry.rows[0]?.phone).toBe("+447700900123");
    const without = validatePeople(headers, [row], choices, {});
    expect(without.rows[0]?.phone).toBeNull();
    expect(without.problems.some((p) => /country code/.test(p.message))).toBe(true);
    const d = validateDonations(
      ["Name", "Amount", "Date", "Phone"],
      [["Priya Sharma", "25.00", "2026-01-02", "98250 12345"]],
      ["name", "amount", "date", "phone"] as never,
      { country: "IN" },
    );
    expect(d.rows[0]?.phone).toBe("+919825012345");
  });
});

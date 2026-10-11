import { describe, expect, it } from "vitest";

import { findInternationalAddresses, findPhones } from "../../src/lib/onboarding/intl/contact-text";
import { findFirst, parseHtml } from "../src/web/site/dom";
import { contactDetails } from "../src/web/site/facts";

const body = (html: string) => findFirst(parseHtml(`<html><body>${html}</body></html>`).root, "body")!;

describe("phone numbers from any country in a page's text", () => {
  it("reads numbers with a country code, checked against the calling-code table", () => {
    expect(findPhones("Call +44 20 7946 0958 or +91 98250 12345 today")).toEqual(["+44 20 7946 0958", "+91 98250 12345"]);
    expect(findPhones("Telefon +49 30 12345678")).toEqual(["+49 30 12345678"]);
    expect(findPhones("Reach us on 0091 98250 12345.")).toEqual(["0091 98250 12345"]);
  });
  it("reads a national number that follows a label such as Tel, Mobile or WhatsApp", () => {
    expect(findPhones("Tel: 020 7946 0958")).toEqual(["020 7946 0958"]);
    expect(findPhones("Mobile 98250 12345")).toEqual(["98250 12345"]);
    expect(findPhones("Teléfono: 612 345 678")).toEqual(["612 345 678"]);
  });
  it("keeps the North American formats it always read", () => {
    expect(findPhones("Call 281.555.0199 or 1-800-555-0100 ext 4.")).toEqual(["281.555.0199", "1-800-555-0100"]);
  });
  it("does not take dates, years, prices or order numbers for phone numbers", () => {
    expect(findPhones("Founded 1994. Open 2026-10-11 from 09:00 to 17:30. Order 20261011 costs 1,250.00.")).toEqual([]);
    expect(findPhones("+999 123 4567")).toEqual([]);
  });
});

describe("addresses from any country in a page's text", () => {
  const found = (text: string) => findInternationalAddresses(text);
  it("United Kingdom", () => {
    expect(found("Find us at 12 Lotus Road, Leeds LS1 4AB on Sundays.")).toEqual(["12 Lotus Road, Leeds LS1 4AB"]);
  });
  it("Canada", () => {
    expect(found("Visit 100 King St W, Toronto, ON M5X 1A1 anytime")).toEqual(["100 King St W, Toronto, ON M5X 1A1"]);
  });
  it("Australia", () => {
    expect(found("12 George St, Sydney NSW 2000")).toEqual(["12 George St, Sydney NSW 2000"]);
  });
  it("Germany and the Netherlands", () => {
    expect(found("Adresse: Hauptstraße 12, 10115 Berlin")).toEqual(["Hauptstraße 12, 10115 Berlin"]);
    expect(found("Kerkstraat 5, 1012 AB Amsterdam")).toEqual(["Kerkstraat 5, 1012 AB Amsterdam"]);
  });
  it("France, Spain, Italy and Portugal", () => {
    expect(found("12 rue de la Paix, 75002 Paris")).toEqual(["12 rue de la Paix, 75002 Paris"]);
    expect(found("Calle Mayor 12, 28013 Madrid")).toEqual(["Calle Mayor 12, 28013 Madrid"]);
    expect(found("Via Roma 12, 00184 Roma")).toEqual(["Via Roma 12, 00184 Roma"]);
    expect(found("Rua das Flores 123, 1200-195 Lisboa")).toEqual(["Rua das Flores 123, 1200-195 Lisboa"]);
  });
  it("India", () => {
    expect(found("Plot 12, MG Road, Andheri East, Mumbai, Maharashtra 400069")).toEqual(["Plot 12, MG Road, Andheri East, Mumbai, Maharashtra 400069"]);
  });
  it("finds nothing in plain prose", () => {
    expect(found("We meet every Sunday at ten. Bring a friend. The hall holds 120 people and parking is free.")).toEqual([]);
  });
  it("stays fast on a hostile page of 200,000 characters", () => {
    const hostile = "12 ".repeat(40_000) + " Road ".repeat(10_000) + "+44 ".repeat(10_000) + "A".repeat(20_000);
    const t0 = Date.now();
    findInternationalAddresses(hostile);
    findPhones(hostile);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe("contactDetails reads every country", () => {
  it("collects international phones and addresses next to the US ones", () => {
    const c = contactDetails(
      body(`<p>Tel: 020 7946 0958. WhatsApp +44 7700 900123. 12 Lotus Road, Leeds LS1 4AB. Also 410 Water Street, Lakeshore, MI 49401.</p>`),
      [],
      [],
      [],
    );
    expect(c.phones).toEqual(["+44 7700 900123", "020 7946 0958"]);
    expect(c.addresses).toEqual(["410 Water Street, Lakeshore, MI 49401", "12 Lotus Road, Leeds LS1 4AB"]);
  });
});

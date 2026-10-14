import { describe, expect, it } from "vitest";

import { householdNameWithoutChildren } from "@/lib/commands/child-filter";
import { factValues, missingWords, sampleValues, sendValues, type EmailFacts } from "@/lib/merge/build";
import { placeholderNames } from "@/lib/merge/catalogue";
import { emailDay, emailEventDay, emailList, emailMoney, emailPlace, emailTime } from "@/lib/merge/format";
import { householdNameForEmail } from "@/lib/merge/household-name";

const us = emailPlace({ currency: "USD", time_zone: "America/Chicago", country: "US", languages: ["en"] });
const india = emailPlace({ currency: "INR", time_zone: "Asia/Kolkata", country: "IN", languages: ["en"] });
const spain = emailPlace({ currency: "EUR", time_zone: "Europe/Madrid", country: "ES", languages: ["es"] });

describe("money and dates in the community's own way", () => {
  it("writes money in the community's currency and locale, to the cent", () => {
    expect(emailMoney(12500050, us)).toBe("$125,000.50");
    expect(emailMoney(12500050, india)).toBe("₹1,25,000.50");
    expect(emailMoney(12500050, spain)?.replace(/\s/g, " ")).toBe("125.000,50 €");
    expect(emailMoney(null, us)).toBeNull();
  });

  it("writes calendar dates without shifting the day, and event times in the community's time zone", () => {
    expect(emailDay("2026-10-13", us)).toBe("October 13, 2026");
    expect(emailDay("2026-10-13", spain)).toBe("13 de octubre de 2026");
    expect(emailEventDay("2026-11-07T23:30:00Z", us)).toBe("Saturday, November 7, 2026");
    expect(emailTime("2026-11-07T23:30:00Z", us)).toBe("5:30 PM");
    expect(emailTime("2026-11-07T23:30:00Z", spain)).toBe("0:30");
    expect(emailDay(null, us)).toBeNull();
  });

  it("falls back safely: an unknown currency code or time zone never breaks an email", () => {
    const odd = emailPlace({ currency: "dollars", time_zone: "Mars/Olympus", country: null, languages: null });
    expect(odd).toEqual({ currency: "USD", locale: "en-US", timeZone: "UTC" });
    expect(emailList(["General Fund", "Building Fund", "General Fund"], us)).toBe("General Fund and Building Fund");
  });
});

describe("a household's name in an email", () => {
  const cases: [string, string[]][] = [
    ["Shah, Priya, Rahul & Zoya", ["Zoya"]],
    ["Priya & Zoya Shah", ["Zoya"]],
    ["The Shah family (Zoya, Kiran)", ["Zoya", "Kiran"]],
    ["Rivera household", ["Ana"]],
  ];
  it.each(cases)("%s loses its children's first names exactly as the screens do", (name, minors) => {
    expect(householdNameForEmail(name, minors)).toBe(householdNameWithoutChildren(name, minors));
    for (const m of minors) expect(householdNameForEmail(name, minors) ?? "").not.toContain(m);
  });
});

describe("the values of one email", () => {
  const facts: EmailFacts = {
    center: { name: "Riverside Community Center", short_name: "Riverside", currency: "USD", time_zone: "America/Chicago", country: "US", languages: ["en"] },
    household: { id: "h1", name: "Rivera, Alex & Zoya", number: "H-1042", minor_first_names: ["Zoya"] },
    payment: { amount_cents: 25000, received_on: "2026-10-13", method: "check", receipt_number: "R-100231", receipt_name: null, applied_to: ["Zoya's Fund", "General Fund"] },
    wording: { signed_by: "The Treasurer", personal_note: null },
    recipients: [{ person_id: "p1", address: "alex@example.org", first_name: "Alex", name: "Alex Rivera", language: "en" }],
  };

  it("fills every placeholder of the receipt, with the email's own words where the record has nothing", () => {
    const values = factValues("payment_receipt", facts, null);
    expect(values.payment_amount).toBe("$250.00");
    expect(values.payment_date).toBe("October 13, 2026");
    expect(values.payment_method).toBe("Check");
    expect(values.recipient_first_name).toBe("Alex");
    expect(values.receipt_note).toBeNull();
    const sent = sendValues("payment_receipt", values);
    expect(Object.keys(sent)).toEqual(placeholderNames("payment_receipt"));
    expect(sent.receipt_note).toBe(missingWords("payment_receipt").receipt_note);
    expect(sent.payment_receipt_name).toBe("");
  });

  it("never says a child's name: not in the household's name, not in any other value", () => {
    const sent = sendValues("payment_receipt", factValues("payment_receipt", facts, null));
    expect(JSON.stringify(sent)).not.toContain("Zoya");
    expect(sent.household_name).toBe("Rivera, Alex");
  });

  it("writes a pledge's balance and a registration's count", () => {
    const pledge = factValues("pledge_recorded", { ...facts, pledge: { amount_cents: 100000, paid_cents: 25000, number: "P-1", pledged_at: "2026-10-13", due_on: null, for: "Building Fund" } }, null);
    expect(pledge.pledge_balance).toBe("$750.00");
    expect(pledge.pledge_due_date).toBeNull();
    expect(sendValues("pledge_recorded", pledge).pledge_due_date).toBe("no due date set");
    const reg = factValues("registration_confirmed", { ...facts, event: { name: "Autumn Gathering", number: "EV-9", starts_at: "2026-11-07T23:30:00Z", venue: null }, registration: { count: 3 } }, null);
    expect(reg.registration_count).toBe("3");
    expect(sendValues("registration_confirmed", reg).event_place).toBe("place to be announced");
  });

  it("has a made-up sample for every placeholder (a community with no record yet)", () => {
    for (const key of ["payment_receipt", "pledge_recorded", "registration_confirmed"] as const) {
      expect(Object.keys(sampleValues(key))).toEqual(placeholderNames(key));
    }
  });
});

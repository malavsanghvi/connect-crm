import { describe, expect, it } from "vitest";

import { changedFields, listWords, mergeAsk, missingQuestion, parsePaymentAsk, readDate, EMPTY_ASK } from "@/lib/giving-workspace/ask";

// "Record a payment by asking" (the Giving page): a sentence read into the Record payment form's fields, with no model. It never
// picks a household; `who` is only what to search for. 2026-10-07 is a Wednesday.
const TODAY = "2026-10-07";

describe("reading a payment sentence", () => {
  it("reads the board's sentence: amount, method, check number, the latest Sunday, who and what for", () => {
    const a = parsePaymentAsk("Record a $250 check from Shah for the building pledge. Check number 1043, received Sunday.", TODAY);
    expect(a).toEqual({ amount: "250", method: "check", reference: "1043", receivedOn: "2026-10-04", who: "Shah", about: "building pledge" });
  });

  it("reads other currencies and names from many cultures", () => {
    expect(parsePaymentAsk("Record ₹5,001 cash from Priya Raman", TODAY)).toMatchObject({ amount: "5001", method: "cash", who: "Priya Raman" });
    expect(parsePaymentAsk("£40.50 from Siobhán O'Connor by bank transfer yesterday", TODAY)).toMatchObject({ amount: "40.50", method: "ach", who: "Siobhán O'Connor", receivedOn: "2026-10-06" });
    expect(parsePaymentAsk("Record 120 euros from the Nguyen family", TODAY)).toMatchObject({ amount: "120", who: "Nguyen" });
    expect(parsePaymentAsk("Zelle of 75 from Oluwaseun Adeyemi-Bello on 2026-10-01", TODAY)).toMatchObject({ amount: "75", method: "zelle", who: "Oluwaseun Adeyemi-Bello", receivedOn: "2026-10-01" });
    expect(parsePaymentAsk("Record 300 from José Núñez", TODAY).who).toBe("José Núñez");
  });

  it("takes a household or member number as what to search for, and never reads it as the amount", () => {
    expect(parsePaymentAsk("Record 250 from household 1042", TODAY)).toMatchObject({ amount: "250", who: "1042" });
    expect(parsePaymentAsk("Record a check from member number 0417 for 101", TODAY)).toMatchObject({ amount: "101", who: "0417", method: "check" });
    expect(parsePaymentAsk("Record 50 cash from household RNA-H-2041", TODAY)).toMatchObject({ amount: "50", who: "RNA-H-2041" });
  });

  it("never reads a check number or a date as the amount", () => {
    expect(parsePaymentAsk("check 1043 from Okafor, 200", TODAY)).toMatchObject({ reference: "1043", amount: "200", method: "check" });
    expect(parsePaymentAsk("Record 80 from Lee received 4 October", TODAY)).toMatchObject({ amount: "80", receivedOn: "2026-10-04" });
    expect(parsePaymentAsk("Record a check #2210 from Garcia", TODAY)).toMatchObject({ reference: "2210", amount: null });
  });

  it("leaves out what it cannot find, and asks for it", () => {
    const a = parsePaymentAsk("Record a check", TODAY);
    expect(a).toMatchObject({ amount: null, who: null, method: "check" });
    expect(missingQuestion(a)).toMatch(/Who gave it, and how much/);
    expect(missingQuestion({ ...a, who: "Shah" })).toBe("How much was it?");
    expect(missingQuestion({ ...a, amount: "10" })).toMatch(/Which household/);
    expect(missingQuestion({ ...a, amount: "10", who: "Shah" })).toBeNull();
    expect(parsePaymentAsk("", TODAY)).toEqual(EMPTY_ASK);
    expect(parsePaymentAsk("Record 0 from Shah", TODAY).amount).toBeNull();
  });

  it("does not read 'for household 1042' as what the money is for", () => {
    expect(parsePaymentAsk("Record 25 for household 1042", TODAY)).toMatchObject({ who: "1042", about: null, amount: "25" });
  });
});

describe("dates are never later than today", () => {
  it("reads today, yesterday, weekdays and named days", () => {
    expect(readDate("today", TODAY)?.date).toBe(TODAY);
    expect(readDate("received yesterday", TODAY)?.date).toBe("2026-10-06");
    expect(readDate("on Wednesday", TODAY)?.date).toBe(TODAY);
    expect(readDate("last Wednesday", TODAY)?.date).toBe("2026-09-30");
    expect(readDate("Thursday", TODAY)?.date).toBe("2026-10-01");
    expect(readDate("October 4", TODAY)?.date).toBe("2026-10-04");
    // A day later in the year without a year was last year's.
    expect(readDate("12 December", TODAY)?.date).toBe("2025-12-12");
    expect(readDate("31 February", TODAY)).toBeNull();
    expect(readDate("nothing here", TODAY)).toBeNull();
  });
});

describe("changing what was asked", () => {
  it("changes only what the new sentence says", () => {
    const base = parsePaymentAsk("Record a $250 check from Shah", TODAY);
    const change = parsePaymentAsk("make it $300", TODAY);
    expect(mergeAsk(base, change)).toMatchObject({ amount: "300", method: "check", who: "Shah" });
    expect(changedFields(change)).toEqual(["the amount"]);
    const zelle = parsePaymentAsk("it was a Zelle, received yesterday", TODAY);
    expect(changedFields(zelle)).toEqual(["how it was paid", "the date"]);
    expect(changedFields(parsePaymentAsk("record two more", TODAY))).toEqual([]);
  });

  it("lists words in plain English", () => {
    expect(listWords([])).toBe("");
    expect(listWords(["the amount"])).toBe("the amount");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
  });
});

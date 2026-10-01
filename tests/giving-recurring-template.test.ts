import { describe, expect, it } from "vitest";

import { RECOMMENDED_RECURRING_TEMPLATE, fitsRecurringConfirmation, recurringTemplateOptions, templateFields } from "@/lib/giving";

// The platform's own templates (0220), as the form would read them.
const PAYPAL = { key: "paypal_email_code", subject: "Confirm the PayPal email for {{center_name}}", body: "The confirmation code is {{code}}. It expires in {{minutes}} minutes." };
const RECEIPT = { key: "receipt", subject: "Receipt {{receipt_number}} from {{center_name}}", body: "Dear {{name}}, thank you. {{center_name}} received {{amount}} for {{fund}} on {{date}}." };
const SIGN_IN = { key: "sign_in_code", subject: "Your {{center_short_name}} sign-in code", body: "Your sign-in code is {{code}}." };
const TEST = { key: "test_message", subject: "Test email from {{center_name}}", body: "This is a test email from {{center_name}}." };
const RECURRING = {
  key: RECOMMENDED_RECURRING_TEMPLATE,
  subject: "Your {{frequency}} gift to {{opportunity_name}}",
  body: "Thank you for giving to {{opportunity_name}} at {{center_name}}. Your {{frequency}} gift of ${{amount}} has been added to your pledges. The next one is on {{next_date}}.",
};

describe("templateFields", () => {
  it("lists the names inside {{ }} once each, ignoring spaces inside the braces", () => {
    expect(templateFields("Hi {{name}}, {{ amount }} and {{name}} again, {{center_name}}")).toEqual(["name", "amount", "center_name"]);
    expect(templateFields("no fields {here} or {{ }}")).toEqual([]);
    expect(templateFields(null)).toEqual([]);
    expect(templateFields(undefined)).toEqual([]);
  });
});

describe("fitsRecurringConfirmation", () => {
  it("accepts a template that uses only the fields the recurring cycle fills in", () => {
    expect(fitsRecurringConfirmation(RECURRING)).toBe(true);
    expect(fitsRecurringConfirmation(TEST)).toBe(true);
    expect(fitsRecurringConfirmation({ subject: null, body: "Thank you." })).toBe(true);
  });
  it("refuses one that would go out with raw placeholders", () => {
    expect(fitsRecurringConfirmation(PAYPAL)).toBe(false);
    expect(fitsRecurringConfirmation(RECEIPT)).toBe(false);
    expect(fitsRecurringConfirmation(SIGN_IN)).toBe(false);
    expect(fitsRecurringConfirmation({ subject: "Gift", body: "Dear {{name}}" })).toBe(false);
  });
  it("checks the subject as well as the body", () => {
    expect(fitsRecurringConfirmation({ subject: "{{code}}", body: "Thank you {{amount}}" })).toBe(false);
  });
});

describe("recurringTemplateOptions", () => {
  it("offers only the templates that fit, the recommended one first, then by key", () => {
    const options = recurringTemplateOptions([PAYPAL, TEST, RECEIPT, RECURRING, SIGN_IN]);
    expect(options.map((o) => o.key)).toEqual([RECOMMENDED_RECURRING_TEMPLATE, "test_message"]);
  });
  it("never offers the PayPal code template that the form used to show as chosen", () => {
    expect(recurringTemplateOptions([PAYPAL, SIGN_IN, RECEIPT])).toEqual([]);
  });
  it("labels each with its subject and key, and falls back to the key", () => {
    const options = recurringTemplateOptions([RECURRING, { key: "plain", subject: null, body: "Thanks" }, { key: "same", subject: "same", body: "x" }]);
    expect(options.find((o) => o.key === RECOMMENDED_RECURRING_TEMPLATE)?.label).toBe("Your {{frequency}} gift to {{opportunity_name}} (recurring_gift_confirmation)");
    expect(options.find((o) => o.key === "plain")?.label).toBe("plain");
    expect(options.find((o) => o.key === "same")?.label).toBe("same");
  });
  it("collapses a center template and a platform default that share a key (the first row wins)", () => {
    const mine = { ...RECURRING, subject: "Our recurring thank-you" };
    const options = recurringTemplateOptions([mine, RECURRING]);
    expect(options).toHaveLength(1);
    expect(options[0].label).toContain("Our recurring thank-you");
  });
  it("keeps an opportunity's current choice listed, marked when it no longer fits or no longer exists", () => {
    expect(recurringTemplateOptions([PAYPAL, RECURRING], "paypal_email_code").map((o) => o.key)).toEqual([RECOMMENDED_RECURRING_TEMPLATE, "paypal_email_code"]);
    expect(recurringTemplateOptions([PAYPAL, RECURRING], "paypal_email_code")[1].label).toContain("uses fields this email does not fill in");
    expect(recurringTemplateOptions([RECURRING], "gone")[0]).toEqual({ key: "gone", label: "gone \u2014 no longer exists" });
  });
});

import { describe, expect, it } from "vitest";

import { renderEmail } from "@/lib/messaging/email";
import { brokenPlaceholders, mergeSegments, oneLine, placeholdersIn, renderMerge, unknownPlaceholders } from "@/lib/merge/render";

describe("the mail-merge renderer", () => {
  it("reads {{name}} as app.render_message_text does: spaces inside the braces, letters, digits and underscores", () => {
    expect(placeholdersIn("Dear {{ recipient_first_name }}, {{payment_amount}} and {{payment_amount}} again")).toEqual([
      "recipient_first_name",
      "payment_amount",
    ]);
    expect(placeholdersIn("{{household.name}} {{ two words }}")).toEqual([]);
  });

  it("names the placeholders an email does not have, and text that only looks like one", () => {
    expect(unknownPlaceholders("{{pledge_amount}} {{nickname}}", ["pledge_amount"])).toEqual(["nickname"]);
    expect(brokenPlaceholders("Hi {pledge_amount} and {{ pledge amount }} and {{pledge_amount}")).toEqual([
      "{pledge_amount}",
      "{{ pledge amount }}",
      "{{pledge_amount}",
    ]);
    expect(brokenPlaceholders("Hi {{pledge_amount}}")).toEqual([]);
  });

  it("fills values, writes the email's own words for a missing one, and leaves an unknown name as typed", () => {
    const values = { recipient_first_name: "Alex", pledge_due_date: null };
    const missing = { pledge_due_date: "no due date set" };
    expect(renderMerge("Dear {{recipient_first_name}}, due {{pledge_due_date}}. {{nope}}", values, missing)).toBe(
      "Dear Alex, due no due date set. {{nope}}",
    );
    const seg = mergeSegments("{{recipient_first_name}} {{pledge_due_date}} {{nope}}", values, missing);
    expect(seg.map((s) => s.kind)).toEqual(["value", "text", "missing", "text", "unknown"]);
  });

  it("never lets a value inject HTML: the email escapes every character of the filled text", () => {
    const body = renderMerge("Thank you {{recipient_first_name}}", { recipient_first_name: '<img src=x onerror="alert(1)">' });
    const email = renderEmail({ subject: "Receipt", body, brand: { name: "Riverside" }, sandbox: false });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("keeps a value to one line (subjects, headers)", () => {
    expect(oneLine("Line one\r\nBcc: someone@example.org\u0007  end")).toBe("Line one Bcc: someone@example.org end");
  });
});

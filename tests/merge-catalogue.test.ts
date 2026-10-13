import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EMAIL_TRIGGERS, PLACEHOLDERS, TRIGGER_INFO, placeholderGroups, placeholderNames } from "@/lib/merge/catalogue";
import { PLACEHOLDER_RE } from "@/lib/merge/render";

// The database refuses wording that uses a name the email does not have (app._email_placeholders, 0770); the picker offers the
// names in src/lib/merge/catalogue.ts. The two lists must be the same, or the picker would offer a name the database refuses.
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0770_automatic_emails.sql"), "utf8");

function sqlList(key: string): string[] {
  const fn = sql.slice(sql.indexOf("create or replace function app._email_placeholders"));
  const m = new RegExp(`when '${key}' then array\\[([^\\]]*)\\]`).exec(fn);
  if (!m) throw new Error(`no list for ${key} in 0770`);
  return [...(m[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1] ?? "");
}

describe("the placeholders of each automatic email", () => {
  it.each(EMAIL_TRIGGERS)("%s: the portal and the database list the same names, in the same order", (key) => {
    expect(placeholderNames(key)).toEqual(sqlList(key));
  });

  it("every name is one the renderer reads, used once, with a label and a sample", () => {
    for (const key of EMAIL_TRIGGERS) {
      const names = placeholderNames(key);
      expect(new Set(names).size).toBe(names.length);
      for (const p of PLACEHOLDERS[key]) {
        expect(`{{${p.name}}}`.match(PLACEHOLDER_RE)?.[0]).toBe(`{{${p.name}}}`);
        expect(p.label.length).toBeGreaterThan(2);
        expect(p.sample.length).toBeGreaterThan(0);
      }
    }
  });

  it("no placeholder names a child, an attendee or a date of birth", () => {
    for (const key of EMAIL_TRIGGERS) {
      for (const n of placeholderNames(key)) expect(n).not.toMatch(/child|kid|attendee|birth|dob|dedication/);
    }
  });

  it("the standard wording (0770) uses only each email's own names", () => {
    const seed = sql.slice(sql.indexOf("insert into app.message_templates"));
    const rows: Record<string, string> = {
      payment_receipt: "payment_receipt",
      pledge_recorded: "pledge_recorded",
      registration_confirmed: "registration_confirmed",
    };
    for (const [template, key] of Object.entries(rows)) {
      const row = new RegExp(`\\('${template}', \\d+, '([^']*)',\\s*E'([^']*)'\\)`).exec(seed);
      expect(row, template).not.toBeNull();
      const used = [...`${row?.[1]} ${row?.[2]}`.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
      expect(used.length).toBeGreaterThan(3);
      for (const u of used) expect(placeholderNames(key as (typeof EMAIL_TRIGGERS)[number])).toContain(u);
    }
  });

  it("groups keep the catalogue's order and say what each email is for", () => {
    const groups = placeholderGroups("payment_receipt").map((g) => g.group);
    expect(groups).toEqual(["Community", "Recipient", "Household", "Payment"]);
    expect(TRIGGER_INFO.payment_receipt.manage).toBe("giving.manage");
    expect(TRIGGER_INFO.registration_confirmed.module).toBe("events");
  });
});

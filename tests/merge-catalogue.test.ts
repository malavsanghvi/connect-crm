import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EMAIL_TRIGGERS, PLACEHOLDERS, SCHEDULE_AUDIENCES, TRIGGER_INFO, multilineNames, placeholderGroups, placeholderNames, scheduleKey, type MergeKey } from "@/lib/merge/catalogue";
import { PLACEHOLDER_RE } from "@/lib/merge/render";

// The database refuses wording that uses a name the email does not have (app._email_placeholders: 0770, redefined in 0771 with
// the scheduled emails); the picker offers the names in src/lib/merge/catalogue.ts. The two lists must be the same, or the picker
// would offer a name the database refuses. The latest migration that defines the function is the one that counts.
const dir = join(process.cwd(), "supabase", "migrations");
const latest = readdirSync(dir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8"))
  .filter((text) => text.includes("create or replace function app._email_placeholders"))
  .pop() ?? "";
const sql = readFileSync(join(dir, "0770_automatic_emails.sql"), "utf8");
const ALL_KEYS: MergeKey[] = [...EMAIL_TRIGGERS, ...SCHEDULE_AUDIENCES.map(scheduleKey)];

function sqlList(key: string): string[] {
  const fn = latest.slice(latest.indexOf("create or replace function app._email_placeholders"));
  const m = new RegExp(`when '${key}' then array\\[([^\\]]*)\\]`).exec(fn);
  if (!m) throw new Error(`no list for ${key}`);
  return [...(m[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1] ?? "");
}

describe("the placeholders of each automatic email", () => {
  it.each(ALL_KEYS)("%s: the portal and the database list the same names, in the same order", (key) => {
    expect(placeholderNames(key)).toEqual(sqlList(key));
  });

  it("every name is one the renderer reads, used once, with a label and a sample", () => {
    for (const key of ALL_KEYS) {
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
    for (const key of ALL_KEYS) {
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

  it("the lists (one line each) are the ones the database keeps out of a subject line", () => {
    const lists = [...new Set(ALL_KEYS.flatMap((k) => multilineNames(k)))].sort();
    const m = /_email_list_placeholders\(\) returns text\[\][\s\S]*?select array\[([^\]]*)\]/.exec(latest);
    expect(lists).toEqual([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort());
  });
});

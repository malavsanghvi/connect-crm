import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import GivingGlancePreview from "@/app/dev/giving-glance/page";
import { CHILD } from "@/app/dev/giving-glance/fixtures";
import { validateRulesJson } from "@/lib/center-rules";
import { givingShowBy } from "@/lib/giving-glance/levels";
import { parseSection, readRuleSettings, RULE_DEFAULTS } from "@/lib/settings-rules";

// The dev-only preview of "Giving at a glance" (src/app/dev/giving-glance): invented giving for a neutral church, real renders
// without a database, never in production. It is also where the panel's wording and the "no children" rule are checked.

afterEach(() => {
  vi.unstubAllEnvs();
});

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await GivingGlancePreview({ searchParams: Promise.resolve(sp) }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the dev preview of giving at a glance", () => {
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(GivingGlancePreview({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("shows the eight indicators for this year at household level, in dollars, with the year filter", async () => {
    const t = text(await page());
    expect(t).toContain("Giving at a glance");
    expect(t).toContain("The whole household · This year (2026)");
    for (const label of ["Pledged", "Paid", "Still open", "Overdue", "Pledges fulfilled", "Gifts", "Last gift", "Recurring gift"]) expect(t).toContain(label);
    // The year chips: this year, last year, the earlier year with data, all time.
    for (const chip of ["This year (2026)", "Last year (2025)", "2024", "All time"]) expect(t).toContain(chip);
    // 2026 pledged: 3600 + 1200 + 500 + 1500 + 100 (the child's pledge is part of the household's) - the cancelled one.
    expect(t).toContain("$6,900.00");
    // Still open as of today: 400 + 600 + 900 + 380.
    expect(t).toContain("$2,280.00");
    expect(t).toContain("Monthly $300.00");
    expect(t).not.toMatch(/\bbid/i);
  });

  it("compares with the same time last year while the year is going on, and with the year before for a past year", async () => {
    expect(text(await page())).toMatch(/on the same time last year/);
    const last = text(await page({ year: "2025" }));
    expect(last).toContain("Last year (2025)");
    expect(last).toMatch(/on 2024/);
    expect(text(await page({ year: "all" }))).not.toMatch(/Up \d+% on|Down \d+% on/);
  });

  it("follows a year that starts in July, naming it by the year it starts in", async () => {
    const t = text(await page({ fy: "7" }));
    expect(t).toContain("This year (2026-27)");
    expect(t).toContain("Last year (2025-26)");
  });

  it("splits giving by person, with 'Not tied to a person' so the parts add up, and never lists the child", async () => {
    const html = await page({ view: "person" });
    const t = text(html);
    expect(t).toContain("Show giving for");
    for (const chip of ["Everyone", "Amara Okafor", "Mateo Silva", "Not tied to a person"]) expect(t).toContain(chip);
    expect(html).not.toContain(CHILD);
    expect(t).not.toMatch(/child/i);
    // One adult chosen: that person's own giving.
    const amara = text(await page({ view: "person", giving_for: "person-amara" }));
    expect(amara).toContain("Amara Okafor · This year (2026)");
    expect(amara).toContain("Monthly $300.00");
    const rest = text(await page({ view: "person", giving_for: "none" }));
    expect(rest).toContain("Not tied to a person · This year (2026)");
    // The child's id in the address is not an adult of the household: the whole household is shown.
    expect(text(await page({ view: "person", giving_for: CHILD }))).toContain("The whole household");
  });

  it("ignores a person in the address when the community shows giving by household", async () => {
    const t = text(await page({ giving_for: "person-amara" }));
    expect(t).toContain("The whole household");
    expect(t).not.toContain("Show giving for");
  });

  it("shows a person's own giving with the rest of the household explained, and a way to the household's total", async () => {
    const t = text(await page({ view: "person-page" }));
    expect(t).toContain("Amara Okafor · This year (2026)");
    expect(t).toContain("Not tied to Amara:");
    expect(t).toContain("See the household's total");
  });

  it("labels the household's giving on a person's page and shows its card (adults only)", async () => {
    const t = text(await page({ view: "household-card" }));
    expect(t).toContain("Household giving");
    expect(t).toContain("Household H-1042 · Amara Okafor, Mateo Silva");
  });

  it("says there is nothing for an empty year and offers the other years", async () => {
    const t = text(await page({ year: "2021" }));
    expect(t).toContain("No giving recorded for this year");
    expect(t).toContain("Nothing was pledged or paid in 2021.");
    expect(t).toMatch(/See This year \(2026\) Last year \(2025\) 2024 All time/);
    expect(text(await page({ view: "empty-rows" }))).toContain("No giving recorded for this year");
    expect(text(await page({ view: "empty-rows", year: "all" }))).toContain("No giving recorded yet");
  });

  it("says 'You don't have access to this area' instead of an empty table", async () => {
    const t = text(await page({ view: "noaccess" }));
    expect(t).toContain("You don't have access to this area");
    expect(t).not.toContain("Pledged");
  });

  it("shows a failed read next to what it was, with a retry", async () => {
    const html = await page({ view: "error" });
    expect(text(html)).toContain("Could not load the giving figures");
    expect(html).toContain('href="/dev/giving-glance?view=error"');
    expect(text(html)).toContain("Try again");
  });

  it("tells a finance volunteer they see only the payments they recorded", async () => {
    expect(text(await page({ view: "limited" }))).toContain("You can see only the payments you recorded yourself");
  });

  it("keeps the year filter in every link, and only the year chips change it", async () => {
    const html = await page({ view: "person", year: "2025", giving_for: "person-mateo" });
    expect(html).toContain("year=2024");
    expect(html).toMatch(/href="\/dev\/giving-glance\?view=person&amp;giving_for=person-mateo&amp;year=all"/);
    // The person chips keep the year.
    expect(html).toMatch(/href="\/dev\/giving-glance\?view=person&amp;year=2025&amp;giving_for=person-amara"/);
  });

  it("describes the month-by-month bars in words", async () => {
    const html = await page();
    expect(html).toMatch(/role="img" aria-label="Paid by month: Jan \$300\.00, Feb \$300\.00/);
  });
});

describe("the 'Show giving by' setting", () => {
  it("is the household for every community, and the panel works with it unset", () => {
    expect(RULE_DEFAULTS.givingShowBy).toBe("household");
    expect(readRuleSettings({}).givingShowBy).toBe("household");
    expect(readRuleSettings(null).givingShowBy).toBe("household");
    expect(readRuleSettings({ giving: { show_by: "person" } }).givingShowBy).toBe("person");
    expect(givingShowBy({ fees: { ask_donor_to_cover: true } })).toBe("household");
  });

  it("is saved with the giving rules, only when the form sent it", () => {
    const form = (o: Record<string, string>) => (name: string) => o[name] ?? null;
    expect(parseSection("giving", form({ ask_donor_to_cover: "on", giving_show_by: "person" }))).toEqual({
      ok: true,
      patch: { fees: { ask_donor_to_cover: true }, boli: { soft_close_minutes: 0 }, giving: { show_by: "person" } },
    });
    // A save from a form without the choice leaves the stored setting alone.
    expect(parseSection("giving", form({ ask_donor_to_cover: "on" }))).toEqual({ ok: true, patch: { fees: { ask_donor_to_cover: true }, boli: { soft_close_minutes: 0 } } });
    expect(parseSection("giving", form({ giving_show_by: "family" }))).toEqual({ ok: false, error: "Choose whether giving is shown by household or by person." });
  });

  it("is checked when rules are pasted in the advanced editor", () => {
    expect(validateRulesJson(JSON.stringify({ giving: { show_by: "person" } })).ok).toBe(true);
    expect(validateRulesJson(JSON.stringify({ giving: { show_by: "household" } })).ok).toBe(true);
    expect(validateRulesJson(JSON.stringify({ giving: { show_by: "family" } }))).toEqual({ ok: false, errors: ['"giving.show_by" must be "household" or "person".'] });
    expect(validateRulesJson(JSON.stringify({ giving: "person" }))).toEqual({ ok: false, errors: ['"giving" must be an object.'] });
  });
});

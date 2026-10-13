import { describe, expect, it } from "vitest";

import { scheduleValues, sendValues, type ScheduleFacts } from "@/lib/merge/build";
import { AUDIENCE_INFO, placeholderNames, scheduleKey } from "@/lib/merge/catalogue";
import { emailPlace } from "@/lib/merge/format";
import { hourLabel, scheduleSentence, weekdayLabel } from "@/lib/merge/schedule";

const us = emailPlace({ currency: "USD", time_zone: "America/Chicago", country: "US", languages: ["en"] });

const base: ScheduleFacts = {
  center: { name: "Riverside Community Center", short_name: "Riverside", currency: "USD", time_zone: "America/Chicago", country: "US", languages: ["en"] },
  household: { id: "h1", name: "Rivera, Alex & Zoya", number: "H-1042", minor_first_names: ["Zoya"] },
  recipients: [{ person_id: "p1", address: "alex@example.org", first_name: "Alex", name: "Alex Rivera", language: "en" }],
};

describe("when a scheduled email goes, in words", () => {
  it("says each frequency", () => {
    expect(scheduleSentence({ frequency: "daily", hour: 9 })).toBe("Every day at 9:00 AM");
    expect(scheduleSentence({ frequency: "weekly", day_of_week: 1, hour: 18 })).toBe("Every week on Monday at 6:00 PM");
    expect(scheduleSentence({ frequency: "monthly", day_of_month: 1, hour: 9 })).toBe("Every month on day 1 at 9:00 AM");
    expect(scheduleSentence({ frequency: "yearly", day_of_month: 15, month: 1, hour: 9 })).toBe("Every year on January 15 at 9:00 AM");
  });

  it("writes hours and weekdays in the community's locale", () => {
    expect(hourLabel(18, "en-GB")).toBe("18:00");
    expect(weekdayLabel(0, "es-ES")).toBe("domingo");
    expect(hourLabel(99)).toBe("11:00 PM");
  });

  it("describes each audience", () => {
    expect(AUDIENCE_INFO.pledges_due_soon.describe({ days: 1 })).toBe("Households with an open pledge due in the next 1 day");
    expect(AUDIENCE_INFO.pledges_past_due.describe({ since: "2026-01-01" })).toContain("made on or after 2026-01-01, imported pledges left out");
  });
});

describe("a household's values in a scheduled email", () => {
  it("lists the pledges one line each, with the totals", () => {
    const facts: ScheduleFacts = {
      ...base,
      data: {
        pledges: [
          { number: "P-1", for: "Building Fund", balance_cents: 40000, due_on: "2026-10-16" },
          { number: "P-2", for: "Zoya's Fund", balance_cents: 1000, due_on: "2026-10-18" },
        ],
        count: 2,
        balance_cents: 41000,
        next_due: "2026-10-16",
      },
    };
    const v = scheduleValues("pledges_due_soon", facts, null, us);
    expect(v.pledges_list).toBe("P-1 · Building Fund · $400.00 · October 16, 2026\nP-2 · Fund · $10.00 · October 18, 2026");
    expect(v.pledges_balance).toBe("$410.00");
    expect(v.next_due_date).toBe("October 16, 2026");
    expect(v.household_name).toBe("Rivera, Alex");
    const sent = sendValues(scheduleKey("pledges_due_soon"), v);
    expect(Object.keys(sent)).toEqual(placeholderNames(scheduleKey("pledges_due_soon")));
    expect(sent.pledges_list.split("\n")).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toContain("Zoya");
  });

  it("lists the gifts of the period, and the dates it covers", () => {
    const facts: ScheduleFacts = {
      ...base,
      data: {
        gifts: [{ received_on: "2026-10-03", amount_cents: 25000, for: "General Fund" }],
        count: 1,
        total_cents: 25000,
        period_start: "2026-09-13",
        period_end: "2026-10-12",
      },
    };
    const v = scheduleValues("gave_recently", facts, null, us);
    expect(v.gifts_list).toBe("October 3, 2026 · $250.00 · General Fund");
    expect(v.gifts_total).toBe("$250.00");
    expect(v.gifts_period).toBe("September 13, 2026 – October 12, 2026");
  });

  it("keeps a list on its lines and every other value on one line", () => {
    const sent = sendValues(scheduleKey("gave_recently"), {
      gifts_list: "Line one\r\nLine two\u0007\n\nLine three",
      household_name: "Rivera\nBcc: x@example.org",
    });
    expect(sent.gifts_list).toBe("Line one\nLine two\nLine three");
    expect(sent.household_name).toBe("Rivera Bcc: x@example.org");
  });
});

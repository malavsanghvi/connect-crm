import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS } from "@/lib/giving-today/fixtures";
import { activeGivingTab, canOpenToday, givingTabs, type TabContext } from "@/lib/giving-today/tabs";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";

const ctx = (permissions: string[], modulesOff: string[] = ["bolis"], kind = NEUTRAL_KIND): TabContext => ({ permissions, isPlatformAdmin: false, modulesOff, kind });
const keys = (c: TabContext) => givingTabs(c).map((t) => t.key);
const treasurer = ROLE_PERMISSIONS.treasurer;

describe("Giving's one tab row", () => {
  it("a treasurer in a neutral community: every tab with a screen today, in the plan's order (no Labh, Bolis off)", () => {
    expect(keys(ctx(treasurer))).toEqual(["today", "pledges", "payments", "bank", "campaigns", "statements", "counts", "books"]);
    const tabs = givingTabs(ctx(treasurer));
    // Until slice 5 the counts are a view of Payments.
    expect(tabs.find((t) => t.key === "counts")).toMatchObject({ label: "Cash counts", href: "/giving/payments?view=counts" });
    expect(tabs.find((t) => t.key === "campaigns")).toMatchObject({ label: "Campaigns & opportunities", href: "/giving/opportunities" });
    expect(tabs.find((t) => t.key === "books")?.href).toBe("/accounting/close");
    // Insights has no screen yet: it is not offered.
    expect(keys(ctx(treasurer))).not.toContain("insights");
  });

  it("an add-on the community switched off takes its tab with it (unknown keys count as on until M2)", () => {
    const off = ctx(treasurer, ["bolis", "giving_bank", "giving_counts", "giving_recurring", "giving_statements", "giving_opportunities"]);
    expect(keys(off)).toEqual(["today", "pledges", "payments", "campaigns", "books"]);
    expect(givingTabs(off).find((t) => t.key === "campaigns")).toMatchObject({ label: "Campaigns", href: "/giving/opportunities/campaigns" });
    expect(keys(ctx(treasurer, ["bolis", "accounting"]))).not.toContain("books");
  });

  it("a kind with Labh and Bolis keeps their tabs, in its own words, until slice 6 folds them in", () => {
    const jain = ctx([...treasurer, "bolis.manage"], [], LEGACY_KIND);
    expect(keys(jain)).toEqual(["today", "pledges", "payments", "bank", "campaigns", "labh", "bolis", "statements", "counts", "books"]);
    expect(givingTabs(jain).find((t) => t.key === "counts")?.label).toBe("Bhandar counts");
    expect(keys(ctx(treasurer, ["labh"], LEGACY_KIND))).not.toContain("labh");
  });

  it("a volunteer and a second approver see only what they can open", () => {
    expect(keys(ctx(ROLE_PERMISSIONS.volunteer))).toEqual(["today", "pledges", "payments", "bank", "counts"]);
    expect(keys(ctx(ROLE_PERMISSIONS.approver))).toEqual(["today"]);
    expect(canOpenToday(ctx(ROLE_PERMISSIONS.approver))).toBe(true);
    expect(canOpenToday(ctx(["bolis.view"]))).toBe(false);
  });

  it("lights the tab of the page being read (the longest address wins)", () => {
    const tabs = givingTabs(ctx(treasurer, [], LEGACY_KIND));
    expect(activeGivingTab(tabs, "/giving")).toBe("today");
    expect(activeGivingTab(tabs, "/giving/ask")).toBe("today");
    expect(activeGivingTab(tabs, "/giving/payments")).toBe("payments");
    expect(activeGivingTab(tabs, "/giving/payments/bank")).toBe("bank");
    expect(activeGivingTab(tabs, "/giving/opportunities/campaigns")).toBe("campaigns");
    expect(activeGivingTab(tabs, "/giving/labh")).toBe("labh");
    expect(activeGivingTab(tabs, "/giving/pledges")).toBe("pledges");
    expect(activeGivingTab(tabs, "/bolis")).toBeNull();
  });
});

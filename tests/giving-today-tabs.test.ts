import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS } from "@/lib/giving-today/fixtures";
import { activeGivingTab, canOpenToday, givingTabs, type TabContext } from "@/lib/giving-today/tabs";
import { LEGACY_KIND, NEUTRAL_KIND } from "@/lib/kind";

const ctx = (permissions: string[], modulesOff: string[] = ["bolis"], kind = NEUTRAL_KIND): TabContext => ({ permissions, isPlatformAdmin: false, modulesOff, kind });
const keys = (c: TabContext) => givingTabs(c).map((t) => t.key);
const treasurer = ROLE_PERMISSIONS.treasurer;

describe("Giving's one tab row", () => {
  it("a treasurer in a neutral community: every tab with a screen today, in the plan's order (no Labh, Bolis off)", () => {
    expect(keys(ctx(treasurer))).toEqual(["today", "pledges", "payments", "bank", "proofs", "campaigns", "statements", "insights", "counts", "books"]);
    const tabs = givingTabs(ctx(treasurer));
    // The counts have their own tab since slice 5.
    expect(tabs.find((t) => t.key === "counts")).toMatchObject({ label: "Cash counts", href: "/giving/counts", paths: ["/giving/counts"] });
    expect(activeGivingTab(tabs, "/giving/counts")).toBe("counts");
    expect(tabs.find((t) => t.key === "campaigns")).toMatchObject({ label: "Campaigns & opportunities", href: "/giving/campaigns" });
    expect(tabs.find((t) => t.key === "books")?.href).toBe("/accounting/close");
    expect(tabs.find((t) => t.key === "proofs")).toMatchObject({ label: "Payment proofs", href: "/giving/proofs", paths: ["/giving/proofs"] });
    expect(activeGivingTab(tabs, "/giving/proofs")).toBe("proofs");
    expect(givingTabs(ctx(treasurer)).find((t) => t.key === "insights")).toMatchObject({ label: "Insights", href: "/giving/insights" });
  });

  it("an add-on the community switched off takes its tab with it (unknown keys count as on until M2)", () => {
    const off = ctx(treasurer, ["bolis", "giving_bank", "giving_proofs", "giving_counts", "giving_recurring", "giving_statements", "giving_opportunities"]);
    expect(keys(off)).toEqual(["today", "pledges", "payments", "campaigns", "insights", "books"]);
    expect(givingTabs(off).find((t) => t.key === "campaigns")).toMatchObject({ label: "Campaigns", href: "/giving/campaigns" });
    expect(keys(ctx(treasurer, ["bolis", "accounting"]))).not.toContain("books");
  });

  it("a kind with Labh and Bolis finds them as views of Campaigns & opportunities (slice 6), not tabs of their own", () => {
    const jain = ctx([...treasurer, "bolis.manage"], [], LEGACY_KIND);
    expect(keys(jain)).toEqual(["today", "pledges", "payments", "bank", "proofs", "campaigns", "statements", "insights", "counts", "books"]);
    expect(givingTabs(jain).find((t) => t.key === "counts")?.label).toBe("Bhandar counts");
    // Someone who holds only the Bolis permission inside Giving opens the tab on the Bolis view.
    expect(givingTabs(ctx(["giving.record_offline", "bolis.view"], [], LEGACY_KIND)).find((t) => t.key === "campaigns")?.href).toBe("/giving/campaigns?view=bolis");
  });

  it("a volunteer and a second approver see only what they can open", () => {
    expect(keys(ctx(ROLE_PERMISSIONS.volunteer))).toEqual(["today", "pledges", "payments", "bank", "proofs", "counts"]);
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
    expect(activeGivingTab(tabs, "/giving/labh")).toBe("campaigns");
    expect(activeGivingTab(tabs, "/giving/pledges")).toBe("pledges");
    expect(activeGivingTab(tabs, "/bolis")).toBe("campaigns");
  });
});

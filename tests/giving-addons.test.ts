// Giving as a core plus seven add-ons (0741-0743, docs/GIVING_REDESIGN.md section 11): the portal follows the database.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { CATALOG } from "@/lib/commands/catalog";
import { isModuleEnabled, moduleForPath } from "@/lib/modules";
import { visibleNav } from "@/lib/permissions";
import { visibleTaskSources } from "@/lib/tasks";

const admin = { permissions: [] as string[], isPlatformAdmin: true };
const givingTabs = (modulesOff: string[]) =>
  visibleNav({ ...admin, modulesOff })
    .find((m) => m.key === "giving")
    ?.tabs.map((t) => t.href) ?? [];

describe("Giving add-ons in the portal", () => {
  it("each add-on page belongs to its module; the core pages and the Campaigns list stay with Giving", () => {
    expect(moduleForPath("/giving/payments/bank")).toBe("giving_bank");
    expect(moduleForPath("/giving/bank")).toBe("giving_bank");
    expect(moduleForPath("/giving/opportunities")).toBe("giving_opportunities");
    expect(moduleForPath("/giving/opportunities/campaigns")).toBe("giving");
    expect(moduleForPath("/giving/campaigns")).toBe("giving");
    expect(moduleForPath("/giving/recurring")).toBe("giving_recurring");
    expect(moduleForPath("/giving/labh")).toBe("labh");
    expect(moduleForPath("/giving/payments")).toBe("giving");
    expect(moduleForPath("/giving/pledges")).toBe("giving");
    // Receipts and their templates live on the Statements page, so the page stays with Giving (it hides the statements part).
    expect(moduleForPath("/giving/statements")).toBe("giving");
  });

  it("an add-on that is off loses its tab; the rest of Giving stays", () => {
    const all = givingTabs([]);
    expect(all).toEqual(expect.arrayContaining(["/giving/pledges", "/giving/payments", "/giving/opportunities", "/giving/recurring", "/giving/labh", "/giving/statements"]));
    const some = givingTabs(["giving_recurring", "labh", "giving_opportunities", "giving_statements", "giving_bank"]);
    expect(some).not.toContain("/giving/recurring");
    expect(some).not.toContain("/giving/labh");
    // Opportunities' tab also opens the Campaigns list (core); its page sends people there while the add-on is off.
    expect(some).toEqual(expect.arrayContaining(["/giving/pledges", "/giving/payments", "/giving/opportunities", "/giving/statements"]));
    // Giving off: the whole area goes, add-ons with it.
    expect(visibleNav({ ...admin, modulesOff: ["giving"] }).some((m) => m.key === "giving")).toBe(false);
  });

  it("the deposits task and the bank commands follow Bank reconciliation", () => {
    const keys = (modulesOff: string[]) => visibleTaskSources({ ...admin, modulesOff }).map((s) => s.key);
    expect(keys([])).toContain("deposits");
    expect(keys(["giving_bank"])).not.toContain("deposits");
    expect(keys(["giving_bank"])).toContain("refund");
    const moduleOf = (key: string) => CATALOG.find((c) => c.key === key)?.module;
    for (const k of ["giving.bank_lines_unmatched", "giving.match_deposit", "giving.confirm_exact_zelle_matches", "giving.zelle_waiting"]) {
      expect(moduleOf(k), k).toBe("giving_bank");
    }
    expect(moduleOf("giving.household_summary")).toBe("giving");
  });

  it("an add-on counts as on until the database says otherwise (an older database without the add-ons)", () => {
    expect(isModuleEnabled({ modulesOff: [] }, "giving_bank")).toBe(true);
    expect(isModuleEnabled({ modulesOff: ["giving_bank"] }, "giving_bank")).toBe(false);
  });
});

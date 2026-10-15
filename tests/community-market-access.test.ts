// Who sees the Community Market in the portal (0830): the Store's tab, the permission group in Roles, the access keys. Convenience only: the
// database decides (supabase/tests/830_community_market_test.sql); these checks keep the screens in step with it.
import { describe, expect, it } from "vitest";

import { ENTITLEMENT_GROUPS, entitlementGroupsFor, entitlementLabel } from "@/lib/entitlements";
import { LEGACY_KIND } from "@/lib/kind";
import { isModuleEnabled, isProductModule, MODULES, moduleForPath, moduleOffMessage } from "@/lib/modules";
import { ACCESS, canAccess, visibleNav } from "@/lib/permissions";

const nav = (permissions: string[], modulesOff: string[]) => visibleNav({ permissions, isPlatformAdmin: false, modulesOff, kind: LEGACY_KIND });
const storeTabs = (permissions: string[], modulesOff: string[]) => nav(permissions, modulesOff).find((m) => m.key === "store")?.tabs.map((t) => t.label) ?? [];

describe("the Community Market in the navigation", () => {
  it("is a tab of the Store only while the market is on, for the people who may open it", () => {
    expect(storeTabs(["store.manage"], ["market"])).toStrictEqual(["Inventory", "Menu & pickup", "Orders by pickup"]);
    expect(storeTabs(["store.manage"], [])).toStrictEqual(["Inventory", "Menu & pickup", "Orders by pickup", "Community Market"]);
    // The market lives in the store: with the Store off there is no market either.
    expect(nav(["store.manage", "market.manage"], ["store", "market"]).find((m) => m.key === "store")).toBeUndefined();
  });

  it("gives a person who runs only the market the Store with that one tab, and nobody else the tab", () => {
    expect(storeTabs(["market.manage"], [])).toStrictEqual(["Community Market"]);
    expect(storeTabs(["market.view"], [])).toStrictEqual(["Community Market"]);
    expect(storeTabs(["market.moderate"], [])).toStrictEqual(["Community Market"]);
    expect(storeTabs(["market.manage"], ["market"])).toStrictEqual([]);
    expect(storeTabs(["people.view", "giving.view"], [])).toStrictEqual([]);
    expect(storeTabs(["store.pickup"], [])).toStrictEqual(["Orders by pickup"]);
  });

  it("opens the market's page under the market module, so a switched-off market says so", () => {
    expect(moduleForPath("/store/market")).toBe("market");
    expect(moduleForPath("/store/menu")).toBe("store");
    expect(isModuleEnabled({ modulesOff: ["market"] }, "market")).toBe(false);
    expect(isModuleEnabled({ modulesOff: ["store"] }, "market")).toBe(false);
  });
});

describe("the access keys of the Community Market", () => {
  it("let the store's staff and the market's own roles open it, and the store's manager or market.manage change it", () => {
    expect([...ACCESS.marketView]).toStrictEqual(["store.view", "store.manage", "market.view", "market.manage", "market.moderate"]);
    expect([...ACCESS.marketManage]).toStrictEqual(["store.manage", "market.manage"]);
    const as = (permissions: string[]) => ({ permissions, isPlatformAdmin: false });
    expect(canAccess(as(["market.manage"]), "marketManage")).toBe(true);
    expect(canAccess(as(["store.manage"]), "marketManage")).toBe(true);
    expect(canAccess(as(["market.view"]), "marketManage")).toBe(false);
    expect(canAccess(as(["market.moderate"]), "marketManage")).toBe(false);
    expect(canAccess(as(["market.view"]), "marketView")).toBe(true);
    expect(canAccess(as(["store.view"]), "marketView")).toBe(true);
    expect(canAccess(as(["store.pickup"]), "marketView")).toBe(false);
    expect(canAccess(as([]), "marketView")).toBe(false);
  });
});

describe("the Community Market in Roles", () => {
  it("lists its three permissions in a group of its own", () => {
    const group = ENTITLEMENT_GROUPS.find((g) => g.name === "Community Market");
    expect(group?.items.map((i) => i.key)).toStrictEqual(["market.view", "market.manage", "market.moderate"]);
    expect(entitlementLabel("market.manage")).toMatch(/categories and listings/);
  });

  it("shows the group only while the community has the market on", () => {
    const names = (modulesOff: string[]) => entitlementGroupsFor(LEGACY_KIND, modulesOff).map((g) => g.name);
    expect(names(["market"])).not.toContain("Community Market");
    expect(names([])).toContain("Community Market");
  });
});

describe("the Community Market as a Marketplace product", () => {
  it("is a module that needs the Store, named for the community, and asked for in Settings › Marketplace", () => {
    const m = MODULES.find((x) => x.key === "market");
    expect(m).toMatchObject({ key: "market", label: "Community Market", core: false, dependsOn: ["store"] });
    expect(isProductModule("market")).toBe(true);
    expect(moduleOffMessage("market", "Lakeside Club")).toBe(
      "Community Market is not on for Lakeside Club. It is a Marketplace product: an administrator can request it, or resume it if it is paused, in Settings › Marketplace.",
    );
  });
});

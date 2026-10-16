import { describe, expect, it } from "vitest";

import {
  MARKET_TABS,
  chipFor,
  codeFailed,
  dialogNote,
  marketplaceHref,
  needMark,
  parseProduct,
  parseProducts,
  platformRow,
  productsInTab,
  requestFailed,
  requestedLine,
  sinceLine,
  switchDoneMessage,
  switchFormProblem,
  type Product,
} from "@/lib/marketplace";
import { isProductModule, moduleOffMessage } from "@/lib/modules";

const TZ = "America/Chicago";

/** One row as app.marketplace_states returns it (0753), with overrides. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: "website",
    module_key: "website",
    name: "WeaverSite",
    module_label: "WeaverSite",
    mark: "WS",
    line: "Your website, built from what Weaver already knows.",
    gets: ["A first draft built from your current site"],
    needs: [{ module: "people", label: "Members & families", on: true, required: false }],
    members_line: null,
    data_line: null,
    price_text: "Price not set yet",
    price_short: "Price not set yet",
    included: false,
    catalog_status: "available",
    target_quarter: null,
    on_note: "The site stays a private draft until publishing is built.",
    off_note: null,
    sort: 90,
    state: "available",
    enabled: false,
    granted: false,
    paused: false,
    waiting_for: [],
    source: "none",
    granted_at: null,
    granted_by_name: null,
    grant_reason: null,
    paused_at: null,
    paused_by_name: null,
    pause_reason: null,
    request_id: null,
    request_note: null,
    requested_at: null,
    requested_by_name: null,
    notified_at: null,
    ...over,
  };
}
const product = (over: Record<string, unknown> = {}): Product => parseProduct(row(over))!;

describe("parsing app.marketplace_states", () => {
  it("reads every field, and refuses a row that is not the expected shape", () => {
    const p = product({ needs: [{ module: "comms", label: "Communications", on: false, required: true }, { bad: 1 }] });
    expect(p.key).toBe("website");
    expect(p.built).toBe(true);
    expect(p.needs).toEqual([{ module: "comms", label: "Communications", on: false, required: true }]);
    expect(parseProduct(row({ state: "weird" }))).toBeNull();
    expect(parseProducts([row(), row({ key: null })])).toBeNull();
    expect(parseProducts([row(), row({ key: "ai", name: "iWeaver" })])?.map((x) => x.key)).toEqual(["website", "ai"]);
  });
});

describe("Settings › Marketplace", () => {
  const all = [
    product({ key: "giving", name: "Giving", state: "included" }),
    product({ key: "accounting", name: "Accounting", state: "on" }),
    product({ key: "store", name: "Digital Store", state: "paused" }),
    product({ key: "website", state: "requested" }),
    product({ key: "ai", name: "iWeaver", state: "available" }),
    product({ key: "care", name: "DonorDelight", state: "not_built", catalog_status: "not_built" }),
    product({ key: "gala", name: "Gala", module_key: null, state: "notified", catalog_status: "not_built" }),
  ];
  it("the four tabs, as in the prototype", () => {
    expect(MARKET_TABS.map((t) => t.label)).toEqual(["All", "In use", "Available", "Not built yet"]);
    expect(productsInTab(all, "all")).toHaveLength(7);
    expect(productsInTab(all, "inuse").map((p) => p.key)).toEqual(["giving", "accounting", "store"]);
    expect(productsInTab(all, "available").map((p) => p.key)).toEqual(["website", "ai"]);
    expect(productsInTab(all, "coming").map((p) => p.key)).toEqual(["care", "gala"]);
  });
  it("each state's chip has words, never colour alone", () => {
    expect(["included", "on", "paused", "requested", "available", "not_built", "notified"].map((s) => chipFor(s as Product["state"]).label)).toEqual([
      "Included",
      "On",
      "Paused",
      "Requested",
      "Available",
      "Not built yet",
      "We will tell you",
    ]);
    expect(needMark({ module: "giving", label: "Giving", on: false, required: true })).toBe("Off: turn it on first");
  });
  it("the line under the state says when, by whom and why", () => {
    expect(sinceLine(product({ state: "on", source: "weaver", granted_at: "2026-09-03T15:00:00Z" }), TZ)).toBe("On since Sep 3, 2026, turned on by Weaver");
    expect(sinceLine(product({ state: "on", source: "grandfathered", granted_at: "2026-08-20T15:00:00Z" }), TZ)).toBe(
      "On since Aug 20, 2026. Included because your community used it before packs began",
    );
    expect(sinceLine(product({ state: "on", source: "trial" }), TZ)).toBe("On as a trial while your community is a sandbox");
    expect(sinceLine(product({ state: "paused", paused_by_name: "Sam K.", paused_at: "2026-10-02T15:00:00Z" }), TZ)).toBe("Paused by Sam K. on Oct 2, 2026");
    expect(sinceLine(product({ state: "requested", requested_by_name: "Sam K.", requested_at: "2026-10-10T15:00:00Z" }), TZ)).toBe(
      "Requested by Sam K. on Oct 10, 2026",
    );
    expect(sinceLine(product({ state: "available", source: "trial_ended", grant_reason: "iWeaver was a trial." }), TZ)).toBe("iWeaver was a trial.");
    expect(sinceLine(product({ state: "included", source: "kind_default" }), TZ)).toBeNull();
  });
  it("a failed request keeps the note and says so", () => {
    expect(requestFailed("Could not send the request — Weaver did not answer.")).toBe("Could not send the request — Weaver did not answer. Your note is kept.");
  });
});

describe("Platform › Communities › Products", () => {
  it("core, on, off and not built, each with where it came from and the one action", () => {
    expect(platformRow(product({ state: "included", included: true, granted: true, source: "kind_default" }), TZ)).toEqual({
      chip: { label: "Core: always on", tone: "core" },
      source: "Included for every community of this kind.",
      action: null,
    });
    const on = platformRow(product({ state: "on", granted: true, source: "weaver", granted_by_name: "ana@weaver.test", granted_at: "2026-09-03T15:00:00Z" }), TZ);
    expect(on).toEqual({ chip: { label: "On", tone: "on" }, source: "Turned on by ana@weaver.test on Sep 3, 2026.", action: "off" });
    const paused = platformRow(
      product({ state: "paused", granted: true, paused: true, source: "weaver", granted_by_name: "ana@weaver.test", granted_at: "2026-07-14T15:00:00Z", paused_at: "2026-10-02T15:00:00Z" }),
      TZ,
    );
    expect(paused.source).toBe("Turned on by ana@weaver.test on Jul 14, 2026. Paused by the community on Oct 2, 2026.");
    const gf = platformRow(product({ key: "ai", state: "on", granted: true, source: "grandfathered", granted_at: "2026-08-20T15:00:00Z", grant_reason: "Grandfathered (0750): Niva was on." }), TZ);
    expect(gf.source).toBe("Grandfathered on Aug 20, 2026: Niva was on.");
    expect(platformRow(product({ state: "requested", requested_at: "2026-10-10T15:00:00Z" }), TZ)).toEqual({
      chip: { label: "Off", tone: "off" },
      source: "Not turned on. Requested on Oct 10, 2026.",
      action: "on",
    });
    expect(platformRow(product({ key: "care", state: "not_built", catalog_status: "not_built" }), TZ)).toEqual({
      chip: { label: "Not built yet", tone: "coming" },
      source: "Not turned on. Shown to the community as not built yet.",
      action: "on",
    });
    expect(platformRow(product({ key: "gala", module_key: null, state: "not_built", catalog_status: "not_built" }), TZ).action).toBeNull();
  });
  it("the dialog's note, the checks before sending, and the code error in the prototype's words", () => {
    expect(dialogNote(product(), true)).toBe("The site stays a private draft until publishing is built.");
    expect(dialogNote(product(), false)).toBe("Members and staff lose access at once. Nothing is deleted. Turning it on again brings everything back.");
    expect(switchFormProblem("  ", "123456")).toBe("Add a reason first. It is saved in the audit log.");
    expect(switchFormProblem("Reviewed", "12345")).toBe("Enter all 6 digits of the code from your authenticator app.");
    expect(switchFormProblem("Reviewed", "123456")).toBeNull();
    expect(codeFailed("Could not check the code — that code is wrong or has expired. Codes change every 30 seconds — enter the one showing now.")).toBe(
      "That code did not match. Codes change every 30 seconds, so enter the current one.",
    );
    expect(codeFailed("Could not check the code — your session has expired. Sign in again.")).toBe("Could not check the code — your session has expired. Sign in again.");
  });
  it("the done line says whether the admins were emailed, never that they were when they were not", () => {
    expect(switchDoneMessage("WeaverSite", "Riverbend", true, true, "queued")).toBe("WeaverSite is on for Riverbend. Its admins got a message.");
    expect(switchDoneMessage("WeaverSite", "Riverbend", false, false, "no_recipient")).toBe(
      "WeaverSite is off for Riverbend. The community has no owner or requester to email, so no message was sent.",
    );
    expect(switchDoneMessage("WeaverSite", "Riverbend", true, false, "failed: no template")).toBe(
      "WeaverSite is on for Riverbend. The message to its admins could not be sent (failed: no template): tell them yourself.",
    );
    expect(requestedLine(product({ requested_by_name: "Sam K.", requested_at: "2026-10-10T15:00:00Z" }), TZ, " (community admin)")).toBe(
      "Requested by Sam K. (community admin) on Oct 10, 2026",
    );
  });
});

describe("a product that is off says where to go", () => {
  it("every link to the Marketplace is the one route, opened on the product when there is one", () => {
    expect(marketplaceHref()).toBe("/settings/marketplace");
    expect(marketplaceHref("website")).toBe("/settings/marketplace?product=website");
  });
  it("the Marketplace for the five products, Settings › Modules for the rest", () => {
    expect(["ai", "website", "channels", "care", "matching"].every(isProductModule)).toBe(true);
    expect(isProductModule("giving")).toBe(false);
    expect(moduleOffMessage("website", "Riverbend", "WeaverSite")).toBe(
      "WeaverSite is not on for Riverbend. It is a Marketplace product: an administrator can request it, or resume it if it is paused, in Settings › Marketplace.",
    );
    expect(moduleOffMessage("giving", "Riverbend", "Giving")).toBe("The Giving module is switched off for Riverbend. An administrator can switch it on in Settings › Modules.");
  });
});

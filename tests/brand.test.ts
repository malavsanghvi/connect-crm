import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { WEAVER_SILHOUETTE_D, WEAVER_VIEW_BOX } from "@/components/brand/weaver-mark";
import { GENEROSITY_LINE, PRODUCT_NAME } from "@/lib/brand";

describe("the Weaver brand (owner 2026-10-08)", () => {
  it("the product is called Weaver", () => {
    expect(PRODUCT_NAME).toBe("Weaver");
  });
  it("the product introduces itself as built and run on generosity (owner 2026-10-08)", () => {
    expect(GENEROSITY_LINE).toBe("Built and Runs on Generosity");
  });
  it("the favicon file draws the same mark as the component", () => {
    const svg = readFileSync(new URL("../src/app/icon.svg", import.meta.url), "utf8");
    expect(svg).toContain(`viewBox="${WEAVER_VIEW_BOX}"`);
    expect(svg).toContain(`d="${WEAVER_SILHOUETTE_D}"`);
    expect(svg).toContain("<title>Weaver</title>");
  });
});

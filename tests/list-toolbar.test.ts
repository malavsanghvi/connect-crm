import { describe, expect, it } from "vitest";

import { chipName, menuView } from "@/lib/list-toolbar";

const chip = (key: string, label: string, on = false, count: number | null = null) => ({ key, label, href: `/list?${key}`, count, on });

describe("a group of chips as a dropdown", () => {
  const methods = [chip("", "All methods", true), chip("check", "Check"), chip("zelle", "Zelle"), chip("card", "Card")];

  it("is not lit while the all option is on, and keeps all options with the all one first", () => {
    const v = menuView(methods);
    expect(v.on).toBe(false);
    expect(v.value).toBeNull();
    expect(v.options.map((o) => o.label)).toEqual(["All methods", "Check", "Zelle", "Card"]);
  });

  it("is lit and says its value once an option is on", () => {
    const v = menuView([chip("", "All methods"), chip("check", "Check"), chip("zelle", "Zelle", true)]);
    expect(v.on).toBe(true);
    expect(v.value).toBe("Zelle");
  });

  it("gives a group that has no all chip the reset option the list names, lit while nothing is chosen", () => {
    const buckets = [chip("1_30", "1 to 30 days · $96,200", false, 64), chip("31_60", "31 to 60 days · $61,900", false, 29)];
    const none = menuView(buckets, { label: "Any", href: "/list" });
    expect(none.on).toBe(false);
    expect(none.options.map((o) => o.label)).toEqual(["Any", "1 to 30 days · $96,200", "31 to 60 days · $61,900"]);
    expect(none.options[0]).toMatchObject({ href: "/list", on: true });
    const one = menuView([chip("1_30", "1 to 30 days · $96,200", true, 64), buckets[1]], { label: "Any", href: "/list" });
    expect(one.on).toBe(true);
    expect(one.value).toBe("1 to 30 days");
    expect(one.options[0].on).toBe(false);
  });

  it("has no reset option when the list names none and the group has no all chip", () => {
    expect(menuView([chip("a", "A"), chip("b", "B")]).options.map((o) => o.label)).toEqual(["A", "B"]);
  });

  it("names a chip without its amount", () => {
    expect(chipName("90+ days · $27,100")).toBe("90+ days");
    expect(chipName("Zelle")).toBe("Zelle");
  });
});

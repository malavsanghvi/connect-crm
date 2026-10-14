import { describe, expect, it } from "vitest";

import { isCanonicalScreenKey, routePattern, screenKey, shouldTrackPath } from "@/lib/activity/route-pattern";

const UUID = "8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f";

describe("routePattern", () => {
  it("turns an id into [id] and keeps the portal's own words", () => {
    expect(routePattern(`/events/${UUID}`)).toBe("/events/[id]");
    expect(routePattern(`/people/${UUID}`)).toBe("/people/[id]");
    expect(routePattern(`/pathshala/terms/${UUID}/fees`)).toBe("/pathshala/terms/[id]/fees");
    expect(routePattern("/giving/payments")).toBe("/giving/payments");
    expect(routePattern("/content/gyan-path")).toBe("/content/gyan-path");
    expect(routePattern("/")).toBe("/");
    expect(routePattern("")).toBe("/");
  });

  it("makes any numeric or uuid-looking segment [id]", () => {
    expect(routePattern("/households/417")).toBe("/households/[id]");
    expect(routePattern("/events/8f0c9e5a1b2c4d3e9f405a6b7c8d9e0f")).toBe("/events/[id]");
    expect(routePattern("/events/8F0C9E5A-1B2C-4D3E-9F40-5A6B7C8D9E0F")).toBe("/events/[id]");
    expect(routePattern("/x/0417/y/2026-10-10")).toBe("/x/[id]/y/[id]");
  });

  it("never lets a query string or a hash through", () => {
    expect(routePattern(`/events/${UUID}?tab=rsvps&q=Shah`)).toBe("/events/[id]");
    expect(routePattern("/people?search=Priya%20Shah#top")).toBe("/people");
    expect(routePattern("/giving?household=8f0c9e5a-1b2c-4d3e-9f40-5a6b7c8d9e0f")).toBe("/giving");
    expect(routePattern("https://portal.example.org/events/417?x=1")).toBe("/events/[id]");
  });

  it("treats a trailing or doubled slash as the same address", () => {
    expect(routePattern("/giving/")).toBe("/giving");
    expect(routePattern("//giving///payments//")).toBe("/giving/payments");
  });

  it("turns anything that is not a plain lowercase word into [id]", () => {
    expect(routePattern("/people/Priya-Shah")).toBe("/people/[id]");
    expect(routePattern("/people/priya_shah")).toBe("/people/[id]");
    expect(routePattern("/people/priya.shah")).toBe("/people/[id]");
    expect(routePattern("/people/priya%20shah")).toBe("/people/[id]");
    expect(routePattern("/people/%E0%A4%A4")).toBe("/people/[id]");
    expect(routePattern("/people/%zz")).toBe("/people/[id]");
    expect(routePattern("/invite/abcdefghijklmnopqrstuvwxyzabcdefghijkl")).toBe("/invite/[id]");
    expect(routePattern("/x/deadbeefcafe")).toBe("/x/[id]");
    expect(routePattern("/x/-")).toBe("/x/[id]");
    expect(routePattern("/x/word-")).toBe("/x/[id]");
  });

  it("treats a known dynamic value as [id], even when it looks like a word", () => {
    expect(routePattern("/settings/import/template/people", ["people"])).toBe("/settings/import/template/[id]");
    expect(routePattern("/a/b", ["a"])).toBe("/[id]/b");
  });

  it("cuts a very deep address", () => {
    expect(routePattern("/a/b/c/d/e/f/g/h/i/j/k").split("/").length - 1).toBe(8);
  });

  it("is stable: a pattern is its own pattern", () => {
    for (const path of ["/", "/events/[id]", "/pathshala/terms/[id]/fees", "/giving/payments"]) {
      expect(routePattern(path)).toBe(path);
    }
  });

  it("cannot be handed anything that is not text", () => {
    expect(routePattern(undefined as unknown as string)).toBe("/");
    expect(routePattern(null as unknown as string)).toBe("/");
    expect(routePattern(42 as unknown as string)).toBe("/");
  });

  it("lets no id of any usual shape survive (random ids, numbers, hex and tokens)", () => {
    const hex = "0123456789abcdef";
    const alnum = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    const pick = (chars: string, len: number) => Array.from({ length: len }, () => chars[rnd(chars.length)]).join("");
    for (let i = 0; i < 500; i += 1) {
      const uuid = `${pick(hex, 8)}-${pick(hex, 4)}-${pick(hex, 4)}-${pick(hex, 4)}-${pick(hex, 12)}`;
      const samples = [uuid, uuid.replace(/-/g, ""), String(rnd(1_000_000_000)), pick(hex, 8 + rnd(40)), pick(alnum, 6 + rnd(60)), `${pick("abcdef", 8 + rnd(12))}`];
      for (const sample of samples) {
        const pattern = routePattern(`/events/${sample}/edit?x=${sample}#${sample}`);
        expect(pattern, sample).toBe("/events/[id]/edit");
        expect(pattern.includes(sample)).toBe(false);
      }
    }
  });
});

describe("screenKey and isCanonicalScreenKey", () => {
  it("builds the catalog key", () => {
    expect(screenKey(`/events/${UUID}?tab=x`)).toBe("screen:/events/[id]");
    expect(screenKey("/")).toBe("screen:/");
  });

  it("accepts only keys that carry no id", () => {
    expect(isCanonicalScreenKey("screen:/events/[id]")).toBe(true);
    expect(isCanonicalScreenKey("screen:/")).toBe(true);
    expect(isCanonicalScreenKey(`screen:/events/${UUID}`)).toBe(false);
    expect(isCanonicalScreenKey("screen:/events/417")).toBe(false);
    expect(isCanonicalScreenKey("screen:/events?tab=x")).toBe(false);
    expect(isCanonicalScreenKey("screen:events")).toBe(false);
    expect(isCanonicalScreenKey("giving.record_payment")).toBe(false);
    expect(isCanonicalScreenKey(undefined)).toBe(false);
  });
});

describe("shouldTrackPath", () => {
  it("skips the platform console and the interface's own endpoints", () => {
    expect(shouldTrackPath("/platform")).toBe(false);
    expect(shouldTrackPath("/platform/centers/8f0c")).toBe(false);
    expect(shouldTrackPath("/Platform/centers")).toBe(false);
    expect(shouldTrackPath("/api/activity")).toBe(false);
    expect(shouldTrackPath("/login")).toBe(false);
  });

  it("records the community portal", () => {
    expect(shouldTrackPath("/")).toBe(true);
    expect(shouldTrackPath("/giving/payments")).toBe(true);
    expect(shouldTrackPath("/events/8f0c")).toBe(true);
    expect(shouldTrackPath("/platformer")).toBe(true);
  });
});

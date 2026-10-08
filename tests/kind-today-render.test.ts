import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Content › Today & darshan / Live stream. Migration 0600 closes the live-stream area (the access area "darshan") for every
// kind but the Jain Center, so the page must not offer an administrator of any other kind to add a stream nobody can watch.
// Only the page's own output is rendered: the actions and the drawer button are stubbed.
vi.mock("@/app/(app)/content/actions", () => ({ saveContentItemAction: vi.fn(), saveDayTimingsAction: vi.fn(), saveTimingRulesAction: vi.fn() }));
vi.mock("@/app/(app)/content/item-form", () => ({
  ContentItemButton: ({ label }: { label: string }) => createElement("button", { "data-testid": "content-item-button" }, label),
}));
vi.mock("@/components/action-form", () => ({ ActionForm: ({ children }: { children?: unknown }) => createElement("form", null, children as never) }));
const getSession = vi.fn();
const loadSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: () => getSession(), loadSession: () => loadSession() }));

import TodayPage from "@/app/(app)/content/today/page";
import { LEGACY_KIND, parseKindProfile } from "@/lib/kind";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

// A query builder that answers every call with the same result: enough for a page that only reads rows.
function rows(data: unknown[] = []) {
  const result = { data, error: null };
  const p: unknown = new Proxy(function () {}, {
    get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => void) => resolve(result) : p),
    apply: () => p,
  });
  return p;
}

const chamber = parseKindProfile({
  category: { key: "chamber_of_commerce", label: "Chamber of commerce", faith_based: false, uses_tradition: false, terms: { greeting: "Welcome" } },
  modules: {},
})!;
const community = parseKindProfile({
  category: { key: "nonprofit_secular", label: "Community organization", faith_based: false, uses_tradition: false, terms: { greeting: "Welcome" } },
  modules: {},
})!;

const session = (kind: typeof LEGACY_KIND, extra: Record<string, unknown> = {}) => ({
  kind,
  db: { from: () => rows() },
  center: { id: "c1", name: "Houston Chamber", short_name: null, time_zone: "America/Chicago", rules: {} },
  permissions: ["content.view", "content.draft", "content.manage", "settings.manage"],
  isPlatformAdmin: true,
  isOwner: false,
  modulesOff: [],
  ...extra,
});

describe("Content › Live stream for a kind that has no live-stream area", () => {
  beforeEach(() => {
    getSession.mockReset();
    loadSession.mockReset();
  });

  it("offers no Add stream button and no stream table, and says why", async () => {
    getSession.mockResolvedValue(session(chamber));
    const html = render(await TodayPage());
    expect(html).not.toContain("Add stream");
    expect(html).not.toContain("content-item-button");
    expect(html).not.toContain("<table");
    expect(html).toContain("Live stream is not part of a Chamber of commerce organization");
    expect(html).toContain("cannot watch a live stream yet");
  });

  it("does not say organization twice for the neutral kind", async () => {
    getSession.mockResolvedValue(session(community));
    const html = render(await TodayPage());
    expect(html).toContain("Live stream is not part of a Community organization");
    expect(html).not.toContain("organization organization");
    expect(html).not.toContain("Add stream");
  });

  it("a Jain Center keeps the Add stream button and its daily timings", async () => {
    getSession.mockResolvedValue(session(LEGACY_KIND, { center: { id: "c1", name: "JSH", short_name: "JSH", time_zone: "America/Chicago", rules: {} } }));
    const html = render(await TodayPage());
    expect(html).toContain("Add stream");
    expect(html).toContain("Daily timings");
    expect(html).not.toContain("is not part of");
  });
});

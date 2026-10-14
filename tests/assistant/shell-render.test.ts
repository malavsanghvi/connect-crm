import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The whole portal shell, rendered once on the server with Niva off (its state before any answer, and the state after a failed or
// refused answer): the page must come out whole and nothing of Niva may be in it. Server actions are replaced; nothing is called.
vi.mock("next/navigation", () => ({
  usePathname: () => "/giving/payments",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("@/app/(app)/search/actions", () => ({ globalSearchAction: vi.fn() }));
vi.mock("@/app/(app)/search/find-actions", () => ({ findAction: vi.fn() }));
vi.mock("@/app/auth-actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/app/tenancy-actions", () => ({ switchCenterAction: vi.fn() }));
vi.mock("@/app/history-actions", () => ({ loadRecordHistoryAction: vi.fn() }));

import { AppShell } from "@/components/shell/app-shell";
import { LEGACY_KIND } from "@/lib/kind";
import type { CrmSession } from "@/lib/session";

const h = createElement as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;

const session = {
  permissions: ["dashboard", "households", "pledges"],
  isPlatformAdmin: false,
  isOwner: false,
  userId: "u1",
  email: "treasurer@example.org",
  center: {
    id: "c1",
    slug: "jsh",
    name: "Jain Society",
    short_name: "JSH",
    time_zone: "America/New_York",
    currency: "USD",
    branding: {},
    feature_flags: {},
    rules: {},
    status: "active",
    environment: "production",
  },
  person: { id: "p1", name: "Priya Mehta", memberNumber: "1001" },
  roles: [{ key: "treasurer", name: "Treasurer", scopeKind: "center" }],
  grants: [{ role_key: "treasurer", scope_kind: "center", scope_id: null }],
  requestId: "r1",
  modulesOff: [],
  modulesStatus: "ok",
  kind: LEGACY_KIND,
  kindStatus: "ok",
  aal: "aal1",
  amr: [],
  centerSource: "default",
  switchable: [],
} as unknown as CrmSession;

describe("the portal shell with Niva off", () => {
  const html = renderToStaticMarkup(h(AppShell, { session, tasks: null }, createElement("section", { id: "page" }, "Payments page")));

  it("renders the page and the usual shell around it", () => {
    expect(html).toContain('<section id="page">Payments page</section>');
    expect(html).toContain("Jain Society");
    expect(html).toContain("<main");
    expect(html).toContain("cc-sidebar");
    expect(html).toContain("Sign out");
  });

  it("shows nothing of Niva: no button, no panel, no sparkle", () => {
    expect(html).not.toContain("niva-panel");
    expect(html).not.toContain("Ask Niva");
    expect(html).not.toContain("Close Niva");
    expect(html).not.toContain("Open or close Niva");
    expect(html).not.toContain("Conversation with Niva");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import OnboardingStartPreview from "@/app/dev/onboarding-start/page";
import { devPreviewAllowed, isDevPreviewPath } from "@/lib/dev-preview";
import { proxy } from "@/proxy";

// The dev-only preview of the onboarding front door (src/app/dev/onboarding-start): sample data, no database, and never
// in production. Both read NODE_ENV when called, so the modules are imported once (React picks its build at load).

afterEach(() => {
  vi.unstubAllEnvs();
});

const call = (sp: Record<string, string> = {}) => OnboardingStartPreview({ searchParams: Promise.resolve(sp) });

describe("the dev preview route", () => {
  it("returns notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(call()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  // Vitest runs with NODE_ENV "test": outside production, like `next dev`.
  it("draws the front door with sample data outside production, without Supabase", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const html = renderToStaticMarkup(await call());
    expect(html).toContain("DEV PREVIEW · SAMPLE DATA");
    expect(html).toContain("Riverside Neighbours Association");
    expect(html).toContain("Looks like a Neon CRM export");
    const empty = renderToStaticMarkup(await call({ sample: "empty" }));
    expect(empty).toContain("Nothing loaded yet");
    expect(empty).not.toContain("I looked at");
  });

  it("only /dev paths are previews, and only outside production", () => {
    expect(devPreviewAllowed("production")).toBe(false);
    expect(devPreviewAllowed("development")).toBe(true);
    expect(devPreviewAllowed("test")).toBe(true);
    expect(isDevPreviewPath("/dev/onboarding-start")).toBe(true);
    expect(isDevPreviewPath("/dev")).toBe(true);
    expect(isDevPreviewPath("/devices")).toBe(false);
    expect(isDevPreviewPath("/setup/dev")).toBe(false);
  });
});

describe("the proxy lets /dev through without a session only outside production", () => {
  const request = () => new NextRequest("http://localhost:3100/dev/onboarding-start", { headers: { host: "localhost:3100" } });
  const withEnv = () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "placeholder-anon-key");
  };

  it("passes /dev through outside production", async () => {
    withEnv();
    const res = await proxy(request());
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends a signed-out /dev request to sign-in in production", async () => {
    withEnv();
    vi.stubEnv("NODE_ENV", "production");
    const res = await proxy(request());
    expect(res.headers.get("location") ?? "").toContain("/login");
  });
});

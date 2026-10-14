import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/server-db", () => ({ workerQuery: vi.fn(), workerDbConfigured: () => false }));
// No OAUTH_STATE_SECRET: the callback refuses at once and sends the person back to QuickBooks setup with a message.
vi.mock("@/lib/platform-setup/server-config", () => ({ loadPlatformConfig: vi.fn(async () => {}), platformValue: () => "" }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { GET } from "@/app/api/oauth/intuit/callback/route";

describe("Intuit callback return address", () => {
  it("sends the person back to the public host, not the server's own address behind the proxy", async () => {
    const req = new NextRequest("http://localhost:3000/api/oauth/intuit/callback?code=c&state=s&realmId=1", {
      headers: { "x-forwarded-host": "admin.weaverams.org", "x-forwarded-proto": "https" },
    });
    const res = await GET(req);
    const to = new URL(res.headers.get("location") ?? "");
    expect(to.origin).toBe("https://admin.weaverams.org");
    expect(to.pathname).toBe("/accounting/qbo/setup");
    expect(to.searchParams.get("connect")).toBe("error");
  });

  it("falls back to the request's own origin when no forwarded host is sent (local dev)", async () => {
    const res = await GET(new NextRequest("http://localhost:3000/api/oauth/intuit/callback?code=c&state=s"));
    expect(new URL(res.headers.get("location") ?? "").origin).toBe("http://localhost:3000");
  });
});

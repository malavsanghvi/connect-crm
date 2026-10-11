import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The forms call Server Actions; here nothing is called, only rendered.
vi.mock("@/app/demo/actions", () => ({ startDemoAction: vi.fn(), leaveDemoAction: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

const server = vi.hoisted(() => ({ loadDemoChoices: vi.fn(), loadDemoBanner: vi.fn() }));
vi.mock("@/lib/demo-signin/server", () => server);
const supabase = vi.hoisted(() => ({ claims: null as null | { email?: string } }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: supabase.claims }, error: null }) } }),
}));

import DemoPage from "@/app/demo/page";
import { DemoBanner } from "@/components/demo-banner";
import { parseChoices } from "@/lib/demo-signin/rules";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const P = (n: number) => `5b3f1c7e-0d0c-4a8e-9a55-0f1d2c3b4a${String(n).padStart(2, "0")}`;
const choices = parseChoices({
  enabled: true,
  communities: [
    {
      kind: "faith",
      name: "Sunrise Jain Temple (Demo)",
      people: [
        { id: P(1), role: "Administrator", name: "Asha Test", story: "Runs the temple's office and sees everything." },
        { id: P(2), role: "Treasurer", name: "Tara Test", story: "Records payments and closes the month." },
        { id: P(3), role: "Member", name: "Mira Test", story: "Gives, registers for events and reads notices." },
      ],
    },
    {
      kind: "neutral",
      name: "Lakeside Neighbors Club (Demo)",
      people: [{ id: P(4), role: "Event lead", name: "Eli Test", story: "Plans the summer picnic." }],
    },
  ],
});

async function page(searchParams: Record<string, string> = {}) {
  return render(await DemoPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  supabase.claims = null;
  server.loadDemoChoices.mockReset().mockResolvedValue({ ok: true, choices });
  server.loadDemoBanner.mockReset().mockResolvedValue(null);
});

describe("the banner on every page of a demo session", () => {
  it("says where you are and who you are, with Switch role and Leave the demo", () => {
    const html = render(createElement(DemoBanner, { info: { role: "Treasurer", name: "Tara Test", centerName: "Sunrise", secondsLeft: 6120 } }));
    expect(html).toContain('data-testid="demo-banner"');
    expect(html).toContain("You are exploring a demo community as Treasurer");
    expect(html).toContain('href="/demo"');
    expect(html).toContain(">Switch role<");
    expect(html).toContain(">Leave the demo<");
    expect(html).toContain("1 h 42 min left");
  });

  it("still says it is a demo, and still offers the ways out, when the session could not be read", () => {
    const html = render(createElement(DemoBanner, { info: null }));
    expect(html).toContain("You are exploring a demo community");
    expect(html).not.toContain(" as ");
    expect(html).toContain(">Switch role<");
    expect(html).toContain(">Leave the demo<");
  });
});

describe("the demo page", () => {
  it("offers the two kinds of community and a card for each person of the chosen one, faith-based first", async () => {
    const html = await page();
    expect(html).toContain("Try the demo");
    expect(html).toContain("Faith-based");
    expect(html).toContain("Not faith-based");
    expect(html).toContain("Sunrise Jain Temple (Demo)");
    expect(html).toContain("Lakeside Neighbors Club (Demo)");
    for (const role of ["Administrator", "Treasurer", "Member"]) expect(html).toContain(role);
    expect(html).toContain("Runs the temple&#x27;s office and sees everything.");
    expect(html.match(/data-testid="demo-person"/g)).toHaveLength(3);
    expect(html.match(/>Start</g)).toHaveLength(3);
    expect(html).not.toContain("Eli Test");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('href="/demo?kind=neutral"');
  });

  it("shows the other community's people when it is chosen", async () => {
    const html = await page({ kind: "neutral" });
    expect(html.match(/data-testid="demo-person"/g)).toHaveLength(1);
    expect(html).toContain("Eli Test");
    expect(html).toContain("Event lead");
    expect(html).not.toContain("Asha Test");
  });

  it("falls back to the first community for a kind it does not have", async () => {
    const html = await page({ kind: "chamber" });
    expect(html).toContain("Asha Test");
  });

  it("sends the chosen person's id, never an address", async () => {
    const html = await page();
    expect(html).toContain(`name="persona" value="${P(1)}"`);
    expect(html).not.toContain("weaverams.org");
    expect(html).not.toContain("@");
  });

  it("says the demo is switched off, with no way to start", async () => {
    server.loadDemoChoices.mockResolvedValue({ ok: true, choices: { ...choices, enabled: false } });
    const html = await page();
    expect(html).toContain("The demo is switched off right now");
    expect(html).not.toContain('data-testid="demo-person"');
  });

  it("says it is not ready when nobody can be chosen", async () => {
    server.loadDemoChoices.mockResolvedValue({ ok: true, choices: { enabled: true, communities: [] } });
    const html = await page();
    expect(html).toContain("The demo is not ready yet");
    expect(html).not.toContain('data-testid="demo-person"');
  });

  it("shows a failure to load in words, with a way to try again, and no empty list", async () => {
    server.loadDemoChoices.mockResolvedValue({ ok: false, error: "Could not load the demo people — the database could not be reached." });
    const html = await page();
    expect(html).toContain("Could not load the demo");
    expect(html).toContain("the database could not be reached");
    expect(html).toContain('href="/demo"');
    expect(html).not.toContain('data-testid="demo-person"');
  });

  it("tells a person whose demo ended, and why", async () => {
    expect(await page({ ended: "expired" })).toContain("Your 2-hour demo has ended");
    expect(await page({ ended: "off" })).toContain("The demo was switched off");
    expect(await page({ ended: "nonsense" })).not.toContain("demo has ended");
  });

  it("warns someone signed in to a real account that starting the demo signs them out here", async () => {
    supabase.claims = { email: "ada@jsh.org" };
    const html = await page();
    expect(html).toContain("You are signed in as ada@jsh.org");
    expect(html).toContain("signs you out in this browser first");
  });

  it("tells someone already in a demo who they are, and offers to leave", async () => {
    supabase.claims = { email: "treasurer@demo.weaverams.org" };
    server.loadDemoBanner.mockResolvedValue({ role: "Treasurer", name: "Tara Test", centerName: "Sunrise", secondsLeft: 3000 });
    const html = await page();
    expect(html).toContain("You are in the demo as Tara Test, Treasurer");
    expect(html).toContain(">Leave the demo<");
    expect(html).not.toContain("You are signed in as");
  });

  it("does not treat an ended demo session as being in the demo", async () => {
    supabase.claims = { email: "treasurer@demo.weaverams.org" };
    server.loadDemoBanner.mockResolvedValue(null);
    const html = await page();
    expect(html).not.toContain("You are in the demo as");
    expect(html).not.toContain("You are signed in as");
  });
});

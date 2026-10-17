import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The "Ask for employers" screen (migration 0920), drawn once on the server: who is listed (the household as its card), how each can be reached,
// what the message says, what is left out, and that email not being set up is said before anything is clicked.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/giving/matching/ask",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = {
  permissions: ["matching.manage"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: undefined as unknown,
  db: {},
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago", currency: "USD" },
};
vi.mock("@/lib/session", () => ({ getSession: async () => session, loadSession: async () => ({ status: "ok", session }) }));
const answers = vi.hoisted(() => ({ ask: null as unknown, ready: { ok: true } as { ok: boolean; error?: string } }));
vi.mock("@/lib/matching/data", () => ({ ASK_PAGE: 50, loadAskList: async () => answers.ask }));
vi.mock("@/lib/matching/send-ready", () => ({ emailReadiness: async () => answers.ready }));

import AskPage from "@/app/(app)/giving/matching/ask/page";
import { parseAskList } from "@/lib/matching/ask";

const household = { id: "h1", name: "Mensah, Ama", number: "GC-H-0041", org_household_id: null, city: "Austin", zone: null, primary_member: "Ama Mensah", adults: [{ person_id: "p1", name: "Ama Mensah", is_primary: true }], merged: false };
const answer = (over: Record<string, unknown> = {}, rows: unknown[] = [{ person: { id: "p1", name: "Ama Mensah" }, household, email: true, app: false, last_asked: null }]) => ({
  ok: true,
  data: parseAskList({
    total: rows.length, rows, counts: { people: 8, to_ask: 6, email: 2, app: 1, nobody: 3, on_file: 1, withdrew: 1, recent: 2 }, today: "2026-10-17", sandbox: false, ...over,
  }),
});
const draw = async () => renderToStaticMarkup(await AskPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  session.permissions = ["matching.manage"];
  answers.ask = answer();
  answers.ready = { ok: true };
});

describe("Ask for employers", () => {
  it("lists a person with the household as its card, how they can be reached and that they were not asked yet", async () => {
    const html = await draw();
    expect(html).toContain("Ama Mensah");
    expect(html).toContain("Mensah, Ama");
    expect(html).toContain("GC-H-0041");
    expect(html).toContain("Email · Not asked yet");
    expect(html).toContain("Left out: 1 with an employer on file · 1 who withdrew it (never asked again) · 2 asked in the last 90 days.");
  });

  it("shows the owner's words, and nothing about an amount or a gift", async () => {
    const html = await draw();
    expect(html).toContain("You may be eligible to double the donation from your employer if you provide your employer information.");
    expect(html).toContain("It carries no amount and no gift");
    expect(html).not.toMatch(/\$\d/);
  });

  it("offers to ask everyone reachable, and each reachable person", async () => {
    const html = await draw();
    expect(html).toContain("Ask 3 people");
    expect(html).toContain(">Ask<");
  });

  it("says, before anything is clicked, that email is not set up", async () => {
    answers.ready = { ok: false, error: "Email sending is not set up on the Weaver server yet (it still needs the Resend API key), so nothing was sent or queued." };
    const html = await draw();
    expect(html).toContain("Email is not set up, so nothing can be asked yet");
    expect(html).toContain("Email sending is not set up on the Weaver server yet");
  });

  it("says a sandbox reaches only verified test recipients", async () => {
    answers.ask = answer({ sandbox: true });
    expect(await draw()).toContain("A sandbox messages only verified test recipients");
  });

  it("leaves out the button for a person nobody can reach", async () => {
    answers.ask = answer({}, [{ person: { id: "p9", name: "Zed Zorn" }, household, email: false, app: false, last_asked: "2026-07-03T15:00:00Z" }]);
    const html = await draw();
    expect(html).toContain("No email address or member app that can be written to");
    expect(html).toContain("Asked before, on 3 July 2026");
    expect(html).not.toContain('value="p9"');
  });

  it("is not for someone who cannot manage: the database's words, no list", async () => {
    session.permissions = ["matching.view"];
    const html = await draw();
    expect(html).toContain("You don&#x27;t have access to this area");
    expect(html).not.toContain("Ama Mensah");
  });

  it("shows a load error beside the page, with a way to retry", async () => {
    answers.ask = { ok: false, error: "Could not load the families to ask: the database could not be reached." };
    const html = await draw();
    expect(html).toContain("The families to ask could not be loaded");
    expect(html).toContain("Try again");
  });

  it("explains an empty list", async () => {
    answers.ask = answer({ counts: { people: 0, to_ask: 0, email: 0, app: 0, nobody: 0, on_file: 0, withdrew: 0, recent: 0 }, total: 0 }, []);
    expect(await draw()).toContain("No family has given in the last 24 months");
  });
});

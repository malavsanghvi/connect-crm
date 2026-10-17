import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// CatchTheMatch Phase 1's screens (0886-0888), drawn once on the server (the repo has no browser test environment): the members to catch, the
// claims, the record-a-match form, the library, and the card that carries the steps. The database decides who is let in and what a row says;
// these tests check what the portal does with the answer, in words.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/giving/matching/catch",
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
const answers = vi.hoisted(() => ({ catch: null as unknown, claims: null as unknown, person: null as unknown, library: null as unknown, process: null as unknown }));
vi.mock("@/lib/matching/data", () => ({
  CATCH_PAGE: 50,
  LIBRARY_PAGE: 50,
  loadCatchList: async () => answers.catch,
  loadClaimsList: async () => answers.claims,
  loadPersonGifts: async () => answers.person,
  loadProcessList: async () => answers.library,
  loadProcess: async () => answers.process,
}));

import CatchPage from "@/app/(app)/giving/matching/catch/page";
import ClaimsPage from "@/app/(app)/giving/matching/claims/page";
import RecordMatchPage from "@/app/(app)/giving/matching/claims/record/page";
import LibraryPage from "@/app/(app)/giving/matching/library/page";
import { ProcessCard } from "@/components/matching/process-card";
import { parseCatchList, parseClaimsList, parsePersonGifts, parseProcessAnswer, parseProcessList } from "@/lib/matching/catch";

const household = { id: "h1", name: "Bravo, Bo", number: "GC-H-0042", org_household_id: null, city: "Austin", zone: null, primary_member: "Bo Bravo", adults: [{ person_id: "p1", name: "Bo Bravo", is_primary: true }], merged: false };
const processJson = {
  summary: "The member requests the match in Benevity; staff verify it.", who_submits: "either",
  steps: ["Sign in to Benevity with your work email", "Find the organization by its legal name and tax ID"], documents: ["The receipt of the gift"],
  links: [{ label: "Acme's Benevity page", url: "https://acme.benevity.example/match" }], typical_days: 30, tips: "Ask within 30 days.",
  worked_on: "2026-09-01", worked_note: "Paid to a community in the spring", version: 2,
};
const answerJson = (over: Record<string, unknown> = {}) => ({
  program: { id: "g1", company_name: "Acme", portal: "benevity", portal_url: "https://acme.example/match", status: "active" },
  process: processJson, worked_communities: 2, here: { received: 1, last_on: "2026-09-30" }, ...over,
});
const catchRow = (over: Record<string, unknown> = {}) => ({
  person: { id: "p1", name: "Bo Bravo" }, household, employer: "Acme Corp",
  program: { id: "g1", company_name: "Acme", portal: "benevity", portal_url: "https://acme.example/match", deadline_note: null },
  proven: { received: 2, last_on: "2026-09-30" }, process: { who_submits: "either", version: 2 },
  gifts: [{ payment_id: "pay1", received_on: "2026-10-01", amount_cents: null, deadline_on: "2027-04-01", days_left: 166 }], ...over,
});
const catchAnswer = (over: Record<string, unknown> = {}, rows: unknown[] = [catchRow()]) => ({
  ok: true,
  data: parseCatchList({
    filter: "catchable", total: rows.length, rows, counts: { catchable: rows.length, missed: 1, open: 0, ended: 1 }, amounts: false, today: "2026-10-17",
    org: { name: "Grace Church", legal_name: "Grace Church of Austin, Inc.", ein: "12-3456789" }, can_manage: true, ...over,
  }),
});
const draw = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CatchPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  session.permissions = ["matching.manage"];
  session.isPlatformAdmin = false;
  answers.catch = catchAnswer();
  answers.process = { ok: true, data: parseProcessAnswer(answerJson()) };
});

describe("the members to catch", () => {
  it("lists a member: the household by its card, the employer, how many matches the program paid here, the gift and the time left", async () => {
    const html = await draw();
    expect(html).toContain("Bo Bravo");
    expect(html).toContain("Bravo, Bo");
    expect(html).toContain("GC-H-0042");
    expect(html).toContain("Works at Acme Corp");
    expect(html).toContain("Acme has matched gifts to us 2 times, the last on 30 September 2026");
    expect(html).toContain("Gift of 1 October 2026");
    expect(html).toContain("166 days left, until 1 April 2027");
    expect(html).toContain("To catch (1)");
    expect(html).toContain("Missed (1)");
  });

  it("carries the message to copy, with the steps from the library and the registered name, and says nothing of an amount", async () => {
    const html = await draw();
    expect(html).toContain("Message for the member");
    expect(html).toContain("Hello Bo,");
    expect(html).toContain("1. Sign in to Benevity with your work email");
    expect(html).toContain("Grace Church of Austin, Inc., tax ID 12-3456789");
    expect(html).not.toMatch(/\$\d/);
  });

  it("shows the amount only when the database sent one (a role that also sees giving)", async () => {
    answers.catch = catchAnswer({ amounts: true }, [catchRow({ gifts: [{ payment_id: "pay1", received_on: "2026-10-01", amount_cents: 12000, deadline_on: null, days_left: null }] })]);
    const html = await draw();
    expect(html).toContain("$120.00");
    expect(html).toContain("No deadline known");
  });

  it("offers a manager 'Mark as asked'; a viewer reads the list and is offered no write", async () => {
    expect(await draw()).toContain("Mark as asked");
    session.permissions = ["matching.view"];
    answers.catch = catchAnswer({ can_manage: false });
    const html = await draw();
    expect(html).toContain("Bo Bravo");
    expect(html).not.toContain("Mark as asked");
  });

  it("says when the library has no steps for the employer, and what the message then says", async () => {
    answers.catch = catchAnswer({}, [catchRow({ process: null })]);
    answers.process = { ok: true, data: parseProcessAnswer(answerJson({ process: null })) };
    const html = await draw();
    expect(html).toContain("The library has no steps for this employer yet");
    expect(html).toContain("Please ask Acme&#x27;s matching program");
  });

  it("keeps the list when the steps cannot be loaded, and says so", async () => {
    answers.process = { ok: false, error: "Could not load how to claim from this employer: the database could not be reached." };
    const html = await draw();
    expect(html).toContain("Bo Bravo");
    expect(html).toContain("Some steps could not be loaded");
  });

  it("explains an empty list when no employer has paid yet, pointing to where the first match is recorded", async () => {
    answers.catch = catchAnswer({ counts: { catchable: 0, missed: 0, open: 0, ended: 0 } }, []);
    const html = await draw();
    expect(html).toContain("No employer has paid a match here yet.");
    expect(html).toContain('href="/giving/matching/claims"');
    expect(html).toContain('href="/giving/matching/employers"');
  });

  it("keeps what was missed apart, with the deadline that passed, and offers no message for it", async () => {
    answers.catch = catchAnswer({ filter: "missed" }, [catchRow({ gifts: [{ payment_id: "pay3", received_on: "2025-12-01", amount_cents: null, deadline_on: "2026-06-20", days_left: -119 }] })]);
    const html = await draw({ show: "missed" });
    expect(html).toContain("The deadline was 119 days ago (20 June 2026)");
    expect(html).not.toContain("Message for the member");
    expect(html).not.toContain("Mark as asked");
  });

  it("says 'You don't have access to this area' to someone without CatchTheMatch and to a platform admin, never an empty list", async () => {
    session.permissions = ["people.view"];
    expect(await draw()).toContain("You don&#x27;t have access to this area");
    session.permissions = ["*"];
    session.isPlatformAdmin = true;
    const admin = await draw();
    expect(admin).toContain("You don&#x27;t have access to this area");
    expect(admin).not.toContain("Bo Bravo");
  });

  it("shows a failed read in words with a retry", async () => {
    answers.catch = { ok: false, error: "Could not load the members to catch: the database could not be reached." };
    const html = await draw();
    expect(html).toContain("The members to catch could not be loaded");
    expect(html).toContain("Try again");
  });
});

describe("the claims", () => {
  const claim = (state: string, over: Record<string, unknown> = {}) => ({
    id: "c1", state, state_at: "2026-10-10T10:00:00Z", received_on: state === "received" ? "2026-10-10" : null, note: "Asked at coffee", person: { id: "p1", name: "Bo Bravo" }, household,
    program: { id: "g1", company_name: "Acme", portal: null, portal_url: null }, gift: { payment_id: "pay1", received_on: "2026-09-01", amount_cents: null }, deadline_on: "2027-03-01", ...over,
  });
  const claims = (filter: string, rows: unknown[], over: Record<string, unknown> = {}) => ({
    ok: true, data: parseClaimsList({ filter, total: rows.length, rows, amounts: false, today: "2026-10-17", can_manage: true, ...over }),
  });
  const drawClaims = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await ClaimsPage({ searchParams: Promise.resolve(sp) }));

  it("lists an open claim with where it stands and the states it can move to", async () => {
    answers.claims = claims("open", [claim("asked")]);
    const html = await drawClaims();
    expect(html).toContain("Bo Bravo");
    expect(html).toContain("Asked");
    expect(html).toContain("Ask by 1 March 2027");
    expect(html).toContain("Asked at coffee");
    expect(html).toContain("The member asked their employer");
    expect(html).toContain("The match was paid to us");
    expect(html).not.toContain("Open it again");
  });

  it("says when a member was asked by message (with a reminder) and when the member reported they asked their employer", async () => {
    answers.claims = claims("open", [claim("asked", { asked_by_message_at: "2026-10-12T10:00:00Z" }), claim("requested", { id: "c2", requested_by_member_at: "2026-10-14T10:00:00Z" })]);
    const html = await drawClaims();
    expect(html).toContain("Asked by message on 12 October 2026");
    expect(html).toContain("Send a reminder");
    expect(html).toContain("The member says they asked their employer (14 October 2026)");
    answers.claims = claims("open", [claim("asked")]);
    const plain = await drawClaims();
    expect(plain).toContain("Send to the member");
    expect(plain).not.toContain("Asked by message");
    expect(plain).not.toContain("The member says they asked");
  });

  it("offers an ended claim only 'Open it again', and shows the day the match was received", async () => {
    answers.claims = claims("ended", [claim("received")]);
    const html = await drawClaims({ show: "ended" });
    expect(html).toContain("Match received");
    expect(html).toContain("Received 10 October 2026");
    expect(html).toContain("Open it again");
    expect(html).not.toContain("The employer declined");
  });

  it("offers a viewer no way to move a claim", async () => {
    session.permissions = ["matching.view"];
    answers.claims = claims("open", [claim("asked")], { can_manage: false });
    const html = await drawClaims();
    expect(html).toContain("Bo Bravo");
    expect(html).not.toContain("The member asked their employer");
  });

  it("says what an empty list means, and a failed read with a retry", async () => {
    answers.claims = claims("open", []);
    expect(await drawClaims()).toContain("No claim is open.");
    answers.claims = { ok: false, error: "Could not load the claims: the database could not be reached." };
    const html = await drawClaims();
    expect(html).toContain("The claims could not be loaded");
    expect(html).toContain("Try again");
  });
});

describe("recording a match somebody already got", () => {
  const person = (over: Record<string, unknown> = {}) => ({
    ok: true,
    data: parsePersonGifts({
      person: { id: "00000000-0000-4000-8000-000000000001", name: "Ana Alpha" }, household, program: { id: "g1", company_name: "Acme", portal: "benevity" }, amounts: false, today: "2026-10-17", can_manage: true,
      gifts: [{ payment_id: "pay1", received_on: "2026-08-01", amount_cents: null, claim: null }, { payment_id: "pay2", received_on: "2026-05-01", amount_cents: null, claim: { id: "c1", state: "asked" } }],
      ...over,
    }),
  });
  const drawRecord = async (sp: Record<string, string> = { person: "00000000-0000-4000-8000-000000000001" }) =>
    renderToStaticMarkup(await RecordMatchPage({ searchParams: Promise.resolve(sp) }));

  it("lists the gifts that have no claim, the choices of where it stands, and what already has one", async () => {
    answers.person = person();
    const html = await drawRecord();
    expect(html).toContain("Record a match for Ana Alpha");
    expect(html).toContain("Employer program:");
    expect(html).toContain("Gift of 1 August 2026");
    expect(html).toContain("Match received");
    expect(html).toContain("Gift of 1 May 2026: asked");
  });

  it("says to link the employer first when no program is confirmed", async () => {
    answers.person = person({ program: null });
    const html = await drawRecord();
    expect(html).toContain("Their employer is not linked to a program yet");
    expect(html).toContain('href="/giving/matching/employers"');
  });

  it("asks for a person first, and shows only a manager the form", async () => {
    expect(await drawRecord({})).toContain("Choose a person first");
    session.permissions = ["matching.view"];
    expect(await drawRecord()).toContain("You don&#x27;t have access to this area");
  });
});

describe("how to claim", () => {
  const library = (rows: unknown[]) => ({ ok: true, data: parseProcessList({ total: rows.length, rows }) });
  const drawLibrary = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await LibraryPage({ searchParams: Promise.resolve(sp) }));

  it("lists the employers that have steps, how it works and how many communities were paid through them", async () => {
    answers.library = library([{ id: "g1", company_name: "Acme", country: "US", portal: "benevity", who_submits: "either", summary: "Request it in Benevity.", version: 2, worked_on: "2026-09-01", worked_communities: 2 }]);
    const html = await drawLibrary();
    expect(html).toContain("Acme");
    expect(html).toContain("Request it in Benevity.");
    expect(html).toContain("Either the member or the organization can make the request");
    expect(html).toContain("Seen by Weaver&#x27;s team 1 September 2026");
    expect(html).toContain("2 communities paid through it");
  });

  it("says when there is nothing, and when a search finds nothing", async () => {
    answers.library = library([]);
    expect(await drawLibrary()).toContain("Weaver&#x27;s team has not written any steps yet.");
    expect(await drawLibrary({ q: "zzz" })).toContain("No employer with steps matches that name.");
  });

  it("shows a failed read in words", async () => {
    answers.library = { ok: false, error: "Could not load the how-to-claim library: the database could not be reached." };
    expect(await drawLibrary()).toContain("The library could not be loaded");
  });

  it("draws the steps, what to have ready, the link, the time and whether Weaver's team saw it work", () => {
    const html = renderToStaticMarkup(ProcessCard({ answer: parseProcessAnswer(answerJson()) }));
    expect(html).toContain("Sign in to Benevity with your work email");
    expect(html).toContain("Have ready:");
    expect(html).toContain('href="https://acme.benevity.example/match"');
    expect(html).toContain("It usually takes about 30 days.");
    expect(html).toContain("Weaver&#x27;s team saw it work on 1 September 2026: Paid to a community in the spring.");
    expect(html).toContain("2 communities have had a match paid through this program.");
    expect(html).toContain("Here: 1 match, the last on 30 September 2026.");
  });

  it("says plainly when Weaver's team has not written the steps yet", () => {
    const html = renderToStaticMarkup(ProcessCard({ answer: parseProcessAnswer(answerJson({ process: null })) }));
    expect(html).toContain("Weaver&#x27;s team has not written the steps for Acme yet.");
    expect(html).not.toContain("<ol");
  });
});

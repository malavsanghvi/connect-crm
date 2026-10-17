import { describe, expect, it } from "vitest";

import {
  CLAIM_STATES,
  buildMessage,
  claimMoves,
  deadlineLine,
  linksToText,
  parseCatchList,
  parseClaimsList,
  parseLinksText,
  parsePersonGifts,
  parseProcess,
  parseProcessAnswer,
  parseProcessList,
  processFromForm,
  provenLine,
  type Process,
} from "@/lib/matching/catch";

// CatchTheMatch Phase 1 (0886-0888): reading what the database returns, and the words. Pure.

const household = { id: "h1", name: "Mensah, Ama", number: "GC-H-0041", org_household_id: null, city: "Austin", zone: null, primary_member: "Ama Mensah", adults: [], merged: false };
const org = { name: "Grace Church", legalName: "Grace Church of Austin, Inc.", ein: "12-3456789" };
const process: Process = {
  summary: "The member requests the match in Benevity; staff verify it.",
  whoSubmits: "either",
  steps: ["Sign in to Benevity with your work email", "Find the organization by its legal name and tax ID", "Enter the gift date and amount"],
  documents: ["The receipt or bank line of the gift"],
  links: [{ label: "Acme's Benevity page", url: "https://acme.benevity.example/match" }],
  typicalDays: 30,
  tips: "Request it within 30 days of the gift.",
  workedOn: "2026-09-01",
  workedNote: "Paid to a community in the spring",
  version: 2,
  updatedAt: "2026-10-01T00:00:00Z",
};

describe("reading the catch list", () => {
  const list = parseCatchList({
    filter: "catchable", total: 1, amounts: false, today: "2026-10-17", can_manage: true,
    org: { name: "Grace Church", legal_name: "Grace Church of Austin, Inc.", ein: "12-3456789" },
    counts: { catchable: 1, missed: 2, open: 3, ended: 4 },
    rows: [{
      person: { id: "p1", name: "Bo Bravo" }, household, employer: "Acme Corp",
      program: { id: "g1", company_name: "Acme", portal: "benevity", portal_url: "https://acme.example/match", deadline_note: null },
      proven: { received: 2, last_on: "2026-09-30" }, process: { who_submits: "either", version: 2 },
      gifts: [{ payment_id: "pay1", received_on: "2026-10-01", amount_cents: null, deadline_on: "2027-04-01", days_left: 166 }],
    }],
  });

  it("reads every part, the household as the community knows it, and no amount", () => {
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({
      person: { id: "p1", name: "Bo Bravo" }, employer: "Acme Corp", provenReceived: 2, provenLastOn: "2026-09-30",
      program: { id: "g1", companyName: "Acme", portal: "benevity" }, process: { whoSubmits: "either", version: 2 },
    });
    expect(list.rows[0].household?.number).toBe("GC-H-0041");
    expect(list.rows[0].gifts[0]).toEqual({ paymentId: "pay1", receivedOn: "2026-10-01", amountCents: null, deadlineOn: "2027-04-01", daysLeft: 166 });
    expect(list.counts).toEqual({ catchable: 1, missed: 2, open: 3, ended: 4 });
    expect(list.org).toEqual(org);
    expect(list.canManage).toBe(true);
  });

  it("copes with an empty or odd answer without throwing", () => {
    const bare = parseCatchList({});
    expect(bare.rows).toEqual([]);
    expect(bare.filter).toBe("catchable");
    expect(bare.org.name).toBe("our organization");
    expect(parseCatchList(null).total).toBe(0);
  });
});

describe("reading the claims", () => {
  it("keeps the claims it understands and drops one with an unknown state", () => {
    const l = parseClaimsList({
      filter: "ended", total: 2, amounts: true, today: "2026-10-17", can_manage: false,
      rows: [
        { id: "c1", state: "received", state_at: "2026-10-01T10:00:00Z", received_on: "2026-10-01", note: "Paid", person: { id: "p1", name: "Ana Alpha" }, household,
          program: { id: "g1", company_name: "Acme", portal: null, portal_url: null }, gift: { payment_id: "pay1", received_on: "2026-08-01", amount_cents: 10000 }, deadline_on: "2027-02-01" },
        { id: "c2", state: "mystery", person: {}, program: {}, gift: {} },
      ],
    });
    expect(l.filter).toBe("ended");
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]).toMatchObject({ id: "c1", state: "received", receivedOn: "2026-10-01", gift: { amountCents: 10000 }, deadlineOn: "2027-02-01" });
  });

  it("reads a person's gifts, each with its claim", () => {
    const g = parsePersonGifts({
      person: { id: "p1", name: "Ana Alpha" }, household, program: { id: "g1", company_name: "Acme", portal: "benevity" }, amounts: false, today: "2026-10-17", can_manage: true,
      gifts: [{ payment_id: "a", received_on: "2026-08-01", amount_cents: null, claim: { id: "c1", state: "received" } }, { payment_id: "b", received_on: "2026-09-01", amount_cents: null, claim: null }],
    });
    expect(g.program?.companyName).toBe("Acme");
    expect(g.gifts[0].claim).toEqual({ id: "c1", state: "received" });
    expect(g.gifts[1].claim).toBeNull();
    expect(parsePersonGifts({}).program).toBeNull();
  });
});

describe("where a claim can go", () => {
  it("lets an open claim move to any other state but 'asked', and an ended one only be opened again", () => {
    expect(claimMoves("asked")).toEqual(["requested", "verified", "received", "declined", "expired", "withdrawn"]);
    expect(claimMoves("requested")).toEqual(["verified", "received", "declined", "expired", "withdrawn"]);
    for (const s of ["received", "declined", "expired", "withdrawn"] as const) expect(claimMoves(s)).toEqual(["asked"]);
    expect(CLAIM_STATES).toHaveLength(7);
  });
});

describe("the words", () => {
  it("says how many matches the program has paid here", () => {
    expect(provenLine("Acme", 1, null)).toBe("Acme has matched a gift to us once");
    expect(provenLine("Acme", 3, "2026-09-30")).toBe("Acme has matched gifts to us 3 times, the last on 30 September 2026");
  });

  it("says the time left to ask, in days and dates", () => {
    expect(deadlineLine({ deadlineOn: null, daysLeft: null })).toBe("No deadline known");
    expect(deadlineLine({ deadlineOn: "2026-10-17", daysLeft: 0 })).toBe("Last day to ask is today (17 October 2026)");
    expect(deadlineLine({ deadlineOn: "2026-10-18", daysLeft: 1 })).toBe("1 day left, until 18 October 2026");
    expect(deadlineLine({ deadlineOn: "2027-02-28", daysLeft: 134 })).toBe("134 days left, until 28 February 2027");
    expect(deadlineLine({ deadlineOn: "2026-10-16", daysLeft: -1 })).toBe("The deadline was yesterday (16 October 2026)");
    expect(deadlineLine({ deadlineOn: "2026-06-20", daysLeft: -119 })).toBe("The deadline was 119 days ago (20 June 2026)");
  });
});

describe("the message for a member", () => {
  const gifts = [{ receivedOn: "2026-10-01", deadlineOn: "2027-04-01" }];

  it("carries the steps, what to have ready, the dates, the registered name and tax ID, and the portal", () => {
    const m = buildMessage({ firstName: "Bo", employer: "Acme Corp", program: "Acme", org, portalUrl: "https://acme.example/match", process, gifts });
    expect(m).toContain("Hello Bo,");
    expect(m).toContain("Thank you for your gift to Grace Church.");
    expect(m).toContain("Acme Corp may match it");
    expect(m).toContain("Your gift of 1 October 2026 (ask by 1 April 2027)");
    expect(m).toContain("1. Sign in to Benevity with your work email");
    expect(m).toContain("3. Enter the gift date and amount");
    expect(m).toContain("Have ready: The receipt or bank line of the gift.");
    expect(m).toContain("It usually takes about 30 days.");
    expect(m).toContain("Where to ask: https://acme.example/match");
    expect(m).toContain("Please use our registered name and tax ID: Grace Church of Austin, Inc., tax ID 12-3456789.");
    expect(m).toContain("Either the member or the organization can make the request.");
  });

  it("never names an amount", () => {
    const m = buildMessage({ firstName: "Bo", employer: "Acme Corp", program: "Acme", org, portalUrl: null, process, gifts });
    expect(m).not.toMatch(/\$|cents|USD/);
  });

  it("without steps in the library, says to ask the employer's matching program and offers help", () => {
    const m = buildMessage({ firstName: "Bo", employer: "Acme Corp", program: "Acme", org: { name: "Grace Church", legalName: null, ein: null }, portalUrl: null, process: null, gifts });
    expect(m).toContain("Please ask Acme's matching program");
    expect(m).toContain("Please use our registered name: Grace Church.");
    expect(m).not.toContain("tax ID");
    expect(m).not.toContain("How:");
  });

  it("falls back to the first link of the library when the program has no portal address", () => {
    const m = buildMessage({ firstName: "Bo", employer: "", program: "Acme", org, portalUrl: null, process, gifts: [] });
    expect(m).toContain("Where to ask: https://acme.benevity.example/match");
    expect(m).toContain("Acme may match it");
    expect(m).not.toContain("Your gift of");
  });
});

describe("the library", () => {
  it("reads a process, its links, and the counts", () => {
    const p = parseProcess({
      summary: "How it works", who_submits: "organization", steps: ["One", "", "Two"], documents: ["Doc"], links: [{ label: "L", url: "https://x.example" }, { label: "no url" }],
      typical_days: 14, tips: "Tip", worked_on: "2026-09-01", worked_note: "Fine", version: 3, updated_at: "2026-10-01T00:00:00Z",
    });
    expect(p).toMatchObject({ whoSubmits: "organization", steps: ["One", "Two"], documents: ["Doc"], typicalDays: 14, workedOn: "2026-09-01", version: 3 });
    expect(p?.links).toEqual([{ label: "L", url: "https://x.example" }]);
    expect(parseProcess({ steps: ["a"] })).toBeNull();
    expect(parseProcess(null)).toBeNull();
    const a = parseProcessAnswer({ program: { id: "g1", company_name: "Acme" }, process: null, worked_communities: 2, here: { received: 1, last_on: "2026-09-30" } });
    expect(a).toMatchObject({ process: null, workedCommunities: 2, here: { received: 1, lastOn: "2026-09-30" } });
    expect(parseProcessAnswer({ program: {}, here: null }).here).toBeNull();
  });

  it("reads the list of programs that have steps", () => {
    const l = parseProcessList({ total: 1, rows: [{ id: "g1", company_name: "Acme", country: "US", portal: "benevity", who_submits: "member", summary: "S", version: 1, worked_communities: 2 }, { company_name: "no id" }] });
    expect(l.total).toBe(1);
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0]).toMatchObject({ companyName: "Acme", workedCommunities: 2, whoSubmits: "member" });
  });

  it("reads links as 'label | https://address' lines, and says plainly when a line is wrong", () => {
    expect(parseLinksText("Portal | https://a.example\n\nForm|https://b.example/form")).toEqual({
      ok: true, links: [{ label: "Portal", url: "https://a.example" }, { label: "Form", url: "https://b.example/form" }],
    });
    const bad = parseLinksText("https://no-label.example");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("label | https://address");
    expect(linksToText([{ label: "Portal", url: "https://a.example" }])).toBe("Portal | https://a.example");
  });

  it("reads the library form: steps and documents one per line, empty optional fields as nothing", () => {
    const fd = new FormData();
    fd.set("summary", "  It works  ");
    fd.set("who_submits", "either");
    fd.set("steps", "One\r\n\r\n  Two  \n");
    fd.set("documents", "");
    fd.set("links", "Portal | https://a.example");
    fd.set("typical_days", "");
    fd.set("worked_on", "2026-09-01");
    const r = processFromForm(fd);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.process).toMatchObject({ summary: "It works", who_submits: "either", steps: ["One", "Two"], documents: [], typical_days: null, tips: null, worked_on: "2026-09-01", worked_note: null });
      expect(r.process.links).toEqual([{ label: "Portal", url: "https://a.example" }]);
    }
    fd.set("links", "no pipe here");
    expect(processFromForm(fd).ok).toBe(false);
  });
});

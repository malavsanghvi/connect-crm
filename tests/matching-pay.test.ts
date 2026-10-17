import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseYearEndStatement } from "@/lib/giving";
import { parseClaimsList } from "@/lib/matching/catch";
import { MATCH_PAYMENT_EFFECTS, matchPaymentFromForm, matchRecordedMessage, parseClaimDetail } from "@/lib/matching/pay";

// CatchTheMatch Phase 1, piece 3 (migration 0925): the match arrives in Giving. The amount (integer cents), the Server Action (it must pass only what
// the screen asked for, and refuse in words), the screen that records it, and the claims list that says whether it was recorded. The database moves
// the money; these tests check what the portal sends and says.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/giving/matching/claims/pay",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const rpc = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({ allowed: true, detail: null as unknown, claims: null as unknown }));
const session = {
  permissions: ["matching.manage", "giving.record_offline"] as string[],
  isPlatformAdmin: false,
  modulesOff: [] as string[],
  kind: undefined as unknown,
  db: {},
  center: { id: "c1", name: "Grace Church", time_zone: "America/Chicago", currency: "USD" },
};
vi.mock("@/lib/session", () => ({
  getSession: async () => session,
  loadSession: async () => ({ status: "ok", session }),
  authorizeActionWhere: async (check: (s: unknown) => boolean) =>
    state.allowed && check({ permissions: ["matching.manage", "giving.record_offline"], isPlatformAdmin: false, modulesOff: [] })
      ? { ok: true, session: { center: { id: "c1", currency: "USD" }, requestId: "r1", clientApp: "portal" } }
      : { ok: false, error: "Could not record the match — you don't have permission (needs matching.manage and giving.record_offline)." },
  dbWithReason: async () => ({ rpc }),
}));
vi.mock("@/lib/matching/data", () => ({
  CATCH_PAGE: 50,
  loadMatchClaim: async () => state.detail,
  loadClaimsList: async () => state.claims,
  loadCatchList: async () => ({ ok: false, error: "not needed here" }),
}));

import { recordMatchPaymentAction } from "@/app/(app)/giving/matching/actions";
import ClaimsPage from "@/app/(app)/giving/matching/claims/page";
import PayPage from "@/app/(app)/giving/matching/claims/pay/page";

const CLAIM = "92500000-0000-4000-8000-00000000c0a1";
const household = { id: "h1", name: "Bravo, Bo", number: "GC-H-0042", org_household_id: null, city: "Austin", zone: null, primary_member: "Bo Bravo", adults: [], merged: false };
const claimJson = (over: Record<string, unknown> = {}) => ({
  id: CLAIM, state: "requested", state_at: "2026-10-10T10:00:00Z", received_on: null, note: null,
  person: { id: "p1", name: "Bo Bravo" }, household, program: { id: "g1", company_name: "Acme", portal: null, portal_url: null },
  gift: { payment_id: "pay1", received_on: "2026-09-01", amount_cents: null }, match: { recorded: false, payment_id: null, amount_cents: null },
  deadline_on: "2027-03-01", ...over,
});
const detail = (over: Record<string, unknown> = {}, claim: Record<string, unknown> = {}) => ({
  ok: true,
  data: parseClaimDetail({ claim: claimJson(claim), amounts: false, today: "2026-10-17", can_manage: true, can_record: true, ...over }),
});
const form = (over: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("claim_id", CLAIM);
  fd.set("donor_first_name", "Bo");
  fd.set("amount", "120.00");
  fd.set("received_on", "2026-10-16");
  for (const [k, v] of Object.entries(over)) fd.set(k, v);
  return fd;
};

describe("the amount", () => {
  const parse = (over: Record<string, string>) => matchPaymentFromForm(form(over));
  it("reads dollars and cents into integer cents", () => {
    expect(parse({ amount: "120.00" })).toEqual({ ok: true, input: { amountCents: 12000, receivedOn: "2026-10-16", note: null } });
    expect(parse({ amount: "1,200.5" })).toMatchObject({ ok: true, input: { amountCents: 120050 } });
    expect(parse({ amount: "$99" })).toMatchObject({ ok: true, input: { amountCents: 9900 } });
    expect(parse({ amount: "0.07" })).toMatchObject({ ok: true, input: { amountCents: 7 } });
  });
  it("refuses zero, a negative, a fraction of a cent and words, in words", () => {
    for (const bad of ["0", "0.00", "-5", "(5.00)", "1.234", "abc", "", "12 dollars"]) {
      const r = parse({ amount: bad });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toBe("Enter the amount the employer paid, for example 120.00.");
    }
  });
  it("checks the day's shape and the note's length", () => {
    expect(parse({ received_on: "17/10/2026" }).ok).toBe(false);
    expect(parse({ received_on: "" })).toMatchObject({ ok: true, input: { receivedOn: null } });
    expect(parse({ note: "x".repeat(201) }).ok).toBe(false);
  });
});

describe("the Record action", () => {
  beforeEach(() => {
    rpc.mockReset();
    state.allowed = true;
    session.permissions = ["matching.manage", "giving.record_offline"];
  });
  it("sends the claim, the whole cents, the day and the note, and says where the match went", async () => {
    rpc.mockResolvedValue({ data: { payment_id: "pay9" }, error: null });
    const r = await recordMatchPaymentAction(null, form({ note: "Batch 4410" }));
    expect(rpc).toHaveBeenCalledWith("record_match_payment", { p_center: "c1", p_claim: CLAIM, p_amount_cents: 12000, p_received_on: "2026-10-16", p_note: "Batch 4410" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.message).toBe(matchRecordedMessage("Bo", "$120.00"));
    expect(r.ok && r.message).toContain("no receipt goes to the donor");
  });
  it("does not call the database for a bad amount or claim", async () => {
    expect((await recordMatchPaymentAction(null, form({ amount: "abc" }))).ok).toBe(false);
    expect((await recordMatchPaymentAction(null, form({ claim_id: "nope" }))).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses someone without both permissions before the database is asked", async () => {
    state.allowed = false;
    const r = await recordMatchPaymentAction(null, form());
    expect(r.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows the database's plain sentence beside the button when it refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "That is more than ten times the gift it matches, which is far beyond any employer's match. Check the amount.", code: "22023" } });
    const r = await recordMatchPaymentAction(null, form({ amount: "9999.00" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Could not record the match — That is more than ten times the gift/);
  });
});

describe("the Record screen", () => {
  const draw = async (sp: Record<string, string> = { claim: CLAIM }) => renderToStaticMarkup(await PayPage({ searchParams: Promise.resolve(sp) }));
  beforeEach(() => {
    session.permissions = ["matching.manage", "giving.record_offline"];
    state.detail = detail();
  });
  it("says what recording does, in three plain sentences, and asks for the amount, the day and a note", async () => {
    const html = await draw();
    expect(html).toContain("Record the match for Bo Bravo");
    expect(html).toContain("Bravo, Bo");
    expect(html).toContain("GC-H-0042");
    for (const e of MATCH_PAYMENT_EFFECTS) expect(html).toContain(e.replace(/'/g, "&#x27;").replace(/›/g, "›"));
    expect(html).toContain("Amount the employer paid (USD)");
    expect(html).toContain("Day the money was received");
    expect(html).toContain("Record the match</button>");
  });
  it("shows the gift's amount only when the database sent one", async () => {
    expect(await draw()).not.toMatch(/\$\d/);
    state.detail = detail({ amounts: true }, { gift: { payment_id: "pay1", received_on: "2026-09-01", amount_cents: 20000 } });
    expect(await draw()).toContain("($200.00)");
  });
  it("offers no form when the match is already recorded, the claim ended, or the person can not record", async () => {
    state.detail = detail({ amounts: true }, { state: "received", match: { recorded: true, payment_id: "pay9", amount_cents: 20000 } });
    let html = await draw();
    expect(html).toContain("The match is already recorded in Giving");
    expect(html).toContain("$200.00 was recorded");
    expect(html).not.toContain("Record the match</button>");
    state.detail = detail({}, { state: "declined" });
    html = await draw();
    expect(html).toContain("This claim ended without a match");
    expect(html).not.toContain("Record the match</button>");
    state.detail = detail({ can_record: false });
    html = await draw();
    expect(html).toContain("You can not record this here");
    expect(html).not.toContain("Record the match</button>");
  });
  it("is for a manager only, and says so when the claim is not there or fails to load", async () => {
    session.permissions = ["matching.view"];
    expect(await draw()).toContain("You don&#x27;t have access to this area");
    session.permissions = ["matching.manage"];
    expect(await draw({ claim: "nope" })).toContain("That claim was not found");
    state.detail = { ok: false, error: "Could not load this claim: the database could not be reached." };
    const html = await draw();
    expect(html).toContain("The claim could not be loaded");
    expect(html).toContain("Try again");
  });
});

describe("the claims list and the statement", () => {
  const drawClaims = async () => renderToStaticMarkup(await ClaimsPage({ searchParams: Promise.resolve({}) }));
  const list = (rows: unknown[], over: Record<string, unknown> = {}) => ({
    ok: true, data: parseClaimsList({ filter: "open", total: rows.length, rows, amounts: false, today: "2026-10-17", can_manage: true, can_record: true, ...over }),
  });
  beforeEach(() => {
    session.permissions = ["matching.manage", "giving.record_offline"];
    session.modulesOff = [];
  });
  it("offers Record the match on an open claim, and nothing to move once the match is recorded", async () => {
    state.claims = list([claimJson()]);
    let html = await drawClaims();
    expect(html).toContain("Record the match");
    expect(html).toContain(`/giving/matching/claims/pay?claim=${CLAIM}`);
    state.claims = list([claimJson({ state: "received", received_on: "2026-10-16", match: { recorded: true, payment_id: "pay9", amount_cents: 20000 } })], { filter: "ended", amounts: true });
    html = await drawClaims();
    expect(html).toContain("Match recorded in Giving: $200.00");
    expect(html).not.toContain("Record the match");
    expect(html).not.toContain("Open it again");
  });
  it("shows no amount and no Record link to a manager without a giving permission, and a thank-you link only where DonorDelight is on", async () => {
    state.claims = list([claimJson({ state: "received", received_on: "2026-10-16", match: { recorded: true, payment_id: null, amount_cents: null } })], { can_record: false });
    let html = await drawClaims();
    expect(html).toContain("Match recorded in Giving");
    expect(html).not.toMatch(/\$\d/);
    expect(html).not.toContain("Record the match");
    expect(html).toContain("Thank the donor");
    session.modulesOff = ["care"];
    html = await drawClaims();
    expect(html).not.toContain("Thank the donor");
  });
  it("reads the employer's match off the donor's statement and keeps it out of the total", () => {
    const st = parseYearEndStatement({
      tax_year: 2026, gift_count: 2, total_cents: 23000, lines: [], left_out: { opening_balance_count: 0, opening_balance_cents: 0, reason: null },
      employer_matches: [{ payment_id: "p9", received_on: "2026-10-16", given_cents: 20000, employer: "Acme" }], employer_match_cents: 20000,
    });
    expect(st).toMatchObject({ total_cents: 23000, employer_match_cents: 20000, employer_match_count: 1 });
    expect(parseYearEndStatement({ tax_year: 2026, gift_count: 0, total_cents: 0 })).toMatchObject({ employer_match_cents: 0, employer_match_count: 0 });
  });
});

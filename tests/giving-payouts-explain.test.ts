import { beforeEach, describe, expect, it, vi } from "vitest";

// Explain and accept a card payout difference (slice 9): the words and checks the sheet shows, the row a pair found by date or
// accepted becomes, and the Server Actions (giving.manage; a reason when the amounts differ; the database decides the rest).

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/activity/with-activity", () => ({ withActivity: async (_key: string, action: () => Promise<unknown>) => action() }));
const rpc = vi.fn();
let allowed = true;
vi.mock("@/lib/session", () => ({
  authorizeAction: async (_key: string, doing: string) =>
    allowed ? { ok: true, session: { db: { rpc: (n: string, a: unknown) => rpc(n, a) } } } : { ok: false, error: `Could not ${doing} — you don't have permission (giving.manage).` },
}));

import { explainPayoutAction, unpairPayoutAction } from "@/app/(app)/giving/payments/bank/payout-actions";
import { pairPayouts, payoutRowView } from "@/lib/giving-bank/views";
import { acceptLabel, differenceSentence, explainProblem, reasonLabel } from "@/lib/giving-payouts/explain";
import { formatCents } from "@/lib/money";

const usd = (c: number) => formatCents(c, "USD", "en-US");
const eur = (c: number) => formatCents(c, "EUR", "en-IE");
const P = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ctx = { currency: "USD", locale: "en-US", timeZone: "America/Chicago", today: "2026-10-12" };

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { already: false, difference_cents: -200 }, error: null });
  allowed = true;
});

describe("the words", () => {
  it("name the difference on the button, in the community's currency", () => {
    expect(acceptLabel(-200, usd)).toBe("Accept the $2.00 difference");
    expect(acceptLabel(350, eur)).toBe("Accept the €3.50 difference");
    expect(acceptLabel(0, usd)).toBe("Pair them: the amounts agree");
    expect(differenceSentence(-200, usd)).toBe("The bank received $2.00 less than the payout.");
    expect(differenceSentence(350, usd)).toBe("The bank received $3.50 more than the payout.");
    expect(reasonLabel("bank_fee")).toBe("The bank charged a fee");
    expect(reasonLabel("nonsense")).toBeNull();
  });

  it("ask for a typed reason and a sentence only when the amounts differ", () => {
    expect(explainProblem(0, null, "")).toBeNull();
    expect(explainProblem(-200, null, "Fee")).toBe("Choose why the bank line and the payout differ.");
    expect(explainProblem(-200, "bank_fee", "  ")).toContain("Say in a sentence");
    expect(explainProblem(-200, "bank_fee", "Wire fee")).toBeNull();
  });
});

describe("the payout row", () => {
  const provider = { id: P, provider: "stripe", ref: "po_1", grossCents: 10_300, feeCents: 300, netCents: 10_000, arrivesOn: "2026-10-07" };
  const line = { id: B, postedOn: "2026-10-08", amountCents: 9_800, description: "STRIPE TRANSFER", payoutId: null };

  it("offers Explain and accept on a pair found by date, with the difference on the button", () => {
    const [pair] = pairPayouts([provider], [line]);
    const row = payoutRowView(pair, ctx);
    expect(row.explain).toEqual({ payoutId: P, bankLineId: B, differenceCents: -200, sentence: "The bank received $2.00 less than the payout.", button: "Accept the $2.00 difference" });
    expect(row.paired).toBeNull();
    expect(row.attention).toBe(true);
  });

  it("shows an accepted pair as paired, with its reason, no longer needing a look, and offers the undo", () => {
    const [pair] = pairPayouts([{ ...provider, matched: true, differenceCode: "bank_fee", differenceNote: "Incoming wire fee" }], [{ ...line, payoutId: P }]);
    const row = payoutRowView(pair, ctx);
    expect(row.explain).toBeNull();
    expect(row.paired).toEqual({ payoutId: P, reason: "The bank charged a fee", note: "Incoming wire fee" });
    expect(row.difference).toEqual({ text: "$2.00 less at the bank, explained", tone: "ok" });
    expect(row.how).toBe("Paired with this bank line.");
    expect(row.attention).toBe(false);
  });
});

describe("the Server Actions", () => {
  it("pair the payout through the database, passing the reason only with a difference", async () => {
    const res = await explainPayoutAction({ payoutId: P, bankLineId: B, differenceCents: -200, code: "bank_fee", note: " Incoming wire fee " });
    expect(res).toEqual({ ok: true, differenceCents: -200, already: false });
    expect(rpc).toHaveBeenCalledWith("explain_payout", { p_payout: P, p_bank_line: B, p_code: "bank_fee", p_note: "Incoming wire fee" });
  });

  it("refuse a difference without its reason before asking the database", async () => {
    const res = await explainPayoutAction({ payoutId: P, bankLineId: B, differenceCents: -200, code: null, note: "" });
    expect(res).toEqual({ ok: false, error: "Could not accept the difference — choose why the bank line and the payout differ." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("say the database's refusal next to the button (a locked month), and refuse without giving.manage", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "October 2026 is locked, so its card payouts cannot be paired." } });
    const res = await explainPayoutAction({ payoutId: P, bankLineId: B, differenceCents: 0, code: null, note: "" });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toContain("Could not pair the payout with the bank line");
    allowed = false;
    const refused = await unpairPayoutAction({ payoutId: P, reason: "Wrong line" });
    expect(refused).toEqual({ ok: false, error: "Could not undo the pairing — you don't have permission (giving.manage)." });
  });

  it("undo a pairing only with a reason", async () => {
    expect(await unpairPayoutAction({ payoutId: P, reason: "  " })).toEqual({ ok: false, error: "Could not undo the pairing — say why; the reason is kept in the audit log." });
    rpc.mockResolvedValue({ data: { already: false }, error: null });
    expect(await unpairPayoutAction({ payoutId: P, reason: "Paired with the wrong line" })).toEqual({ ok: true, already: false });
    expect(rpc).toHaveBeenCalledWith("unpair_payout", { p_payout: P, p_reason: "Paired with the wrong line" });
  });
});

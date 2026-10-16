import { describe, expect, it } from "vitest";

import {
  ageChip,
  approvePrimary,
  canShowInline,
  cardChips,
  decisionBlock,
  entryLabel,
  fileKind,
  filesLabel,
  householdLine,
  methodLabel,
  parseLookalikes,
  parseProofQueue,
  proofFlags,
  sentByLine,
  type CardCan,
  type ProofCard,
} from "@/lib/payment-proofs/queue";

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const date = (v: string) => v;
const flagCtx = { money, date };
const can: CardCan = { decide: true, approve: true, bank: true };

const raw = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  household_id: "22222222-2222-4222-8222-222222222222",
  status: "submitted",
  entry: "open_pledges",
  method: "check",
  amount_cents: 25000,
  paid_on: "2026-10-12",
  reference: "1048",
  note: null,
  created_at: "2026-10-12T15:00:00Z",
  age_days: 3,
  excess_cents: 0,
  covered: [{ pledge_id: "p1", pledge_number: "P-0587", title: "Harvest supper", amount_cents: 16000, pledge_amount_cents: 16000, state: "active" }],
  files: [{ id: "f1", storage_path: "c/h/p/a.jpg", content_type: "image/jpeg", bytes: 1200, removed: false }],
  events: [{ kind: "submitted", body: "Sent", created_at: "2026-10-12T15:00:00Z" }],
  household: {
    household_id: "22222222-2222-4222-8222-222222222222",
    household_name: "Okafor household",
    household_number: "H-1042",
    org_household_id: "2210",
    members: "Adaeze O., Chidi O.",
    zone: "Eastside",
    city: "Riverbend",
    last_gift_on: null,
    open_pledge_cents: 31000,
  },
  lookalikes: [],
  same_file: false,
  bank_lines: [],
  needs_second: false,
  first_approved: false,
  first_approved_by_me: false,
  own_household: false,
  stale: false,
  ...over,
});

const card = (over: Record<string, unknown> = {}): ProofCard => {
  const cards = parseProofQueue([raw(over)]);
  if (!cards || cards.length !== 1) throw new Error("card did not parse");
  return cards[0];
};

describe("reading the queue", () => {
  it("reads a card with its household, files, pledges and money in integer cents", () => {
    const c = card();
    expect(c.amountCents).toBe(25000);
    expect(c.household?.household_number).toBe("H-1042");
    expect(c.covered).toEqual([{ pledgeId: "p1", number: "P-0587", title: "Harvest supper", coverCents: 16000, pledgeCents: 16000 }]);
    expect(c.files[0]).toMatchObject({ kind: "image", url: null, removed: false });
    expect(c.status).toBe("submitted");
  });

  it("reads who sent the proof, and tolerates an answer that has no sender", () => {
    // raw() has no sent_by key at all: the shape the database sent before 0873.
    expect(card().sentBy).toBeNull();
    expect(sentByLine(card())).toBeNull();
    expect(card({ sent_by: "Mina Rao" }).sentBy).toBe("Mina Rao");
    expect(sentByLine(card({ sent_by: "Mina Rao" }))).toBe("Sent by Mina Rao");
    expect(card({ sent_by: null }).sentBy).toBeNull();
    expect(card({ sent_by: "   " }).sentBy).toBeNull();
    expect(card({ sent_by: 7 }).sentBy).toBeNull();
  });

  it("treats no answer as an empty queue and anything that is not a list as unreadable", () => {
    expect(parseProofQueue(null)).toEqual([]);
    expect(parseProofQueue([])).toEqual([]);
    expect(parseProofQueue({ nope: true })).toBeNull();
    expect(parseProofQueue("x")).toBeNull();
  });

  it("drops a card that has no id, household or method rather than inventing one", () => {
    expect(parseProofQueue([raw({ id: null }), raw({ household_id: "" }), raw({ method: null }), raw()])).toHaveLength(1);
  });

  it("ignores soft credits that are no longer active, and files without a path", () => {
    const c = card({
      covered: [
        { pledge_id: "p1", amount_cents: 100, pledge_amount_cents: 100, state: "released" },
        { pledge_id: "p2", amount_cents: 200, pledge_amount_cents: 300, state: "active" },
      ],
      files: [{ id: "f1" }, { id: "f2", storage_path: "x.pdf", content_type: "application/pdf", bytes: 5, removed: false }],
    });
    expect(c.covered.map((p) => p.pledgeId)).toEqual(["p2"]);
    expect(c.files.map((f) => f.kind)).toEqual(["pdf"]);
  });

  it("keeps a household that could not be read as null so the screen can refuse to decide", () => {
    expect(card({ household: null }).household).toBeNull();
    expect(householdLine(null, "Org household")).toBe("Household not found");
  });

  it("parses the lookalikes the database sends, skipping what it cannot read", () => {
    expect(parseLookalikes([{ kind: "payment", id: "a", label: "Receipt R-1", certain: true }, { kind: "weird", id: "b" }, { kind: "proof", id: "c" }])).toEqual([
      { kind: "payment", id: "a", label: "Receipt R-1", certain: true },
      { kind: "proof", id: "c", label: "A similar payment", certain: false },
    ]);
    expect(parseLookalikes(null)).toEqual([]);
  });
});

describe("wording", () => {
  it("never shows a household by name alone", () => {
    const c = card();
    expect(householdLine(c.household, "Org household")).toBe("H-1042 · Org household 2210");
    expect(householdLine({ ...c.household!, household_number: null, org_household_id: null }, "Org household")).toBe("no household number · Org household —");
  });

  it("names methods, entry points and file kinds in plain words", () => {
    expect(methodLabel("ach")).toBe("Bank transfer (ACH)");
    expect(methodLabel("matching_gift")).toBe("Matching gift");
    expect(methodLabel("brand_new")).toBe("Brand new");
    expect(entryLabel("rsvp")).toBe("An event RSVP");
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("image/heic")).toBe("image");
    expect(canShowInline("image/heic")).toBe(false);
    expect(canShowInline("image/png")).toBe(true);
    expect(filesLabel([{ removed: true }, { removed: false }] as never)).toBe("1 file");
  });

  it("lights the age chip at 3, 7 and 14 days", () => {
    expect(ageChip(0)).toEqual({ label: "Today", tone: "plain" });
    expect(ageChip(2).tone).toBe("plain");
    expect(ageChip(3)).toEqual({ label: "3 days", tone: "soft" });
    expect(ageChip(7).tone).toBe("warn");
    expect(ageChip(14).tone).toBe("bad");
    expect(ageChip(1).label).toBe("1 day");
  });
});

describe("what the system checked", () => {
  it("says clear when there is nothing to worry about", () => {
    expect(proofFlags(card(), flagCtx).map((x) => x.key)).toEqual(["clear"]);
  });

  it("flags a lookalike payment, the same file, and a waiting bank line", () => {
    const c = card({
      lookalikes: [{ kind: "payment", id: "pay1", label: "Receipt R-2291, check, Oct 6", certain: true }],
      same_file: true,
      bank_lines: [{ id: "b1", posted_on: "2026-10-14", description: "CHECK 1048" }],
    });
    const f = proofFlags(c, flagCtx);
    expect(f.map((x) => x.key)).toEqual(["look:pay1", "same_file", "bank:b1"]);
    expect(f[0]).toMatchObject({ tone: "bad", tag: "Possible duplicate:" });
    expect(f[0].text).toContain("same check number or reference");
    expect(f[2].text).toContain("2026-10-14");
    expect(cardChips(c).map((x) => x.label)).toEqual(["Possible duplicate", "Same file as before", "Bank line waiting"]);
  });

  it("says plainly when two people are needed and who has approved", () => {
    expect(proofFlags(card({ needs_second: true }), flagCtx)[0].text).toContain("second person");
    expect(proofFlags(card({ needs_second: true, first_approved: true, first_approved_by_me: true }), flagCtx)[0].text).toContain("you gave the first approval");
    expect(proofFlags(card({ needs_second: true, first_approved: true }), flagCtx)[0].text).toContain("first approval is in");
  });

  it("notes cash, an uncovered proof and money sent beyond the pledges", () => {
    const f = proofFlags(card({ method: "cash", covered: [], excess_cents: 5000 }), flagCtx);
    expect(f.map((x) => x.key)).toEqual(["no_pledge", "excess", "cash", "clear"]);
    expect(f[1].text).toContain("$50.00");
  });

  it("marks your own household and a stale question", () => {
    expect(proofFlags(card({ own_household: true }), flagCtx)[0]).toMatchObject({ key: "own", tone: "bad" });
    const stale = card({ status: "needs_info", stale: true, question: "A clearer photo?" });
    expect(proofFlags(stale, flagCtx).some((x) => x.key === "stale")).toBe(true);
    expect(cardChips(stale)[0].label).toBe("No reply, back in queue");
  });
});

describe("the Approve button", () => {
  it("is a plain Approve, or Approve and reconcile when a bank line waits", () => {
    expect(approvePrimary(card(), can)).toMatchObject({ label: "Approve", disabled: false, reconcile: false });
    const withBank = card({ bank_lines: [{ id: "b1", posted_on: "2026-10-14", description: "" }] });
    expect(approvePrimary(withBank, can)).toMatchObject({ label: "Approve and reconcile", reconcile: true });
    // Without the permission to confirm bank matches, or with Bank reconciliation off, the bank line is not offered.
    expect(approvePrimary(withBank, { ...can, bank: false })).toMatchObject({ label: "Approve", reconcile: false });
  });

  it("is off for your own household and without the permission to decide", () => {
    expect(approvePrimary(card({ own_household: true }), can)).toMatchObject({ disabled: true });
    expect(decisionBlock(card({ own_household: true }), can)).toContain("own household");
    expect(approvePrimary(card(), { ...can, decide: false })).toMatchObject({ disabled: true });
    expect(decisionBlock(card(), { ...can, decide: false })).toContain("permission");
    expect(decisionBlock(card(), can)).toBeNull();
  });

  it("walks the two-person rule: first, then a different person with approval rights", () => {
    expect(approvePrimary(card({ needs_second: true }), can)).toMatchObject({ label: "Approve (first of two)", disabled: false });
    expect(approvePrimary(card({ needs_second: true, first_approved: true, first_approved_by_me: true }), can)).toMatchObject({ disabled: true });
    expect(approvePrimary(card({ needs_second: true, first_approved: true }), can)).toMatchObject({ label: "Approve (second of two)", disabled: false });
    expect(approvePrimary(card({ needs_second: true, first_approved: true }), { ...can, approve: false })).toMatchObject({ disabled: true });
    const bank = card({ needs_second: true, first_approved: true, bank_lines: [{ id: "b", posted_on: "", description: "" }] });
    expect(approvePrimary(bank, can).label).toBe("Approve and reconcile (second of two)");
  });
});

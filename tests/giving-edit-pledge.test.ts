import { describe, expect, it } from "vitest";

import {
  checkEditChanges,
  checkEditReason,
  checkPledgeId,
  deleteButtonLabel,
  deletedMessage,
  designationOf,
  diffPledgeEdit,
  editButtonLabel,
  editedMessage,
  formFromState,
  type PledgeEditState,
} from "@/lib/giving-actions/edit-pledge";

// Edit and delete a pledge (migration 0782): the pure checks and sentences. The database decides again (test 182).

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const TODAY = "2026-10-13";
const ID = "18200000-0000-4000-8000-000000000301";
const CAMP = "18200000-0000-4000-8000-000000000501";
const FUND = "18200000-0000-4000-8000-000000000401";
const ADULT = "18200000-0000-4000-8000-000000000101";

const NONE = { details: null, due: null, amount: null, for: null, delete: null, qbo: null };

const state = (over: Partial<PledgeEditState> = {}): PledgeEditState => ({
  pledgeId: ID,
  pledgeNumber: "PL-0455",
  householdId: "18200000-0000-4000-8000-000000000201",
  status: "open",
  source: "general",
  amountCents: 50_000,
  paidCents: 0,
  dueOn: "2026-11-12",
  pledgedOn: "2026-10-13",
  campaignId: null,
  fundId: null,
  opportunityId: null,
  dedication: null,
  recognitionName: null,
  anonymous: false,
  pledgedByPersonId: null,
  locks: NONE,
  ...over,
});

describe("what the sheet starts with", () => {
  it("shows the pledge as it is, and a campaign stands for its fund", () => {
    const f = formFromState(state({ campaignId: CAMP, fundId: FUND, dedication: "In memory of Ba", pledgedByPersonId: ADULT }));
    expect(f).toEqual({ amount: "500.00", dueOn: "2026-11-12", designation: `campaign:${CAMP}`, dedication: "In memory of Ba", recognitionName: "", anonymous: false, pledgedBy: ADULT });
    expect(designationOf(state({ fundId: FUND }))).toBe(`fund:${FUND}`);
    expect(designationOf(state())).toBe("");
  });

  it("changes nothing when nothing was touched", () => {
    const s = state({ campaignId: CAMP, dedication: "x" });
    const d = diffPledgeEdit(s, formFromState(s), TODAY, money);
    expect(d).toEqual({ ok: true, value: { changes: {}, fields: [] } });
  });
});

describe("what the person changed", () => {
  it("sends only the keys that changed, with the words for the button", () => {
    const s = state();
    const d = diffPledgeEdit(s, { ...formFromState(s), amount: "750.00", dueOn: "2026-12-31", dedication: " For Ba ", anonymous: true }, TODAY, money);
    expect(d).toEqual({
      ok: true,
      value: { changes: { amount_cents: 75_000, due_on: "2026-12-31", dedication: "For Ba", anonymous: true }, fields: ["amount", "due date", "dedication", "anonymous"] },
    });
  });

  it("clears a dedication and the adult who pledged with null", () => {
    const s = state({ dedication: "x", recognitionName: "The Shahs", pledgedByPersonId: ADULT });
    const d = diffPledgeEdit(s, { ...formFromState(s), dedication: "  ", recognitionName: "", pledgedBy: "" }, TODAY, money);
    expect(d).toEqual({
      ok: true,
      value: { changes: { dedication: null, recognition_name: null, pledged_by_person_id: null }, fields: ["dedication", "recognition name", "who pledged"] },
    });
  });

  it("sends both campaign and fund, so the fund follows the campaign and nothing stale stays", () => {
    const s = state({ campaignId: CAMP, fundId: FUND });
    expect(diffPledgeEdit(s, { ...formFromState(s), designation: `fund:${FUND}` }, TODAY, money)).toMatchObject({
      ok: true,
      value: { changes: { campaign_id: null, fund_id: FUND }, fields: ["what it is for"] },
    });
    expect(diffPledgeEdit(s, { ...formFromState(s), designation: "" }, TODAY, money)).toMatchObject({ ok: true, value: { changes: { campaign_id: null, fund_id: null } } });
    expect(diffPledgeEdit(state(), { ...formFromState(state()), designation: `campaign:${CAMP}` }, TODAY, money)).toMatchObject({
      ok: true,
      value: { changes: { campaign_id: CAMP, fund_id: null } },
    });
    // The same campaign again is not a change, even though its fund is also stored.
    expect(diffPledgeEdit(s, { ...formFromState(s), designation: `campaign:${CAMP}` }, TODAY, money)).toMatchObject({ ok: true, value: { fields: [] } });
  });

  it("refuses what the database would refuse, in plain words", () => {
    const s = state({ paidCents: 20_000 });
    const f = formFromState(s);
    const err = (over: Partial<typeof f>) => {
      const d = diffPledgeEdit(s, { ...f, ...over }, TODAY, money);
      return d.ok ? null : d.error;
    };
    expect(err({ amount: "100.00" })).toBe("The amount cannot be less than $200.00, which is already paid. To close the pledge early, write off what is still open.");
    expect(err({ amount: "" })).toBe("Enter the pledge amount, like 500.00.");
    expect(err({ amount: "0" })).toBe("Enter the pledge amount, like 500.00.");
    expect(err({ amount: "9999999999999.00" })).toBe("That amount is too large. Check it and try again.");
    expect(err({ dueOn: "" })).toBe("Choose the due date.");
    expect(err({ dueOn: "2026-02-30" })).toBe("Enter the due date as a date, like 2026-12-31.");
    expect(err({ dueOn: "2026-10-12" })).toBe("The due date cannot be before the day it was pledged.");
    expect(err({ dueOn: "2046-10-13" })).toBe("The due date must be within ten years of today.");
    expect(err({ dedication: "x".repeat(201) })).toBe("Keep the dedication to 200 characters or fewer.");
    expect(err({ recognitionName: "x".repeat(121) })).toBe("Keep the recognition name to 120 characters or fewer.");
    expect(err({ designation: "nonsense" })).toBe("Choose what the pledge is for again: that choice was not understood.");
    expect(err({ designation: `opportunity:${CAMP}` })).toBe("Choose what the pledge is for again: that choice was not understood.");
    expect(err({ pledgedBy: "not-an-id" })).toBe("Choose the adult who pledged again: that choice was not understood.");
  });

  it("accepts an amount equal to what is paid (it closes the pledge)", () => {
    const s = state({ paidCents: 20_000 });
    expect(diffPledgeEdit(s, { ...formFromState(s), amount: "200.00" }, TODAY, money)).toMatchObject({ ok: true, value: { changes: { amount_cents: 20_000 } } });
  });

  it("does not look at a field the database locked", () => {
    const s = state({ locks: { ...NONE, amount: "PL-0455 is in QuickBooks.", for: "PL-0455 is in QuickBooks.", due: "A write-off is waiting." } });
    const d = diffPledgeEdit(s, { ...formFromState(s), amount: "1.00", dueOn: "2030-01-01", designation: `campaign:${CAMP}`, dedication: "Thanks" }, TODAY, money);
    expect(d).toEqual({ ok: true, value: { changes: { dedication: "Thanks" }, fields: ["dedication"] } });
  });

  it("a deleted pledge allows nothing, an opportunity pledge keeps what it is for", () => {
    const gone = state({ status: "cancelled", locks: { details: "PL-0455 was deleted (cancelled), so it cannot change.", due: "x", amount: "x", for: "x", delete: "x", qbo: null } });
    expect(diffPledgeEdit(gone, { ...formFromState(gone), dedication: "Thanks", anonymous: true, pledgedBy: ADULT }, TODAY, money)).toEqual({
      ok: true,
      value: { changes: {}, fields: [] },
    });
    const opp = state({ opportunityId: CAMP });
    expect(diffPledgeEdit(opp, { ...formFromState(opp), designation: `fund:${FUND}` }, TODAY, money)).toEqual({ ok: true, value: { changes: {}, fields: [] } });
  });
});

describe("what the server accepts", () => {
  it("normalises a good request", () => {
    expect(
      checkEditChanges({ amount_cents: 75_000, due_on: "2026-12-31", campaign_id: CAMP.toUpperCase(), fund_id: null, dedication: " Thanks ", recognition_name: "", anonymous: true, pledged_by_person_id: null }),
    ).toEqual({
      ok: true,
      value: { amount_cents: 75_000, due_on: "2026-12-31", campaign_id: CAMP, fund_id: null, dedication: "Thanks", recognition_name: null, anonymous: true, pledged_by_person_id: null },
    });
  });

  it("refuses what was not asked for or cannot be right", () => {
    const err = (v: unknown) => {
      const c = checkEditChanges(v);
      return c.ok ? null : c.error;
    };
    expect(err(null)).toBe("Change at least one thing, or close the sheet.");
    expect(err({})).toBe("Change at least one thing, or close the sheet.");
    expect(err({ status: "paid" })).toBe("Something on the sheet was not understood. Close it and open it again.");
    expect(err({ amount_cents: 12.5 })).toBe("Enter the pledge amount, like 500.00.");
    expect(err({ amount_cents: -5 })).toBe("Enter the pledge amount, like 500.00.");
    expect(err({ amount_cents: "500" })).toBe("Enter the pledge amount, like 500.00.");
    expect(err({ due_on: "2026-02-30" })).toBe("Enter the due date as a date, like 2026-12-31.");
    expect(err({ campaign_id: "x" })).toBe("A choice on the sheet was not understood. Close it and open it again.");
    expect(err({ anonymous: "yes" })).toBe("Anonymous is yes or no.");
    expect(err({ dedication: 5 })).toBe("The dedication was not understood.");
  });

  it("wants a reason of three letters to five hundred, and a real pledge id", () => {
    expect(checkEditReason("  Entered wrongly ")).toEqual({ ok: true, value: "Entered wrongly" });
    expect(checkEditReason("no").ok).toBe(false);
    expect(checkEditReason(undefined).ok).toBe(false);
    expect(checkEditReason("x".repeat(501))).toEqual({ ok: false, error: "Keep the reason to 500 characters or fewer." });
    expect(checkEditReason("", "Say why it is deleted.")).toEqual({ ok: false, error: "Say why it is deleted." });
    expect(checkPledgeId(ID.toUpperCase())).toEqual({ ok: true, value: ID });
    expect(checkPledgeId("nope")).toEqual({ ok: false, error: "Open the pledge again: it was not found." });
  });
});

describe("the sentences", () => {
  it("names the pledge and what changes on the button", () => {
    expect(editButtonLabel("PL-0455", [])).toBe("Change something to save");
    expect(editButtonLabel("PL-0455", ["amount"])).toBe("Save amount on PL-0455");
    expect(editButtonLabel("PL-0455", ["amount", "due date", "dedication"])).toBe("Save amount, due date and dedication on PL-0455");
    expect(editButtonLabel(null, ["amount", "due date"])).toBe("Save amount and due date");
  });

  it("says what was done only from what the server said", () => {
    expect(editedMessage({ pledgeNumber: "PL-0455", changed: true, fields: ["amount", "due date"] })).toBe("PL-0455 updated: amount, due date.");
    expect(editedMessage({ pledgeNumber: null, changed: false, fields: [] })).toBe("The pledge already had these details. Nothing changed.");
    expect(deletedMessage({ pledgeNumber: "PL-0455" })).toBe("PL-0455 is deleted. It stays in the family's History as Cancelled.");
    expect(deleteButtonLabel("PL-0455", 50_000, "USD", "en-US")).toBe("Delete PL-0455 ($500.00)");
  });
});

// The platform team's Chip In and card-fee Server Actions and the reads behind their screens (docs/PAYMENT_ADDONS.md §11.2): who may use
// them, what they send to the database (integer cents, a reason), the rule that the switch cannot be turned on before a limit and a
// suggestion are saved, and the plain sentence for every way a save can fail.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ loadSession: vi.fn(), dbWithReason: vi.fn(), getSession: vi.fn() }));
vi.mock("@/app/security-actions", () => ({ verifyStepUpAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { revalidatePath } from "next/cache";

import { saveChipInAction } from "@/app/(app)/platform/centers/[id]/actions";
import { addFeeRateAction } from "@/app/(app)/platform/payments/actions";
import { loadChipInCard, loadPlatformFeeRates } from "@/lib/data/chip-in-platform";
import { TURN_ON_BLOCKED } from "@/lib/payments/chip-in-platform";
import { UNEXPECTED_SHAPE } from "@/lib/payments/plugins/view";
import { dbWithReason, loadSession } from "@/lib/session";

import { fakeDb, fakeSession } from "./commands/helpers";

const CENTER = "7d0f3b9a-6a39-4d0c-9f43-0a1a1d7c1150";
const ADMIN = "11111111-aaaa-4aaa-8aaa-000000000001";

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  return fd;
}

const SAVED_JSH = { center_id: CENTER, asking: false, yearly_limit_cents: 5000, suggested_cents: [200, 500, 1000], reason: "Owner decision", updated_by: null, updated_at: "2026-10-15T12:00:00Z" };
const NOTHING_SAVED = { center_id: CENTER, asking: false, yearly_limit_cents: null, suggested_cents: [], reason: "Started", updated_by: ADMIN, updated_at: "2026-10-15T12:00:00Z" };

const save = { center: CENTER, limit: "50", suggestion: ["2", "5", "10", ""], reason: "Pilot with the chamber" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(revalidatePath).mockReset();
  vi.mocked(dbWithReason).mockReset();
  vi.mocked(loadSession).mockReset();
});

describe("saveChipInAction", () => {
  const rpc = vi.fn();
  function as(over: { admin?: boolean; saved?: Record<string, unknown>[]; failSaved?: boolean } = {}) {
    rpc.mockReset();
    const db = fakeDb({ tables: { chip_in_settings: over.saved ?? [] }, failTables: over.failSaved ? { chip_in_settings: { code: "XX000", message: "boom" } } : undefined });
    vi.mocked(loadSession).mockResolvedValue({ status: "ok", session: fakeSession({ db, isPlatformAdmin: over.admin ?? true, userId: ADMIN }) } as never);
    vi.mocked(dbWithReason).mockResolvedValue({ rpc } as never);
    return db;
  }

  it("is for the Weaver team only, and asks the database nothing otherwise", async () => {
    as({ admin: false });
    expect(await saveChipInAction(null, form(save))).toEqual({ ok: false, error: "Could not save the Chip In settings — only the Weaver team (platform admins) can do this." });
    expect(rpc).not.toHaveBeenCalled();
    expect(dbWithReason).not.toHaveBeenCalled();
    vi.mocked(loadSession).mockResolvedValue({ status: "signed_out" } as never);
    expect(await saveChipInAction(null, form(save))).toEqual({ ok: false, error: "Could not save the Chip In settings — your session has expired. Sign in again." });
    vi.mocked(loadSession).mockResolvedValue({ status: "env_missing" } as never);
    expect(await saveChipInAction(null, form(save))).toMatchObject({ ok: false, error: expect.stringMatching(/the app could not load your session/) });
  });

  it("refuses an out-of-date form and a missing or over-long reason, in plain words", async () => {
    as();
    expect(await saveChipInAction(null, form({ ...save, center: "not-a-community" }))).toEqual({ ok: false, error: "Could not save the Chip In settings — the form is out of date. Reload and try again." });
    expect(await saveChipInAction(null, form({ ...save, reason: "   " }))).toEqual({ ok: false, error: "Could not save the Chip In settings — say why. The reason is kept in the audit log." });
    expect(await saveChipInAction(null, form({ ...save, reason: "x".repeat(501) }))).toEqual({ ok: false, error: "Could not save the Chip In settings — keep the reason under 500 characters." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("explains a mistyped amount before sending anything", async () => {
    as();
    const say = async (over: Record<string, string | string[]>) => (await saveChipInAction(null, form({ ...save, ...over }))) as { ok: false; error: string };
    expect((await say({ limit: "5000" })).error).toBe("Could not save the Chip In settings — The yearly limit per account is between $1.00 and $1,000.00.");
    expect((await say({ limit: "lots" })).error).toBe("Could not save the Chip In settings — Enter the yearly limit as dollars, for example 50 or 50.00.");
    expect((await say({ suggestion: ["10", "5"] })).error).toBe("Could not save the Chip In settings — List the suggested amounts from the smallest to the largest, each different.");
    expect((await say({ suggestion: ["75"] })).error).toBe("Could not save the Chip In settings — A suggested amount cannot be more than the yearly limit.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends dollars as integer cents with the reason, and says what was saved", async () => {
    as({ saved: [SAVED_JSH] });
    rpc.mockResolvedValue({ data: { center_id: CENTER, changed: true, asking: false, yearly_limit_cents: 5000, suggested_cents: [200, 500, 1000], updated_at: "2026-10-16T09:00:00Z" }, error: null });
    expect(await saveChipInAction(null, form(save))).toEqual({ ok: true, message: "Chip In settings saved · nothing is asked of any member while the switch is off · audit logged" });
    expect(rpc).toHaveBeenCalledWith("platform_set_chip_in", {
      p_center: CENTER,
      p_limit_cents: 5000,
      p_suggested_cents: [200, 500, 1000],
      p_asking: false,
      p_reason: "Pilot with the chamber",
    });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "Pilot with the chamber");
    expect(revalidatePath).toHaveBeenCalledWith(`/platform/centers/${CENTER}`);
  });

  it("saves a first limit and suggestions with the switch off and no limit before that (null, not zero)", async () => {
    as();
    rpc.mockResolvedValue({ data: { changed: true, asking: false }, error: null });
    expect(await saveChipInAction(null, form({ ...save, limit: "", suggestion: ["", "", "", ""] }))).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("platform_set_chip_in", expect.objectContaining({ p_limit_cents: null, p_suggested_cents: [], p_asking: false }));
  });

  it("says when nothing changed", async () => {
    as();
    rpc.mockResolvedValue({ data: { changed: false, asking: false }, error: null });
    expect(await saveChipInAction(null, form(save))).toEqual({ ok: true, message: "Nothing changed: these settings were already saved." });
  });

  describe("the switch cannot be turned on until a limit and a suggestion are saved", () => {
    const on = { ...save, asking: "on" };

    it("refuses when nothing is saved yet, even when the form carries a limit and suggestions", async () => {
      as({ saved: [] });
      expect(await saveChipInAction(null, form(on))).toEqual({ ok: false, error: `Could not save the Chip In settings — ${TURN_ON_BLOCKED}` });
      expect(rpc).not.toHaveBeenCalled();
      expect(dbWithReason).not.toHaveBeenCalled();
    });

    it("refuses when only part is saved", async () => {
      as({ saved: [NOTHING_SAVED] });
      expect(await saveChipInAction(null, form(on))).toMatchObject({ ok: false, error: expect.stringContaining("cannot be turned on until a yearly limit and at least one suggested amount are saved") });
      as({ saved: [{ ...SAVED_JSH, suggested_cents: [] }] });
      expect(await saveChipInAction(null, form(on))).toMatchObject({ ok: false });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("still needs both in the form (the database's sentences first)", async () => {
      as({ saved: [SAVED_JSH] });
      expect(await saveChipInAction(null, form({ ...on, limit: "" }))).toEqual({ ok: false, error: "Could not save the Chip In settings — Set the yearly limit per account before asking members for a Chip In." });
      expect(await saveChipInAction(null, form({ ...on, suggestion: ["", "", "", ""] }))).toEqual({
        ok: false,
        error: "Could not save the Chip In settings — Add at least one suggested amount before asking members for a Chip In.",
      });
      expect(rpc).not.toHaveBeenCalled();
    });

    it("turns it on once both are saved, and says members are now asked", async () => {
      as({ saved: [SAVED_JSH] });
      rpc.mockResolvedValue({ data: { changed: true, asking: true, yearly_limit_cents: 5000 }, error: null });
      expect(await saveChipInAction(null, form(on))).toEqual({
        ok: true,
        message: "Chip In is on for this organization: members are asked for an optional Chip In, up to $50.00 a year each · audit logged",
      });
      expect(rpc).toHaveBeenCalledWith("platform_set_chip_in", expect.objectContaining({ p_asking: true, p_limit_cents: 5000 }));
    });

    it("turning it off needs no saved setting at all, and never reads one", async () => {
      const db = as({ saved: [] });
      rpc.mockResolvedValue({ data: { changed: true, asking: false }, error: null });
      expect(await saveChipInAction(null, form(save))).toMatchObject({ ok: true });
      expect((db as unknown as { calls: unknown[] }).calls).toEqual([]);
    });

    it("says so when the saved setting cannot be read, and sends nothing", async () => {
      as({ failSaved: true });
      expect(await saveChipInAction(null, form(on))).toMatchObject({ ok: false, error: expect.stringMatching(/^Could not save the Chip In settings — boom\.$/) });
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("errors", () => {
    it("passes the database's refusal on, next to the form, and logs the detail", async () => {
      as({ saved: [SAVED_JSH] });
      rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "A suggested amount cannot be more than the yearly limit." } });
      expect(await saveChipInAction(null, form(save))).toEqual({ ok: false, error: "Could not save the Chip In settings — A suggested amount cannot be more than the yearly limit." });
      expect(console.error).toHaveBeenCalledWith("[crm] Could not save the Chip In settings:", expect.objectContaining({ code: "22023" }));
    });

    it("says it plainly when the database does not let this sign-in change it", async () => {
      as();
      rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Only the Weaver team can change the Chip In settings." } });
      expect(await saveChipInAction(null, form(save))).toEqual({ ok: false, error: "Could not save the Chip In settings — you don't have permission to make this change." });
    });

    it("says it plainly when the database cannot be reached or the function is missing", async () => {
      as();
      rpc.mockResolvedValue({ data: null, error: { message: "fetch failed" } });
      expect(await saveChipInAction(null, form(save))).toEqual({ ok: false, error: "Could not save the Chip In settings — the database could not be reached — check the connection and try again." });
      rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
      expect(await saveChipInAction(null, form(save))).toMatchObject({ ok: false, error: expect.stringMatching(/has the latest migration been applied/) });
    });

    it("never asks for a fresh 2FA code (the owner's rule of 2026-10-14) and never says it did", async () => {
      as();
      rpc.mockResolvedValue({ data: { changed: true, asking: false }, error: null });
      const result = await saveChipInAction(null, form(save));
      expect(result).toMatchObject({ ok: true });
      expect(result.stepUp).toBeUndefined();
    });
  });
});

describe("addFeeRateAction", () => {
  const rpc = vi.fn();
  const rate = { method_class: "card", percent: "2.2", fixed: "0.30", cap: "", note: "approved nonprofit pricing, letter of 2026-11-02", reason: "The chamber sent its letter" };
  function as(admin = true) {
    rpc.mockReset();
    vi.mocked(loadSession).mockResolvedValue({ status: "ok", session: fakeSession({ isPlatformAdmin: admin }) } as never);
    vi.mocked(dbWithReason).mockResolvedValue({ rpc } as never);
  }

  it("is for the Weaver team only", async () => {
    as(false);
    expect(await addFeeRateAction(null, form(rate))).toEqual({ ok: false, error: "Could not save the card fee rate — only Weaver platform admins can do this." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("adds the platform-wide rate (no organization), as basis points and cents", async () => {
    as();
    rpc.mockResolvedValue({ data: { id: "r1" }, error: null });
    expect(await addFeeRateAction(null, form(rate))).toEqual({ ok: true, message: "Card fee estimate is now 2.2% + $0.30 for every organization without a rate of its own · audit logged" });
    expect(rpc).toHaveBeenCalledWith("platform_set_fee_rate", {
      p_center: null,
      p_method_class: "card",
      p_bps: 220,
      p_fixed_cents: 30,
      p_cap_cents: null,
      p_source_note: "approved nonprofit pricing, letter of 2026-11-02",
      p_reason: "The chamber sent its letter",
    });
    expect(dbWithReason).toHaveBeenCalledWith(expect.anything(), "The chamber sent its letter");
    expect(revalidatePath).toHaveBeenCalledWith("/platform/payments");
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining("/platform/centers/"));
  });

  it("adds one organization's own rate, with a cap, and refreshes its page too", async () => {
    as();
    rpc.mockResolvedValue({ data: { id: "r2" }, error: null });
    expect(await addFeeRateAction(null, form({ ...rate, center: CENTER, method_class: "ach", percent: "0.8", fixed: "", cap: "5" }))).toEqual({
      ok: true,
      message: "Bank debit fee estimate is now 0.8%, never more than $5.00 for this organization · audit logged",
    });
    expect(rpc).toHaveBeenCalledWith("platform_set_fee_rate", expect.objectContaining({ p_center: CENTER, p_method_class: "ach", p_bps: 80, p_fixed_cents: 0, p_cap_cents: 500 }));
    expect(revalidatePath).toHaveBeenCalledWith(`/platform/centers/${CENTER}`);
    expect(revalidatePath).toHaveBeenCalledWith("/platform/payments");
  });

  it("explains a mistake before sending anything", async () => {
    as();
    expect(await addFeeRateAction(null, form({ ...rate, center: "nope" }))).toEqual({ ok: false, error: "Could not save the card fee rate — the form is out of date. Reload and try again." });
    expect(await addFeeRateAction(null, form({ ...rate, reason: "" }))).toEqual({ ok: false, error: "Could not save the card fee rate — say why. The reason is kept in the audit log." });
    expect(await addFeeRateAction(null, form({ ...rate, percent: "11" }))).toEqual({ ok: false, error: "Could not save the card fee rate — The percentage is between 0% and 10%." });
    expect(await addFeeRateAction(null, form({ ...rate, note: "" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Say where this rate comes from/) });
    expect(await addFeeRateAction(null, form({ ...rate, method_class: "paypal" }))).toEqual({ ok: false, error: "Could not save the fee rate — Choose card or bank debit." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the database's refusal on in plain words", async () => {
    as();
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "That community was not found." } });
    expect(await addFeeRateAction(null, form({ ...rate, center: CENTER }))).toEqual({ ok: false, error: "Could not save the card fee rate — That community was not found." });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Only the Weaver team can change a fee rate." } });
    expect(await addFeeRateAction(null, form(rate))).toEqual({ ok: false, error: "Could not save the card fee rate — you don't have permission to make this change." });
  });
});

describe("the reads behind the Chip In card", () => {
  const OVERVIEW = {
    center_id: CENTER,
    calendar_year: 2026,
    asking: false,
    yearly_limit_cents: 5000,
    live: { accounts: 0, collected_cents: 0, refunded_cents: 0, in_flight_cents: 0, accounts_at_limit: 0 },
    test: { accounts: 2, collected_cents: 700, refunded_cents: 0, in_flight_cents: 0, accounts_at_limit: 0 },
  };
  const RATES = { card: { bps: 290, fixed_cents: 30, cap_cents: null, custom: false, effective_from: "2020-01-01T00:00:00Z", source_note: "Stripe US standard pricing" } };

  function read(over: { rpc?: Record<string, unknown>; failRpc?: Record<string, { code?: string; message: string }>; tables?: Record<string, Record<string, unknown>[]> } = {}) {
    const db = fakeDb({
      tables: {
        chip_in_settings: [{ ...SAVED_JSH, updated_by: ADMIN }],
        center_users: [{ center_id: "center-1", user_id: ADMIN, person_id: "p1" }],
        people: [{ id: "p1", first_name: "Priya", last_name: "Shah", preferred_name: null, member_number: "M1" }],
        ...over.tables,
      },
      rpc: { chip_in_overview: OVERVIEW, payment_fee_rates_for: RATES, ...over.rpc } as never,
      failRpc: over.failRpc,
    });
    return { db, session: fakeSession({ db, isPlatformAdmin: true, userId: "someone-else" }) };
  }

  it("reads the settings, the figures and the rates, with the name of who changed it", async () => {
    const { session, db } = read();
    const data = await loadChipInCard(session, CENTER);
    expect(data.settings).toMatchObject({ ok: true, value: { asking: false, yearlyLimitCents: 5000, suggestedCents: [200, 500, 1000] } });
    expect(data.overview).toMatchObject({ ok: true, value: { calendarYear: 2026, test: { accounts: 2, collectedCents: 700 } } });
    expect(data.rates).toMatchObject({ ok: true, value: { card: { bps: 290, custom: false } } });
    expect(data.changedBy).toBe("Priya Shah");
    expect((db as unknown as { rpcCalls: { fn: string; args: unknown }[] }).rpcCalls.map((c) => c.fn).sort()).toEqual(["chip_in_overview", "payment_fee_rates_for"]);
  });

  it("calls the people behind a change 'Weaver's team' when nobody signed in made it, and 'a Weaver platform admin' when the name cannot be read", async () => {
    expect((await loadChipInCard(read({ tables: { chip_in_settings: [SAVED_JSH] } }).session, CENTER)).changedBy).toBe("Weaver's team");
    expect((await loadChipInCard(read({ tables: { center_users: [] } }).session, CENTER)).changedBy).toBe("a Weaver platform admin");
  });

  it("says 'no access', once, when the database refuses the platform check: never an empty card", async () => {
    const { session } = read({ failRpc: { chip_in_overview: { code: "42501", message: "Only the Weaver team can see the Chip In figures." } } });
    const data = await loadChipInCard(session, CENTER);
    expect(data.settings).toEqual({ ok: false, reason: "no_access" });
    expect(data.overview).toEqual({ ok: false, reason: "no_access" });
    expect(data.rates).toEqual({ ok: false, reason: "no_access" });
  });

  it("keeps the parts apart: one that fails does not hide the others", async () => {
    const failed = await loadChipInCard(read({ failRpc: { payment_fee_rates_for: { code: "XX000", message: "boom" } } }).session, CENTER);
    expect(failed.rates).toMatchObject({ ok: false, reason: "error" });
    expect(failed.settings.ok).toBe(true);
    expect(failed.overview.ok).toBe(true);
    const down = fakeDb({ failTables: { chip_in_settings: { code: "XX000", message: "boom" } }, rpc: { chip_in_overview: OVERVIEW, payment_fee_rates_for: RATES } as never });
    const data = await loadChipInCard(fakeSession({ db: down, isPlatformAdmin: true }), CENTER);
    expect(data.settings).toMatchObject({ ok: false, reason: "error" });
    expect(data.overview.ok).toBe(true);
    expect(data.rates.ok).toBe(true);
  });

  it("reports a shape it does not understand instead of guessing", async () => {
    const { session } = read({ rpc: { chip_in_overview: { weird: true } } });
    const data = await loadChipInCard(session, CENTER);
    expect(data.overview).toMatchObject({ ok: false, reason: "error" });
    expect(String((data.overview as { error: Error }).error.message)).toBe(UNEXPECTED_SHAPE);
  });

  it("reads the platform-wide rates: the one in force and the earlier ones, with who added them", async () => {
    const rows = [
      { id: "r2", center_id: null, method_class: "card", bps: 280, fixed_cents: 30, cap_cents: null, effective_from: "2026-09-01T00:00:00Z", source_note: "negotiated", set_by: ADMIN },
      { id: "r1", center_id: null, method_class: "card", bps: 290, fixed_cents: 30, cap_cents: null, effective_from: "2020-01-01T00:00:00Z", source_note: "standard", set_by: null },
      { id: "a1", center_id: null, method_class: "ach", bps: 80, fixed_cents: 0, cap_cents: 500, effective_from: "2020-01-01T00:00:00Z", source_note: "ACH", set_by: null },
      { id: "x1", center_id: CENTER, method_class: "card", bps: 100, fixed_cents: 0, cap_cents: null, effective_from: "2026-10-01T00:00:00Z", source_note: "one organization's", set_by: null },
    ];
    const { session } = read({ tables: { payment_fee_rates: rows } });
    const res = await loadPlatformFeeRates(session);
    if (!res.ok) throw new Error("expected rates");
    expect(res.value.effective.card).toMatchObject({ bps: 280, sourceNote: "negotiated" });
    expect(res.value.effective.ach).toMatchObject({ bps: 80, capCents: 500 });
    // The rows of one organization are never platform rates: the read asks for center_id = null only.
    expect(res.value.earlier.map((r) => [r.id, r.by])).toEqual([["r1", "Weaver's team"]]);
  });

  it("says so when the platform rates cannot be read, or the database does not allow it", async () => {
    const down = fakeSession({ db: fakeDb({ failTables: { payment_fee_rates: { code: "XX000", message: "boom" } } }), isPlatformAdmin: true });
    expect(await loadPlatformFeeRates(down)).toMatchObject({ ok: false, reason: "error" });
    const refused = fakeSession({ db: fakeDb({ failTables: { payment_fee_rates: { code: "42501", message: "permission denied for table payment_fee_rates" } } }), isPlatformAdmin: true });
    expect(await loadPlatformFeeRates(refused)).toEqual({ ok: false, reason: "no_access" });
  });
});

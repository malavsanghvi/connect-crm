import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY,
  DEFAULT_WINDOW_DAYS,
  isShortening,
  METHOD_ROWS,
  parseProofPolicy,
  parseRetentionPreview,
  previewSentence,
  retentionNote,
  retentionPatchFromForm,
  retentionYearsProblem,
  rulesPatchFromForm,
  windowDays,
} from "@/lib/payment-proofs/policy";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("reading the policy", () => {
  it("falls back to the database's defaults for anything unreadable", () => {
    expect(parseProofPolicy(null)).toEqual(DEFAULT_POLICY);
    expect(parseProofPolicy("x")).toEqual(DEFAULT_POLICY);
    expect(parseProofPolicy({ retention_years: "nope" }).retentionYears).toBe(7);
  });

  it("reads what the organization set, keeping money in cents and years in range", () => {
    const p = parseProofPolicy({
      required_methods: ["check", "cash", "check", "card"],
      retention_years: 10,
      legal_hold: true,
      second_approver_over_cents: 250000,
      reply_wait_days: 21,
      honour_event_entry: false,
      release_store_orders: true,
      windows: { check: 20, zelle: 999, nonsense: 5 },
    });
    expect(p).toEqual({
      requiredMethods: ["check", "cash"],
      retentionYears: 10,
      legalHold: true,
      secondApproverOverCents: 250000,
      replyWaitDays: 21,
      honourEventEntry: false,
      releaseStoreOrders: true,
      windows: { check: 20 },
    });
    expect(parseProofPolicy({ retention_years: 99 }).retentionYears).toBe(25);
    expect(parseProofPolicy({ retention_years: 1 }).retentionYears).toBe(3);
  });

  it("gives each method's days: the organization's, else the usual", () => {
    expect(windowDays(parseProofPolicy({ windows: { check: 20 } }), "check")).toBe(20);
    expect(windowDays(DEFAULT_POLICY, "check")).toBe(DEFAULT_WINDOW_DAYS.check);
    expect(DEFAULT_WINDOW_DAYS).toMatchObject({ zelle: 5, ach: 7, check: 30, cash: 14, stock: 30, daf: 60, matching_gift: 60, other: 45 });
    expect(METHOD_ROWS.map((r) => r.key).sort()).toEqual(Object.keys(DEFAULT_WINDOW_DAYS).sort());
  });
});

describe("Settings > Payments form", () => {
  const base = { reply_wait_days: "14", second_approver: "" };

  it("builds the patch: ticked methods, days only where typed, the limit in cents", () => {
    const r = rulesPatchFromForm(form({ ...base, need_check: "on", need_stock: "on", days_check: "21", days_cash: "", second_approver: "$2,500.00", honour_event_entry: "on" }));
    expect(r).toEqual({
      ok: true,
      patch: {
        required_methods: ["check", "stock"],
        windows: { check: 21 },
        second_approver_over_cents: 250000,
        reply_wait_days: 14,
        honour_event_entry: true,
        release_store_orders: false,
      },
    });
  });

  it("turns the second approval off with an empty box or zero", () => {
    expect(rulesPatchFromForm(form(base))).toMatchObject({ ok: true, patch: { second_approver_over_cents: 0 } });
    expect(rulesPatchFromForm(form({ ...base, second_approver: "0" }))).toMatchObject({ ok: true, patch: { second_approver_over_cents: 0 } });
  });

  it("refuses numbers out of range with a sentence that names the field", () => {
    expect(rulesPatchFromForm(form({ ...base, days_check: "0" }))).toMatchObject({ ok: false });
    expect(rulesPatchFromForm(form({ ...base, days_zelle: "181" }))).toMatchObject({ ok: false });
    const bad = rulesPatchFromForm(form({ ...base, days_check: "abc" }));
    expect(bad.ok === false && bad.error).toContain("Check");
    expect(rulesPatchFromForm(form({ ...base, second_approver: "lots" }))).toMatchObject({ ok: false });
    expect(rulesPatchFromForm(form({ ...base, second_approver: "-5" }))).toMatchObject({ ok: false });
    expect(rulesPatchFromForm(form({ ...base, second_approver: "1000000.01" }))).toMatchObject({ ok: false });
    expect(rulesPatchFromForm(form({ ...base, reply_wait_days: "0" }))).toMatchObject({ ok: false });
    expect(rulesPatchFromForm(form({ ...base, reply_wait_days: "61" }))).toMatchObject({ ok: false });
    expect(rulesPatchFromForm(form({ ...base, reply_wait_days: "" }))).toMatchObject({ ok: false });
  });
});

describe("Settings > Storage retention", () => {
  it("accepts 3 to 25 whole years", () => {
    expect(retentionYearsProblem("3")).toBeNull();
    expect(retentionYearsProblem("25")).toBeNull();
    expect(retentionYearsProblem("2")).toContain("3 to 25");
    expect(retentionYearsProblem("26")).toContain("3 to 25");
    expect(retentionYearsProblem("7.5")).not.toBeNull();
    expect(retentionYearsProblem("")).not.toBeNull();
  });

  it("reads the form, including the legal hold", () => {
    expect(retentionPatchFromForm(form({ years: "10", legal_hold: "on" }))).toEqual({ ok: true, patch: { retention_years: 10, legal_hold: true } });
    expect(retentionPatchFromForm(form({ years: "7" }))).toEqual({ ok: true, patch: { retention_years: 7, legal_hold: false } });
    expect(retentionPatchFromForm(form({ years: "1" }))).toMatchObject({ ok: false });
  });

  it("knows when the years are being shortened, which needs a reason and a 2FA code", () => {
    const current = parseProofPolicy({ retention_years: 7 });
    expect(isShortening(current, { retention_years: 6, legal_hold: false })).toBe(true);
    expect(isShortening(current, { retention_years: 7, legal_hold: true })).toBe(false);
    expect(isShortening(current, { retention_years: 9, legal_hold: false })).toBe(false);
    expect(retentionNote(current, 5)).toContain("reason and your sign-in code");
    expect(retentionNote(current, 9)).toBe("Raising the years never removes anything.");
    expect(retentionNote(parseProofPolicy({ legal_hold: true }), 7)).toContain("legal hold is on");
  });
});

describe("what shortening the years would make due (proof_retention_preview)", () => {
  it("reads the database's counts, and nothing when the answer is not one", () => {
    expect(parseRetentionPreview({ files: 12, family_files: 9, current_years: 7, new_years: 5, legal_hold: false })).toEqual({
      files: 12,
      familyFiles: 9,
      currentYears: 7,
      newYears: 5,
      legalHold: false,
    });
    expect(parseRetentionPreview(null)).toBeNull();
    expect(parseRetentionPreview({ nothing: 1 })).toBeNull();
    expect(parseRetentionPreview({ files: "x" })?.files).toBe(0);
  });

  it("says it in words: files due, families who lose access, the legal hold", () => {
    const p = (o: object) => parseRetentionPreview({ files: 12, family_files: 9, current_years: 7, new_years: 5, legal_hold: false, ...o })!;
    expect(previewSentence(p({}))).toBe("12 files would become due, and families would lose access to 9 of them.");
    expect(previewSentence(p({ files: 1, family_files: 0 }))).toBe("1 file would become due, and no family would lose access to a file.");
    expect(previewSentence(p({ files: 0 }))).toBe("No file would become due at this length.");
    expect(previewSentence(p({ legal_hold: true }))).toContain("legal hold is on");
  });
});

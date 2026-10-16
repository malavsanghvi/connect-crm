import { describe, expect, it } from "vitest";

import { evidenceState, evidenceTitle, evidenceWhen, fileKind, fileLine, fileSize, keptUntilText, parseEvidence } from "@/lib/pledge-evidence";

// app.pledge_evidence (0866): for a pledge in any status, every proof and file connected to it.

const wire = [
  {
    kind: "proof",
    proof_id: "pr1",
    payment_id: null,
    state: "waiting",
    covered_cents: 25000,
    method: "check",
    paid_on: "2026-10-10",
    reference: "1048",
    reason: null,
    sent_on: "2026-10-12T15:00:00Z",
    kept_until: "2033-12-31",
    files: [
      { id: "f1", storage_path: "c/h/pr1/a.jpg", content_type: "image/jpeg", bytes: 1_300_000, removed: false, removed_on: null, removed_reason: null },
      { id: "f2", storage_path: "c/h/pr1/b.pdf", content_type: "application/pdf", bytes: 90_000, removed: true, removed_on: "2033-12-31T00:00:00Z", removed_reason: "retention" },
    ],
  },
  {
    kind: "payment",
    proof_id: "pr0",
    payment_id: "pay1",
    state: "reconciled",
    covered_cents: 6000,
    method: "cash",
    paid_on: "2026-09-26",
    reference: null,
    receipt_number: "R-2026-0211",
    kept_until: null,
    files: [],
  },
];

describe("parseEvidence", () => {
  const items = parseEvidence(wire)!;
  it("reads proofs, payments and their files, tombstones included", () => {
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "proof", proofId: "pr1", state: "waiting", coveredCents: 25000, reference: "1048", keptUntil: "2033-12-31" });
    expect(items[0].files.map((f) => [f.id, f.removed])).toEqual([["f1", false], ["f2", true]]);
    expect(items[1]).toMatchObject({ kind: "payment", receiptNumber: "R-2026-0211", keptUntil: null });
  });
  it("is null for a shape it does not know, so it never shows 'no evidence' by mistake", () => {
    expect(parseEvidence({})).toBeNull();
    expect(parseEvidence([{ kind: "mystery" }])).toBeNull();
    expect(parseEvidence([{ kind: "proof", files: "x" }])).toBeNull();
    expect(parseEvidence([{ kind: "proof", files: [{ nope: 1 }] }])).toBeNull();
    expect(parseEvidence([])).toEqual([]);
  });
});

describe("the words", () => {
  const items = parseEvidence(wire)!;
  it("titles a proof and a payment", () => {
    expect(evidenceTitle(items[0], "USD")).toBe("Payment confirmation for $250.00, check 1048");
    expect(evidenceTitle(items[1], "USD")).toBe("Receipt R-2026-0211, cash · $60.00 on this pledge");
  });
  it("says the state of each piece of evidence", () => {
    expect(evidenceState(items[0])).toEqual({ label: "Waiting", tone: "info" });
    expect(evidenceState(items[1]).label).toBe("Evidence on a bank reconciled payment");
    expect(evidenceState({ kind: "proof", state: "rejected" })).toEqual({ label: "Not accepted", tone: "bad" });
    expect(evidenceState({ kind: "proof", state: "merged" }).label).toBe("Kept with the payment");
  });
  it("says when it was sent, and how long it is kept (a legal hold has no date)", () => {
    expect(evidenceWhen(items[0], "America/Chicago")).toContain("Sent");
    expect(keptUntilText(items[0], "America/Chicago")).toContain("Kept until");
    expect(keptUntilText(items[1], "America/Chicago")).toContain("legal hold");
  });
  it("describes a file, and a removed file by its record", () => {
    expect(fileLine(items[0].files[0], "America/Chicago")).toBe("Photo · 1.2 MB");
    expect(fileLine(items[0].files[1], "America/Chicago")).toMatch(/^PDF removed .*retention$/);
    expect(fileKind("application/pdf")).toBe("PDF");
    expect(fileKind(null)).toBe("File");
    expect(fileSize(512)).toBe("512 B");
    expect(fileSize(2048)).toBe("2 KB");
  });
});

import { describe, expect, it } from "vitest";

import {
  checkEvidenceFile,
  EVIDENCE_MAX_BYTES,
  evidenceDisplayName,
  evidenceFileLine,
  evidenceFilesFrom,
  evidenceObjectPath,
  liveStaffFiles,
  safeBaseName,
  STAFF_FILES_PER_PAYMENT,
} from "@/lib/payment-proofs/evidence-files";

const C = "00000000-0000-4000-8000-0000000000c1";
const P = "00000000-0000-4000-8000-0000000000a1";
const ID = "11111111-2222-4333-8444-555555555555";

describe("a file staff attach to a payment", () => {
  it("accepts photos and PDFs up to 10 MB, by type or, for a phone that leaves the type empty, by the ending", () => {
    expect(checkEvidenceFile({ name: "check.jpg", type: "image/jpeg", size: 1000 })).toEqual({ ok: true, contentType: "image/jpeg" });
    expect(checkEvidenceFile({ name: "IMG_0042.HEIC", type: "", size: 1000 })).toEqual({ ok: true, contentType: "image/heic" });
    expect(checkEvidenceFile({ name: "receipt.pdf", type: "application/pdf", size: EVIDENCE_MAX_BYTES })).toEqual({ ok: true, contentType: "application/pdf" });
  });

  it("says in words why a file is refused, before any upload starts", () => {
    expect(checkEvidenceFile({ name: "page.html", type: "text/html", size: 10 })).toEqual({ ok: false, error: "Attach a photo (JPEG, PNG, WebP or HEIC) or a PDF." });
    expect(checkEvidenceFile({ name: "notes.txt", type: "", size: 10 })).toMatchObject({ ok: false });
    expect(checkEvidenceFile({ name: "a.jpg", type: "image/jpeg", size: 0 })).toEqual({ ok: false, error: "The file is empty." });
    expect(checkEvidenceFile({ name: "big.png", type: "image/png", size: EVIDENCE_MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: "The file is 10.0 MB. A file can be at most 10 MB.",
    });
    expect(checkEvidenceFile({ name: "a.jpg", type: "image/jpeg", size: 10 }, STAFF_FILES_PER_PAYMENT)).toEqual({
      ok: false,
      error: "A payment can have up to 5 files attached by staff. Remove one first.",
    });
  });

  it("keeps staff files in the staff folder of the payment, with a readable, safe name", () => {
    expect(evidenceObjectPath(C, P, ID, "Check front (Oct 12).JPG", "image/jpeg")).toBe(`${C}/staff/${P}/${ID}-check-front-oct-12.jpg`);
    expect(evidenceObjectPath(C, P, ID, "../../etc/passwd", "application/pdf")).toBe(`${C}/staff/${P}/${ID}-etc-passwd.pdf`);
    expect(evidenceObjectPath(C, P, ID, "###", "image/png")).toBe(`${C}/staff/${P}/${ID}-file.png`);
    expect(safeBaseName("x".repeat(100) + ".jpg")).toHaveLength(40);
    expect(evidenceObjectPath(C, P, ID, "a.jpg", "image/jpeg").split("/")).toHaveLength(4);
  });

  it("gives the name back from the path; the family's uuid-only files have none", () => {
    expect(evidenceDisplayName(`${C}/staff/${P}/${ID}-check-front.jpg`)).toBe("check-front.jpg");
    expect(evidenceDisplayName(`${C}/h1/${ID}/${ID}.jpg`)).toBeNull();
  });
});

describe("the files of a payment", () => {
  const rows = [
    { id: "f2", proof_id: null, storage_path: `${C}/staff/${P}/${ID}-receipt.pdf`, content_type: "application/pdf", bytes: 52_000, created_at: "2026-10-14T15:00:00Z", deleted_at: null, deleted_reason: null },
    { id: "f1", proof_id: "pr1", storage_path: `${C}/h1/pr1/${ID}.jpg`, content_type: "image/jpeg", bytes: 1_500_000, created_at: "2026-10-12T15:00:00Z", deleted_at: null, deleted_reason: null },
    { id: "f3", proof_id: null, storage_path: `${C}/staff/${P}/${ID}-old.jpg`, content_type: "image/jpeg", bytes: 900, created_at: "2026-10-13T15:00:00Z", deleted_at: "2026-10-15T09:00:00Z", deleted_reason: "Photo of the wrong check" },
  ];
  const urls = new Map([
    [`${C}/staff/${P}/${ID}-receipt.pdf`, "https://signed/r"],
    [`${C}/h1/pr1/${ID}.jpg`, "https://signed/f"],
    [`${C}/staff/${P}/${ID}-old.jpg`, "https://signed/never"],
  ]);

  it("lists the family's files and the staff files oldest first, with a link only for a file that still exists", () => {
    const files = evidenceFilesFrom(rows, urls);
    expect(files.map((f) => [f.id, f.source, f.url])).toEqual([
      ["f1", "family", "https://signed/f"],
      ["f3", "staff", null],
      ["f2", "staff", "https://signed/r"],
    ]);
    expect(liveStaffFiles(files)).toBe(1);
  });

  it("describes each file in a line, and a removed one by its tombstone", () => {
    const [family, removed, staff] = evidenceFilesFrom(rows, urls);
    expect(evidenceFileLine(family!, "America/Chicago")).toBe("Photo · 1.4 MB · sent by the family Oct 12, 2026");
    expect(evidenceFileLine(staff!, "America/Chicago")).toBe("receipt.pdf · PDF · 51 KB · attached by staff Oct 14, 2026");
    expect(evidenceFileLine(removed!, "America/Chicago")).toBe("Photo attached by staff, removed Oct 15, 2026: Photo of the wrong check");
  });
});

import { describe, expect, it } from "vitest";

import { parseUploadScanSummary, uploadScanView } from "@/lib/upload-scan";

const summary = (over: Record<string, unknown> = {}) => ({
  mode: "off", enforced_since: null, held_buckets: ["homework", "recordings"],
  files: 12, pending: 12, clean: 0, failed: 0, infected: 0, removed: 0, queued: 12, ...over,
});

describe("virus scanning on the Settings pages (0589)", () => {
  it("reads the database's summary, and nothing when there is none", () => {
    expect(parseUploadScanSummary(undefined)).toBeNull();
    expect(parseUploadScanSummary("x")).toBeNull();
    expect(parseUploadScanSummary(summary({ mode: "weird", pending: -3, clean: "7" }))).toMatchObject({ mode: "off", pending: 0, clean: 0, files: 12 });
    expect(parseUploadScanSummary(summary({ mode: "enforce", enforced_since: "2026-10-07T10:00:00Z" }))).toMatchObject({
      mode: "enforce", enforcedSince: "2026-10-07T10:00:00Z", heldBuckets: ["homework", "recordings"],
    });
  });

  it("off: says it is switched off and how many files wait to be checked", () => {
    const v = uploadScanView(parseUploadScanSummary(summary()));
    expect(v.title).toBe("Virus scanning is switched off");
    expect(v.counts).toBe("12 files waiting to be checked");
    expect(v.detail).toMatch(/checked once, in the background/);
    expect(uploadScanView(parseUploadScanSummary(summary({ pending: 1 }))).counts).toBe("1 file waiting to be checked");
    expect(uploadScanView(parseUploadScanSummary(summary({ pending: 0 }))).counts).toBe("No files waiting to be checked");
  });

  it("monitor: counts the results and says nothing is held back or removed", () => {
    const v = uploadScanView(parseUploadScanSummary(summary({ mode: "monitor", pending: 2, clean: 1300, failed: 1, infected: 1 })));
    expect(v.title).toBe("Virus scanning is on in monitor mode");
    expect(v.counts).toBe("2 files waiting to be checked · 1,300 clean · 1 could not be checked · 1 found infected (kept: monitor mode)");
    expect(v.detail).toMatch(/Nothing is held back or removed yet/);
    expect(v.tone).toBe("bad");
  });

  it("enforce: says what is held back and what was removed, never a file name", () => {
    const v = uploadScanView(parseUploadScanSummary(summary({ mode: "enforce", pending: 0, clean: 40, removed: 2 })));
    expect(v.title).toBe("Virus scanning is on");
    expect(v.detail).toMatch(/^Homework and recordings reach teachers only once they are checked/);
    expect(v.counts).toBe("0 files waiting to be checked · 40 clean · 2 infected files removed");
    expect(v.tone).toBe("ok");
    expect(uploadScanView(parseUploadScanSummary(summary({ mode: "enforce", infected: 1 }))).counts).toContain("1 infected file waiting to be removed");
  });

  it("says plainly when the database sent no summary", () => {
    expect(uploadScanView(null)).toMatchObject({ title: "Virus scanning", tone: "warn", counts: "" });
  });
});

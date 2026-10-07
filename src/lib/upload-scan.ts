// Virus scanning of uploads (migration 0589), as Settings › Storage and Settings › Integrations say it. Pure helpers
// (tests/upload-scan.test.ts). The database returns one summary per community: app.center_storage_overview(...).scan
// and app.background_service_status(...).scan, from app._upload_scan_summary.
//
// The mode is a platform setting (Platform › Setup › Background service › Virus scanning of uploads, UPLOAD_SCAN_MODE):
//   off      the default: nothing is checked yet; every upload waits to be checked once scanning is switched on
//   monitor  every upload is checked and the result recorded; nothing is held back or removed
//   enforce  homework and recordings reach teachers only once checked; an infected file is removed and the family
//            (or the uploader) and the office are told

import { isPlainObject } from "@/lib/center-rules";

export type UploadScanMode = "off" | "monitor" | "enforce";

export type UploadScanSummary = {
  mode: UploadScanMode;
  /** When enforcement began (enforce only). */
  enforcedSince: string | null;
  /** The buckets whose files are held back until checked (homework, recordings). */
  heldBuckets: string[];
  /** This community's files in the scanned buckets, and how their checks stand. */
  files: number;
  pending: number;
  clean: number;
  failed: number;
  /** Infected and still stored: kept in monitor mode, or waiting for their removal in enforce mode. */
  infected: number;
  /** Infected files removed (enforce mode). */
  removed: number;
  /** Checks queued for the background service. */
  queued: number;
};

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);

/** The "scan" object of either function, or null when the database sent none (before 0589). */
export function parseUploadScanSummary(v: unknown): UploadScanSummary | null {
  if (!isPlainObject(v)) return null;
  return {
    mode: v.mode === "monitor" || v.mode === "enforce" ? v.mode : "off",
    enforcedSince: typeof v.enforced_since === "string" ? v.enforced_since : null,
    heldBuckets: Array.isArray(v.held_buckets) ? v.held_buckets.filter((b): b is string => typeof b === "string") : [],
    files: count(v.files),
    pending: count(v.pending),
    clean: count(v.clean),
    failed: count(v.failed),
    infected: count(v.infected),
    removed: count(v.removed),
    queued: count(v.queued),
  };
}

function n(value: number, one: string, many: string): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;
}

export type UploadScanView = { title: string; detail: string; counts: string; tone: "ok" | "warn" | "bad" };

/** What the two Settings pages say: a headline, what it means, and the counts. */
export function uploadScanView(s: UploadScanSummary | null): UploadScanView {
  if (!s) {
    return {
      title: "Virus scanning",
      detail: "Uploads are checked for type and size. The database did not say how virus scanning stands (virus scanning is switched off until a platform administrator switches it on).",
      counts: "",
      tone: "warn",
    };
  }
  const waiting = n(s.pending, "file waiting to be checked", "files waiting to be checked");
  if (s.mode === "off") {
    return {
      title: "Virus scanning is switched off",
      detail:
        "Uploads are checked for type and size only. Virus scanning does not start by itself: a platform administrator switches it on once the scanner is installed, and the files uploaded until then are checked once, in the background, after that.",
      counts: s.pending > 0 ? waiting : "No files waiting to be checked",
      tone: "warn",
    };
  }
  const parts = [waiting];
  if (s.clean > 0) parts.push(`${s.clean.toLocaleString("en-US")} clean`);
  if (s.failed > 0) parts.push(n(s.failed, "could not be checked", "could not be checked"));
  if (s.mode === "monitor") {
    if (s.infected > 0) parts.push(n(s.infected, "found infected (kept: monitor mode)", "found infected (kept: monitor mode)"));
    return {
      title: "Virus scanning is on in monitor mode",
      detail: "Every upload is checked and the result recorded. Nothing is held back or removed yet, and an infected file is only written to the audit log.",
      counts: parts.join(" · "),
      tone: s.infected > 0 ? "bad" : "ok",
    };
  }
  if (s.removed > 0) parts.push(n(s.removed, "infected file removed", "infected files removed"));
  if (s.infected > 0) parts.push(n(s.infected, "infected file waiting to be removed", "infected files waiting to be removed"));
  const held = s.heldBuckets.includes("homework") && s.heldBuckets.includes("recordings") ? "Homework and recordings" : "Held files";
  return {
    title: "Virus scanning is on",
    detail: `${held} reach teachers only once they are checked (the family opens them at once). An infected file is removed, and the family or the uploader and the office are told.`,
    counts: parts.join(" · "),
    tone: s.infected > 0 ? "bad" : s.failed > 0 ? "warn" : "ok",
  };
}

import { describe, expect, it } from "vitest";

import { photoLocation } from "@/lib/content";
import {
  GOOGLE_PHOTO_SUFFIX,
  googlePhotoUrl,
  importStatusLine,
  isGoogleImageBase,
  isGooglePhotosAlbumUrl,
  parseImportStatus,
  type AlbumImportStatus,
} from "@/lib/google-photos";

// Invented addresses: nothing here is a real album or photo.
const KEY = "AF1QipFAKEALBUMKEYFAKEALBUMKEYFAKEALBUMKEY00";
const BASE = "https://lh3.googleusercontent.com/pw/FAKEPHOTO0001" + "x".repeat(60);

describe("isGooglePhotosAlbumUrl", () => {
  it("accepts a shared album, short or long, with or without a query", () => {
    expect(isGooglePhotosAlbumUrl("https://photos.app.goo.gl/FakeShortId12345")).toBe(true);
    expect(isGooglePhotosAlbumUrl("  https://photos.app.goo.gl/FakeShortId12345/  ")).toBe(true);
    expect(isGooglePhotosAlbumUrl("http://photos.app.goo.gl/FakeShortId12345?foo=bar")).toBe(true);
    expect(isGooglePhotosAlbumUrl(`https://photos.google.com/share/${KEY}?key=FAKEKEY`)).toBe(true);
    expect(isGooglePhotosAlbumUrl(`https://photos.google.com/u/1/share/${KEY}?key=FAKEKEY&pli=1`)).toBe(true);
    expect(isGooglePhotosAlbumUrl("HTTPS://PHOTOS.APP.GOO.GL/FakeShortId12345")).toBe(true);
  });
  it("refuses everything else", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "   ",
      "https://example.com/album",
      "https://photos.app.goo.gl/",
      "https://photos.app.goo.gl/short",
      "https://photos.app.goo.gl.evil.example/FakeShortId12345",
      "https://evilphotos.google.com/share/" + KEY,
      "https://photos.google.com/photo/" + KEY,
      "https://photos.google.com/albums/" + KEY,
      "https://photos.google.com/share/short",
      "https://drive.google.com/drive/folders/FakeFolderId1234567",
      "https://www.dropbox.com/sh/abc",
      "ftp://photos.app.goo.gl/FakeShortId12345",
      "https://user@photos.app.goo.gl/FakeShortId12345",
      "https://photos.app.goo.gl/FakeShortId12345 and some words",
      "https://photos.app.goo.gl/FakeShortId12345\nhttps://example.com",
    ]) {
      expect(isGooglePhotosAlbumUrl(bad), String(bad)).toBe(false);
    }
  });
});

describe("googlePhotoUrl", () => {
  it("adds the verified size suffix to a bare Google image address", () => {
    expect(googlePhotoUrl(BASE, "thumb")).toBe(BASE + "=w480-h480-c");
    expect(googlePhotoUrl(BASE, "full")).toBe(BASE + "=w1600");
    expect(GOOGLE_PHOTO_SUFFIX).toEqual({ thumb: "=w480-h480-c", full: "=w1600" });
  });
  it("leaves every other address alone, including one that already has a suffix", () => {
    for (const other of [BASE + "=w600", "https://example.com/a.jpg", "https://xyz.supabase.co/storage/v1/object/sign/photos/a.jpg?token=abc", "photos/a.jpg"]) {
      expect(googlePhotoUrl(other, "thumb")).toBe(other);
    }
  });
  it("knows what a bare Google image address is", () => {
    expect(isGoogleImageBase(BASE)).toBe(true);
    expect(isGoogleImageBase(BASE + "=w100")).toBe(false);
    expect(isGoogleImageBase("https://lh3.googleusercontent.com/pw/short")).toBe(false);
    expect(isGoogleImageBase("http://lh3.googleusercontent.com/pw/" + "a".repeat(60))).toBe(false);
    expect(isGoogleImageBase("https://lh9.googleusercontent.com/pw/" + "a".repeat(60))).toBe(false);
    expect(isGoogleImageBase("https://evil.example.com/pw/" + "a".repeat(60))).toBe(false);
  });
  it("is what an imported photo's storage_path looks like to photoLocation: a plain https address", () => {
    expect(photoLocation(BASE)).toEqual({ kind: "url", url: BASE });
  });
});

describe("parseImportStatus", () => {
  it("reads the database's answer", () => {
    expect(parseImportStatus({ has_link: true, importing: true, since: "2026-10-01T15:00:00Z", synced_at: null, photo_count: null, error: null })).toEqual({
      hasLink: true,
      importing: true,
      since: "2026-10-01T15:00:00Z",
      syncedAt: null,
      photoCount: null,
      error: null,
    });
    expect(parseImportStatus({ has_link: false, importing: false, synced_at: "2026-09-30T10:00:00Z", photo_count: 575, error: "x" })).toMatchObject({
      hasLink: false,
      syncedAt: "2026-09-30T10:00:00Z",
      photoCount: 575,
      error: "x",
    });
  });
  it("returns null for anything that is not an object", () => {
    for (const v of [null, undefined, "x", 3, [], true]) expect(parseImportStatus(v)).toBeNull();
  });
});

describe("importStatusLine", () => {
  const when = (iso: string) => `at ${iso.slice(0, 10)}`;
  const base: AlbumImportStatus = { hasLink: true, importing: false, since: null, syncedAt: null, photoCount: null, error: null };
  it("says nothing was imported yet", () => {
    expect(importStatusLine(base, when)).toEqual({ tone: "info", text: "Nothing has been imported from this link yet." });
  });
  it("says importing while a job is queued or running, whatever else is stored", () => {
    const line = importStatusLine({ ...base, importing: true, since: "2026-10-01T15:00:00Z", error: "old error", syncedAt: "2026-09-01T00:00:00Z" }, when);
    expect(line.tone).toBe("info");
    expect(line.text).toMatch(/^Importing… started at 2026-10-01\. This usually takes a minute or two\. Reload this page/);
    expect(line.text).not.toMatch(/old error/);
  });
  it("reports the last import and how many photos Google Photos had", () => {
    expect(importStatusLine({ ...base, syncedAt: "2026-09-30T10:00:00Z", photoCount: 575 }, when)).toEqual({ tone: "ok", text: "Last imported at 2026-09-30. Google Photos had 575 photos." });
    expect(importStatusLine({ ...base, syncedAt: "2026-09-30T10:00:00Z", photoCount: 1 }, when).text).toMatch(/had 1 photo\.$/);
    expect(importStatusLine({ ...base, syncedAt: "2026-09-30T10:00:00Z", photoCount: 1500 }, when).text).toMatch(/had 1,500 photos\./);
  });
  it("shows the last error in plain English, with the last good import when there was one", () => {
    const first = importStatusLine({ ...base, error: "No photos were found — the album may be private, empty, or Google changed its page." }, when);
    expect(first).toEqual({ tone: "bad", text: "The import did not work: No photos were found — the album may be private, empty, or Google changed its page." });
    const later = importStatusLine({ ...base, error: "Google did not return the album page; try again later", syncedAt: "2026-09-30T10:00:00Z", photoCount: 8 }, when);
    expect(later.tone).toBe("bad");
    expect(later.text).toBe("The last import did not finish cleanly: Google did not return the album page; try again later. (Last good import: at 2026-09-30. Google Photos had 8 photos.)");
  });
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProcessCard } from "@/components/matching/process-card";
import { parseProcessAnswer } from "@/lib/matching/catch";
import {
  LIBRARY_MAX_BYTES,
  checkLibraryFile,
  fileLine,
  isFileKind,
  libraryFileFromForm,
  libraryObjectPath,
} from "@/lib/matching/files";

// CatchTheMatch Phase 1, piece 4 (migration 0928): a file or screenshot for a library entry. What a person is told before an upload starts, how the
// entry's answer reads its files, how the card shows them, and the platform actions that make the upload address, register the file and remove it.
// The database and the bucket's policy decide who may; these tests check what the portal sends and says.

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ ok: true, env: { supabaseAnonKey: "anon-key" } }) }));
const h = vi.hoisted(() => ({
  isAdmin: true,
  liveCount: 2,
  signedUpload: { data: { path: "", signedUrl: "https://storage.example/upload?token=t" }, error: null as null | { message: string } },
  rpc: vi.fn(),
  remove: vi.fn(),
  signedUrls: vi.fn(),
}));
vi.mock("@/lib/session", () => {
  const storage = {
    from: () => ({
      createSignedUploadUrl: async (path: string) => ({ data: h.signedUpload.error ? null : { path, signedUrl: h.signedUpload.data.signedUrl }, error: h.signedUpload.error }),
      remove: h.remove,
      createSignedUrls: h.signedUrls,
    }),
  };
  const db = {
    rpc: h.rpc,
    storage,
    from: () => ({ select: () => ({ eq: () => ({ is: async () => ({ count: h.liveCount, error: null }) }) }) }),
  };
  return {
    loadSession: async () => ({ status: "ok", session: { isPlatformAdmin: h.isAdmin, db, requestId: "r1", clientApp: "portal" } }),
    dbWithReason: async () => db,
  };
});

import { addLibraryFileAction, prepareLibraryUploadAction, removeLibraryFileAction } from "@/app/(app)/platform/matching/actions";
import { LibraryFiles } from "@/components/matching/library-files";

const PROGRAM = "92800000-0000-4000-8000-0000000000a1";
const FILE = "92800000-0000-4000-8000-0000000000f1";

describe("what a person is told before an upload", () => {
  it("accepts a JPEG, PNG, WebP or PDF, and takes the type from the name when the browser leaves it empty", () => {
    expect(checkLibraryFile({ name: "form.pdf", type: "application/pdf", size: 1000 })).toEqual({ ok: true, contentType: "application/pdf" });
    expect(checkLibraryFile({ name: "screen.PNG", type: "", size: 1000 })).toEqual({ ok: true, contentType: "image/png" });
    expect(checkLibraryFile({ name: "a.jpeg", type: "image/jpeg", size: 1 })).toEqual({ ok: true, contentType: "image/jpeg" });
  });
  it("refuses HEIC, an unknown type, an empty or an oversized file, and a seventh file, each in words", () => {
    const heic = checkLibraryFile({ name: "p.heic", type: "image/heic", size: 1000 });
    expect(!heic.ok && heic.error).toContain("A phone photo can be saved as a JPEG");
    expect(checkLibraryFile({ name: "x.exe", type: "", size: 1000 }).ok).toBe(false);
    expect(checkLibraryFile({ name: "x.pdf", type: "application/pdf", size: 0 })).toEqual({ ok: false, error: "The file is empty." });
    const big = checkLibraryFile({ name: "x.pdf", type: "application/pdf", size: LIBRARY_MAX_BYTES + 1 });
    expect(!big.ok && big.error).toContain("at most 10 MB");
    const seventh = checkLibraryFile({ name: "x.pdf", type: "application/pdf", size: 10 }, 6);
    expect(!seventh.ok && seventh.error).toContain("up to 6 files");
  });
  it("makes the stored name from the entry and the file only: no community, no file name", () => {
    expect(libraryObjectPath(PROGRAM.toUpperCase(), FILE, "application/pdf")).toBe(`${PROGRAM}/${FILE}.pdf`);
    expect(libraryObjectPath(PROGRAM, FILE, "image/jpeg")).toBe(`${PROGRAM}/${FILE}.jpg`);
  });
  it("reads the kind, the caption and the reason, and says what is missing", () => {
    expect(libraryFileFromForm({ kind: "form", caption: "  The   form ", reason: "Employer sent it" })).toEqual({ ok: true, kind: "form", caption: "The form", reason: "Employer sent it" });
    expect(libraryFileFromForm({ kind: "poster", caption: "x", reason: "x" })).toMatchObject({ ok: false });
    expect(libraryFileFromForm({ kind: "form", caption: "  ", reason: "x" })).toMatchObject({ ok: false, error: "Give the file a short caption: what it shows." });
    expect(libraryFileFromForm({ kind: "form", caption: "x", reason: "" })).toMatchObject({ ok: false });
    expect(libraryFileFromForm({ kind: "form", caption: "x".repeat(201), reason: "x" })).toMatchObject({ ok: false });
    expect(isFileKind("screenshot")).toBe(true);
    expect(isFileKind("poster")).toBe(false);
  });
  it("describes a file in a line", () => {
    expect(fileLine({ kind: "form", contentType: "application/pdf", bytes: 120000 })).toBe("Form · PDF · 117 KB");
    expect(fileLine({ kind: "screenshot", contentType: "image/png", bytes: 2 * 1024 * 1024 })).toBe("Screenshot · PNG · 2.0 MB");
  });
});

const answerJson = (over: Record<string, unknown> = {}) => ({
  program: { id: PROGRAM, company_name: "Acme", portal: "benevity", portal_url: "https://acme.example/match", status: "active" },
  process: { summary: "The member requests the match.", who_submits: "member", steps: ["Sign in"], documents: [], links: [], typical_days: null, tips: null, worked_on: null, worked_note: null, version: 1 },
  worked_communities: 1,
  here: null,
  files: [
    { id: FILE, kind: "form", caption: "Acme's matching form", content_type: "application/pdf", bytes: 120000, path: `${PROGRAM}/${FILE}.pdf`, added_at: "2026-10-17T10:00:00Z" },
    { id: "bad", kind: "poster", caption: "x", content_type: "application/pdf", bytes: 1, path: "p" },
  ],
  ...over,
});

describe("the entry's files on the card", () => {
  it("reads the files, leaves out one with an unknown kind, and defaults to none", () => {
    const a = parseProcessAnswer(answerJson());
    expect(a.files).toHaveLength(1);
    expect(a.files[0]).toMatchObject({ id: FILE, kind: "form", caption: "Acme's matching form", contentType: "application/pdf", bytes: 120000, url: null });
    expect(parseProcessAnswer({ program: { id: PROGRAM } }).files).toEqual([]);
  });
  it("shows each file as a link that opens in a new tab, with its kind, type and size", () => {
    const a = parseProcessAnswer(answerJson());
    a.files[0]!.url = "https://storage.example/signed?token=1";
    const html = renderToStaticMarkup(createElement(ProcessCard, { answer: a }));
    expect(html).toContain("Forms and screens");
    expect(html).toContain('href="https://storage.example/signed?token=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Acme&#x27;s matching form");
    expect(html).toContain("Form · PDF · 117 KB");
  });
  it("says in words when the links could not be made, and still lists the files", () => {
    const a = parseProcessAnswer(answerJson());
    a.filesNotice = "The files could not be opened just now (storage did not answer). Reload the page to try again.";
    const html = renderToStaticMarkup(createElement(ProcessCard, { answer: a }));
    expect(html).toContain("The files could not be opened just now");
    expect(html).toContain("Acme&#x27;s matching form");
    expect(html).not.toContain("href=\"https://storage");
  });
  it("shows nothing about files when there are none, and shows the files even before the steps are written", () => {
    expect(renderToStaticMarkup(createElement(ProcessCard, { answer: parseProcessAnswer(answerJson({ files: [] })) }))).not.toContain("Forms and screens");
    const noSteps = renderToStaticMarkup(createElement(ProcessCard, { answer: parseProcessAnswer(answerJson({ process: null })) }));
    expect(noSteps).toContain("has not written the steps");
    expect(noSteps).toContain("Forms and screens");
  });
});

describe("the editor's list", () => {
  it("lists the files with Remove, and offers Add a file until six are held", () => {
    const a = parseProcessAnswer(answerJson());
    let html = renderToStaticMarkup(createElement(LibraryFiles, { programId: PROGRAM, files: a.files, filesNotice: null }));
    expect(html).toContain("Acme&#x27;s matching form");
    expect(html).toContain("Remove");
    expect(html).toContain("Add a file");
    const six = Array.from({ length: 6 }, (_, i) => ({ ...a.files[0]!, id: `f${i}` }));
    html = renderToStaticMarkup(createElement(LibraryFiles, { programId: PROGRAM, files: six, filesNotice: null }));
    expect(html).toContain("An entry holds 6 files at most");
    expect(html).not.toContain("Add a file");
    html = renderToStaticMarkup(createElement(LibraryFiles, { programId: PROGRAM, files: [], filesNotice: "The files could not be opened just now (x)." }));
    expect(html).toContain("No file yet");
    expect(html).toContain("The files could not be opened just now");
  });
});

describe("the platform actions", () => {
  beforeEach(() => {
    h.isAdmin = true;
    h.liveCount = 2;
    h.signedUpload.error = null;
    h.rpc.mockReset();
    h.remove.mockReset();
    h.remove.mockResolvedValue({ error: null });
  });

  it("makes an upload address for Weaver's team only, under the entry's own folder", async () => {
    const r = await prepareLibraryUploadAction({ programId: PROGRAM, fileName: "form.pdf", type: "application/pdf", size: 5000 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.data?.path).toMatch(new RegExp(`^${PROGRAM}/[0-9a-f-]{36}\\.pdf$`));
    expect(r.ok && r.data?.apiKey).toBe("anon-key");
    h.isAdmin = false;
    const refused = await prepareLibraryUploadAction({ programId: PROGRAM, fileName: "form.pdf", type: "application/pdf", size: 5000 });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain("only Weaver's team");
  });
  it("checks the file before any bytes move, and says what storage refused", async () => {
    expect((await prepareLibraryUploadAction({ programId: PROGRAM, fileName: "x.exe", type: "", size: 5000 })).ok).toBe(false);
    expect((await prepareLibraryUploadAction({ programId: "nope", fileName: "x.pdf", type: "application/pdf", size: 5000 })).ok).toBe(false);
    h.liveCount = 6;
    const full = await prepareLibraryUploadAction({ programId: PROGRAM, fileName: "x.pdf", type: "application/pdf", size: 5000 });
    expect(!full.ok && full.error).toContain("up to 6 files");
    h.liveCount = 0;
    h.signedUpload.error = { message: "new row violates row-level security policy" };
    const denied = await prepareLibraryUploadAction({ programId: PROGRAM, fileName: "x.pdf", type: "application/pdf", size: 5000 });
    expect(!denied.ok && denied.error).toContain("storage refused it");
    h.signedUpload.error = { message: "Bucket not found" };
    const missing = await prepareLibraryUploadAction({ programId: PROGRAM, fileName: "x.pdf", type: "application/pdf", size: 5000 });
    expect(!missing.ok && missing.error).toContain("not set up on this server yet");
  });
  it("registers the uploaded file, and deletes the bytes when the database refuses", async () => {
    h.rpc.mockResolvedValue({ data: FILE, error: null });
    const input = { programId: PROGRAM, path: `${PROGRAM}/${FILE}.pdf`, contentType: "application/pdf", bytes: 5000, sha256: "a".repeat(64), kind: "form", caption: "The form", reason: "Employer sent it" };
    const ok = await addLibraryFileAction(input);
    expect(ok.ok).toBe(true);
    expect(h.rpc).toHaveBeenCalledWith("add_match_process_file", {
      p_program: PROGRAM, p_path: `${PROGRAM}/${FILE}.pdf`, p_content_type: "application/pdf", p_bytes: 5000, p_sha256: "a".repeat(64), p_kind: "form", p_caption: "The form", p_reason: "Employer sent it",
    });
    expect(h.remove).not.toHaveBeenCalled();
    h.rpc.mockResolvedValue({ data: null, error: { message: "An entry can have up to 6 files. Remove one first.", code: "22023" } });
    const refused = await addLibraryFileAction(input);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toContain("Could not add the file — An entry can have up to 6 files");
    expect(h.remove).toHaveBeenCalledWith([`${PROGRAM}/${FILE}.pdf`]);
  });
  it("deletes the bytes and says what is missing when the caption or the reason is", async () => {
    const r = await addLibraryFileAction({ programId: PROGRAM, path: `${PROGRAM}/${FILE}.pdf`, contentType: "application/pdf", bytes: 5000, sha256: null, kind: "form", caption: "", reason: "x" });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("give the file a short caption");
    expect(h.remove).toHaveBeenCalledWith([`${PROGRAM}/${FILE}.pdf`]);
    expect(h.rpc).not.toHaveBeenCalled();
  });
  it("removes a file with a reason and deletes its stored copy", async () => {
    h.rpc.mockResolvedValue({ data: { id: FILE, storage_path: `${PROGRAM}/${FILE}.pdf` }, error: null });
    const r = await removeLibraryFileAction({ fileId: FILE, programId: PROGRAM, reason: "Replaced" });
    expect(r).toMatchObject({ ok: true, message: "File removed from the library." });
    expect(h.rpc).toHaveBeenCalledWith("remove_match_process_file", { p_file: FILE, p_reason: "Replaced" });
    expect(h.remove).toHaveBeenCalledWith([`${PROGRAM}/${FILE}.pdf`]);
    expect((await removeLibraryFileAction({ fileId: FILE, programId: PROGRAM, reason: "" })).ok).toBe(false);
    h.remove.mockResolvedValue({ error: { message: "x" } });
    const partial = await removeLibraryFileAction({ fileId: FILE, programId: PROGRAM, reason: "Replaced" });
    expect(partial.ok && partial.message).toContain("could not be deleted just now");
  });
});

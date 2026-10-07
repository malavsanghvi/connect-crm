import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ClamdError, clamdTarget, clamdVersion, describeTarget, isLimitsHeuristic, isSizeLimit, parseScanReply, ping, scanStream, type ClamdTarget,
} from "../src/clamd";
import { serveClamd, startFakeClamd, VIRUS_MARKER, type FakeClamd, type FakeClamdState } from "./fake-clamd";

async function* chunks(...parts: (string | Uint8Array)[]): AsyncIterable<Uint8Array> {
  for (const p of parts) yield typeof p === "string" ? Buffer.from(p, "latin1") : p;
}

describe("clamd: answers and settings", () => {
  it("reads clamd's answers", () => {
    expect(parseScanReply("stream: OK\0")).toEqual({ result: "clean" });
    expect(parseScanReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({ result: "infected", signature: "Win.Test.EICAR_HDB-1" });
    expect(parseScanReply("stream: Heuristics.Limits.Exceeded.MaxFileSize FOUND")).toEqual({ result: "infected", signature: "Heuristics.Limits.Exceeded.MaxFileSize" });
    expect(parseScanReply("INSTREAM size limit exceeded. ERROR\0")).toEqual({ result: "error", message: "INSTREAM size limit exceeded." });
    expect(parseScanReply("stream: Can't allocate memory ERROR")).toEqual({ result: "error", message: "Can't allocate memory" });
    expect(parseScanReply("something odd")).toMatchObject({ result: "error", message: expect.stringContaining("does not understand") });
    expect(parseScanReply("stream: Bad\u0007Name FOUND")).toEqual({ result: "infected", signature: "BadName" });
    expect(isSizeLimit("INSTREAM size limit exceeded.")).toBe(true);
    expect(isLimitsHeuristic("Heuristics.Limits.Exceeded.MaxRecursion")).toBe(true);
    expect(isLimitsHeuristic("Win.Test.EICAR_HDB-1")).toBe(false);
  });

  it("finds clamd from CLAMD_SOCKET, or CLAMD_HOST and CLAMD_PORT (3310 by default)", () => {
    expect(clamdTarget({})).toBeNull();
    expect(clamdTarget({ CLAMD_HOST: " 127.0.0.1 " })).toEqual({ kind: "tcp", host: "127.0.0.1", port: 3310 });
    expect(clamdTarget({ CLAMD_HOST: "127.0.0.1", CLAMD_PORT: "3311" })).toEqual({ kind: "tcp", host: "127.0.0.1", port: 3311 });
    expect(clamdTarget({ CLAMD_HOST: "127.0.0.1", CLAMD_PORT: "nope" })).toEqual({ kind: "tcp", host: "127.0.0.1", port: 3310 });
    expect(clamdTarget({ CLAMD_SOCKET: "/run/clamav/clamd.ctl", CLAMD_HOST: "127.0.0.1" })).toEqual({ kind: "socket", path: "/run/clamav/clamd.ctl" });
    expect(describeTarget({ kind: "tcp", host: "127.0.0.1", port: 3310 })).toBe("127.0.0.1:3310");
  });
});

describe("clamd: talking to a clamd (an in-process fake)", () => {
  let fake: FakeClamd;
  let target: ClamdTarget;
  beforeAll(async () => {
    fake = await startFakeClamd();
    target = { kind: "tcp", host: "127.0.0.1", port: fake.port };
  });
  afterAll(() => fake.close());

  it("pings and asks the version", async () => {
    expect(await ping(target)).toBe(true);
    expect(await clamdVersion(target)).toBe("ClamAV 1.4.3/27790/Tue Oct  6 08:00:00 2026");
    expect(fake.commands.slice(0, 2)).toEqual(["zPING", "zVERSION"]);
  });

  it("streams a file in 64 KiB chunks and ends it with a zero-length chunk", async () => {
    fake.chunks.length = 0;
    const big = Buffer.alloc(150 * 1024, 7);
    const { verdict, bytes } = await scanStream(target, chunks(big.subarray(0, 100_000), big.subarray(100_000)));
    expect(verdict).toEqual({ result: "clean" });
    expect(bytes).toBe(150 * 1024);
    expect(fake.received.at(-1)!.equals(big)).toBe(true);
    expect(Math.max(...fake.chunks)).toBe(64 * 1024);
    expect(fake.chunks.reduce((a, b) => a + b, 0)).toBe(150 * 1024);
  });

  it("says what it found", async () => {
    expect((await scanStream(target, chunks("hello ", VIRUS_MARKER, " world"))).verdict).toEqual({ result: "infected", signature: "Test.Marker.Virus" });
    expect((await scanStream(target, chunks("LIMITS"))).verdict).toEqual({ result: "infected", signature: "Heuristics.Limits.Exceeded.MaxScanSize" });
  });

  it("checks an empty file", async () => {
    expect(await scanStream(target, chunks())).toEqual({ verdict: { result: "clean" }, bytes: 0 });
  });

  it("stops when the source fails, and says why", async () => {
    async function* broken(): AsyncIterable<Uint8Array> {
      yield Buffer.from("part one");
      throw new Error("the download was cut short");
    }
    await expect(scanStream(target, broken())).rejects.toThrow(/cut short/);
  });
});

describe("clamd: when it goes wrong", () => {
  it("takes clamd's answer when it stops reading at its size limit", async () => {
    const fake = await startFakeClamd("limit", 100_000);
    try {
      const { verdict } = await scanStream({ kind: "tcp", host: "127.0.0.1", port: fake.port }, chunks(Buffer.alloc(1024 * 1024, 1)));
      expect(verdict.result).toBe("error");
      expect(isSizeLimit((verdict as { message: string }).message)).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it("gives up when clamd never answers", async () => {
    const fake = await startFakeClamd("silent");
    try {
      await expect(scanStream({ kind: "tcp", host: "127.0.0.1", port: fake.port }, chunks("x"), { timeoutMs: 300 })).rejects.toThrow(/did not answer within 300 ms/);
    } finally {
      await fake.close();
    }
  });

  it("says plainly when clamd cannot be reached", async () => {
    const server = net.createServer();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise<void>((r) => server.close(() => r()));
    const err = await ping({ kind: "tcp", host: "127.0.0.1", port }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClamdError);
    expect(String((err as Error).message)).toMatch(/could not reach clamd at 127\.0\.0\.1:\d+/);
  });

  it("talks over a local socket too (CLAMD_SOCKET)", async () => {
    const path = process.platform === "win32" ? `\\\\.\\pipe\\connect-clamd-test-${process.pid}` : join(tmpdir(), `connect-clamd-test-${process.pid}.sock`);
    const state: FakeClamdState = { commands: [], received: [], chunks: [], openScans: 0, maxOpenScans: 0, mode: "normal", limitBytes: 0 };
    const server = net.createServer((sock) => serveClamd(state, sock));
    await new Promise<void>((r) => server.listen(path, r));
    try {
      expect(await ping({ kind: "socket", path })).toBe(true);
      expect((await scanStream({ kind: "socket", path }, chunks(VIRUS_MARKER))).verdict.result).toBe("infected");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

// A real clamd, only when one is configured (CLAMD_HOST, e.g. 127.0.0.1 on a droplet after deploy/clamav-setup.sh). The
// EICAR test file is put together here from two halves, so no file in this repository is itself a "virus".
const live = process.env.CLAMD_HOST ? describe : describe.skip;
live("a real clamd (CLAMD_HOST)", () => {
  it("finds the EICAR test file and passes a harmless one", async () => {
    const target = clamdTarget(process.env)!;
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$" + "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    expect(await ping(target)).toBe(true);
    expect(await clamdVersion(target)).toMatch(/^ClamAV /);
    const found = await scanStream(target, chunks(eicar));
    expect(found.verdict).toMatchObject({ result: "infected", signature: expect.stringMatching(/eicar/i) });
    expect((await scanStream(target, chunks("Namo Arihantanam\n"))).verdict).toEqual({ result: "clean" });
  });
});

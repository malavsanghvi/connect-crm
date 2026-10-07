// An in-process stand-in for clamd (net.createServer) that speaks the same protocol as the real one: z-commands ending in
// NUL, INSTREAM chunks with a 4-byte big-endian length, a zero-length chunk at the end, NUL-terminated answers. What it
// finds: a stream holding VIRUS_MARKER is infected (Test.Marker.Virus), one holding "LIMITS" hits a limits heuristic.

import net from "node:net";
import type { AddressInfo } from "node:net";

/**
 * normal: answers each command; limit: answers "size limit exceeded" once more than limitBytes arrived and reads (ignores)
 * the rest; silent: never answers a scan; reset: drops the connection once more than limitBytes arrived.
 */
export type FakeClamdMode = "normal" | "limit" | "silent" | "reset";

export type FakeClamdState = {
  /** Every command received, in order (zPING, zVERSION, zINSTREAM). */
  commands: string[];
  /** The bytes of each complete INSTREAM, in order. */
  received: Buffer[];
  /** The length of each INSTREAM chunk received (the terminator excluded). */
  chunks: number[];
  /** INSTREAM sessions open now, and the most that were open at once. */
  openScans: number;
  maxOpenScans: number;
  mode: FakeClamdMode;
  /** "limit" mode: answer "size limit exceeded" once more than this many bytes arrived. */
  limitBytes: number;
};

export type FakeClamd = FakeClamdState & { port: number; close(): Promise<void> };

export const VIRUS_MARKER = "FAKE-CLAMD-VIRUS-MARKER";

/** One client connection, as clamd would serve it. */
export function serveClamd(fake: FakeClamdState, sock: net.Socket): void {
  let buf = Buffer.alloc(0);
  let streaming = false;
  let answered = false;
  let total = 0;
  const parts: Buffer[] = [];
  sock.on("error", () => undefined);
  sock.on("end", () => sock.end());
  sock.on("close", () => {
    if (streaming) fake.openScans -= 1;
    streaming = false;
  });
  sock.on("data", (d: Buffer) => {
    if (answered) return; // past the size limit: read and ignore the rest, as a polite server would
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (!streaming) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        const cmd = buf.subarray(0, nul).toString("latin1");
        buf = buf.subarray(nul + 1);
        fake.commands.push(cmd);
        if (cmd === "zPING") return void sock.end("PONG\0");
        if (cmd === "zVERSION") return void sock.end("ClamAV 1.4.3/27790/Tue Oct  6 08:00:00 2026\0");
        if (cmd !== "zINSTREAM") return void sock.end("UNKNOWN COMMAND\0");
        streaming = true;
        fake.openScans += 1;
        fake.maxOpenScans = Math.max(fake.maxOpenScans, fake.openScans);
        continue;
      }
      if (buf.length < 4) return;
      const len = buf.readUInt32BE(0);
      if (len === 0) {
        buf = buf.subarray(4);
        const content = Buffer.concat(parts);
        fake.received.push(content);
        if (fake.mode === "silent") return; // never answers
        const text = content.toString("latin1");
        const reply = text.includes(VIRUS_MARKER)
          ? "stream: Test.Marker.Virus FOUND\0"
          : text.includes("LIMITS")
            ? "stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND\0"
            : "stream: OK\0";
        return void sock.end(reply);
      }
      if (buf.length < 4 + len) return;
      fake.chunks.push(len);
      parts.push(Buffer.from(buf.subarray(4, 4 + len)));
      total += len;
      buf = buf.subarray(4 + len);
      if (fake.mode === "limit" && total > fake.limitBytes) {
        answered = true;
        return void sock.write("INSTREAM size limit exceeded. ERROR\0");
      }
      if (fake.mode === "reset" && total > fake.limitBytes) return void sock.destroy();
    }
  });
}

export async function startFakeClamd(mode: FakeClamdMode = "normal", limitBytes = 1000): Promise<FakeClamd> {
  const fake: FakeClamdState = { commands: [], received: [], chunks: [], openScans: 0, maxOpenScans: 0, mode, limitBytes };
  const server = net.createServer((sock) => serveClamd(fake, sock));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return Object.assign(fake, {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
      }),
  });
}

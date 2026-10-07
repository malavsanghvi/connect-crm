// A small clamd client (ClamAV's scanning daemon) over node:net: no npm dependency, no file on this machine's disk.
//
//   zINSTREAM  the file is streamed to clamd: "zINSTREAM\0", then chunks, each a 4-byte big-endian length and that many
//              bytes (64 KiB here), then a zero-length chunk. clamd answers once, NUL-terminated:
//                "stream: OK"                        clean
//                "stream: <signature> FOUND"         infected (a heuristic such as Heuristics.Limits.Exceeded.* too)
//                "<reason> ERROR"                    e.g. "INSTREAM size limit exceeded. ERROR" past StreamMaxLength
//              Only an answer that ends with its NUL counts (one cut short is a failure, never a verdict), and only one that
//              comes after the whole file was sent: the one thing clamd may say early is an ERROR (its size limit). An early
//              "OK" or "FOUND" is a failure too, and the file is checked again.
//   zPING      "PONG": is clamd there?
//   zVERSION   "ClamAV 1.4.3/27790/Mon Oct  6 08:31:00 2026": the engine and its signature database.
//
// Where clamd listens: CLAMD_SOCKET (a unix socket path) or CLAMD_HOST and CLAMD_PORT (default 3310). deploy/clamav-setup.sh
// makes it listen on 127.0.0.1:3310 only. Every command has a connect timeout and an overall timeout.

import net from "node:net";

import type { Env } from "./config";

export type ClamdTarget = { kind: "socket"; path: string } | { kind: "tcp"; host: string; port: number };

/** clamd's address from the environment, or null when neither CLAMD_SOCKET nor CLAMD_HOST is set. */
export function clamdTarget(env: Env): ClamdTarget | null {
  const path = env.CLAMD_SOCKET?.trim();
  if (path) return { kind: "socket", path };
  const host = env.CLAMD_HOST?.trim();
  if (!host) return null;
  const raw = env.CLAMD_PORT?.trim();
  const port = raw ? Number(raw) : 3310;
  return { kind: "tcp", host, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3310 };
}

export function describeTarget(t: ClamdTarget): string {
  return t.kind === "socket" ? `unix socket ${t.path}` : `${t.host}:${t.port}`;
}

export type ClamdOptions = {
  /** Connecting (ms). */
  connectTimeoutMs?: number;
  /** The whole command, from connecting to the answer (ms). clamd's own MaxScanTime is 60 s (clamav-setup.sh). */
  timeoutMs?: number;
  /** Bytes per INSTREAM chunk. */
  chunkBytes?: number;
};

export const CLAMD_DEFAULTS: Required<ClamdOptions> = { connectTimeoutMs: 5000, timeoutMs: 120000, chunkBytes: 64 * 1024 };

export type Verdict = { result: "clean" } | { result: "infected"; signature: string } | { result: "error"; message: string };

export class ClamdError extends Error {
  override name = "ClamdError";
}

/** A signature as it may be stored and shown: printable ASCII, at most 200 characters. */
function cleanSignature(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 200) || "unnamed";
}

/** clamd's answer to INSTREAM, in our terms. */
export function parseScanReply(raw: string): Verdict {
  const text = raw.replace(/\0+$/, "").trim();
  const body = text.replace(/^stream:\s*/, "");
  if (body === "OK") return { result: "clean" };
  const found = /^(.+?)\s+FOUND$/.exec(body);
  if (found) return { result: "infected", signature: cleanSignature(found[1]!) };
  if (/\bERROR$/.test(body)) return { result: "error", message: cleanSignature(body.replace(/\s*ERROR$/, "")) || "clamd reported an error" };
  return { result: "error", message: `clamd answered something this service does not understand (${cleanSignature(body)})` };
}

/** The size limit (StreamMaxLength) was reached: no point trying again with the same file. */
export function isSizeLimit(message: string): boolean {
  return /size limit exceeded/i.test(message);
}

/** A heuristic "found" for a file clamd could not check completely (too big, too deep, too many files): not a virus. */
export function isLimitsHeuristic(signature: string): boolean {
  return /^Heuristics\.Limits\.Exceeded/i.test(signature);
}

type Conversation = {
  /** Resolves with clamd's answer, up to its NUL; rejects when the connection ends or fails before that. */
  reply: Promise<string>;
  /** clamd has answered (or the conversation failed): stop sending. */
  answered(): boolean;
  /** The request is complete: call it right before its last bytes are written. Any answer that began before it is early. */
  sent(): void;
  /** Some of the answer arrived before sent() was called. */
  early(): boolean;
  /** Send bytes; resolves once they are handed to the socket (backpressure), at once after the answer. */
  write(bytes: Uint8Array): Promise<void>;
};

function open(target: ClamdTarget, connectTimeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = target.kind === "socket" ? net.createConnection({ path: target.path }) : net.createConnection({ host: target.host, port: target.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ClamdError(`could not reach clamd at ${describeTarget(target)} within ${connectTimeoutMs} ms`));
    }, connectTimeoutMs);
    const failed = (err: Error) => {
      clearTimeout(timer);
      reject(new ClamdError(`could not reach clamd at ${describeTarget(target)} (${err.message})`));
    };
    socket.once("error", failed);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.off("error", failed);
      resolve(socket);
    });
  });
}

async function converse<T>(target: ClamdTarget, opts: Required<ClamdOptions>, run: (c: Conversation) => Promise<T>): Promise<T> {
  const socket = await open(target, opts.connectTimeoutMs);
  let text = "";
  let done = false;
  let failure: ClamdError | null = null;
  let endSent = false;
  let early = false;
  let settle!: (v: string) => void;
  let fail!: (e: Error) => void;
  const reply = new Promise<string>((res, rej) => {
    settle = res;
    fail = rej;
  });
  reply.catch(() => undefined); // awaited by the caller; never an unhandled rejection
  const answer = () => {
    if (done) return;
    done = true;
    settle(text);
  };
  // Only an answer that ends with its NUL counts: one cut short (the connection closed or failed first) is a failure,
  // never a verdict, however much of it arrived.
  const lost = (why: string) => {
    if (done) return;
    done = true;
    failure = new ClamdError(text ? `${why}, part way through its answer` : why);
    fail(failure);
  };
  socket.on("data", (d: Buffer) => {
    if (done) return;
    if (!endSent) early = true;
    const s = d.toString("latin1");
    const nul = s.indexOf("\0");
    text += nul >= 0 ? s.slice(0, nul) : s;
    if (nul >= 0) {
      answer();
      socket.end();
    } else if (text.length > 4096) {
      lost("clamd's answer was too long");
      socket.destroy();
    }
  });
  socket.on("end", () => lost("clamd closed the connection without an answer"));
  socket.on("close", () => lost("clamd closed the connection without an answer"));
  socket.on("error", (err) => lost(`the connection to clamd failed (${err.message})`));
  const deadline = setTimeout(() => {
    lost(`clamd did not answer within ${opts.timeoutMs} ms`);
    socket.destroy();
  }, opts.timeoutMs);
  try {
    return await run({
      reply,
      answered: () => done,
      sent: () => {
        endSent = true;
      },
      early: () => early,
      write: (bytes) =>
        new Promise<void>((resolve, reject) => {
          if (done) return resolve();
          socket.write(bytes, (err) => {
            if (!err || done) resolve();
            else reject(failure ?? new ClamdError(`could not send the file to clamd (${err.message})`));
          });
        }),
    });
  } finally {
    clearTimeout(deadline);
    socket.destroy();
  }
}

/** One short command (zPING, zVERSION): its answer. */
async function command(target: ClamdTarget, cmd: string, options: ClamdOptions): Promise<string> {
  const opts = { ...CLAMD_DEFAULTS, timeoutMs: 10000, ...options };
  return converse(target, opts, async (c) => {
    await c.write(Buffer.from(`z${cmd}\0`, "latin1"));
    return (await c.reply).trim();
  });
}

/** Is clamd there? */
export async function ping(target: ClamdTarget, options: ClamdOptions = {}): Promise<boolean> {
  return (await command(target, "PING", options)) === "PONG";
}

/** The engine and signature database clamd scans with ("ClamAV 1.4.3/27790/…"). */
export async function clamdVersion(target: ClamdTarget, options: ClamdOptions = {}): Promise<string> {
  const v = (await command(target, "VERSION", options)).replace(/[^\x20-\x7e]/g, "").slice(0, 200);
  if (!/^ClamAV /.test(v)) throw new ClamdError(`clamd answered VERSION with something unexpected (${v.slice(0, 80)})`);
  return v;
}

/**
 * Streams the bytes to clamd (INSTREAM) and returns its verdict and how many bytes were sent. A source that fails (a
 * download cut short) rejects; so does a clamd that cannot be reached, closes without an answer or times out. An answer
 * that comes before the whole file was sent is never taken as clean (or as found): only an ERROR may come early (its
 * size limit); anything else then is a failure, and the file is checked again.
 */
export async function scanStream(target: ClamdTarget, source: AsyncIterable<Uint8Array>, options: ClamdOptions = {}): Promise<{ verdict: Verdict; bytes: number }> {
  const opts = { ...CLAMD_DEFAULTS, ...options };
  return converse(target, opts, async (c) => {
    await c.write(Buffer.from("zINSTREAM\0", "latin1"));
    let bytes = 0;
    let early = false;
    outer: for await (const piece of source) {
      for (let off = 0; off < piece.byteLength; off += opts.chunkBytes) {
        if (c.answered()) {
          early = true;
          break outer;
        }
        const part = piece.subarray(off, Math.min(off + opts.chunkBytes, piece.byteLength));
        const head = Buffer.alloc(4);
        head.writeUInt32BE(part.byteLength, 0);
        await c.write(Buffer.concat([head, part]));
        bytes += part.byteLength;
      }
    }
    if (c.answered()) early = true;
    else {
      c.sent(); // from here on an answer is a real one; before it, it was early
      await c.write(Buffer.alloc(4)); // the zero-length chunk: the end of the file
    }
    const verdict = parseScanReply(await c.reply);
    if ((early || c.early()) && verdict.result !== "error") {
      throw new ClamdError(`clamd answered before the whole file was sent (after ${bytes} bytes); the answer is not used`);
    }
    return { verdict, bytes };
  });
}

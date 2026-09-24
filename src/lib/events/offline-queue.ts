// Offline check-in queue. When the phone has no signal, scans are kept on the
// device and replayed (with p_offline = true) once the connection returns.
// Storage is injected so this is testable and can sit on localStorage.

export type QueuedScan = {
  id: string;
  eventId: string;
  token: string;
  station: string;
  attendeeIds: string[] | null;
  queuedAt: string;
  attempts: number;
  lastError?: string;
};

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** What happened when one queued scan was sent. */
export type SendOutcome =
  | { kind: "sent" }
  /** The server answered but refused permanently (e.g. invalid token). The scan is recorded server-side; drop it. */
  | { kind: "rejected"; error: string }
  /** No connection / server unreachable: keep it and stop replaying for now. */
  | { kind: "retry"; error: string };

export type ReplayReport = { sent: number; rejected: { scan: QueuedScan; error: string }[]; remaining: number };

export function queueKey(eventId: string) {
  return `connect-crm:scan-queue:${eventId}`;
}

function sameScan(a: Pick<QueuedScan, "eventId" | "token" | "station" | "attendeeIds">, b: typeof a) {
  const ids = (x: string[] | null) => (x ? [...x].sort().join(",") : "*");
  return a.eventId === b.eventId && a.token === b.token && a.station === b.station && ids(a.attendeeIds) === ids(b.attendeeIds);
}

export function createScanQueue(storage: KeyValueStorage, key: string, makeId: () => string = defaultId) {
  function read(): QueuedScan[] {
    const raw = storage.getItem(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as QueuedScan[]) : [];
    } catch (error) {
      // Corrupt entry: log it and treat the queue as empty rather than crash the scanner.
      console.error("[offline-queue] saved scans could not be read and were ignored", error);
      return [];
    }
  }
  function write(items: QueuedScan[]) {
    storage.setItem(key, JSON.stringify(items));
  }

  return {
    list: read,
    size: () => read().length,
    /** Adds a scan unless an identical one is already waiting. Returns the queued item. */
    enqueue(scan: { eventId: string; token: string; station: string; attendeeIds?: string[] | null }, now: Date = new Date()): QueuedScan {
      const items = read();
      const candidate = { eventId: scan.eventId, token: scan.token.trim(), station: scan.station, attendeeIds: scan.attendeeIds ?? null };
      const existing = items.find((i) => sameScan(i, candidate));
      if (existing) return existing;
      const item: QueuedScan = { ...candidate, id: makeId(), queuedAt: now.toISOString(), attempts: 0 };
      write([...items, item]);
      return item;
    },
    remove(id: string) {
      write(read().filter((i) => i.id !== id));
    },
    clear() {
      write([]);
    },
    /** Send queued scans oldest-first. Stops at the first "retry" so order is preserved. */
    async replay(send: (scan: QueuedScan) => Promise<SendOutcome>): Promise<ReplayReport> {
      const report: ReplayReport = { sent: 0, rejected: [], remaining: 0 };
      for (const scan of read()) {
        let outcome: SendOutcome;
        try {
          outcome = await send(scan);
        } catch (error) {
          outcome = { kind: "retry", error: error instanceof Error ? error.message : String(error) };
        }
        if (outcome.kind === "retry") {
          write(read().map((i) => (i.id === scan.id ? { ...i, attempts: i.attempts + 1, lastError: outcome.error } : i)));
          break;
        }
        write(read().filter((i) => i.id !== scan.id));
        if (outcome.kind === "sent") report.sent += 1;
        else report.rejected.push({ scan, error: outcome.error });
      }
      report.remaining = read().length;
      return report;
    },
  };
}

export type ScanQueue = ReturnType<typeof createScanQueue>;

/** True when an error means "we could not talk to the server" rather than "the server said no". */
export function isConnectivityError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return true;
  const e = error as { message?: string; name?: string } | null;
  const msg = (e?.message ?? String(error ?? "")).toLowerCase();
  return (
    e?.name === "TypeError" ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("fetch failed")
  );
}

function defaultId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** In-memory storage (tests, or when localStorage is unavailable). */
export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

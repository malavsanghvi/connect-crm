"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { explainError } from "@/lib/errors";
import { formatTime } from "@/lib/events/format";
import {
  createScanQueue,
  isConnectivityError,
  memoryStorage,
  queueKey,
  type KeyValueStorage,
  type QueuedScan,
  type SendOutcome,
} from "@/lib/events/offline-queue";
import { extractTicketToken, randomToken } from "@/lib/events/tokens";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { CameraScanner } from "./camera-scanner";
import { WalkInPanel } from "./walk-in-panel";

type Station = "entry" | "food" | "gifts";
const STATIONS: { key: Station; label: string; verb: string; done: string }[] = [
  { key: "entry", label: "Entry", verb: "Check in", done: "Checked in" },
  { key: "food", label: "Food", verb: "Serve food to", done: "Food served to" },
  { key: "gifts", label: "Gifts", verb: "Give gifts to", done: "Gifts given to" },
];

type Person = {
  id: string;
  name: string;
  checkedIn: boolean;
  served: boolean;
  gift: boolean;
  child: boolean;
  senior: boolean;
  assistance: boolean;
  lunch: string | null;
};
type Party = { token: string; name: string; people: Person[] };
type Notice = { tone: "success" | "warning" | "danger" | "navy"; text: string; action?: { label: string; run: () => void } };
type RpcRow = { result: string; rsvp_id: string | null; household_name: string | null; attendees: unknown };
type RpcOutcome = { kind: "ok"; row: RpcRow } | { kind: "offline"; error: string } | { kind: "error"; error: string };

const QUEUE_EVENT = "connect-crm:scan-queue";

function safeStorage(): KeyValueStorage {
  try {
    const t = "__connect_probe__";
    window.localStorage.setItem(t, t);
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch (error) {
    console.error("[checkin] localStorage unavailable; offline scans will be kept in memory only", error);
    return memoryStorage();
  }
}

function deviceId(): string {
  try {
    const key = "connect-crm:device-id";
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = `web-${randomToken(6)}`;
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch (error) {
    console.error("[checkin] could not read or save this device's id; scans are logged as web-unknown", error);
    return "web-unknown";
  }
}

function friendlyError(error: unknown, doing: string): string {
  return `Could not ${doing} — ${explainError(error)}.`;
}

function peopleFromJson(json: unknown): Person[] {
  if (!Array.isArray(json)) return [];
  return json.map((p) => {
    const x = p as Record<string, unknown>;
    return {
      id: String(x.id),
      name: String(x.name ?? "Guest"),
      checkedIn: Boolean(x.checked_in),
      served: false,
      gift: false,
      child: Boolean(x.child_under_12),
      senior: Boolean(x.senior),
      assistance: Boolean(x.assistance),
      lunch: typeof x.lunch === "string" ? x.lunch : null,
    };
  });
}

function familyName(row: RpcRow, people: Person[]) {
  if (row.household_name) return row.household_name;
  const last = people[0]?.name.split(" ").slice(-1)[0];
  return last ? `${last} family` : "This party";
}

function resultText(result: string, household?: string | null): string {
  switch (result) {
    case "invalid":
      return "Not recognised — this isn't a ticket or member card we know. Try the phone lookup.";
    case "wrong_event":
      return "This ticket is for a different event.";
    case "revoked":
      return "This ticket was cancelled. Send the family to the help desk.";
    case "ambiguous":
      return "This card matches more than one person. Use the phone lookup instead.";
    case "no_rsvp":
      return `${household ?? "This family"} has no RSVP for this event.`;
    case "duplicate":
      return `${household ?? "This party"} is already checked in.`;
    default:
      return `Unexpected result: ${result}.`;
  }
}

export function CheckInScreen({
  eventId,
  eventStatus,
  initialCheckedIn,
  expected,
  timeZone,
  supabaseEnv,
}: {
  eventId: string;
  eventStatus: string;
  initialCheckedIn: number;
  /** People on confirmed RSVPs (the denominator of "N of M checked in"). */
  expected: number;
  timeZone: string;
  supabaseEnv: { supabaseUrl: string; supabaseAnonKey: string };
}) {
  const getBrowserClient = useCallback(() => getSupabaseBrowserClient(supabaseEnv), [supabaseEnv]);
  const queue = useMemo(() => (typeof window === "undefined" ? null : createScanQueue(safeStorage(), queueKey(eventId))), [eventId]);
  const queued = useSyncExternalStore(
    (cb) => {
      window.addEventListener(QUEUE_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(QUEUE_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    () => queue?.size() ?? 0,
    () => 0,
  );
  const online = useSyncExternalStore(
    (cb) => {
      window.addEventListener("online", cb);
      window.addEventListener("offline", cb);
      return () => {
        window.removeEventListener("online", cb);
        window.removeEventListener("offline", cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );

  const [station, setStation] = useState<Station>("entry");
  const [kiosk, setKiosk] = useState(false);
  const [camera, setCamera] = useState(false);
  const [mode, setMode] = useState<"scan" | "party" | "walkin">("scan");
  const [walkInName, setWalkInName] = useState<string>("");
  const [party, setParty] = useState<Party | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [problem, setProblem] = useState<{ text: string; retry?: () => void } | null>(null);
  const [rejected, setRejected] = useState<{ token: string; error: string }[]>([]);
  const [checkedIn, setCheckedIn] = useState(initialCheckedIn);
  const [manual, setManual] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const replaying = useRef(false);
  const stationInfo = STATIONS.find((s) => s.key === station)!;

  const notifyQueue = () => window.dispatchEvent(new Event(QUEUE_EVENT));

  const focusScanner = useCallback(() => {
    // Keep the input focused so a USB/Bluetooth keyboard-wedge scanner can type into it.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (mode === "scan" && !camera) focusScanner();
  }, [mode, camera, focusScanner]);

  const refreshCount = useCallback(async () => {
    try {
      const res = await getBrowserClient()
        .from("attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .not("checked_in_at", "is", null);
      if (res.error) console.error("[checkin] count refresh failed", res.error);
      else if (typeof res.count === "number") setCheckedIn(res.count);
    } catch (error) {
      console.error("[checkin] count refresh failed", error);
    }
  }, [eventId, getBrowserClient]);

  useEffect(() => {
    const t = setInterval(() => void refreshCount(), 30_000);
    return () => clearInterval(t);
  }, [refreshCount]);

  const callCheckIn = useCallback(
    async (token: string, st: string, attendeeIds: string[] | null, offline = false): Promise<RpcOutcome> => {
      try {
        const { data, error } = await getBrowserClient().rpc("check_in", {
          p_event: eventId,
          p_token: token,
          p_station: st,
          ...(attendeeIds ? { p_attendee_ids: attendeeIds } : {}),
          p_device: deviceId(),
          p_offline: offline,
        });
        if (error) {
          if (isConnectivityError(error)) return { kind: "offline", error: error.message };
          console.error("[checkin] check_in failed", error);
          return { kind: "error", error: friendlyError(error, st === "lookup" ? "look up that code" : "record the check-in") };
        }
        const row = (Array.isArray(data) ? data[0] : data) as RpcRow | undefined;
        if (!row) return { kind: "error", error: "The server didn't return a result. Try again." };
        return { kind: "ok", row };
      } catch (error) {
        if (isConnectivityError(error)) return { kind: "offline", error: String(error) };
        console.error("[checkin] check_in threw", error);
        return { kind: "error", error: friendlyError(error, "reach the check-in service") };
      }
    },
    [eventId, getBrowserClient],
  );

  const saveOffline = useCallback(
    (token: string, st: Station, attendeeIds: string[] | null, why: string) => {
      if (!queue) return;
      queue.enqueue({ eventId, token, station: st, attendeeIds });
      notifyQueue();
      setNotice({
        tone: "warning",
        text: `${why} — scan saved on this phone. It will sync when the connection is back${attendeeIds ? "" : " (the whole party will be checked in)"}.`,
      });
      setParty(null);
      setMode("scan");
    },
    [eventId, queue],
  );

  const replay = useCallback(async () => {
    if (!queue || replaying.current || queue.size() === 0) return;
    replaying.current = true;
    try {
      const report = await queue.replay(async (scan: QueuedScan): Promise<SendOutcome> => {
        const res = await callCheckIn(scan.token, scan.station, scan.attendeeIds, true);
        if (res.kind === "offline") return { kind: "retry", error: res.error };
        if (res.kind === "error") return { kind: "rejected", error: res.error };
        return res.row.result === "ok" || res.row.result === "duplicate" ? { kind: "sent" } : { kind: "rejected", error: resultText(res.row.result) };
      });
      notifyQueue();
      if (report.sent) setNotice({ tone: "success", text: `Synced ${report.sent} offline scan${report.sent === 1 ? "" : "s"}.` });
      if (report.rejected.length) setRejected((cur) => [...cur, ...report.rejected.map((r) => ({ token: r.scan.token, error: r.error }))]);
      if (report.sent) void refreshCount();
    } finally {
      replaying.current = false;
    }
  }, [queue, callCheckIn, refreshCount]);

  useEffect(() => {
    if (!online || queued === 0) return;
    const first = setTimeout(() => void replay(), 500);
    const again = setInterval(() => void replay(), 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [online, queued, replay]);

  function showResultProblem(row: RpcRow) {
    if (row.result === "no_rsvp") {
      setNotice({
        tone: "warning",
        text: resultText("no_rsvp", row.household_name),
        action: {
          label: "Register as walk-in",
          run: () => {
            setWalkInName(row.household_name ?? "");
            setMode("walkin");
            setNotice(null);
          },
        },
      });
    } else if (row.result === "ambiguous" || row.result === "invalid") {
      setNotice({
        tone: "danger",
        text: resultText(row.result),
        action: {
          label: "Find by phone",
          run: () => {
            setWalkInName("");
            setMode("walkin");
            setNotice(null);
          },
        },
      });
    } else {
      setNotice({ tone: row.result === "duplicate" ? "warning" : "danger", text: resultText(row.result, row.household_name) });
    }
  }

  async function confirm(token: string, attendeeIds: string[] | null, st: Station = station) {
    setBusy(true);
    setProblem(null);
    const res = await callCheckIn(token, st, attendeeIds);
    setBusy(false);
    if (res.kind === "offline") return saveOffline(token, st, attendeeIds, "No connection");
    if (res.kind === "error") {
      setProblem({ text: res.error, retry: () => void confirm(token, attendeeIds, st) });
      return;
    }
    const row = res.row;
    if (row.result !== "ok") {
      setParty(null);
      setMode("scan");
      showResultProblem(row);
      return;
    }
    const people = peopleFromJson(row.attendees);
    const touched = attendeeIds ? people.filter((p) => attendeeIds.includes(p.id)) : people;
    const lunchTimes = [...new Set(touched.map((p) => p.lunch).filter((x): x is string => Boolean(x)))].sort();
    const info = STATIONS.find((s) => s.key === st)!;
    setNotice({
      tone: "success",
      text: `✓ ${info.done} ${touched.length} · ${familyName(row, people)}${st === "entry" && lunchTimes.length ? ` · Lunch ${lunchTimes.map((t) => formatTime(t, timeZone)).join(", ")}` : ""}`,
    });
    setParty(null);
    setMode("scan");
    if (st === "entry") void refreshCount();
  }

  async function lookup(raw: string) {
    const token = extractTicketToken(raw);
    if (!token) return;
    if (busy) {
      setNotice({ tone: "warning", text: "Still saving the last scan — scan again in a moment." });
      return;
    }
    setNotice(null);
    setProblem(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) return saveOffline(token, station, null, "You're offline");
    if (kiosk) return confirm(token, null);
    setBusy(true);
    // Station "lookup" resolves the code to the household RSVP without recording a check-in.
    const res = await callCheckIn(token, "lookup", null);
    if (res.kind === "offline") {
      setBusy(false);
      return saveOffline(token, station, null, "No connection");
    }
    if (res.kind === "error") {
      setBusy(false);
      setProblem({ text: res.error, retry: () => void lookup(raw) });
      return;
    }
    const row = res.row;
    if (row.result !== "ok" || !row.rsvp_id) {
      setBusy(false);
      showResultProblem(row);
      return;
    }
    let people = peopleFromJson(row.attendees);
    try {
      const detail = await getBrowserClient()
        .from("attendees")
        .select("id, served_food_at, gift_given_at, checked_in_at")
        .eq("rsvp_id", row.rsvp_id);
      if (detail.error) console.error("[checkin] attendee detail unavailable; food/gift ticks may be incomplete", detail.error);
      for (const d of detail.data ?? []) {
        people = people.map((p) => (p.id === d.id ? { ...p, served: Boolean(d.served_food_at), gift: Boolean(d.gift_given_at), checkedIn: Boolean(d.checked_in_at) } : p));
      }
    } catch (error) {
      console.error("[checkin] attendee detail failed", error);
    }
    setBusy(false);
    const pending = people.filter((p) => (station === "entry" ? !p.checkedIn : station === "food" ? !p.served : !p.gift));
    setParty({ token, name: familyName(row, people), people });
    setSelected(pending.map((p) => p.id));
    setMode("party");
  }

  function submitManual() {
    const v = manual.trim();
    if (!v) return;
    if (busy) {
      // Never drop a scan silently: keep it in the box so it can be sent again.
      setNotice({ tone: "warning", text: "Still saving the last scan — press Go again in a moment." });
      return;
    }
    setManual("");
    void lookup(v);
  }

  const doneFor = (p: Person) => (station === "entry" ? p.checkedIn : station === "food" ? p.served : p.gift);

  return (
    <div className="space-y-4">
      {/* Status strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-navy px-4 py-3 text-white">
        <p className="text-lg" aria-live="polite">
          <strong className="font-display text-2xl">{checkedIn}</strong> checked in · of {expected} confirmed
        </p>
        <p className="text-sm">
          {online ? <span className="text-[#9FE0BC]">● Online</span> : <span className="text-[#F7B4AE]">● Offline</span>}
          {queued > 0 && <span className="ml-2 rounded-full bg-[#D7A15F] px-2 py-0.5 font-semibold text-navy">{queued} waiting to sync</span>}
        </p>
      </div>
      {eventStatus !== "live" && (
        <p className="rounded-lg bg-saffron-50 px-3 py-2 text-sm text-brown">This event isn&apos;t marked live yet — check-ins still work.</p>
      )}

      {/* Station switcher */}
      <div role="tablist" aria-label="Station" className="grid grid-cols-3 gap-1 rounded-xl bg-navy-700 p-1">
        {STATIONS.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={station === s.key}
            type="button"
            onClick={() => {
              setStation(s.key);
              setParty(null);
              setMode("scan");
              setNotice(null);
            }}
            className={`min-h-12 rounded-lg text-base font-semibold ${station === s.key ? "bg-[#D7A15F] text-[#1E1508]" : "text-[#F4EFE6]"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-xl border p-4 text-base font-semibold ${
            notice.tone === "success"
              ? "border-success/30 bg-success-50 text-success"
              : notice.tone === "warning"
                ? "border-saffron/40 bg-saffron-50 text-brown"
                : notice.tone === "danger"
                  ? "border-danger/30 bg-danger-50 text-danger"
                  : "border-navy/20 bg-navy-50 text-navy"
          }`}
        >
          {notice.text}
          {notice.action && (
            <button type="button" className="cc-btn cc-btn-ghost mt-3 w-full" onClick={notice.action.run}>
              {notice.action.label}
            </button>
          )}
        </div>
      )}
      {problem && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-50 p-4 text-danger">
          <p className="font-semibold">{problem.text}</p>
          {problem.retry && (
            <button type="button" className="cc-btn cc-btn-bad mt-3 w-full" onClick={problem.retry}>
              Try again
            </button>
          )}
        </div>
      )}

      {mode === "scan" && (
        <div className="space-y-3 rounded-xl bg-white p-4">
          {camera ? (
            <CameraScanner
              active={camera && mode === "scan"}
              onScan={(text) => void lookup(text)}
              onError={(message) => {
                setCamera(false);
                setProblem({ text: message });
              }}
            />
          ) : (
            <p className="text-sm text-muted">
              Point a scanner at a ticket or member card, or type the code. {stationInfo.label} station.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitManual();
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Scan or type ticket / member number"
              aria-label="Ticket or member code"
              className="crm-input text-lg"
            />
            <button type="submit" className="cc-btn cc-btn-primary min-w-20" disabled={!manual.trim()}>
              {busy ? "…" : "Go"}
            </button>
          </form>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="cc-btn cc-btn-ghost min-h-12" onClick={() => setCamera((c) => !c)}>
              {camera ? "Stop camera" : "Use camera"}
            </button>
            <button
              type="button"
              className="cc-btn cc-btn-ghost min-h-12"
              onClick={() => {
                setWalkInName("");
                setMode("walkin");
                setNotice(null);
              }}
            >
              Walk-in by phone
            </button>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={kiosk} onChange={(e) => setKiosk(e.target.checked)} className="h-5 w-5 accent-navy" />
            <span>
              <strong>Kiosk mode</strong> — {stationInfo.verb.toLowerCase()} the whole party on scan, no confirm step
            </span>
          </label>
          {queued > 0 && (
            <button type="button" className="cc-btn cc-btn-ghost w-full" disabled={!online} onClick={() => void replay()}>
              {online ? `Sync ${queued} saved scan${queued === 1 ? "" : "s"} now` : `${queued} scan${queued === 1 ? "" : "s"} will sync when back online`}
            </button>
          )}
        </div>
      )}

      {mode === "party" && party && (
        <div className="rounded-xl bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-success">Valid · {stationInfo.label} station</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">Welcome, {party.name}</h2>
          <p className="text-sm text-muted">Tick who is here.</p>
          <ul className="mt-3 space-y-2">
            {party.people.map((p) => {
              const on = selected.includes(p.id);
              const already = doneFor(p);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelected((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))}
                    className={`flex min-h-14 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left ${on ? "border-[#B8C2DD] bg-navy-50" : "border-line bg-white"}`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 text-lg font-bold ${on ? "border-navy bg-navy text-white" : "border-line bg-white"}`}>
                      {on ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold">{p.name}</span>
                      <span className="block text-xs text-muted">
                        {[
                          already ? (station === "entry" ? "already checked in" : station === "food" ? "already served" : "gift already given") : null,
                          p.child ? "child under 12" : null,
                          p.senior ? "senior" : null,
                          p.assistance ? "needs assistance" : null,
                          p.lunch ? `lunch ${formatTime(p.lunch, timeZone)}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || " "}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className="cc-btn cc-btn-primary mt-4 min-h-14 w-full text-lg"
            disabled={busy || selected.length === 0}
            onClick={() => void confirm(party.token, selected)}
          >
            {busy ? "Saving…" : selected.length ? `${stationInfo.verb} ${selected.length} ${selected.length === 1 ? "person" : "people"}` : "Select who is here"}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-ghost mt-2 w-full"
            onClick={() => {
              setParty(null);
              setMode("scan");
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {mode === "walkin" && (
        <WalkInPanel
          eventId={eventId}
          prefillName={walkInName}
          online={online}
          onOpenToken={(token) => {
            setMode("scan");
            void lookup(token);
          }}
          onRegistered={(token, attendeeIds) => {
            setStation("entry");
            void confirm(token, attendeeIds, "entry");
          }}
          onClose={() => setMode("scan")}
        />
      )}

      {rejected.length > 0 && (
        <div role="alert" className="rounded-xl border border-danger/30 bg-danger-50 p-4 text-sm text-danger">
          <p className="font-semibold">Some offline scans could not be checked in:</p>
          <ul className="mt-1 list-disc pl-5">
            {rejected.map((r, i) => (
              <li key={i}>
                <code>{r.token.slice(0, 12)}</code> — {r.error}
              </li>
            ))}
          </ul>
          <button type="button" className="cc-btn cc-btn-ghost mt-2" onClick={() => setRejected([])}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

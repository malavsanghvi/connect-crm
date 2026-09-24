"use client";

import { useState } from "react";
import type { ActionResult } from "@/lib/errors";
import { parsePartyLines } from "@/lib/events/report";
import { findWalkIn, registerWalkIn, type WalkInLookup, type WalkInPerson } from "../actions";

const UNREACHABLE = "Couldn't reach the server. Check the connection and try again.";

export function WalkInPanel({
  eventId,
  prefillName,
  online,
  onOpenToken,
  onRegistered,
  onClose,
}: {
  eventId: string;
  prefillName: string;
  online: boolean;
  onOpenToken: (token: string) => void;
  onRegistered: (token: string, attendeeIds: string[]) => void;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [lookup, setLookup] = useState<WalkInLookup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; retry: () => void } | null>(null);
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [partyName, setPartyName] = useState(prefillName);
  const [partyText, setPartyText] = useState("");

  async function run<T>(fn: () => Promise<ActionResult<T>>, retry: () => void): Promise<T | null> {
    setBusy(true);
    setError(null);
    let res: ActionResult<T>;
    try {
      res = await fn();
    } catch (e) {
      console.error("[walk-in] request failed", e);
      res = { ok: false, error: UNREACHABLE };
    }
    setBusy(false);
    if (!res.ok) {
      setError({ text: res.error, retry });
      return null;
    }
    return (res.data ?? null) as T | null;
  }

  async function search() {
    const data = await run(() => findWalkIn({ eventId, phone }), () => void search());
    if (data) {
      setLookup(data);
      setPicked(Object.fromEntries(data.households.map((h) => [h.householdId, h.members.map((m) => m.personId!).filter(Boolean)])));
    }
  }

  async function registerHousehold(h: WalkInLookup["households"][number]) {
    const ids = picked[h.householdId] ?? [];
    const people: WalkInPerson[] = h.members.filter((m) => m.personId && ids.includes(m.personId));
    const data = await run(
      () => registerWalkIn({ eventId, householdId: h.householdId, partyName: h.name, phone: lookup?.phone ?? phone, people }),
      () => void registerHousehold(h),
    );
    if (data) onRegistered(data.token, data.attendeeIds);
  }

  async function registerGuest() {
    const people: WalkInPerson[] = parsePartyLines(partyText).map((p) => ({
      personId: null,
      name: p.name,
      child: p.child_under_12,
      senior: p.senior,
      assistance: p.assistance,
    }));
    if (!people.length) {
      setError({ text: "Add at least one name, one per line.", retry: () => setError(null) });
      return;
    }
    const data = await run(
      () => registerWalkIn({ eventId, householdId: null, partyName: partyName || people[0].name, phone: phone || null, people }),
      () => void registerGuest(),
    );
    if (data) onRegistered(data.token, data.attendeeIds);
  }

  return (
    <div className="space-y-4 rounded-xl bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">Walk-in</h2>
        <button type="button" className="cc-btn cc-btn-ghost" onClick={onClose}>
          Back to scanner
        </button>
      </div>
      {!online && <p className="rounded-lg bg-saffron-50 p-3 text-sm text-brown">Walk-in registration needs a connection. Scans still work offline.</p>}
      {prefillName && <p className="text-sm">Registering <strong>{prefillName}</strong>, who had no RSVP.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="space-y-2"
      >
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Mobile number</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="off" className="crm-input text-lg" placeholder="(713) 555-0198" />
        </label>
        <button type="submit" className="cc-btn cc-btn-primary w-full min-h-12" disabled={busy || !online || phone.replace(/\D/g, "").length < 7}>
          {busy && !lookup ? "Searching…" : "Find family"}
        </button>
      </form>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-danger-50 p-3 text-sm text-danger">
          {error.text}
          <button type="button" className="cc-btn cc-btn-bad mt-2 w-full" onClick={error.retry}>
            Try again
          </button>
        </div>
      )}

      {lookup && (
        <div className="space-y-3">
          {lookup.existing.map((r) => (
            <div key={r.rsvpId} className="rounded-lg border border-line p-3">
              <p className="font-semibold">{r.label} already has an RSVP</p>
              <p className="text-sm text-muted">{r.people.join(", ") || "No names"}</p>
              {r.token ? (
                <button type="button" className="cc-btn cc-btn-primary mt-2 w-full" onClick={() => onOpenToken(r.token!)}>
                  Check in this party
                </button>
              ) : (
                <p className="mt-1 text-sm text-brown">This RSVP has no valid ticket — send them to the help desk.</p>
              )}
            </div>
          ))}
          {lookup.households
            .filter((h) => !h.hasRsvp)
            .map((h) => (
              <div key={h.householdId} className="rounded-lg border border-line p-3">
                <p className="font-semibold">{h.name}</p>
                <p className="text-xs text-muted">Member family · no RSVP for this event. Tick who is here:</p>
                <ul className="mt-2 space-y-1">
                  {h.members.map((m) => {
                    const on = (picked[h.householdId] ?? []).includes(m.personId!);
                    return (
                      <li key={m.personId}>
                        <label className="flex min-h-11 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setPicked((cur) => {
                                const list = cur[h.householdId] ?? [];
                                return { ...cur, [h.householdId]: on ? list.filter((x) => x !== m.personId) : [...list, m.personId!] };
                              })
                            }
                            className="h-5 w-5 accent-navy"
                          />
                          <span>
                            {m.name}
                            {m.child ? " · under 12" : ""}
                            {m.senior ? " · senior" : ""}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  className="cc-btn cc-btn-primary mt-2 w-full min-h-12"
                  disabled={busy || !(picked[h.householdId] ?? []).length}
                  onClick={() => void registerHousehold(h)}
                >
                  Register walk-in and check in {(picked[h.householdId] ?? []).length}
                </button>
              </div>
            ))}
          {lookup.existing.length === 0 && lookup.households.length === 0 && (
            <p className="rounded-lg bg-ground p-3 text-sm">
              No RSVP or family found for that number.
              {!lookup.canSearchMembers && " (Volunteers can't search the member directory; register them as a guest and the office will link them.)"}
            </p>
          )}
        </div>
      )}

      <details className="rounded-lg border border-line" open={Boolean(prefillName) || (lookup !== null && lookup.households.length === 0 && lookup.existing.length === 0)}>
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-semibold text-navy">Register as a guest</summary>
        <div className="space-y-3 border-t border-line p-3">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">Party name</span>
            <input value={partyName} onChange={(e) => setPartyName(e.target.value)} className="crm-input" placeholder="e.g. Shah family" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold">People (one per line)</span>
            <textarea
              value={partyText}
              onChange={(e) => setPartyText(e.target.value)}
              rows={4}
              className="crm-input"
              placeholder={"Priya Shah\nAnya Shah, child\nKanta Shah, senior"}
            />
            <span className="mt-1 block text-xs text-muted">Add “, child”, “, senior” or “, assistance” after a name.</span>
          </label>
          <button type="button" className="cc-btn cc-btn-primary w-full min-h-12" disabled={busy || !online || !partyText.trim()} onClick={() => void registerGuest()}>
            {busy ? "Saving…" : "Register and check in"}
          </button>
        </div>
      </details>
    </div>
  );
}

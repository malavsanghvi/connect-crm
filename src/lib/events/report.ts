// Event-day numbers (moved from connect-admin lib/logic/event-report.ts) plus
// the admin Live check-in dashboard: KPIs, lunch slot board, recent
// check-ins and the median check-in time. Pure functions, unit-tested.

export type RsvpLike = { id: string; status: string; source: string; confirmed_at: string | null };
export type AttendeeLike = {
  id: string;
  rsvp_id: string;
  status: string;
  checked_in_at: string | null;
  served_food_at: string | null;
  gift_given_at?: string | null;
  lunch_slot_id: string | null;
  is_child_under_12: boolean;
  is_senior: boolean;
  needs_assistance: boolean;
};

export type EventReport = {
  households: Record<string, number>;
  householdsTotal: number;
  rsvpdPeople: number;
  confirmedPeople: number;
  checkedIn: number;
  served: number;
  giftsGiven: number;
  noShows: number;
  walkIns: number;
  walkInHouseholds: number;
  waitlistedPeople: number;
  waitlistedHouseholds: number;
  flags: { childUnder12: number; senior: number; assistance: number };
};

/** An RSVP counts as confirmed once it was confirmed, or once the family arrived. */
export function isConfirmedRsvp(r: Pick<RsvpLike, "status" | "confirmed_at"> | undefined): boolean {
  return Boolean(r?.confirmed_at) || r?.status === "confirmed" || r?.status === "attended";
}

export function eventReport(rsvps: RsvpLike[], attendees: AttendeeLike[]): EventReport {
  const byId = new Map(rsvps.map((r) => [r.id, r]));
  const households: Record<string, number> = {};
  for (const r of rsvps) households[r.status] = (households[r.status] ?? 0) + 1;

  let rsvpdPeople = 0;
  let confirmedPeople = 0;
  let checkedIn = 0;
  let served = 0;
  let giftsGiven = 0;
  let noShows = 0;
  let walkIns = 0;
  let waitlistedPeople = 0;
  const flags = { childUnder12: 0, senior: 0, assistance: 0 };

  for (const a of attendees) {
    const r = byId.get(a.rsvp_id);
    const cancelled = r?.status === "cancelled" || a.status === "cancelled";
    const walkIn = r?.source === "walk_in";
    if (a.checked_in_at) checkedIn += 1;
    if (a.served_food_at) served += 1;
    if (a.gift_given_at) giftsGiven += 1;
    if (cancelled) continue;
    if (a.is_child_under_12) flags.childUnder12 += 1;
    if (a.is_senior) flags.senior += 1;
    if (a.needs_assistance) flags.assistance += 1;
    if (walkIn) {
      walkIns += 1;
      continue;
    }
    if (r?.status === "waitlisted") {
      waitlistedPeople += 1;
      continue;
    }
    rsvpdPeople += 1;
    if (isConfirmedRsvp(r)) confirmedPeople += 1;
    if (!a.checked_in_at) noShows += 1;
  }

  return {
    households,
    householdsTotal: rsvps.length,
    rsvpdPeople,
    confirmedPeople,
    checkedIn,
    served,
    giftsGiven,
    noShows,
    walkIns,
    walkInHouseholds: rsvps.filter((r) => r.source === "walk_in" && r.status !== "cancelled").length,
    waitlistedPeople,
    waitlistedHouseholds: rsvps.filter((r) => r.status === "waitlisted").length,
    flags,
  };
}

export type SlotLike = { id: string; starts_at: string; seats: number; status: string };

export function lunchSlotCounts<S extends SlotLike>(slots: S[], attendees: Pick<AttendeeLike, "lunch_slot_id" | "served_food_at">[]) {
  return [...slots]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((s) => {
      const inSlot = attendees.filter((a) => a.lunch_slot_id === s.id);
      return {
        ...s,
        assignedCount: inSlot.length,
        servedCount: inSlot.filter((a) => a.served_food_at).length,
        seatsLeft: Math.max(0, s.seats - inSlot.length),
      };
    });
}

/** Unlimited seat sentinel used by app.ensure_lunch_slots when no seats-per-slot is set. */
export const UNLIMITED_SEATS = 1_000_000;

export type SlotBoardStatus = "Serving" | "Next" | "Queued" | "Open" | "Done";

/**
 * The prototype's slot vocabulary for the admin board. The slot being served
 * is "Serving"; the first scheduled slot after it (or the first scheduled
 * slot when nothing is being served yet) is "Next"; later scheduled slots
 * with people in them are "Queued"; empty ones are "Open"; finished ones "Done".
 */
export function slotBoard<S extends { starts_at: string; status: string; assignedCount: number }>(slots: S[]): (S & { board: SlotBoardStatus })[] {
  const sorted = [...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const serving = sorted.find((s) => s.status === "now_serving");
  const next = sorted.find((s) => s.status === "scheduled" && (!serving || s.starts_at > serving.starts_at));
  return sorted.map((s) => {
    let board: SlotBoardStatus;
    if (s.status === "now_serving") board = "Serving";
    else if (s.status === "done") board = "Done";
    else if (next && s === next) board = "Next";
    else board = s.assignedCount > 0 ? "Queued" : "Open";
    return { ...s, board };
  });
}

/**
 * Lunch slots for an event, mirroring app.ensure_lunch_slots: from lunch
 * start until the event ends (or two hours), one slot per `slotMinutes`,
 * `seats` each (unlimited when unset).
 */
export function planLunchSlots(input: {
  lunchStartsAt: string;
  eventEndsAt: string | null;
  slotMinutes: number;
  seatsPerSlot: number | null;
}): { starts_at: string; ends_at: string; seats: number }[] {
  const minutes = Math.max(1, Math.floor(input.slotMinutes));
  const start = Date.parse(input.lunchStartsAt);
  if (!Number.isFinite(start)) return [];
  const endCandidate = input.eventEndsAt ? Date.parse(input.eventEndsAt) : NaN;
  const end = Number.isFinite(endCandidate) ? endCandidate : start + 2 * 60 * 60_000;
  const out: { starts_at: string; ends_at: string; seats: number }[] = [];
  for (let t = start; t < end && out.length < 200; t += minutes * 60_000) {
    out.push({
      starts_at: new Date(t).toISOString(),
      ends_at: new Date(t + minutes * 60_000).toISOString(),
      seats: input.seatsPerSlot ?? UNLIMITED_SEATS,
    });
  }
  return out;
}

export type PartyMember = { name: string; child_under_12: boolean; senior: boolean; assistance: boolean };

/**
 * One person per line; optional flags after a comma:
 *   "Anya Shah, child"   "Kantaben Shah, senior, assistance"
 */
export function parsePartyLines(text: string): PartyMember[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(",").map((s) => s.trim());
      const flags = rest.join(" ").toLowerCase();
      return {
        name,
        child_under_12: /\b(child|kid|under ?12)\b/.test(flags),
        senior: /\bsenior\b/.test(flags),
        assistance: /\b(assist|assistance|wheelchair)\b/.test(flags),
      };
    })
    .filter((p) => p.name.length > 0);
}

// ---------------------------------------------------------------------------
// Live check-in dashboard
// ---------------------------------------------------------------------------
export type ScanLike = { scanned_at: string; device_id: string | null; station: string; result: string };

/** A gap longer than this means the line was empty, not that one family took that long. */
export const MAX_CHECKIN_GAP_SECONDS = 180;

/**
 * Median seconds per family at the entry station: the time between one
 * successful entry scan and the next on the same device, ignoring idle gaps
 * (over 3 minutes). Null until there are at least two measurable gaps.
 */
export function medianCheckinSeconds(scans: ScanLike[]): number | null {
  const byDevice = new Map<string, number[]>();
  for (const s of scans) {
    if (s.station !== "entry" || s.result !== "ok") continue;
    const t = Date.parse(s.scanned_at);
    if (!Number.isFinite(t)) continue;
    const key = s.device_id ?? "unknown";
    const list = byDevice.get(key) ?? [];
    list.push(t);
    byDevice.set(key, list);
  }
  const gaps: number[] = [];
  for (const times of byDevice.values()) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const g = (times[i] - times[i - 1]) / 1000;
      if (g > 0 && g <= MAX_CHECKIN_GAP_SECONDS) gaps.push(g);
    }
  }
  if (gaps.length < 2) return null;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.round(median);
}

/** "6 s", "1 min 20 s". */
export function formatSeconds(s: number | null): string {
  if (s === null) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export type RecentAttendee = {
  rsvp_id: string;
  checked_in_at: string | null;
  lunch_slot_id: string | null;
  is_child_under_12: boolean;
  is_senior: boolean;
  needs_assistance: boolean;
};

export type RecentCheckin = {
  rsvpId: string;
  at: string;
  family: string;
  count: number;
  lunchSlotStartsAt: string | null;
  /** "child under 12", "senior", or "adults" — why the family has its slot. */
  group: string;
};

/**
 * Most recent check-ins, one row per family (RSVP) and arrival: people of the
 * same RSVP checked in within two minutes of each other are one arrival.
 */
export function recentCheckins(
  attendees: RecentAttendee[],
  labelFor: (rsvpId: string) => string,
  slotStart: (slotId: string) => string | null,
  limit = 8,
): RecentCheckin[] {
  const arrived = attendees.filter((a) => a.checked_in_at).sort((a, b) => b.checked_in_at!.localeCompare(a.checked_in_at!));
  const out: (RecentCheckin & { members: RecentAttendee[] })[] = [];
  for (const a of arrived) {
    const t = Date.parse(a.checked_in_at!);
    const same = out.find((r) => r.rsvpId === a.rsvp_id && Math.abs(Date.parse(r.at) - t) <= 120_000);
    if (same) {
      same.members.push(a);
      continue;
    }
    if (out.length >= limit) continue;
    out.push({ rsvpId: a.rsvp_id, at: a.checked_in_at!, family: labelFor(a.rsvp_id), count: 0, lunchSlotStartsAt: null, group: "", members: [a] });
  }
  return out.map(({ members, ...r }) => {
    const slots = members.map((m) => m.lunch_slot_id).filter((x): x is string => Boolean(x));
    const starts = slots.map(slotStart).filter((x): x is string => Boolean(x)).sort();
    const group = members.some((m) => m.is_child_under_12)
      ? "child under 12"
      : members.some((m) => m.is_senior)
        ? "senior"
        : members.some((m) => m.needs_assistance)
          ? "assistance"
          : "adults";
    return { ...r, count: members.length, lunchSlotStartsAt: starts[0] ?? null, group };
  });
}

// ---------------------------------------------------------------------------
// Event builder
// ---------------------------------------------------------------------------
export const AUDIENCES = ["members_only", "life_members_only", "pathshala_families", "members_and_guests", "public"] as const;
export type EventAudience = (typeof AUDIENCES)[number];

/** The prototype's four "Who can RSVP" chips over the five audience values ("Everyone" covers both guest audiences). */
export function audienceChips(current: string | null | undefined): { value: EventAudience; label: string }[] {
  return [
    { value: current === "public" ? "public" : "members_and_guests", label: "Everyone" },
    { value: "members_only", label: "Members" },
    { value: "life_members_only", label: "Life members only" },
    { value: "pathshala_families", label: "Pathshala families" },
  ];
}

export function audienceLabel(audience: string | null | undefined): string {
  switch (audience) {
    case "public":
    case "members_and_guests":
      return "Everyone";
    case "members_only":
      return "Members";
    case "life_members_only":
      return "Life members only";
    case "pathshala_families":
      return "Pathshala families";
    default:
      return audience ?? "—";
  }
}

export type CommitmentOptions = { per_person?: number[]; lump_sum?: number[]; open?: boolean };

export function readCommitment(raw: unknown): CommitmentOptions {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : []);
  return { per_person: list(o.per_person), lump_sum: list(o.lump_sum), open: o.open === true };
}

export function commitmentEnabled(c: CommitmentOptions): boolean {
  return Boolean((c.per_person?.length ?? 0) + (c.lump_sum?.length ?? 0) || c.open);
}

/** "Per person $3/$5/$7 or lump sum $10/$25/$50/open" — the prototype's toggle note. */
export function commitmentSummary(c: CommitmentOptions, fmt: (cents: number) => string): string {
  const parts: string[] = [];
  if (c.per_person?.length) parts.push(`Per person ${c.per_person.map(fmt).join("/")}`);
  const lump = [...(c.lump_sum ?? []).map(fmt), ...(c.open ? ["open"] : [])];
  if (lump.length) parts.push(`${parts.length ? "lump sum" : "Lump sum"} ${lump.join("/")}`);
  return parts.join(" or ") || "No amounts set";
}

export type LunchRules = { childAtStart: boolean; seniorAtStart: boolean; reminderMinutes: number };

/** Plain-English priority rule (read-only in the builder; set in Settings › Rules). */
export function lunchPriorityText(r: LunchRules): string {
  const first =
    r.childAtStart && r.seniorAtStart
      ? "Families with a child under 12 or a senior eat together at start"
      : r.childAtStart
        ? "Families with a child under 12 eat together at start"
        : r.seniorAtStart
          ? "Seniors eat at start"
          : "No one is placed at start";
  return `${first}; others by arrival, then RSVP order`;
}

export type SlotPreviewLine = { text: string; tone: "ok" | "navy" | "muted" };

/**
 * What the slot engine (app.assign_lunch_for_rsvp) would do with these
 * settings, for three typical families. Arrivals fill slots in order; the
 * priority families at start also take seats in the first slot.
 */
export function slotPreview(input: {
  lunchStartMinutes: number | null; // minutes after midnight, center time
  slotMinutes: number;
  seatsPerSlot: number | null;
  rules: LunchRules;
  arrivalNumber?: number;
  formatMinutes: (minutesAfterMidnight: number) => string;
}): SlotPreviewLine[] {
  const start = input.lunchStartMinutes;
  if (start === null) return [{ text: "Set when lunch starts to see where families will eat.", tone: "muted" }];
  const at = (slotIndex: number) => input.formatMinutes(start + slotIndex * Math.max(1, input.slotMinutes));
  const arrival = input.arrivalNumber ?? 87;
  const seats = input.seatsPerSlot && input.seatsPerSlot > 0 ? input.seatsPerSlot : null;
  const arrivalSlot = seats ? Math.floor((arrival - 1) / seats) : 0;
  const lines: SlotPreviewLine[] = [];
  lines.push(
    input.rules.childAtStart
      ? { text: `Family of 4 with a child under 12 → ${at(0)} together`, tone: "ok" }
      : { text: "Family of 4 with a child under 12 → by arrival (priority off)", tone: "muted" },
  );
  lines.push(
    input.rules.seniorAtStart
      ? { text: `Family of 5 with a senior → ${at(0)} (the senior eats at start)`, tone: "ok" }
      : { text: "Family of 5 with a senior → by arrival (priority off)", tone: "muted" },
  );
  lines.push({
    text: `Family of 2 adults, checked in as #${arrival} → ${at(arrivalSlot)}${seats ? "" : " (seats are unlimited)"}`,
    tone: "navy",
  });
  lines.push({
    text: `Missed slot → may join any later slot · reminder ${input.rules.reminderMinutes} minutes before each slot`,
    tone: "muted",
  });
  return lines;
}

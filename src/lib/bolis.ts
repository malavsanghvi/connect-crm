import { parseCsv } from "@/lib/csv";
import { formatCents, parseAmountToCents } from "@/lib/money";

// Bolis: founder rule — members "pledge", never "bid". The winner is the
// highest amount; the first recorded entry wins a tie (app.close_boli). Every
// entry is kept so the center can offer a similar labh to the other families.

export type BoliStatus = "draft" | "open" | "paused" | "closed" | "settled";

/** Short reference shown in the ID column and the drawer kicker ("BL-3F9A2C"). */
export function boliRef(id: string): string {
  return `BL-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export const BOLI_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  open: "Open",
  paused: "Paused",
  closed: "Closed",
  settled: "Settled",
};

export function boliStatusTone(status: string): "ok" | "warn" | "bad" | "muted" {
  if (status === "open") return "ok";
  if (status === "paused") return "warn";
  if (status === "draft") return "muted";
  return "muted";
}

export function isClosed(status: string): boolean {
  return status === "closed" || status === "settled";
}

export type EntryLike = { id: string; household_id: string; amount_cents: number; entered_at: string };

/** Entries in winner order: highest amount first, then earliest recorded. */
export function rankEntries<T extends EntryLike>(entries: T[]): T[] {
  return [...entries].sort((a, b) => b.amount_cents - a.amount_cents || a.entered_at.localeCompare(b.entered_at) || a.id.localeCompare(b.id));
}

/** The entry that wins (or would win if the boli closed now). */
export function leadingEntry<T extends EntryLike>(entries: T[], winnerEntryId?: string | null): T | null {
  if (winnerEntryId) {
    const w = entries.find((e) => e.id === winnerEntryId);
    if (w) return w;
  }
  return rankEntries(entries)[0] ?? null;
}

/** Households that pledged but did not (or would not) win — the families to accommodate. */
export function otherInterestedHouseholds(entries: EntryLike[], winnerEntryId?: string | null): string[] {
  const lead = leadingEntry(entries, winnerEntryId);
  const out: string[] = [];
  for (const e of rankEntries(entries)) {
    if (lead && e.household_id === lead.household_id) continue;
    if (!out.includes(e.household_id)) out.push(e.household_id);
  }
  return out;
}

/** The smallest pledge accepted next (mirrors app.boli_minimum). */
export function nextMinimum(entries: { amount_cents: number }[], floorCents: number, stepCents: number): number {
  if (entries.length === 0) return floorCents;
  return Math.max(...entries.map((e) => e.amount_cents)) + stepCents;
}

/** True while the cutoff is still ahead (so closing now is "early"). */
export function closesInFuture(closesAt: string | null, now: Date = new Date()): boolean {
  return closesAt !== null && new Date(closesAt).getTime() > now.getTime();
}

// ---------------------------------------------------------------------------
// In-person upload (Bolis → In-person upload)
// ---------------------------------------------------------------------------

export const UPLOAD_TEMPLATE_HEADER = ["Boli name", "Event", "Household ID or name", "Amount", "Called at"];

/** The template members of staff download and fill in after the event. */
export function uploadTemplateCsv(example?: { boli: string; event: string }): string {
  const rows = [UPLOAD_TEMPLATE_HEADER];
  rows.push([example?.boli ?? "Snatra puja kalash", example?.event ?? "", "H-1024", "151", "7:45 PM"]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export type UploadRow = {
  /** 1-based line in the file (header = 1). */
  row: number;
  boli: string;
  event: string;
  household: string;
  amountText: string;
  calledAt: string;
};

export type UploadParse = { rows: UploadRow[]; errors: string[] };

const COLUMN_ALIASES: Record<keyof Omit<UploadRow, "row">, string[]> = {
  boli: ["boli name", "boli", "name", "item"],
  event: ["event", "event name"],
  household: ["household id or name", "household", "household id", "family", "household name"],
  amountText: ["amount", "pledge", "amount ($)", "pledge amount"],
  calledAt: ["called at", "called at (time)", "time", "called"],
};

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

export const MAX_UPLOAD_ROWS = 500;

/** Read the in-person-bolis CSV (header row required; columns matched by name). */
export function parseBoliUploadCsv(text: string): UploadParse {
  const records = parseCsv(text);
  if (records.length === 0) return { rows: [], errors: ["The file is empty."] };
  const header = records[0].map(norm);
  const col = Object.fromEntries(
    Object.entries(COLUMN_ALIASES).map(([k, names]) => [k, names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1]),
  ) as Record<keyof Omit<UploadRow, "row">, number>;
  const missing = (["boli", "household", "amountText"] as const).filter((k) => col[k] < 0);
  if (missing.length > 0) {
    const names = { boli: "Boli name", household: "Household ID or name", amountText: "Amount" };
    return {
      rows: [],
      errors: [`The header row has no ${missing.map((m) => `"${names[m]}"`).join(", ")} column. Download the template and keep its first row.`],
    };
  }
  const rows: UploadRow[] = [];
  for (let r = 1; r < records.length; r++) {
    const cells = records[r];
    const cell = (i: number) => (i >= 0 && i < cells.length ? cells[i].trim() : "");
    const row: UploadRow = {
      row: r + 1,
      boli: cell(col.boli),
      event: cell(col.event),
      household: cell(col.household),
      amountText: cell(col.amountText),
      calledAt: cell(col.calledAt),
    };
    if (!row.boli && !row.household && !row.amountText) continue;
    rows.push(row);
  }
  if (rows.length === 0) return { rows, errors: ["The file has a header row but no bolis under it."] };
  if (rows.length > MAX_UPLOAD_ROWS) {
    return { rows: [], errors: [`The file has ${rows.length} rows; split it into files of at most ${MAX_UPLOAD_ROWS}.`] };
  }
  return { rows, errors: [] };
}

export type UploadBoli = {
  id: string;
  name: string;
  kind: string;
  status: string;
  event_id: string | null;
  event_name: string | null;
  floor_cents: number;
  /** Highest pledge already recorded on this boli, if any. */
  top_cents: number | null;
};

export type HouseholdMatch =
  | { status: "found"; household_id: string; label: string; byName: boolean }
  | { status: "not_found" }
  | { status: "ambiguous"; count: number };

export type CheckedRow = UploadRow & {
  ok: boolean;
  check: string;
  boli_id: string | null;
  boli_name: string | null;
  event_name: string | null;
  household_id: string | null;
  household_label: string | null;
  amount_cents: number | null;
};

function key(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Check each uploaded row: the boli exists (in person, still open), the event
 * matches, the household is found without ambiguity, and the amount clears
 * the floor and any pledge already recorded. Pure — lookups are passed in.
 */
export function checkUploadRows(
  rows: UploadRow[],
  bolis: UploadBoli[],
  households: Map<string, HouseholdMatch>,
  currency = "USD",
): CheckedRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base: CheckedRow = {
      ...r,
      ok: false,
      check: "",
      boli_id: null,
      boli_name: null,
      event_name: r.event || null,
      household_id: null,
      household_label: null,
      amount_cents: null,
    };
    const fail = (check: string): CheckedRow => ({ ...base, check });
    if (!r.boli) return fail("Boli name is missing");
    if (!r.household) return fail("Household is missing");
    const amount = parseAmountToCents(r.amountText);
    if (amount === null || amount <= 0) return fail(r.amountText ? `"${r.amountText}" is not an amount` : "Amount is missing");
    base.amount_cents = amount;

    let candidates = bolis.filter((b) => key(b.name) === key(r.boli));
    if (candidates.length === 0) return fail("Boli not found");
    if (r.event) {
      const sameEvent = candidates.filter((b) => b.event_name !== null && key(b.event_name) === key(r.event));
      if (sameEvent.length === 0) {
        const other = candidates[0].event_name;
        return fail(other ? `Event does not match (this boli is for ${other})` : "Event does not match (this boli has no event)");
      }
      candidates = sameEvent;
    }
    const open = candidates.filter((b) => !isClosed(b.status));
    if (open.length === 0) return fail("Boli is already closed");
    if (open.length > 1) return fail(`${open.length} open bolis have this name — add the event`);
    const boli = open[0];
    base.boli_id = boli.id;
    base.boli_name = boli.name;
    base.event_name = boli.event_name ?? (r.event || null);
    if (boli.kind !== "in_person") return fail("This is a digital boli — members pledge in the app");

    const hh = households.get(key(r.household)) ?? { status: "not_found" as const };
    if (hh.status === "not_found") return fail("Household not found");
    if (hh.status === "ambiguous") return fail(`${hh.count} households match — use the household ID`);
    base.household_id = hh.household_id;
    base.household_label = hh.label;

    if (amount < boli.floor_cents) return fail(`Below floor (${formatCents(boli.floor_cents, currency)})`);
    if (boli.top_cents !== null && boli.top_cents >= amount) {
      return fail(`A pledge of ${formatCents(boli.top_cents, currency)} is already recorded`);
    }
    const firstRow = seen.get(boli.id);
    if (firstRow !== undefined) return fail(`Listed twice in this file (also row ${firstRow})`);
    seen.set(boli.id, r.row);
    return { ...base, ok: true, check: hh.byName ? "OK · matched by name, check the family" : "OK" };
  });
}

export function householdKey(value: string): string {
  return key(value);
}

/**
 * "Called at" to an instant. Accepts a full "YYYY-MM-DD HH:MM" (local) or a
 * time alone ("7:45 PM", "19:45"), which is placed on `defaultDate`.
 * Returns "YYYY-MM-DDTHH:MM" (local wall time) or null.
 */
export function parseCalledAt(input: string, defaultDate: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const full = /^(\d{4}-\d{2}-\d{2})[ T](.+)$/.exec(s);
  const date = full ? full[1] : defaultDate;
  const time = parseClock(full ? full[2] : s);
  if (!time || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return `${date}T${time}`;
}

function parseClock(input: string): string | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(input.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase().replace(/\./g, "");
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === "pm" && h !== 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
  } else if (h > 23 || !m[2]) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Center defaults for new bolis (rules.boli.step_cents / soft_close_minutes). */
export function boliRuleDefaults(rules: unknown): { stepCents: number; softCloseMinutes: number } {
  const boli = rules && typeof rules === "object" && !Array.isArray(rules) ? (rules as Record<string, unknown>).boli : undefined;
  const b = boli && typeof boli === "object" && !Array.isArray(boli) ? (boli as Record<string, unknown>) : {};
  const step = b.step_cents;
  const soft = b.soft_close_minutes;
  return {
    stepCents: typeof step === "number" && Number.isInteger(step) && step > 0 ? step : 2100,
    softCloseMinutes: typeof soft === "number" && Number.isInteger(soft) && soft > 0 && soft <= 120 ? soft : 5,
  };
}

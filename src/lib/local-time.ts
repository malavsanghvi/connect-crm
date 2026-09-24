import { startOfDayInTz } from "@/lib/dates";

// <input type="datetime-local"> values ("YYYY-MM-DDTHH:MM") are wall-clock
// times in the center's zone; the database stores instants (timestamptz).

const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Wall-clock "YYYY-MM-DDTHH:MM" in `timeZone` → ISO instant; null when not valid. */
export function localToUtc(local: string, timeZone: string): string | null {
  const m = LOCAL.exec(local.trim());
  if (!m) return null;
  const [, date, hh, mm] = m;
  const h = Number(hh);
  const min = Number(mm);
  if (h > 23 || min > 59) return null;
  const midnight = new Date(startOfDayInTz(date, timeZone)).getTime();
  if (Number.isNaN(midnight)) return null;
  const guess = midnight + (h * 60 + min) * 60_000;
  // Correct for a DST change between midnight and the wall time.
  const shown = utcToLocal(new Date(guess).toISOString(), timeZone);
  if (shown === local) return new Date(guess).toISOString();
  const [sh, sm] = shown.slice(11).split(":").map(Number);
  const drift = (h * 60 + min - (sh * 60 + sm)) * 60_000;
  const adjusted = guess + (Math.abs(drift) <= 2 * 3_600_000 ? drift : 0);
  return new Date(adjusted).toISOString();
}

/** ISO instant → wall-clock "YYYY-MM-DDTHH:MM" in `timeZone` ("" for null). */
export function utcToLocal(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** "Sat, Sep 26 · 9 PM" — the prototype's short cutoff style. */
export function formatCutoff(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(d);
  const mins = new Intl.DateTimeFormat("en-US", { timeZone, minute: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: Number(mins) === 0 ? undefined : "2-digit",
  }).format(d);
  return `${day} · ${time}`;
}

/** "11 AM–1 PM" style time range for pickup slots. */
export function formatTimeRange(startIso: string, endIso: string, timeZone: string): string {
  const t = (iso: string) => {
    const d = new Date(iso);
    const mins = new Intl.DateTimeFormat("en-US", { timeZone, minute: "2-digit" }).format(d);
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: Number(mins) === 0 ? undefined : "2-digit" }).format(d);
  };
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(startIso));
  return `${day} ${t(startIso)}–${t(endIso)}`;
}

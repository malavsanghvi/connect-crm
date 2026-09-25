// Calendar subscriptions (ICS / iCalendar, RFC 5545): parse a feed and expand
// it into calendar entries for one window of dates.
//
// Pure functions, no I/O: the calendar.* jobs use them on a fetched feed, and
// the JSH seed generator (worker/scripts/jsh-calendar-seed.ts) uses them on the
// saved snapshot, so the seeded rows are exactly what a subscription produces.
//
// Supported: VEVENT with DTSTART/DTEND/DURATION (dates, UTC times, TZID times,
// floating times), SUMMARY/DESCRIPTION/LOCATION/URL/STATUS, RRULE with
// FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (with an
// ordinal for monthly/yearly), BYMONTHDAY, BYMONTH, WKST; EXDATE; RECURRENCE-ID
// overrides; STATUS:CANCELLED. Anything else in a rule (BYSETPOS, BYWEEKNO,
// hourly rules, ...) is reported as skipped rather than guessed at.

export type IcsProp = { name: string; params: Record<string, string>; value: string };

/** A DATE or DATE-TIME value as written: local wall time plus how to read it. */
export type IcsTime = {
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM:SS, null for an all-day DATE
  utc: boolean; // ...Z
  tzid: string | null; // TZID parameter
};

export type Rrule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: IcsTime | null;
  byDay: { n: number; dow: number }[]; // dow 0 = Sunday; n 0 = every
  byMonthDay: number[];
  byMonth: number[];
  wkst: number;
};

export type VEvent = {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  status: string | null;
  start: IcsTime;
  end: IcsTime | null;
  durationMs: number | null;
  rrule: Rrule | null;
  unsupportedRule: string | null;
  exdates: IcsTime[];
  recurrenceId: IcsTime | null;
};

export type IcsCalendar = { name: string | null; timeZone: string | null; events: VEvent[] };

/** One calendar entry as app.calendar_feed_apply takes it (JSON). */
export type FeedEntry = {
  uid: string;
  title: string;
  starts_on: string;
  ends_on: string | null; // inclusive; null when the same day
  all_day: boolean;
  starts_at: string | null; // ISO UTC, timed entries only
  ends_at: string | null;
  location: string | null;
  notes: string | null;
  link: string | null;
  sub: string | null; // "8:00 PM – 8:40 PM · JSH Main Hall": the member app's second line
};

export type FeedWindow = {
  /** One-off events: kept when they overlap [from, to]. */
  from: string;
  to: string;
  /** Repeating events: occurrences starting in [recurFrom, recurTo]. */
  recurFrom: string;
  recurTo: string;
};

export type ExpandResult = {
  entries: FeedEntry[];
  /** Events left out, and why (never a guess at a rule we do not understand). */
  skipped: { uid: string; title: string; reason: string }[];
};

export const MAX_ENTRIES = 5000;
const MAX_OCCURRENCES_PER_EVENT = 1000;
const DAY_MS = 86400000;

// ─── Dates ──────────────────────────────────────────────────────────────────

/** Days since 1970-01-01 for a YYYY-MM-DD date. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y!, m! - 1, d!) / DAY_MS);
}

export function isoFromDay(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoFromDay(dayNumber(iso) + days);
}

/** The window a subscription keeps: 2 years back and 3 ahead for one-off events, 6 months back and a year ahead for repeating ones. */
export function feedWindow(today: string): FeedWindow {
  return { from: addDays(today, -730), to: addDays(today, 1095), recurFrom: addDays(today, -180), recurTo: addDays(today, 365) };
}

/** Today's date in a time zone. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return utcToLocal(now.getTime(), safeZone(tz, "UTC")).date;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Whether Intl knows this IANA zone. */
export function validZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    zoneFormat(tz);
    return true;
  } catch {
    return false;
  }
}

function safeZone(tz: string | null | undefined, fallback: string): string {
  return validZone(tz) ? tz : fallback;
}

/** Local wall time of an instant in a zone. */
export function utcToLocal(ms: number, tz: string): { date: string; time: string } {
  const p: Record<string, string> = {};
  for (const x of zoneFormat(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

function wallMs(date: string, time: string): number {
  const [h, mi, s] = time.split(":").map(Number);
  return dayNumber(date) * DAY_MS + ((h! * 60 + mi!) * 60 + (s ?? 0)) * 1000;
}

/** The instant of a local wall time in a zone (a time skipped by DST moves forward, like calendar apps). */
export function localToUtc(date: string, time: string, tz: string): number {
  const want = wallMs(date, time);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const l = utcToLocal(guess, tz);
    const diff = want - wallMs(l.date, l.time);
    if (diff === 0) return guess;
    guess += diff;
  }
  return guess;
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/** RFC 5545 §3.1: a line starting with a space or tab continues the previous one. */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length > 0) out[out.length - 1] += raw.slice(1);
    else if (raw.length > 0) out.push(raw);
  }
  return out;
}

/** NAME;PARAM=a;PARAM="b:c":value — the first colon outside quotes ends the parameters. */
export function parseLine(line: string): IcsProp | null {
  let q = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ":" && !q) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts: string[] = [];
  let cur = "";
  q = false;
  for (const c of head) {
    if (c === '"') q = !q;
    if (c === ";" && !q) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  parts.push(cur);
  const name = (parts.shift() ?? "").toUpperCase();
  const params: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name, params, value };
}

/** TEXT unescaping (§3.3.11). */
export function unescapeText(v: string): string {
  return v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

export function parseTime(value: string, params: Record<string, string>): IcsTime | null {
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || params.VALUE === "DATE") return { date, time: null, utc: false, tzid: null };
  return { date, time: `${m[4]}:${m[5]}:${m[6]}`, utc: Boolean(m[7]), tzid: m[7] ? null : (params.TZID ?? null) };
}

/** P1D, PT1H30M, P1W (§3.3.6), in milliseconds. */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m || v.trim() === "P" || v.trim().endsWith("T")) return null;
  const n = (i: number) => Number(m[i] ?? 0);
  const ms = (((n(2) * 7 + n(3)) * 24 + n(4)) * 60 + n(5)) * 60000 + n(6) * 1000;
  return m[1] === "-" ? -ms : ms;
}

const DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** An RRULE, or the reason it is not supported. */
export function parseRrule(v: string): Rrule | { unsupported: string } {
  const kv: Record<string, string> = {};
  for (const part of v.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).toUpperCase();
  }
  const freq = kv.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return { unsupported: `repeats ${String(freq ?? "?").toLowerCase()}` };
  for (const k of ["BYSETPOS", "BYWEEKNO", "BYYEARDAY", "BYHOUR", "BYMINUTE", "BYSECOND"]) {
    if (kv[k]) return { unsupported: `uses ${k}` };
  }
  const interval = kv.INTERVAL ? Number(kv.INTERVAL) : 1;
  if (!Number.isInteger(interval) || interval < 1) return { unsupported: "has an invalid INTERVAL" };
  const count = kv.COUNT ? Number(kv.COUNT) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return { unsupported: "has an invalid COUNT" };
  const until = kv.UNTIL ? parseTime(kv.UNTIL, {}) : null;
  if (kv.UNTIL && !until) return { unsupported: "has an invalid UNTIL" };
  const byDay: { n: number; dow: number }[] = [];
  for (const d of (kv.BYDAY ?? "").split(",").filter(Boolean)) {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(d);
    if (!m) return { unsupported: `has BYDAY=${d}` };
    const n = m[1] ? Number(m[1]) : 0;
    if (n !== 0 && freq !== "MONTHLY" && freq !== "YEARLY") return { unsupported: `has BYDAY=${d} on a ${freq.toLowerCase()} rule` };
    byDay.push({ n, dow: DOW[m[2]!]! });
  }
  const nums = (s: string | undefined, lo: number, hi: number) =>
    (s ?? "").split(",").filter(Boolean).map(Number).filter((x) => Number.isInteger(x) && x !== 0 && Math.abs(x) >= lo && Math.abs(x) <= hi);
  const byMonthDay = nums(kv.BYMONTHDAY, 1, 31);
  const byMonth = nums(kv.BYMONTH, 1, 12).filter((x) => x > 0);
  if (byDay.some((d) => d.n !== 0) && freq === "YEARLY" && byMonth.length === 0) return { unsupported: "numbers weekdays within a year" };
  return { freq, interval, count, until, byDay, byMonthDay, byMonth, wkst: DOW[kv.WKST ?? "MO"] ?? 1 };
}

export function parseIcs(text: string): IcsCalendar {
  const lines = unfold(text);
  if (!lines.some((l) => l.toUpperCase() === "BEGIN:VCALENDAR")) throw new Error("This is not a calendar (ICS) file: it has no BEGIN:VCALENDAR.");
  let name: string | null = null;
  let timeZone: string | null = null;
  const events: VEvent[] = [];
  const stack: string[] = [];
  let cur: IcsProp[] | null = null;
  for (const line of lines) {
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      stack.push(p.value.toUpperCase());
      if (p.value.toUpperCase() === "VEVENT" && stack.length === 2) cur = [];
      continue;
    }
    if (p.name === "END") {
      const what = stack.pop();
      if (what === "VEVENT" && cur) {
        const ev = toEvent(cur);
        if (ev) events.push(ev);
        cur = null;
      }
      continue;
    }
    if (cur && stack.length === 2) cur.push(p);
    else if (stack.length === 1) {
      if (p.name === "X-WR-CALNAME") name = unescapeText(p.value).trim() || null;
      if (p.name === "X-WR-TIMEZONE") timeZone = p.value.trim() || null;
    }
  }
  return { name, timeZone, events };
}

function toEvent(props: IcsProp[]): VEvent | null {
  const one = (n: string) => props.find((p) => p.name === n);
  const text = (n: string) => {
    const p = one(n);
    const v = p ? unescapeText(p.value).trim() : "";
    return v || null;
  };
  const ds = one("DTSTART");
  const start = ds ? parseTime(ds.value, ds.params) : null;
  if (!start) return null;
  const de = one("DTEND");
  const end = de ? parseTime(de.value, de.params) : null;
  const du = one("DURATION");
  const durationMs = du ? parseDuration(du.value) : null;
  let rrule: Rrule | null = null;
  let unsupportedRule: string | null = null;
  const rr = one("RRULE");
  if (rr) {
    const r = parseRrule(rr.value);
    if ("unsupported" in r) unsupportedRule = r.unsupported;
    else rrule = r;
  }
  const exdates: IcsTime[] = [];
  for (const p of props.filter((x) => x.name === "EXDATE")) {
    for (const v of p.value.split(",")) {
      const t = parseTime(v, p.params);
      if (t) exdates.push(t);
    }
  }
  const rid = one("RECURRENCE-ID");
  return {
    uid: text("UID") ?? `${start.date}${start.time ?? ""}:${text("SUMMARY") ?? ""}`,
    summary: text("SUMMARY") ?? "",
    description: text("DESCRIPTION"),
    location: text("LOCATION"),
    url: text("URL"),
    status: text("STATUS")?.toUpperCase() ?? null,
    start,
    end,
    durationMs,
    rrule,
    unsupportedRule,
    exdates,
    recurrenceId: rid ? parseTime(rid.value, rid.params) : null,
  };
}

// ─── Text ───────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** A description as plain text: HTML line breaks kept, tags and entities removed. */
export function plainText(v: string | null): string | null {
  if (!v) return null;
  let s = v
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, (_, href: string, label: string) => (label.trim() && label.trim() !== href ? `${label.trim()} (${href})` : href))
    .replace(/<[^>]+>/g, "");
  for (let i = 0; i < 2; i++) {
    s = s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#") && k !== "#39") return String.fromCodePoint(Number(k.slice(1)));
      return ENTITIES[k] ?? m;
    });
  }
  s = s
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s ? s.slice(0, 2000) : null;
}

const URL_RE = /https?:\/\/[^\s<>"')]+/i;

export function isUrl(v: string | null): boolean {
  return !!v && /^https?:\/\/\S+$/i.test(v.trim());
}

function firstUrl(v: string | null): string | null {
  const m = v ? URL_RE.exec(v) : null;
  return m ? m[0].replace(/[.,;]+$/, "") : null;
}

/** "8:00 PM" */
export function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hh = h! % 12 === 0 ? 12 : h! % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
}

// ─── Expansion ──────────────────────────────────────────────────────────────

type Occ = { key: string; startMs: number | null; startDate: string; startTime: string | null };

function dow(dayN: number): number {
  return (((dayN + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

function ymd(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Does day `iso` match the BYDAY/BYMONTHDAY parts of a monthly (or yearly-within-month) rule? */
function monthDayMatch(iso: string, r: Rrule, startDay: number): boolean {
  const { y, m, d } = ymd(iso);
  const dim = daysInMonth(y, m);
  if (r.byMonthDay.length > 0) {
    if (!r.byMonthDay.some((x) => (x > 0 ? x === d : dim + x + 1 === d))) return false;
    if (r.byDay.length === 0) return true;
  }
  if (r.byDay.length > 0) {
    const wd = dow(dayNumber(iso));
    return r.byDay.some((b) => {
      if (b.dow !== wd) return false;
      if (b.n === 0) return true;
      const nth = Math.floor((d - 1) / 7) + 1;
      const fromEnd = Math.floor((dim - d) / 7) + 1;
      return b.n > 0 ? b.n === nth : -b.n === fromEnd;
    });
  }
  return d === startDay;
}

/** Occurrence start dates of a rule (local dates in the event's zone), from DTSTART up to `lastDay`. */
function ruleDates(start: string, r: Rrule, lastDay: string, untilDate: string | null, cap: number): string[] {
  const s = ymd(start);
  const s0 = dayNumber(start);
  const end = Math.min(dayNumber(lastDay), untilDate ? dayNumber(untilDate) : Infinity, s0 + 40000);
  const wkStart0 = s0 - ((dow(s0) - r.wkst + 7) % 7);
  const out: string[] = [];
  let counted = 0;
  for (let n = s0; n <= end; n++) {
    const iso = isoFromDay(n);
    const { y, m } = ymd(iso);
    let ok: boolean;
    switch (r.freq) {
      case "DAILY":
        ok = (n - s0) % r.interval === 0 && (r.byDay.length === 0 || r.byDay.some((b) => b.dow === dow(n))) && (r.byMonth.length === 0 || r.byMonth.includes(m));
        break;
      case "WEEKLY": {
        const days = r.byDay.length > 0 ? r.byDay.map((b) => b.dow) : [dow(s0)];
        ok = Math.floor((n - wkStart0) / 7) % r.interval === 0 && days.includes(dow(n)) && (r.byMonth.length === 0 || r.byMonth.includes(m));
        break;
      }
      case "MONTHLY":
        ok = ((y - s.y) * 12 + (m - s.m)) % r.interval === 0 && (r.byMonth.length === 0 || r.byMonth.includes(m)) && monthDayMatch(iso, r, s.d);
        break;
      case "YEARLY": {
        const months = r.byMonth.length > 0 ? r.byMonth : [s.m];
        const sameDay = r.byDay.length === 0 && r.byMonthDay.length === 0;
        ok = (y - s.y) % r.interval === 0 && months.includes(m) && (sameDay ? ymd(iso).d === s.d : monthDayMatch(iso, r, s.d));
        break;
      }
    }
    // DTSTART always counts as the first occurrence (RFC 5545 §3.8.5.3).
    if (!ok && n !== s0) continue;
    counted++;
    if (r.count !== null && counted > r.count) break;
    out.push(iso);
    if (out.length >= cap) break;
  }
  return out;
}

function timeKey(t: IcsTime, zone: string): string {
  if (!t.time) return t.date.replace(/-/g, "");
  if (t.utc || (t.tzid && validZone(t.tzid) && t.tzid !== zone)) {
    const ms = t.utc ? Date.parse(`${t.date}T${t.time}Z`) : localToUtc(t.date, t.time, t.tzid!);
    const l = utcToLocal(ms, zone);
    return `${l.date.replace(/-/g, "")}T${l.time.replace(/:/g, "")}`;
  }
  return `${t.date.replace(/-/g, "")}T${t.time.replace(/:/g, "")}`;
}

/** The zone an event's wall times are read in: its TZID, UTC for ...Z, else the feed's zone, else the organization's. */
function eventZone(t: IcsTime, feedZone: string): string {
  if (t.utc) return "UTC";
  return safeZone(t.tzid, feedZone);
}

function occurrences(ev: VEvent, feedZone: string, win: FeedWindow): Occ[] | { skip: string } {
  const zone = eventZone(ev.start, feedZone);
  const occ = (date: string): Occ => {
    const time = ev.start.time;
    const startMs = time ? (zone === "UTC" ? Date.parse(`${date}T${time}Z`) : localToUtc(date, time, zone)) : null;
    return { key: timeKey({ ...ev.start, date }, zone), startMs, startDate: date, startTime: time };
  };
  if (ev.unsupportedRule) return { skip: `its repeat rule ${ev.unsupportedRule}, which is not supported` };
  if (!ev.rrule) return [occ(ev.start.date)];
  let untilDate: string | null = null;
  if (ev.rrule.until) {
    const u = ev.rrule.until;
    untilDate = u.time && (u.utc || u.tzid) ? utcToLocal(u.utc ? Date.parse(`${u.date}T${u.time}Z`) : localToUtc(u.date, u.time, safeZone(u.tzid, zone)), zone).date : u.date;
  }
  const lastDay = addDays(win.recurTo, 1); // a little slack for zone shifts; filtered below
  const dates = ruleDates(ev.start.date, ev.rrule, lastDay, untilDate, 40000);
  const ex = new Set(ev.exdates.map((t) => (t.time ? timeKey(t, zone) : t.date.replace(/-/g, ""))));
  const out: Occ[] = [];
  for (const d of dates) {
    const o = occ(d);
    if (ev.rrule.until && o.startMs !== null && ev.rrule.until.time) {
      const u = ev.rrule.until;
      const untilMs = u.utc ? Date.parse(`${u.date}T${u.time}Z`) : localToUtc(u.date, u.time!, safeZone(u.tzid, zone));
      if (o.startMs > untilMs) continue;
    }
    if (ex.has(o.key) || ex.has(o.key.slice(0, 8))) continue;
    out.push(o);
  }
  return out;
}

function entryFor(ev: VEvent, o: Occ, uid: string, displayZone: string): FeedEntry {
  const title = (ev.summary.trim() || "Untitled").replace(/\s+/g, " ").slice(0, 160);
  const location = ev.location ? ev.location.replace(/\s+/g, " ").trim().slice(0, 300) : null;
  const notes = plainText(ev.description);
  const link = (isUrl(location) ? location : null) ?? (isUrl(ev.url) ? ev.url : null) ?? firstUrl(notes);
  const place = location && !isUrl(location) ? location : null;
  if (o.startTime === null) {
    // All-day: DTEND is exclusive; DURATION counts days.
    const startN = dayNumber(o.startDate);
    let days = 1;
    if (ev.end && !ev.end.time) days = Math.max(1, dayNumber(ev.end.date) - dayNumber(ev.start.date));
    else if (ev.durationMs !== null) days = Math.max(1, Math.round(ev.durationMs / DAY_MS));
    const endsOn = isoFromDay(startN + days - 1);
    return { uid, title, starts_on: o.startDate, ends_on: endsOn === o.startDate ? null : endsOn, all_day: true, starts_at: null, ends_at: null, location, notes, link, sub: place };
  }
  const startMs = o.startMs!;
  let durMs = 0;
  if (ev.end && ev.end.time) {
    const z = eventZone(ev.end, eventZone(ev.start, displayZone));
    const s = ev.start;
    const s0 = s.utc ? Date.parse(`${s.date}T${s.time}Z`) : localToUtc(s.date, s.time!, eventZone(s, displayZone));
    const e0 = ev.end.utc ? Date.parse(`${ev.end.date}T${ev.end.time}Z`) : localToUtc(ev.end.date, ev.end.time, z);
    durMs = Math.max(0, e0 - s0);
  } else if (ev.durationMs !== null) durMs = Math.max(0, ev.durationMs);
  const endMs = startMs + durMs;
  const ls = utcToLocal(startMs, displayZone);
  const le = utcToLocal(endMs, displayZone);
  // An end exactly at midnight belongs to the day before.
  const endDate = durMs > 0 && le.time === "00:00:00" ? addDays(le.date, -1) : le.date;
  const when = durMs > 0 ? `${clock(ls.time)} – ${clock(le.time)}` : clock(ls.time);
  return {
    uid,
    title,
    starts_on: ls.date,
    ends_on: endDate > ls.date ? endDate : null,
    all_day: false,
    starts_at: new Date(startMs).toISOString(),
    ends_at: durMs > 0 ? new Date(endMs).toISOString() : null,
    location,
    notes,
    link,
    sub: [when, place].filter(Boolean).join(" · "),
  };
}

/**
 * The entries of a feed for one window, in the organization's time zone.
 * A repeating event's occurrences get the UID "<UID>#<local start>" so a
 * refresh updates the same rows; a one-off keeps its UID.
 */
export function expandCalendar(cal: IcsCalendar, opts: { displayZone: string; window: FeedWindow }): ExpandResult {
  const displayZone = safeZone(opts.displayZone, "UTC");
  const feedZone = safeZone(cal.timeZone, displayZone);
  const win = opts.window;
  const skipped: ExpandResult["skipped"] = [];
  const overrides = new Map<string, VEvent>();
  for (const ev of cal.events) {
    if (ev.recurrenceId) overrides.set(`${ev.uid}|${timeKey(ev.recurrenceId, eventZone(ev.recurrenceId, eventZone(ev.start, feedZone)))}`, ev);
  }
  const byUid = new Map<string, FeedEntry>();
  for (const ev of cal.events) {
    if (ev.recurrenceId) continue;
    if (ev.status === "CANCELLED") continue;
    const occ = occurrences(ev, feedZone, win);
    if (!Array.isArray(occ)) {
      skipped.push({ uid: ev.uid, title: ev.summary, reason: occ.skip });
      continue;
    }
    let n = 0;
    for (const o of occ) {
      const recurring = ev.rrule !== null;
      const uid = recurring ? `${ev.uid}#${o.key}` : ev.uid;
      const over = recurring ? overrides.get(`${ev.uid}|${o.key}`) : undefined;
      if (over && over.status === "CANCELLED") continue;
      let entry: FeedEntry;
      if (over) {
        const oz = eventZone(over.start, feedZone);
        const ms = over.start.time ? (oz === "UTC" ? Date.parse(`${over.start.date}T${over.start.time}Z`) : localToUtc(over.start.date, over.start.time, oz)) : null;
        entry = entryFor(over, { key: o.key, startMs: ms, startDate: over.start.date, startTime: over.start.time }, uid, displayZone);
      } else entry = entryFor(ev, o, uid, displayZone);
      const lastDay = entry.ends_on ?? entry.starts_on;
      const keep = recurring ? entry.starts_on >= win.recurFrom && entry.starts_on <= win.recurTo : lastDay >= win.from && entry.starts_on <= win.to;
      if (!keep) continue;
      if (++n > MAX_OCCURRENCES_PER_EVENT) {
        skipped.push({ uid: ev.uid, title: ev.summary, reason: `more than ${MAX_OCCURRENCES_PER_EVENT} dates in the window; the rest were left out` });
        break;
      }
      byUid.set(uid, entry);
    }
  }
  const entries = [...byUid.values()].sort((a, b) => a.starts_on.localeCompare(b.starts_on) || (a.starts_at ?? "").localeCompare(b.starts_at ?? "") || a.uid.localeCompare(b.uid));
  if (entries.length > MAX_ENTRIES) throw new Error(`This calendar has ${entries.length} dates in the window; the most a subscription takes is ${MAX_ENTRIES}.`);
  return { entries, skipped };
}

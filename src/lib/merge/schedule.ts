// When a scheduled email goes (0771), in plain words for the screens: "Every month on day 1 at 9:00 AM". The database works out
// the moment itself (app._email_schedule_next), in the community's time zone; this only says it.
//
// Pure (no "@/" imports).

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export function isFrequency(v: unknown): v is Frequency {
  return typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);
}

export type ScheduleTiming = {
  frequency: Frequency;
  /** 0 = Sunday … 6 = Saturday (weekly). */
  day_of_week?: number | null;
  /** 1 to 28 (monthly and yearly: every month has it). */
  day_of_month?: number | null;
  /** 1 to 12 (yearly). */
  month?: number | null;
  /** 0 to 23, the community's own clock. */
  hour: number;
};

function safe(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0 ? locale : "en-US";
  } catch {
    return "en-US";
  }
}

/** "9:00 AM" / "09:00": an hour of the day in the locale's way. */
export function hourLabel(hour: number, locale = "en-US"): string {
  const h = Math.min(23, Math.max(0, Math.trunc(hour)));
  return new Intl.DateTimeFormat(safe(locale), { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4, h, 0)));
}

/** "Monday": 2026-01-04 was a Sunday, so day n of that week is weekday n. */
export function weekdayLabel(day: number, locale = "en-US"): string {
  const d = Math.min(6, Math.max(0, Math.trunc(day)));
  return new Intl.DateTimeFormat(safe(locale), { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + d)));
}

export function monthLabel(month: number, locale = "en-US"): string {
  const m = Math.min(12, Math.max(1, Math.trunc(month)));
  return new Intl.DateTimeFormat(safe(locale), { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 1)));
}

export function scheduleSentence(t: ScheduleTiming, locale = "en-US"): string {
  const at = `at ${hourLabel(t.hour, locale)}`;
  switch (t.frequency) {
    case "daily":
      return `Every day ${at}`;
    case "weekly":
      return `Every week on ${weekdayLabel(t.day_of_week ?? 1, locale)} ${at}`;
    case "monthly":
      return `Every month on day ${t.day_of_month ?? 1} ${at}`;
    case "yearly":
      return `Every year on ${monthLabel(t.month ?? 1, locale)} ${t.day_of_month ?? 1} ${at}`;
  }
}

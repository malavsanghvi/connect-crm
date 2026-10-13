// How an automatic email writes money and dates: the community's currency, its locale (its main language in its country,
// src/lib/languages.ts communityLocale) and its time zone. The same formatter the screens use for money (formatCents), so the
// preview and the email agree to the cent.
//
// Pure (no "@/" imports): the background service imports it too.

import { communityLanguages, communityLocale } from "../languages";
import { formatCents } from "../money";

export type EmailPlace = { currency: string; locale: string; timeZone: string };

/** The place a community writes from, from what the database returned (any field may be missing). */
export function emailPlace(center: { currency?: unknown; time_zone?: unknown; country?: unknown; languages?: unknown } | null | undefined): EmailPlace {
  const currency = typeof center?.currency === "string" && /^[A-Z]{3}$/.test(center.currency) ? center.currency : "USD";
  const tz = typeof center?.time_zone === "string" && validZone(center.time_zone) ? center.time_zone : "UTC";
  const country = typeof center?.country === "string" ? center.country : null;
  const locale = safeLocale(communityLocale(communityLanguages(Array.isArray(center?.languages) ? center.languages : null), country));
  return { currency, locale, timeZone: tz };
}

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function safeLocale(locale: string): string {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0 ? locale : "en-US";
  } catch {
    return "en-US";
  }
}

export function emailMoney(cents: number | null | undefined, place: EmailPlace): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  try {
    return formatCents(Number(cents), place.currency, place.locale);
  } catch {
    return formatCents(Number(cents), place.currency, "en-US");
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date ("2026-10-13") in the community's words: "October 13, 2026", "13 October 2026", "13 de octubre de 2026". */
export function emailDay(value: string | null | undefined, place: EmailPlace): string | null {
  if (!value) return null;
  const m = DATE_ONLY.exec(value.slice(0, 10));
  if (m && value.length === 10) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return new Intl.DateTimeFormat(place.locale, { dateStyle: "long", timeZone: "UTC" }).format(d);
  }
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat(place.locale, { dateStyle: "long", timeZone: place.timeZone }).format(t);
}

/** An event's day with its weekday, in the community's time zone: "Saturday, November 7, 2026". */
export function emailEventDay(value: string | null | undefined, place: EmailPlace): string | null {
  if (!value) return null;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat(place.locale, { dateStyle: "full", timeZone: place.timeZone }).format(t);
}

/** A time of day in the community's time zone: "6:30 PM", "18:30". */
export function emailTime(value: string | null | undefined, place: EmailPlace): string | null {
  if (!value) return null;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  return new Intl.DateTimeFormat(place.locale, { timeStyle: "short", timeZone: place.timeZone }).format(t);
}

/** A list of names in the community's language: "A, B and C". */
export function emailList(items: readonly string[], place: EmailPlace): string | null {
  const list = [...new Set(items.map((s) => s.trim()).filter(Boolean))];
  if (list.length === 0) return null;
  try {
    return new Intl.ListFormat(place.locale, { style: "long", type: "conjunction" }).format(list);
  } catch {
    return list.join(", ");
  }
}

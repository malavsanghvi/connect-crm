// The live schedule Niva may answer from (migration 0574, app.niva_worker_center_facts): the community's local date
// and time, its address and phone, regular and daily timings for today and the next seven days, and the upcoming
// events every member can already see in the app. Owner decision 2026-10-01: published events, daily timings and
// the address only. Nothing here is about a person: no RSVPs, pledges, payments, people or households reach the
// database function's output, so none can reach the prompt. Giving items (campaigns, opportunities, bolis) are
// deliberately left out.
//
// niva.answer offers these as "live" sources next to the approved ones, in the same list of ids the model may cite
// (so it stays one call): event:<uuid>, timings:<YYYY-MM-DD>, center:address and center:hours. A cited one is stored
// on the conversation as {kind, id, title}.

import type { JobContext } from "../types";

export type LiveKind = "event" | "timings" | "center";

/** A live item, shaped like a search result so the prompt and the citation check treat both alike. */
export type LiveSource = {
  id: string;
  kind: "live";
  title: string;
  body_md: string;
  rank: number;
  /** What is stored on the conversation when this is cited. */
  live: { kind: LiveKind; id: string };
};

export type DayTimings = {
  on_date: string;
  day_label?: string;
  sunrise?: string;
  sunset?: string;
  navkarsi?: string;
  chauvihar?: string;
  aarti?: string;
  temple_open?: string;
  temple_close?: string;
};

export type LiveEvent = {
  id: string;
  name: string;
  venue?: string;
  starts_local?: string;
  ends_local?: string;
  starts_label?: string;
  ends_label?: string;
  happening_now?: boolean;
  /** Over: it ended (or started more than six hours ago with no end), as the member app counts it. */
  ended?: boolean;
  rsvp?: "open" | "closed" | "not_open_yet";
  rsvp_opens_label?: string;
  rsvp_closes_label?: string;
};

export type CenterFacts = {
  center_name?: string | null;
  time_zone?: string;
  local_now?: string;
  local_today?: string;
  today_label?: string;
  time_label?: string;
  days?: number;
  contact?: { place_name?: string; address?: string; address_note?: string; phone?: string; website?: string } | null;
  regular_timings?: { derasar_hours?: string; aarti?: string; snatra_puja?: string } | null;
  daily_timings?: DayTimings[];
  events?: LiveEvent[];
};

/** How many days ahead events are offered. */
export const FACT_DAYS = 14;

/**
 * Words that mean the question is about a time, a day, a place or an event. Kept small on purpose: the facts are
 * also offered whenever search finds fewer than two sources, and when the question names an upcoming event.
 */
const FACT_WORDS = new RegExp(
  "\\b(?:" +
    [
      "when", "what time", "today", "tonight", "tomorrow", "now", "this (?:week|weekend|month|morning|afternoon|evening)",
      "next (?:week|weekend|month)", "weekends?", "upcoming", "coming up", "schedule", "calendar", "dates?",
      "mondays?", "tuesdays?", "wednesdays?", "thursdays?", "fridays?", "saturdays?", "sundays?",
      "events?", "programs?", "programmes?", "functions?", "pujas?", "poojas?", "pujan", "classe?s?", "festivals?", "celebrations?",
      "mahotsav", "jayanti", "rsvp",
      "open(?:s|ing)?", "clos(?:e|es|ed|ing)", "hours?", "timings?", "times?", "sunrise", "sunset",
      "navkarsi", "navkarshi", "porsi", "chauvihar", "chovihar", "choviar", "aarti", "arti", "darshan",
      "where", "address", "located", "location", "directions?", "parking", "phone", "contact",
    ].join("|") +
    ")\\b",
  "i",
);
/** The same in Gujarati and Hindi: today, tomorrow, when, where, time. */
const FACT_WORDS_GU_HI = /આજે|આજ|કાલે|આવતીકાલે|ક્યારે|ક્યાં|સમય|आज|कल|कब|कहाँ|कहां|समय/u;

export function asksAboutTimeOrPlace(text: string): boolean {
  return FACT_WORDS.test(text) || FACT_WORDS_GU_HI.test(text);
}

const NAME_STOP = new Set(["about", "after", "annual", "event", "evening", "morning", "night", "program", "programme", "special", "their", "there", "these", "where", "which", "while"]);

/** Whether the question names one of the upcoming events ("Is there lunch at the Tapasvi Bahuman?"). */
export function namesAnEvent(text: string, facts: CenterFacts | null): boolean {
  const events = facts?.events ?? [];
  if (events.length === 0) return false;
  const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return events.some((e) =>
    (e.name ?? "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.some((w) => w.length >= 5 && !NAME_STOP.has(w) && words.has(w)),
  );
}

/** app.niva_worker_center_facts, or null when the database does not have it yet (0574 not applied). */
export async function loadCenterFacts(ctx: JobContext, centerId: string, conversationId: string): Promise<CenterFacts | null> {
  try {
    const rows = await ctx.db.query<{ r: CenterFacts | null }>("select app.niva_worker_center_facts($1, $2) as r", [centerId, FACT_DAYS]);
    return rows[0]?.r ?? null;
  } catch (err) {
    // 42883: the function is not on this database yet; Niva answers from its sources alone.
    if ((err as { code?: unknown } | null)?.code !== "42883") throw err;
    ctx.log.warn("niva.answer: this database has no live schedule for Niva yet; answering from sources only", { conversation_id: conversationId });
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function lines(pairs: [string, unknown][]): string {
  return pairs
    .map(([label, v]) => [label, str(v)] as const)
    .filter((p): p is readonly [string, string] => p[1] !== null)
    .map(([label, v]) => `${label}: ${v}`)
    .join("\n");
}

function eventBody(e: LiveEvent): string {
  const when = str(e.starts_label) ? `${e.starts_label}${str(e.ends_label) ? ` to ${e.ends_label}` : ""}` : null;
  const rsvp =
    e.rsvp === "closed"
      ? "closed"
      : e.rsvp === "not_open_yet"
        ? `not open yet${str(e.rsvp_opens_label) ? ` (opens ${e.rsvp_opens_label})` : ""}`
        : e.rsvp === "open"
          ? `open in the app${str(e.rsvp_closes_label) ? ` until ${e.rsvp_closes_label}` : ""}`
          : null;
  const body = lines([
    ["When", when],
    ["Where", e.venue],
    ["RSVP", rsvp],
  ]);
  const now = e.ended ? "This event is already over." : e.happening_now ? "Happening now." : "";
  return now ? `${body}\n${now}`.trim() : body;
}

function dayBody(d: DayTimings): string {
  const derasar = str(d.temple_open) && str(d.temple_close) ? `${d.temple_open} to ${d.temple_close}` : (str(d.temple_open) ? `opens ${d.temple_open}` : null);
  return lines([
    ["Sunrise", d.sunrise],
    ["Navkarsi", d.navkarsi],
    ["Sunset", d.sunset],
    ["Chauvihar", str(d.chauvihar) ? `by ${d.chauvihar}` : null],
    ["Derasar open", derasar],
    ["Aarti", d.aarti],
  ]);
}

/** The facts as live sources: the address, regular timings, each day's timings, then the events in start order. */
export function liveSources(facts: CenterFacts | null): LiveSource[] {
  if (!facts) return [];
  const out: LiveSource[] = [];
  const add = (kind: LiveKind, id: string, title: string, body: string) => {
    if (body.trim()) out.push({ id: `${kind}:${id}`, kind: "live", title, body_md: body, rank: 0, live: { kind, id } });
  };
  const c = facts.contact ?? null;
  if (c) {
    add("center", "address", "Address and contact", lines([
      ["Place", c.place_name], ["Address", c.address], ["Note", c.address_note], ["Phone", c.phone], ["Website", c.website],
    ]));
  }
  const h = facts.regular_timings ?? null;
  if (h) {
    add("center", "hours", "Regular timings", lines([["Derasar hours", h.derasar_hours], ["Aarti", h.aarti], ["Snatra puja", h.snatra_puja]]));
  }
  for (const d of Array.isArray(facts.daily_timings) ? facts.daily_timings : []) {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.on_date ?? "")) continue;
    add("timings", d.on_date, `Timings for ${str(d.day_label) ?? d.on_date}`, dayBody(d));
  }
  for (const e of Array.isArray(facts.events) ? facts.events : []) {
    if (!e || !str(e.id) || !str(e.name)) continue;
    add("event", e.id, e.name.trim(), eventBody(e));
  }
  return out;
}

/** "10:05 AM on Friday, 2 October 2026": when the live schedule was read, in the community's time. */
export function liveAsOf(facts: CenterFacts | null): string | null {
  if (!facts) return null;
  const time = str(facts.time_label);
  const day = str(facts.today_label);
  return time && day ? `${time} on ${day}` : day;
}

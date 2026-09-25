import { describe, expect, it } from "vitest";

import { assertPublicUrl, fetchFeed, isPrivateAddress, normalizeFeedUrl, syncLayer } from "../src/calendar/feed";
import { expandCalendar, feedWindow, localToUtc, parseDuration, parseIcs, parseLine, parseRrule, plainText, unfold, utcToLocal } from "../src/calendar/ics";
import { PermanentError } from "../src/errors";
import type { Http, HttpResponse } from "../src/http";
import * as importFeed from "../src/handlers/calendar.import_feed";
import * as refreshFeeds from "../src/handlers/calendar.refresh_feeds";
import { captureLog, fakeDb, job } from "./helpers";

const WIN = feedWindow("2026-09-25");
const ZONE = "America/Chicago";

function cal(body: string, head = "X-WR-TIMEZONE:America/Chicago"): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", head, body.trim(), "END:VCALENDAR"].join("\r\n");
}
function ev(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}
const expand = (text: string, window = WIN) => expandCalendar(parseIcs(text), { displayZone: ZONE, window });

describe("ICS parsing", () => {
  it("unfolds continuation lines and splits parameters outside quotes", () => {
    expect(unfold("SUMMARY:Hello\r\n  world\r\nX:1")).toEqual(["SUMMARY:Hello world", "X:1"]);
    expect(parseLine('X-APPLE;X-TITLE="A, B: C":geo:1,2')).toEqual({ name: "X-APPLE", params: { "X-TITLE": "A, B: C" }, value: "geo:1,2" });
    expect(parseLine("DTSTART;TZID=America/Chicago:20260228T092000")).toMatchObject({ params: { TZID: "America/Chicago" }, value: "20260228T092000" });
  });

  it("reads durations and rules, and says which rules it will not guess at", () => {
    expect(parseDuration("PT1H30M")).toBe(5400000);
    expect(parseDuration("P1D")).toBe(86400000);
    expect(parseRrule("FREQ=WEEKLY;BYDAY=TU,TH;INTERVAL=2")).toMatchObject({ freq: "WEEKLY", interval: 2, byDay: [{ n: 0, dow: 2 }, { n: 0, dow: 4 }] });
    expect(parseRrule("FREQ=MONTHLY;BYDAY=-1FR")).toMatchObject({ byDay: [{ n: -1, dow: 5 }] });
    expect(parseRrule("FREQ=HOURLY")).toEqual({ unsupported: "repeats hourly" });
    expect(parseRrule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1")).toEqual({ unsupported: "uses BYSETPOS" });
  });

  it("turns HTML descriptions into plain text with the links kept", () => {
    expect(plainText('Zoom Link:&nbsp; <a href="https://bit.ly/x">https://bit.ly/x</a><br>Passcode: 108 &amp; more')).toBe("Zoom Link: https://bit.ly/x\nPasscode: 108 & more");
    expect(plainText('<a href="https://a.co/d">Band</a>')).toBe("Band (https://a.co/d)");
  });

  it("converts wall times across daylight saving", () => {
    expect(new Date(localToUtc("2026-03-08", "10:00:00", ZONE)).toISOString()).toBe("2026-03-08T15:00:00.000Z");
    expect(new Date(localToUtc("2026-03-07", "10:00:00", ZONE)).toISOString()).toBe("2026-03-07T16:00:00.000Z");
    expect(utcToLocal(Date.parse("2026-11-01T07:30:00Z"), ZONE)).toEqual({ date: "2026-11-01", time: "01:30:00" });
  });

  it("refuses something that is not a calendar", () => {
    expect(() => parseIcs("<html>Not found</html>")).toThrow(/not a calendar/);
  });
});

describe("ICS expansion", () => {
  it("keeps one-off events in the organization's zone, all-day end dates inclusive", () => {
    const r = expand(cal([
      ev(["UID:a", "SUMMARY:Puja", "DTSTART:20261018T143000Z", "DTEND:20261018T160000Z", "LOCATION:Derasar"]),
      ev(["UID:b", "SUMMARY:Weekend", "DTSTART;VALUE=DATE:20260417", "DTEND;VALUE=DATE:20260420"]),
      ev(["UID:c", "SUMMARY:Evening", "DTSTART:20260330T010000Z", "DTEND:20260330T020000Z"]),
    ].join("\r\n")));
    expect(r.entries.find((e) => e.uid === "a")).toMatchObject({ starts_on: "2026-10-18", sub: "9:30 AM – 11:00 AM · Derasar", all_day: false });
    expect(r.entries.find((e) => e.uid === "b")).toMatchObject({ starts_on: "2026-04-17", ends_on: "2026-04-19", all_day: true, starts_at: null });
    // 01:00 UTC on the 30th is the evening of the 29th in Houston.
    expect(r.entries.find((e) => e.uid === "c")).toMatchObject({ starts_on: "2026-03-29", sub: "8:00 PM – 9:00 PM" });
  });

  it("expands weekly rules at the same wall time through DST, with per-occurrence UIDs", () => {
    const r = expand(cal(ev(["UID:w", "SUMMARY:Class", "DTSTART;TZID=America/Chicago:20261025T200000", "DTEND;TZID=America/Chicago:20261025T210000",
      "RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=3"])));
    expect(r.entries.map((e) => [e.uid, e.starts_at])).toEqual([
      ["w#20261025T200000", "2026-10-26T01:00:00.000Z"],
      ["w#20261101T200000", "2026-11-02T02:00:00.000Z"],
      ["w#20261108T200000", "2026-11-09T02:00:00.000Z"],
    ]);
  });

  it("honours UNTIL, INTERVAL, EXDATE, overrides and cancellations", () => {
    const r = expand(cal([
      ev(["UID:d", "SUMMARY:Daily", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261007", "EXDATE;VALUE=DATE:20261003"]),
      ev(["UID:m", "SUMMARY:Monthly", "DTSTART;TZID=America/Chicago:20261002T190000", "RRULE:FREQ=MONTHLY;BYDAY=1FR;COUNT=3"]),
      ev(["UID:m", "SUMMARY:Monthly (moved)", "RECURRENCE-ID;TZID=America/Chicago:20261106T190000", "DTSTART;TZID=America/Chicago:20261107T190000"]),
      ev(["UID:x", "SUMMARY:Gone", "STATUS:CANCELLED", "DTSTART;VALUE=DATE:20261010"]),
    ].join("\r\n")));
    expect(r.entries.filter((e) => e.uid.startsWith("d#")).map((e) => e.starts_on)).toEqual(["2026-10-01", "2026-10-05", "2026-10-07"]);
    const monthly = r.entries.filter((e) => e.uid.startsWith("m#"));
    expect(monthly.map((e) => [e.title, e.starts_on])).toEqual([
      ["Monthly", "2026-10-02"],
      ["Monthly (moved)", "2026-11-07"],
      ["Monthly", "2026-12-04"],
    ]);
    expect(r.entries.some((e) => e.title === "Gone")).toBe(false);
  });

  it("limits repeating events to the window and reports rules it skipped", () => {
    const r = expand(cal([
      ev(["UID:long", "SUMMARY:Forever", "DTSTART;VALUE=DATE:20200101", "RRULE:FREQ=WEEKLY"]),
      ev(["UID:h", "SUMMARY:Hourly", "DTSTART:20261001T100000Z", "RRULE:FREQ=HOURLY"]),
      ev(["UID:far", "SUMMARY:Reminder", "DTSTART;TZID=America/Chicago:20290201T083000", "RRULE:FREQ=WEEKLY;BYDAY=MO"]),
    ].join("\r\n")));
    const weekly = r.entries.filter((e) => e.uid.startsWith("long#"));
    expect(weekly[0]!.starts_on >= WIN.recurFrom).toBe(true);
    expect(weekly[weekly.length - 1]!.starts_on <= WIN.recurTo).toBe(true);
    expect(r.entries.some((e) => e.uid.startsWith("far#"))).toBe(false);
    expect(r.skipped).toEqual([{ uid: "h", title: "Hourly", reason: "its repeat rule repeats hourly, which is not supported" }]);
  });
});

describe("public calendar links only", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["142.250.72.14", "8.8.8.8", "2607:f8b0:4009:80b::200e"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("refuses private hosts, odd schemes and credentials; reads webcal:// as https://", async () => {
    const resolve = async (h: string) => (h === "calendar.example.org" ? ["93.184.216.34"] : ["10.0.0.5"]);
    expect(normalizeFeedUrl("webcal://x.org/a.ics")).toBe("https://x.org/a.ics");
    await expect(assertPublicUrl("webcal://calendar.example.org/a.ics", { allowPrivate: false, resolve })).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("https://intranet.example.org/a.ics", { allowPrivate: false, resolve })).rejects.toThrow(/private address/);
    await expect(assertPublicUrl("http://127.0.0.1:8080/a.ics", { allowPrivate: false, resolve })).rejects.toBeInstanceOf(PermanentError);
    await expect(assertPublicUrl("http://localhost/a.ics", { allowPrivate: false, resolve })).rejects.toThrow(/private address/);
    await expect(assertPublicUrl("file:///etc/passwd", { allowPrivate: false, resolve })).rejects.toThrow(/https:\/\//);
    await expect(assertPublicUrl("https://u:p@calendar.example.org/a.ics", { allowPrivate: false, resolve })).rejects.toThrow(/user name or password/);
    await expect(assertPublicUrl("http://localhost:9000/a.ics", { allowPrivate: true, resolve })).resolves.toBeInstanceOf(URL);
  });

  it("re-checks every redirect and refuses a redirect into a private network", async () => {
    const resolve = async (h: string) => (h === "public.example.org" ? ["93.184.216.34"] : ["192.168.0.10"]);
    const http = fakeHttp([{ status: 302, headers: { location: "http://router.example.org/admin" }, text: "" }]);
    await expect(fetchFeed(http, "https://public.example.org/cal.ics", { allowPrivate: false, resolve })).rejects.toThrow(/private address/);
    expect(http.calls).toEqual(["https://public.example.org/cal.ics"]);
  });

  it("explains a missing or non-calendar feed in plain English", async () => {
    const resolve = async () => ["93.184.216.34"];
    await expect(fetchFeed(fakeHttp([{ status: 404, text: "" }]), "https://a.org/x.ics", { allowPrivate: false, resolve })).rejects.toThrow(/was not found/);
    await expect(fetchFeed(fakeHttp([{ status: 200, text: "<html></html>" }]), "https://a.org/x.ics", { allowPrivate: false, resolve })).rejects.toThrow(/does not return a calendar/);
  });
});

describe("calendar jobs", () => {
  const FEED = cal(ev(["UID:a", "SUMMARY:Puja", "DTSTART:20261018T143000Z", "DTEND:20261018T160000Z"]));
  const layer = { layer_id: "11111111-1111-4111-8111-111111111111", center_id: "c", source_url: "http://localhost:9/cal.ics", time_zone: ZONE, name: "Events" };

  it("calendar.import_feed fetches, expands and hands the entries to the database", async () => {
    const { db, calls } = fakeDb({
      query: (text) => (text.includes("worker_calendar_feed_layer") ? [layer] : text.includes("worker_calendar_feed_import") ? [{ result: { inserted: 1 } }] : []),
    });
    const { log } = captureLog();
    const out = await importFeed.run(job({ kind: "calendar.import_feed", payload: { layer_id: layer.layer_id } }), ctx(db, fakeHttp([{ status: 200, text: FEED }]), log));
    expect(out).toMatchObject({ entries: 1, result: { inserted: 1 } });
    const imp = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("worker_calendar_feed_import"))!;
    const [id, entries, keepBefore] = imp.args[1] as [string, string, string];
    expect(id).toBe(layer.layer_id);
    expect(JSON.parse(entries)).toEqual([expect.objectContaining({ uid: "a", starts_on: "2026-10-18" })]);
    expect(keepBefore).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("calendar.import_feed records a failure on the layer and fails the job", async () => {
    const { db, calls } = fakeDb({ query: (text) => (text.includes("worker_calendar_feed_layer") ? [layer] : []) });
    const { log } = captureLog();
    await expect(importFeed.run(job({ kind: "calendar.import_feed", payload: { layer_id: layer.layer_id } }), ctx(db, fakeHttp([{ status: 404, text: "" }]), log))).rejects.toThrow(/not found/);
    const failed = calls.find((c) => c.fn === "query" && String(c.args[0]).includes("worker_calendar_feed_failed"))!;
    expect((failed.args[1] as string[])[1]).toMatch(/not found/);
  });

  it("calendar.refresh_feeds refreshes every due layer and carries on past a failure", async () => {
    const other = { ...layer, layer_id: "22222222-2222-4222-8222-222222222222", name: "Broken" };
    const { db } = fakeDb({
      query: (text) => (text.includes("worker_calendar_feeds_due") ? [layer, other] : text.includes("worker_calendar_feed_import") ? [{ result: {} }] : []),
    });
    const { log } = captureLog();
    const out = await refreshFeeds.run(job({ kind: "calendar.refresh_feeds", center_id: null }), ctx(db, fakeHttp([{ status: 200, text: FEED }, { status: 500, text: "" }]), log));
    expect(out).toMatchObject({ due: 2, refreshed: 1, failed: 1, failures: [{ name: "Broken" }] });
    expect(refreshFeeds.every).toBe(3600);
  });

  it("syncLayer passes the window's start as the date before which history is kept", async () => {
    const { db, calls } = fakeDb({ query: () => [{ result: {} }] });
    const { log } = captureLog();
    await syncLayer(layer, ctx(db, fakeHttp([{ status: 200, text: FEED }]), log), new Date("2026-09-25T12:00:00Z"));
    const imp = calls.find((c) => c.fn === "query")!;
    expect((imp.args[1] as string[])[2]).toBe("2026-03-29");
  });
});

type Canned = { status: number; text: string; headers?: Record<string, string> };
function fakeHttp(responses: Canned[]): Http & { calls: string[] } {
  const calls: string[] = [];
  const queue = [...responses];
  return {
    calls,
    async request(url) {
      calls.push(url);
      const r = queue.shift() ?? { status: 500, text: "" };
      const res: HttpResponse = { status: r.status, ok: r.status >= 200 && r.status < 300, headers: new Headers(r.headers ?? {}), text: r.text, json: () => JSON.parse(r.text) };
      return res;
    },
  };
}

function ctx(db: ReturnType<typeof fakeDb>["db"], http: Http, log: ReturnType<typeof captureLog>["log"]) {
  return {
    db, http, log, env: { CALENDAR_FEEDS_ALLOW_PRIVATE: "1" }, workerId: "t",
    secret: async () => null,
    storeSecret: async () => ({ fingerprint: "" }),
  };
}
